//go:build linux

package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
)

func TestCloseInheritedFDsFromSelectivelyClosesNonCloexecDescriptors(t *testing.T) {
	fdDir := t.TempDir()
	for _, name := range []string{"0", "1", "2", "3", "4", "5", "67", "not-a-fd"} {
		if err := os.WriteFile(filepath.Join(fdDir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	flagsByFD := map[int]int{
		3:  syscall.FD_CLOEXEC,
		4:  0,
		5:  syscall.FD_CLOEXEC,
		67: 0,
	}
	var closed []int
	count := closeInheritedFDsFrom(
		fdDir,
		func(fd int) (int, error) {
			flags, ok := flagsByFD[fd]
			if !ok {
				return 0, syscall.EBADF
			}
			return flags, nil
		},
		func(fd int) error {
			closed = append(closed, fd)
			return nil
		},
	)
	slices.Sort(closed)
	if count != 2 || !slices.Equal(closed, []int{4, 67}) {
		t.Fatalf("closed = %v (count=%d), want [4 67]", closed, count)
	}
}

func TestCloseInheritedFDsDropsInheritedSocketsInSubprocess(t *testing.T) {
	if os.Getenv("LINGER_TEST_CLOSE_FDS_HELPER") == "1" {
		closeInheritedFDs()
		for _, raw := range strings.Split(os.Getenv("LINGER_TEST_CHECK_FDS"), ",") {
			fd, err := strconv.Atoi(raw)
			if err != nil {
				fmt.Fprintf(os.Stderr, "invalid fd %q\n", raw)
				os.Exit(2)
			}
			if _, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), syscall.F_GETFD, 0); errno != syscall.EBADF {
				fmt.Fprintf(os.Stderr, "fd %d stayed open (errno=%v)\n", fd, errno)
				os.Exit(3)
			}
		}
		fmt.Println("closed")
		os.Exit(0)
	}

	tcpListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer tcpListener.Close()
	tcpFile, err := tcpListener.(*net.TCPListener).File()
	if err != nil {
		t.Fatal(err)
	}
	defer tcpFile.Close()

	unixPath := filepath.Join(t.TempDir(), "inherited.sock")
	unixListener, err := net.Listen("unix", unixPath)
	if err != nil {
		t.Fatal(err)
	}
	defer unixListener.Close()
	unixFile, err := unixListener.(*net.UnixListener).File()
	if err != nil {
		t.Fatal(err)
	}
	defer unixFile.Close()

	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestCloseInheritedFDsDropsInheritedSocketsInSubprocess$")
	// ExtraFiles maps onto FDs 3 and 4 without FD_CLOEXEC in the child.
	cmd.ExtraFiles = []*os.File{tcpFile, unixFile}
	cmd.Env = append(os.Environ(),
		"LINGER_TEST_CLOSE_FDS_HELPER=1",
		"LINGER_TEST_CHECK_FDS=3,4",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("helper failed: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "closed") {
		t.Fatalf("unexpected helper output: %s", output)
	}
}
