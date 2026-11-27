//go:build windows

package process

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestParseIsolatedExecArgs(t *testing.T) {
	opts, err := ParseIsolatedExecArgs([]string{
		"--detached",
		"--windowed",
		"--no-stdio",
		"--allow-breakaway",
		"--cwd", `C:\work`,
		"--",
		`C:\node.exe`, "installer.js", "--resume",
	})
	if err != nil {
		t.Fatalf("ParseIsolatedExecArgs() error = %v", err)
	}
	if !opts.Detached || !opts.Windowed || !opts.NoStdio || !opts.AllowBreakaway {
		t.Fatalf("unexpected flags: %+v", opts)
	}
	if opts.Cwd != `C:\work` || opts.Executable != `C:\node.exe` {
		t.Fatalf("unexpected paths: %+v", opts)
	}
	if strings.Join(opts.Args, " ") != "installer.js --resume" {
		t.Fatalf("unexpected args: %v", opts.Args)
	}
	for _, invalid := range [][]string{
		nil,
		{"--detached"},
		{"--"},
		{"--", ""},
		{"--unknown", "--", "node.exe"},
		{"--cwd"},
	} {
		if _, err := ParseIsolatedExecArgs(invalid); err == nil {
			t.Fatalf("ParseIsolatedExecArgs(%v) succeeded, want error", invalid)
		}
	}
}

func TestBuildIsolatedExecCommandFlags(t *testing.T) {
	foreground := BuildIsolatedExecCommand(IsolatedExecOptions{Executable: "node.exe", Args: []string{"-v"}}, os.Stdin, os.Stdout, os.Stderr)
	if !foreground.SysProcAttr.HideWindow || foreground.SysProcAttr.NoInheritHandles {
		t.Fatalf("foreground SysProcAttr = %+v", foreground.SysProcAttr)
	}
	if foreground.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("foreground missing CREATE_NO_WINDOW: %+v", foreground.SysProcAttr)
	}

	detachedHidden := BuildIsolatedExecCommand(IsolatedExecOptions{Executable: "node.exe", Detached: true}, os.Stdin, os.Stdout, os.Stderr)
	if !detachedHidden.SysProcAttr.HideWindow || detachedHidden.SysProcAttr.NoInheritHandles {
		t.Fatalf("detachedHidden SysProcAttr = %+v", detachedHidden.SysProcAttr)
	}
	if detachedHidden.SysProcAttr.CreationFlags&(windows.CREATE_NEW_PROCESS_GROUP|windows.DETACHED_PROCESS) != windows.CREATE_NEW_PROCESS_GROUP|windows.DETACHED_PROCESS {
		t.Fatalf("detachedHidden flags = 0x%x", detachedHidden.SysProcAttr.CreationFlags)
	}

	detachedSetup := BuildIsolatedExecCommand(IsolatedExecOptions{
		Executable: "Linger-setup.exe",
		Args:       []string{"/update", "/relaunch"},
		Detached:   true,
		Windowed:   true,
		NoStdio:    true,
	}, os.Stdin, os.Stdout, os.Stderr)
	if detachedSetup.SysProcAttr.HideWindow || !detachedSetup.SysProcAttr.NoInheritHandles {
		t.Fatalf("detachedSetup SysProcAttr = %+v", detachedSetup.SysProcAttr)
	}
	if detachedSetup.Stdin != nil || detachedSetup.Stdout != nil || detachedSetup.Stderr != nil {
		t.Fatalf("NoStdio command attached stdio handles")
	}
	if detachedSetup.SysProcAttr.CreationFlags != windows.CREATE_NEW_PROCESS_GROUP {
		t.Fatalf("detachedSetup flags = 0x%x, want CREATE_NEW_PROCESS_GROUP", detachedSetup.SysProcAttr.CreationFlags)
	}
}

