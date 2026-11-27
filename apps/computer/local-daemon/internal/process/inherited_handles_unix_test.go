//go:build unix

package process

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestCloseInheritedFDsFromSelectivelyClosesNonCloexecDescriptors(t *testing.T) {
	fdDir := t.TempDir()
	for _, name := range []string{"0", "1", "2", "3", "4", "5", "67", "not-a-fd"} {
		if err := os.WriteFile(filepath.Join(fdDir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	flagsByFD := map[int]int{
		3:  unix.FD_CLOEXEC,
		4:  0,
		5:  unix.FD_CLOEXEC,
		67: 0,
	}
	var closed []int
	count := closeInheritedFDsFrom(
		fdDir,
		func(fd int) (int, error) {
			flags, ok := flagsByFD[fd]
			if !ok {
				return 0, unix.EBADF
			}
			return flags, nil
		},
		func(fd int) error {
			closed = append(closed, fd)
			return nil
		},
		func() int { return 128 },
	)
	slices.Sort(closed)
	if count != 2 || !slices.Equal(closed, []int{4, 67}) {
		t.Fatalf("closed = %v (count=%d), want [4 67]", closed, count)
	}
}

func TestCloseInheritedFDsFallbackRangeClosesNonCloexecDescriptors(t *testing.T) {
	flagsByFD := map[int]int{
		3:  unix.FD_CLOEXEC,
		4:  0,
		11: 0,
		12: unix.FD_CLOEXEC,
	}
	var closed []int
	count := closeInheritedFDsFrom(
		filepath.Join(t.TempDir(), "missing-fd-dir"),
		func(fd int) (int, error) {
			flags, ok := flagsByFD[fd]
			if !ok {
				return 0, unix.EBADF
			}
			return flags, nil
		},
		func(fd int) error {
			closed = append(closed, fd)
			return nil
		},
		func() int { return 16 },
	)
	slices.Sort(closed)
	if count != 2 || !slices.Equal(closed, []int{4, 11}) {
		t.Fatalf("closed = %v (count=%d), want [4 11]", closed, count)
	}
}

func TestCloseInheritedHandlesDropsInheritedSocketsAndFilesInSubprocess(t *testing.T) {
	if os.Getenv("LINGER_TEST_CLOSE_HANDLES_HELPER") == "1" {
		CloseInheritedHandles()
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
		fmt.Println("ready")
		buf := make([]byte, 1)
		_, _ = os.Stdin.Read(buf)
		os.Exit(0)
	}

	tcpListener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	tcpAddr := tcpListener.Addr().String()
	tcpFile, err := tcpListener.(*net.TCPListener).File()
	if err != nil {
		_ = tcpListener.Close()
		t.Fatal(err)
	}

	sockDir, err := os.MkdirTemp("", "lfd-")
	if err != nil {
		_ = tcpFile.Close()
		_ = tcpListener.Close()
		t.Fatal(err)
	}
	if len(filepath.Join(sockDir, "s.sock")) >= 100 {
		_ = os.RemoveAll(sockDir)
		sockDir, err = os.MkdirTemp("/tmp", "lfd-")
		if err != nil {
			_ = tcpFile.Close()
			_ = tcpListener.Close()
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	unixPath := filepath.Join(sockDir, "s.sock")
	unixListener, err := net.Listen("unix", unixPath)
	if err != nil {
		_ = tcpFile.Close()
		_ = tcpListener.Close()
		t.Fatal(err)
	}
	defer unixListener.Close()
	unixFile, err := unixListener.(*net.UnixListener).File()
	if err != nil {
		_ = tcpFile.Close()
		_ = tcpListener.Close()
		t.Fatal(err)
	}
	defer unixFile.Close()

	appFile, err := os.Create(filepath.Join(t.TempDir(), "v8_context_snapshot.bin"))
	if err != nil {
		_ = tcpFile.Close()
		_ = tcpListener.Close()
		t.Fatal(err)
	}
	defer appFile.Close()

	exe, err := os.Executable()
	if err != nil {
		_ = tcpFile.Close()
		_ = tcpListener.Close()
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestCloseInheritedHandlesDropsInheritedSocketsAndFilesInSubprocess$")
	// ExtraFiles maps onto FDs 3, 4, and 5 without FD_CLOEXEC in the child.
	cmd.ExtraFiles = []*os.File{tcpFile, unixFile, appFile}
	cmd.Env = append(os.Environ(),
		"LINGER_TEST_CLOSE_HANDLES_HELPER=1",
		"LINGER_TEST_CHECK_FDS=3,4,5",
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = tcpFile.Close()
		_ = tcpListener.Close()
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		_ = tcpFile.Close()
		_ = tcpListener.Close()
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = tcpFile.Close()
		_ = tcpListener.Close()
		t.Fatal(err)
	}
	defer func() {
		_ = stdin.Close()
		_ = cmd.Wait()
	}()

	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "ready" {
		_ = tcpFile.Close()
		_ = tcpListener.Close()
		t.Fatalf("helper readiness = %q, err = %v", line, err)
	}

	// Close the parent's listener copies while the child stays alive; rebinding
	// the exact same TCP port proves the child no longer holds the socket.
	_ = tcpFile.Close()
	_ = tcpListener.Close()
	rebound, err := net.Listen("tcp4", tcpAddr)
	if err != nil {
		t.Fatalf("failed to rebind %s while child is alive: %v", tcpAddr, err)
	}
	_ = rebound.Close()

	_ = stdin.Close()
	if err := cmd.Wait(); err != nil {
		t.Fatalf("helper exited with error: %v", err)
	}
}
