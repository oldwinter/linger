//go:build unix

package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestCloseInheritedFDsDropsInheritedSocketsInSubprocess(t *testing.T) {
	if os.Getenv("LINGER_TEST_CLOSE_FDS_HELPER") == "1" {
		closeInheritedFDs()
		for _, raw := range strings.Split(os.Getenv("LINGER_TEST_CHECK_FDS"), ",") {
			fd, err := strconv.Atoi(raw)
			if err != nil {
				fmt.Fprintf(os.Stderr, "invalid fd %q\n", raw)
				os.Exit(2)
			}
			if _, err := unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0); err != unix.EBADF {
				fmt.Fprintf(os.Stderr, "fd %d stayed open (err=%v)\n", fd, err)
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

	sockDir, err := os.MkdirTemp("", "lfd-")
	if err != nil {
		t.Fatal(err)
	}
	if len(filepath.Join(sockDir, "s.sock")) >= 100 {
		_ = os.RemoveAll(sockDir)
		sockDir, err = os.MkdirTemp("/tmp", "lfd-")
		if err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	unixPath := filepath.Join(sockDir, "s.sock")
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
