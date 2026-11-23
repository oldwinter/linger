package computercli

import (
	"context"
	"strings"
	"testing"
)

func TestSignInStepIsNativeExceptOnWindows(t *testing.T) {
	const name = "linger-computer-local"
	native := map[string]string{
		"codex":       "Run codex login",
		"claude":      "Run claude auth login",
		"pi":          "Run pi, then /login",
		"antigravity": "Run agy and sign in with Google, or set GEMINI_API_KEY",
	}
	windows := map[string]string{
		"codex":       "Run linger-computer-local runtime login codex",
		"claude":      "Run linger-computer-local runtime login claude",
		"pi":          "Run linger-computer-local runtime login pi, then /login",
		"antigravity": "Run linger-computer-local runtime login antigravity, then sign in with Google, or set GEMINI_API_KEY",
	}
	for _, goos := range []string{"linux", "darwin", "windows"} {
		want := native
		if goos == "windows" {
			want = windows
		}
		for runtimeType, step := range want {
			if got := signInStep(runtimeType, goos, name); got != step {
				t.Errorf("signInStep(%q, %q) = %q, want %q", runtimeType, goos, got, step)
			}
		}
	}
}

func TestRuntimeCheckSignInStepFollowsThePlatform(t *testing.T) {
	for _, goos := range []string{"linux", "windows"} {
		t.Run(goos, func(t *testing.T) {
			f := newFixture(t)
			f.deps.goos = goos
			f.deps.checkRuntime = func(_ context.Context, runtimeType string, _ runtimeRequest) (runtimeCheck, error) {
				return runtimeCheck{diagnostic: runtimeDiagnostic{
					Type: runtimeType, Status: "authentication_required", Available: true, Version: "1.6.0",
				}}, nil
			}
			f.run("runtime", "check", "pi")
			out := f.stdout.String()
			if goos == "windows" {
				contains(t, out, commandName(f.deps.environment)+" runtime login pi, then /login")
				return
			}
			contains(t, out, "Run pi, then /login")
			if strings.Contains(out, "runtime login") {
				t.Fatalf("native step expected, got %q", out)
			}
		})
	}
}
