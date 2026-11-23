package process

import "os/exec"

// PrepareForeground adapts a script launcher for a Runtime the user runs on
// their own terminal. It applies the same launcher rules as Prepare so the
// user signs in to the process the daemon will later start, but it leaves the
// console alone: an interactive Runtime keeps the caller's stdin and stdout
// instead of opening a hidden window.
func PrepareForeground(cmd *exec.Cmd) {
	prepareScriptLauncher(cmd)
}
