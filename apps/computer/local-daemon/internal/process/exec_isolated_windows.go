//go:build windows

package process

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"unsafe"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/platform/winprocess"
	"golang.org/x/sys/windows"
)

// IsolatedExecOptions configures a Windows process launch whose child receives
// only explicit stdio handles (via Go's PROC_THREAD_ATTRIBUTE_HANDLE_LIST) or
// no inherited handles at all when NoStdio is true.
type IsolatedExecOptions struct {
	Executable     string
	Args           []string
	Cwd            string
	Detached       bool
	Windowed       bool
	NoStdio        bool
	AllowBreakaway bool
}

// ParseIsolatedExecArgs parses arguments for the Windows `exec-isolated`
// subcommand: `[--detached] [--windowed] [--no-stdio] [--allow-breakaway] [--cwd <dir>] -- <executable> [args...]`.
func ParseIsolatedExecArgs(args []string) (IsolatedExecOptions, error) {
	var opts IsolatedExecOptions
	sep := -1
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			sep = i
			break
		}
		switch arg {
		case "--detached":
			opts.Detached = true
		case "--windowed":
			opts.Windowed = true
		case "--no-stdio":
			opts.NoStdio = true
		case "--allow-breakaway":
			opts.AllowBreakaway = true
		case "--cwd":
			if i+1 >= len(args) {
				return IsolatedExecOptions{}, errors.New("exec-isolated: --cwd requires a directory")
			}
			i++
			opts.Cwd = args[i]
		default:
			return IsolatedExecOptions{}, fmt.Errorf("exec-isolated: unknown flag %q", arg)
		}
	}
	if sep < 0 || sep+1 >= len(args) || args[sep+1] == "" {
		return IsolatedExecOptions{}, errors.New("exec-isolated: requires -- <executable> [args...]")
	}
	opts.Executable = args[sep+1]
	opts.Args = append([]string(nil), args[sep+2:]...)
	return opts, nil
}

// BuildIsolatedExecCommand constructs an exec.Cmd configured for Windows handle
// isolation. When NoStdio is true, SysProcAttr.NoInheritHandles prevents any
// handle inheritance; otherwise Go's syscall.StartProcess restricts inheritance
// via PROC_THREAD_ATTRIBUTE_HANDLE_LIST to the attached stdio handles only.
func BuildIsolatedExecCommand(opts IsolatedExecOptions, stdin, stdout, stderr *os.File) *exec.Cmd {
	cmd := exec.Command(opts.Executable, opts.Args...)
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	sys := &syscall.SysProcAttr{}
	if opts.NoStdio {
		sys.NoInheritHandles = true
	} else {
		if validStdFile(stdin) {
			cmd.Stdin = stdin
		}
		if validStdFile(stdout) {
			cmd.Stdout = stdout
		}
		if validStdFile(stderr) {
			cmd.Stderr = stderr
		}
	}
	if opts.Detached {
		flags := uint32(windows.CREATE_NEW_PROCESS_GROUP)
		if !opts.Windowed {
			sys.HideWindow = true
			flags |= windows.DETACHED_PROCESS
		}
		sys.CreationFlags = flags
	} else if !opts.Windowed {
		sys.HideWindow = true
		sys.CreationFlags |= windows.CREATE_NO_WINDOW
	}
	cmd.SysProcAttr = sys
	return cmd
}

// RunIsolatedExec launches opts.Executable with strict Windows handle
// isolation, returning the process exit code and any launch error. Detached
// launches return once the child process starts; foreground launches bind the
// child to a kill-on-close Job Object (with silent breakaway when
// AllowBreakaway is set so detached services survive normal exit).
func RunIsolatedExec(opts IsolatedExecOptions) (int, error) {
	cmd := BuildIsolatedExecCommand(opts, os.Stdin, os.Stdout, os.Stderr)
	if opts.Detached {
		if err := cmd.Start(); err != nil {
			return 1, err
		}
		_ = cmd.Process.Release()
		return 0, nil
	}
	if err := runIsolatedForeground(cmd, opts.AllowBreakaway); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() >= 0 {
			return exitErr.ExitCode(), nil
		}
		return 1, err
	}
	return 0, nil
}

func runIsolatedForeground(cmd *exec.Cmd, allowBreakaway bool) error {
	job, err := createIsolatedJob(allowBreakaway)
	if err != nil {
		return cmd.Run()
	}
	defer func() { _ = windows.CloseHandle(job) }()
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_SUSPENDED
	if err := cmd.Start(); err != nil {
		return err
	}
	if proc, openErr := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid)); openErr == nil {
		_ = windows.AssignProcessToJobObject(job, proc)
		_ = windows.CloseHandle(proc)
	}
	if err := winprocess.Resume(cmd.Process.Pid); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return err
	}
	return cmd.Wait()
}

func createIsolatedJob(allowBreakaway bool) (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, err
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if allowBreakaway {
		limits.BasicLimitInformation.LimitFlags |= windows.JOB_OBJECT_LIMIT_BREAKAWAY_OK | windows.JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
	}
	_, err = windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)),
		uint32(unsafe.Sizeof(limits)),
	)
	if err != nil {
		_ = windows.CloseHandle(job)
		return 0, err
	}
	return job, nil
}

func validStdFile(file *os.File) bool {
	if file == nil {
		return false
	}
	handle := windows.Handle(file.Fd())
	return handle != 0 && handle != windows.InvalidHandle
}