func TestRunIsolatedExecPreventsHandleInheritanceAndPreservesStdioAndExitCode(t *testing.T) {
	mode := os.Getenv("LINGER_TEST_ISOLATED_EXEC_HELPER")
	if mode == "foreground" {
		data, _ := io.ReadAll(os.Stdin)
		fmt.Printf("echo:%s\n", strings.TrimSpace(string(data)))
		os.Exit(7)
	}
	if mode == "detached" {
		readyFile := os.Getenv("LINGER_TEST_ISOLATED_READY")
		stopFile := os.Getenv("LINGER_TEST_ISOLATED_STOP")
		_ = os.WriteFile(readyFile, []byte("ok"), 0o600)
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			if _, err := os.Stat(stopFile); err == nil {
				os.Exit(0)
			}
			time.Sleep(20 * time.Millisecond)
		}
		os.Exit(0)
	}
	if mode == "runtime" {
		fmt.Println("runtime-ready")
		buf := make([]byte, 1)
		_, _ = os.Stdin.Read(buf)
		os.Exit(0)
	}

	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}

	// 1. Foreground isolated command preserves stdio and custom exit code.
	t.Run("foreground-stdio-and-exit-code", func(t *testing.T) {
		t.Setenv("LINGER_TEST_ISOLATED_EXEC_HELPER", "foreground")
		cmd := BuildIsolatedExecCommand(IsolatedExecOptions{
			Executable: exe,
			Args:       []string{"-test.run=^TestRunIsolatedExecPreventsHandleInheritanceAndPreservesStdioAndExitCode$"},
		}, nil, nil, nil)
		cmd.Stdin = strings.NewReader("ping\n")
		var stdout bytes.Buffer
		cmd.Stdout = &stdout
		err := runIsolatedForeground(cmd, false)
		var exitErr *exec.ExitError
		if !errorsIsExitCode(err, &exitErr, 7) {
			t.Fatalf("err = %v, want exit code 7", err)
		}
		if strings.TrimSpace(stdout.String()) != "echo:ping" {
			t.Fatalf("stdout = %q, want echo:ping", stdout.String())
		}
	})

	// 2. Detached NoStdio launch does not inherit parent's inheritable TCP socket or file.
	t.Run("detached-no-stdio-isolation", func(t *testing.T) {
		listener, addr := makeInheritableListener(t)
		fileHandle, filePath := makeInheritableLockedFile(t)
		closed := false
		defer func() {
			if !closed {
				_ = listener.Close()
				_ = windows.CloseHandle(fileHandle)
			}
		}()

		dir := t.TempDir()
		readyFile := filepath.Join(dir, "ready")
		stopFile := filepath.Join(dir, "stop")
		defer func() { _ = os.WriteFile(stopFile, []byte("stop"), 0o600) }()
		t.Setenv("LINGER_TEST_ISOLATED_EXEC_HELPER", "detached")
		t.Setenv("LINGER_TEST_ISOLATED_READY", readyFile)
		t.Setenv("LINGER_TEST_ISOLATED_STOP", stopFile)

		code, err := RunIsolatedExec(IsolatedExecOptions{
			Executable: exe,
			Args:       []string{"-test.run=^TestRunIsolatedExecPreventsHandleInheritanceAndPreservesStdioAndExitCode$"},
			Detached:   true,
			NoStdio:    true,
		})
		if err != nil || code != 0 {
			t.Fatalf("RunIsolatedExec(detached) = (%d, %v), want (0, nil)", code, err)
		}
		deadline := time.Now().Add(10 * time.Second)
		for {
			if _, statErr := os.Stat(readyFile); statErr == nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("detached child did not start")
			}
			time.Sleep(20 * time.Millisecond)
		}

		// Close parent resources while detached child is still running.
		_ = listener.Close()
		_ = windows.CloseHandle(fileHandle)
		closed = true

		if err := os.Remove(filePath); err != nil {
			t.Fatalf("file locked by detached child: %v", err)
		}
		rebound, err := net.Listen("tcp4", addr)
		if err != nil {
			t.Fatalf("port %s held by detached child: %v", addr, err)
		}
		_ = rebound.Close()
	})

	// 3. Owned runtime launch (process.Start) does not inherit parent's inheritable TCP socket or file.
	t.Run("owned-runtime-isolation", func(t *testing.T) {
		listener, addr := makeInheritableListener(t)
		fileHandle, filePath := makeInheritableLockedFile(t)
		closed := false
		defer func() {
			if !closed {
				_ = listener.Close()
				_ = windows.CloseHandle(fileHandle)
			}
		}()

		t.Setenv("LINGER_TEST_ISOLATED_EXEC_HELPER", "runtime")
		cmd := exec.Command(exe, "-test.run=^TestRunIsolatedExecPreventsHandleInheritanceAndPreservesStdioAndExitCode$")
		stdin, err := cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			_ = stdin.Close()
			t.Fatal(err)
		}
		if err := Start(cmd); err != nil {
			_ = stdin.Close()
			t.Fatal(err)
		}
		defer func() {
			_ = stdin.Close()
			_ = Signal(cmd, syscall.SIGKILL)
			_ = cmd.Wait()
			Release(cmd)
		}()

		line, err := bufio.NewReader(stdout).ReadString('\n')
		if err != nil || strings.TrimSpace(line) != "runtime-ready" {
			t.Fatalf("runtime child readiness = %q, err = %v", line, err)
		}

		_ = listener.Close()
		_ = windows.CloseHandle(fileHandle)
		closed = true

		if err := os.Remove(filePath); err != nil {
			t.Fatalf("file locked by owned runtime child: %v", err)
		}
		rebound, err := net.Listen("tcp4", addr)
		if err != nil {
			t.Fatalf("port %s held by owned runtime child: %v", addr, err)
		}
		_ = rebound.Close()

		_ = stdin.Close()
		if err := cmd.Wait(); err != nil {
			t.Fatalf("runtime child exited with error: %v", err)
		}
	})
}

func errorsIsExitCode(err error, target **exec.ExitError, want int) bool {
	if err == nil {
		return false
	}
	exitErr, ok := err.(*exec.ExitError)
	if !ok {
		return false
	}
	*target = exitErr
	return exitErr.ExitCode() == want
}
