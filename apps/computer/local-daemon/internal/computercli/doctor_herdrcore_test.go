package computercli

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/herdrcore"
)

func TestDoctorReportsHerdrCoreWhenInstalled(t *testing.T) {
	f := newFixture(t)
	runningStatus := &herdrcore.StatusResult{
		Version:  "0.1.21",
		Live:     3,
		Finished: 1,
	}
	f.herdrCore = herdrCoreCheck(herdrcore.Installation{
		Executable: "/Users/a/.local/bin/hc",
		Socket:     "/Users/a/.local/state/herdr-core/default/default.sock",
		Session:    herdrcore.DefaultSession,
		Transport:  herdrcore.TransportUnixSocket,
	}, "0.1.21", runningStatus)
	if code := f.run("doctor", "--config", f.configPath); code != 0 {
		t.Fatalf("exit=%d stdout=%s", code, f.stdout.String())
	}
	wantLine := "PASS\therdr-core\therdr-core 0.1.21 at /Users/a/.local/bin/hc; core running through /Users/a/.local/state/herdr-core/default/default.sock (live=3 finished=1)\n"
	if !strings.HasSuffix(f.stdout.String(), wantLine) {
		t.Fatalf("text=%q, want suffix %q", f.stdout.String(), wantLine)
	}

	stoppedUnix := herdrCoreCheck(herdrcore.Installation{
		Executable: "/usr/local/bin/hc",
		Socket:     "/home/a/.local/state/herdr-core/default/default.sock",
		Session:    herdrcore.DefaultSession,
		Transport:  herdrcore.TransportUnixSocket,
	}, "0.1.21", nil)
	if stoppedUnix.Name != "herdr-core" || stoppedUnix.Status != "pass" ||
		stoppedUnix.Detail != "herdr-core 0.1.21 at /usr/local/bin/hc; its server is not running at /home/a/.local/state/herdr-core/default/default.sock, so there are no terminals to watch yet" {
		t.Fatalf("stoppedUnix=%+v", stoppedUnix)
	}

	runningStdio := herdrCoreCheck(herdrcore.Installation{
		Executable: `C:\Users\a\.local\bin\hc.exe`,
		Session:    "work",
		Transport:  herdrcore.TransportConnectStdio,
	}, "", runningStatus)
	if runningStdio.Status != "pass" || !strings.Contains(runningStdio.Detail, "via hc connect (session work) (live=3 finished=1)") {
		t.Fatalf("runningStdio=%+v", runningStdio)
	}

	stoppedStdio := herdrCoreCheck(herdrcore.Installation{
		Executable: `C:\Users\a\.local\bin\hc.exe`,
		Session:    "default",
		Transport:  herdrcore.TransportConnectStdio,
	}, "0.1.21", nil)
	if stoppedStdio.Status != "pass" || !strings.Contains(stoppedStdio.Detail, "its server is not running for session default") {
		t.Fatalf("stoppedStdio=%+v", stoppedStdio)
	}
}

func TestInspectHerdrCoreFindsItOnTerminalPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix shell stub test runs on Unix")
	}
	bin, home := t.TempDir(), t.TempDir()
	environment := map[string]string{"PATH": bin, "HOME": home}
	hcBin := filepath.Join(bin, "hc")
	if err := os.WriteFile(hcBin, []byte("#!/bin/sh\necho hc 0.1.21\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	check, ok := inspectHerdrCore(t.Context(), environment)
	wantSock := filepath.Join(home, ".local", "state", "herdr-core", "default", "default.sock")
	if !ok || check.Name != "herdr-core" || check.Status != "pass" ||
		!strings.HasPrefix(check.Detail, "herdr-core 0.1.21 at "+hcBin+"; its server is not running at "+wantSock) {
		t.Fatalf("check=%+v ok=%v", check, ok)
	}
}
