package computercli

import (
	"context"
	"os/exec"
	"slices"
	"strings"
	"testing"
)

// A sign-in must run the same executable discovery found and must hand it
// the Runtime environment, not the CLI's own LINGER_* variables.
func TestRuntimeLoginOpensTheRuntimeTheDaemonStarts(t *testing.T) {
	f := newFixture(t)
	var launched *exec.Cmd
	f.deps.runInteractive = func(cmd *exec.Cmd) (int, error) {
		launched = cmd
		return 0, nil
	}
	f.deps.checkRuntime = func(_ context.Context, runtimeType string, _ runtimeRequest) (runtimeCheck, error) {
		f.diagnoseInputs = append(f.diagnoseInputs, map[string]string{})
		status := "authentication_required"
		if len(f.diagnoseInputs) > 1 {
			status = "ready"
		}
		return runtimeCheck{diagnostic: runtimeDiagnostic{
			Type: runtimeType, Status: status, Available: true, Version: "1.6.0",
			ExecutablePath: "/usr/local/bin/pi", EntryPath: "/usr/local/bin/pi",
		}}, nil
	}
	if code := f.run("runtime", "login", "pi"); code != 0 {
		t.Fatalf("exit=%d stderr=%q", code, f.stderr.String())
	}
	if launched == nil {
		t.Fatalf("no runtime launched: stdout=%q", f.stdout.String())
	}
	if launched.Path != "/usr/local/bin/pi" || !slices.Equal(launched.Args, []string{"/usr/local/bin/pi"}) {
		t.Fatalf("launch=%q %q", launched.Path, launched.Args)
	}
	if launched.Stdin != f.deps.stdin || launched.Stdout != f.deps.stdout || launched.Stderr != f.deps.stderr {
		t.Fatal("runtime does not use the CLI's terminal")
	}
	for _, entry := range launched.Env {
		if strings.HasPrefix(entry, "LINGER_") {
			t.Fatalf("runtime received %q", entry)
		}
	}
	contains(t, f.stdout.String(), "Opening Pi (1.6.0). Sign in, then exit to return here.")
	contains(t, f.stdout.String(), "READY (1.6.0)")
	contains(t, f.stdout.String(), "Pi is ready.")
}

func TestRuntimeLoginRechecksAfterAnInterruptLeavesTheRuntime(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f.deps.runInteractive = func(*exec.Cmd) (int, error) {
		cancel()
		return 0, nil
	}
	calls := 0
	f.deps.checkRuntime = func(ctx context.Context, runtimeType string, _ runtimeRequest) (runtimeCheck, error) {
		// Discovery reports a cancelled probe as an error diagnostic, not an error.
		select {
		case <-ctx.Done():
			return runtimeCheck{diagnostic: runtimeDiagnostic{
				Type: runtimeType, Status: "error", ErrorMessage: "Runtime version probe failed",
			}}, nil
		default:
		}
		calls++
		status := "authentication_required"
		if calls > 1 {
			status = "ready"
		}
		return runtimeCheck{diagnostic: runtimeDiagnostic{
			Type: runtimeType, Status: status, Available: true, Version: "1.6.0",
			ExecutablePath: "/usr/local/bin/pi", EntryPath: "/usr/local/bin/pi",
		}}, nil
	}
	if code := f.runContext(ctx, "runtime", "login", "pi"); code != 0 {
		t.Fatalf("exit=%d stderr=%q", code, f.stderr.String())
	}
	contains(t, f.stdout.String(), "READY (1.6.0)")
	contains(t, f.stdout.String(), "Pi is ready.")
	if strings.Contains(f.stdout.String(), "ERROR") {
		t.Fatalf("stdout=%q", f.stdout.String())
	}
}

func TestRuntimeLoginSkipsTheRowWhenAnInterruptStopsTheRecheck(t *testing.T) {
	f := newFixture(t)
	f.deps.runInteractive = func(*exec.Cmd) (int, error) { return 0, nil }
	f.deps.interruptible = func(ctx context.Context) (context.Context, context.CancelFunc) {
		interrupted, cancel := context.WithCancel(ctx)
		cancel()
		return interrupted, cancel
	}
	calls := 0
	f.deps.checkRuntime = func(ctx context.Context, runtimeType string, _ runtimeRequest) (runtimeCheck, error) {
		// Discovery reports a cancelled probe as an error diagnostic, not an error.
		select {
		case <-ctx.Done():
			return runtimeCheck{diagnostic: runtimeDiagnostic{
				Type: runtimeType, Status: "error", ErrorMessage: "Runtime version probe failed",
			}}, nil
		default:
		}
		calls++
		status := "authentication_required"
		if calls > 1 {
			status = "ready"
		}
		return runtimeCheck{diagnostic: runtimeDiagnostic{
			Type: runtimeType, Status: status, Available: true, Version: "1.6.0",
			ExecutablePath: "/usr/local/bin/pi", EntryPath: "/usr/local/bin/pi",
		}}, nil
	}
	if code := f.run("runtime", "login", "pi"); code != 0 {
		t.Fatalf("exit=%d stderr=%q", code, f.stderr.String())
	}
	contains(t, f.stdout.String(), "Opening Pi")
	if strings.Contains(f.stdout.String(), "ERROR") || strings.Contains(f.stdout.String(), "Pi is ready.") {
		t.Fatalf("stdout=%q", f.stdout.String())
	}
}

func TestRuntimeLoginPointsToTheInstallStep(t *testing.T) {
	f := newFixture(t)
	launched := false
	f.deps.runInteractive = func(*exec.Cmd) (int, error) {
		launched = true
		return 0, nil
	}
	if code := f.run("runtime", "login", "pi"); code != exitCodes[categoryRuntimeUnavailable] {
		t.Fatalf("exit=%d", code)
	}
	if launched {
		t.Fatal("a missing runtime was launched")
	}
	contains(t, f.stdout.String(), "Pi is not installed.")
	contains(t, f.stdout.String(), "Install: npm install -g @earendil-works/pi-coding-agent")
}

func TestRuntimeLoginNeedsOneKnownRuntime(t *testing.T) {
	f := newFixture(t)
	if code := f.run("runtime", "login"); code != exitCodes[categoryUsage] {
		t.Fatalf("exit=%d", code)
	}
	contains(t, f.stderr.String(), "runtime login requires one runtime")
	f.clear()
	if code := f.run("runtime", "login", "mystery"); code != exitCodes[categoryUsage] {
		t.Fatalf("exit=%d", code)
	}
	contains(t, f.stderr.String(), "Unknown runtime: mystery")
}

func TestRuntimeLoginHelp(t *testing.T) {
	f := newFixture(t)
	if code := f.run("runtime", "login", "--help"); code != 0 {
		t.Fatalf("exit=%d", code)
	}
	if got := f.stdout.String(); got != commandHelp["runtime login"] {
		t.Fatalf("help=%q", got)
	}
	contains(t, commandHelp["runtime"], "runtime login <codex|claude|pi|antigravity>")
}
