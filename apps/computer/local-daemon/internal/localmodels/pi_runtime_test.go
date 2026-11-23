package localmodels

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/workspace"
)

func TestToolCommandAlignsPiCodingAgentDir(t *testing.T) {
	fake := newFakeTool(t)
	home := filepath.Join(filepath.Dir(fake.state), "home")
	explicit := filepath.Join(filepath.Dir(fake.state), "custom-pi")
	byokPi := filepath.Join(fake.tool.StateDirectory, "byok-home", ".pi", "agent")
	for _, dir := range []string{filepath.Join(home, ".pi", "agent"), byokPi} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}

	piDirIn := func(env []string) (string, bool) {
		for _, entry := range env {
			if strings.HasPrefix(entry, "PI_CODING_AGENT_DIR=") {
				return strings.TrimPrefix(entry, "PI_CODING_AGENT_DIR="), true
			}
		}
		return "", false
	}

	// Without model-source.json, tool invocations match the base Pi profile
	// that Runtime discovery probes (still stripping any stale byok-home).
	defaultPi := filepath.Join(home, ".pi", "agent")
	for _, tc := range []struct {
		name string
		env  map[string]string
		want string
	}{
		{name: "blank default", env: map[string]string{"HOME": home, "PI_CODING_AGENT_DIR": ""}, want: defaultPi},
		{name: "custom dir", env: map[string]string{"HOME": home, "pi_coding_agent_dir": explicit}, want: explicit},
		{name: "stale byok dir", env: map[string]string{"HOME": home, "PI_CODING_AGENT_DIR": byokPi}, want: defaultPi},
	} {
		cmd := fake.tool.command(tc.env, Action{Name: ActionRefresh})
		if val, ok := piDirIn(cmd.Env); !ok || val != tc.want {
			t.Fatalf("%s: expected PI_CODING_AGENT_DIR=%q without model-source.json, got %q (ok=%v)", tc.name, tc.want, val, ok)
		}
	}

	// Once model-source.json exists (BYOK, subscription, or local), tool calls
	// isolate PI_CODING_AGENT_DIR to this home's managed gateway-home, omitting
	// it before gateway-home exists instead of passing byok-home or ~/.pi/agent.
	for _, source := range []map[string]any{
		{
			"schema":      modelSourceSchema,
			"mode":        "byok",
			"runtime":     "pi",
			"environment": map[string]string{"PI_CODING_AGENT_DIR": byokPi},
		},
		{
			"schema":      modelSourceSchema,
			"mode":        "subscription",
			"runtime":     "claude",
			"environment": map[string]string{},
		},
		{
			"schema":      modelSourceSchema,
			"mode":        "local",
			"runtime":     "pi",
			"environment": map[string]string{"PI_CODING_AGENT_DIR": byokPi},
		},
	} {
		writeModelSourceJSON(t, fake.tool.StateDirectory, source)
		for _, env := range []map[string]string{
			{"HOME": home},
			{"HOME": home, "pi_coding_agent_dir": explicit},
			{"HOME": home, "PI_CODING_AGENT_DIR": byokPi},
		} {
			if val, ok := piDirIn(fake.tool.command(env, Action{Name: ActionLoad, Model: testModel}).Env); ok {
				t.Fatalf("mode=%s env=%v: expected PI_CODING_AGENT_DIR omitted before gateway-home exists, got %q", source["mode"], env, val)
			}
		}
	}

	// A foreign home's legacy ~/.local/share/localmodels/tools/gateway-home is
	// not adopted unless explicitly named in the base environment or local overlay.
	legacyHomeGatewayPi := filepath.Join(home, ".local", "share", "localmodels", "tools", "gateway-home", ".pi", "agent")
	if err := os.MkdirAll(legacyHomeGatewayPi, 0o700); err != nil {
		t.Fatal(err)
	}
	if val, ok := piDirIn(fake.tool.command(map[string]string{"HOME": home}, Action{Name: ActionRefresh}).Env); ok {
		t.Fatalf("expected unconfigured foreign legacy gateway-home omitted, got %q", val)
	}

	// When the base environment explicitly points at an existing legacy
	// gateway-home (as install.sh / install.ps1 do), both tool invocations and
	// local-mode OverlayEnvironment resolve that same legacy profile.
	cmdLegacyBase := fake.tool.command(map[string]string{
		"HOME":                home,
		"PI_CODING_AGENT_DIR": legacyHomeGatewayPi,
	}, Action{Name: ActionLoad, Model: testModel})
	if val, ok := piDirIn(cmdLegacyBase.Env); !ok || val != legacyHomeGatewayPi {
		t.Fatalf("expected explicit legacy gateway-home %q, got %q (ok=%v)", legacyHomeGatewayPi, val, ok)
	}
	writeModelSourceJSON(t, fake.tool.StateDirectory, map[string]any{
		"schema":  modelSourceSchema,
		"mode":    "local",
		"runtime": "pi",
	})
	if got := OverlayEnvironment(map[string]string{
		"HOME":                home,
		"PI_CODING_AGENT_DIR": legacyHomeGatewayPi,
	}, fake.tool.StateDirectory)["PI_CODING_AGENT_DIR"]; got != legacyHomeGatewayPi {
		t.Fatalf("expected OverlayEnvironment to match legacy gateway-home %q, got %q", legacyHomeGatewayPi, got)
	}

	// Once a managed gateway-home Pi profile exists in this home, tool commands
	// and OverlayEnvironment prefer per-home ToolsDirectory(stateDir) over
	// legacy stateDir/gateway-home regardless of base overrides or active mode.
	gatewayPi := filepath.Join(fake.tool.StateDirectory, "gateway-home", ".pi", "agent")
	if err := os.MkdirAll(gatewayPi, 0o700); err != nil {
		t.Fatal(err)
	}
	writeModelSourceJSON(t, fake.tool.StateDirectory, map[string]any{
		"schema":      modelSourceSchema,
		"mode":        "byok",
		"runtime":     "pi",
		"environment": map[string]string{"PI_CODING_AGENT_DIR": byokPi},
	})
	wantStateGateway := "PI_CODING_AGENT_DIR=" + gatewayPi
	for _, env := range []map[string]string{
		{"HOME": home},
		{"HOME": home, "PI_CODING_AGENT_DIR": explicit},
		{"HOME": home, "PI_CODING_AGENT_DIR": byokPi},
		{"HOME": home, "PI_CODING_AGENT_DIR": legacyHomeGatewayPi},
	} {
		cmd := fake.tool.command(env, Action{Name: ActionRefresh})
		if !slices.Contains(cmd.Env, wantStateGateway) {
			t.Fatalf("expected state gateway-home %q in env %v", wantStateGateway, cmd.Env)
		}
	}

	toolsGatewayPi := filepath.Join(ToolsDirectory(fake.tool.StateDirectory), "gateway-home", ".pi", "agent")
	if err := os.MkdirAll(toolsGatewayPi, 0o700); err != nil {
		t.Fatal(err)
	}
	wantToolsGateway := "PI_CODING_AGENT_DIR=" + toolsGatewayPi
	cmdTools := fake.tool.command(map[string]string{
		"HOME":                home,
		"PI_CODING_AGENT_DIR": byokPi,
	}, Action{Name: ActionLoad, Model: testModel})
	if !slices.Contains(cmdTools.Env, wantToolsGateway) {
		t.Fatalf("expected per-home tools gateway-home %q to win in env %v", wantToolsGateway, cmdTools.Env)
	}
	writeModelSourceJSON(t, fake.tool.StateDirectory, map[string]any{
		"schema":      modelSourceSchema,
		"mode":        "local",
		"runtime":     "pi",
		"environment": map[string]string{"PI_CODING_AGENT_DIR": byokPi},
	})
	if got := OverlayEnvironment(map[string]string{"HOME": home, "PI_CODING_AGENT_DIR": byokPi}, fake.tool.StateDirectory)["PI_CODING_AGENT_DIR"]; got != toolsGatewayPi {
		t.Fatalf("expected local OverlayEnvironment to match tools gateway-home %q, got %q", toolsGatewayPi, got)
	}
}

func TestLoadProvisionsPiInHarnessDirectoryWithNodePathAndNotifiesRuntimeChanged(t *testing.T) {
	fake := newFakeTool(t)
	fake.write("status.json", status(model(testModel, "idle")))
	loaded, _ := json.Marshal(status(model(testModel, "loaded")))
	fake.script("load", fakeScript{
		Lines: []fakeLine{
			{Line: progressLine(testModel, "load", 0, 1)},
			{Line: resultLine(testModel), DelayMS: 20},
		},
		StatusAfter: loaded,
	})
	harnessDir := filepath.Join(filepath.Dir(fake.state), "harness")
	home := filepath.Join(filepath.Dir(fake.state), "home")
	nodePath := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(nodePath, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	record := &recorder{}
	var seenMu sync.Mutex
	var seenPiAtChange string
	library := New(Options{
		Tool:             &fake.tool,
		Environment:      map[string]string{"LOCALMODELS_FAKE_TOOL": "1", "HOME": home, "PATH": os.Getenv("PATH")},
		JobDirectory:     filepath.Join(t.TempDir(), "jobs"),
		HarnessDirectory: harnessDir,
		NodePath:         nodePath,
		Publish:          record.publish,
		ProgressInterval: 20 * time.Millisecond,
	})
	library.runtimeChanged = func() {
		if executable := library.PiExecutable(); executable != "" {
			seenMu.Lock()
			seenPiAtChange = executable
			seenMu.Unlock()
		}
		record.runtimeChanged()
	}
	t.Cleanup(library.Close)

	library.Refresh(context.Background())
	if library.PiExecutable() != "" {
		t.Fatalf("idle library unexpectedly provisioned Pi: %q", library.PiExecutable())
	}

	if refusal, answered := library.Act(context.Background(), Action{Name: ActionLoad, Model: testModel}, soon()); refusal != nil || !answered {
		t.Fatalf("load refusal=%+v answered=%v", refusal, answered)
	}
	want := filepath.Join(harnessDir, "tools", "pi", "1.3.0", "pi")
	waitFor(t, "Pi provisioned and runtimeChanged fired", func() bool {
		seenMu.Lock()
		seen := seenPiAtChange
		seenMu.Unlock()
		return record.changes() > 0 && library.PiExecutable() == want && seen == want
	})
	calls := fake.calls()
	if !slices.ContainsFunc(calls, func(c string) bool { return strings.HasPrefix(c, "harness status ") }) ||
		!slices.ContainsFunc(calls, func(c string) bool {
			return strings.HasPrefix(c, "harness plan ") && strings.Contains(c, "--node "+nodePath)
		}) ||
		!slices.ContainsFunc(calls, func(c string) bool { return strings.HasPrefix(c, "harness apply ") }) {
		t.Fatalf("expected harness status/plan(--node)/apply in calls: %v", calls)
	}
	// Without model-source.json, load and Runtime discovery use the exact same
	// Pi profile so TeamHub sees Pi become ready with the loaded model.
	discoveryEnv, err := workspace.PiSourceEnvironment(OverlayEnvironment(
		map[string]string{"HOME": home, "PATH": os.Getenv("PATH")},
		fake.tool.StateDirectory,
	))
	if err != nil {
		t.Fatal(err)
	}
	wantPiDir := "PI_CODING_AGENT_DIR=" + discoveryEnv["PI_CODING_AGENT_DIR"]
	if !slices.ContainsFunc(calls, func(c string) bool { return strings.HasPrefix(c, "load ") && strings.Contains(c, wantPiDir) }) {
		t.Fatalf("expected load call with discovery profile %s in %v", wantPiDir, calls)
	}
}

func TestInitialRefreshProvisionsPiAndInspectPiFindsExisting(t *testing.T) {
	fake := newFakeTool(t)
	fake.write("status.json", status(model(testModel, "loaded")))
	harnessDir := filepath.Join(filepath.Dir(fake.state), "harness")
	record := &recorder{}
	env := map[string]string{"LOCALMODELS_FAKE_TOOL": "1", "HOME": t.TempDir(), "PATH": os.Getenv("PATH")}
	library := New(Options{
		Tool:             &fake.tool,
		Environment:      env,
		JobDirectory:     filepath.Join(t.TempDir(), "jobs"),
		HarnessDirectory: harnessDir,
		Publish:          record.publish,
		RuntimeChanged:   record.runtimeChanged,
		ProgressInterval: time.Second,
	})
	t.Cleanup(library.Close)

	library.Refresh(context.Background())
	want := filepath.Join(harnessDir, "tools", "pi", "1.3.0", "pi")
	waitFor(t, "initial loaded model provisions Pi asynchronously", func() bool {
		return library.PiExecutable() == want && record.changes() == 1
	})

	inspected, err := fake.tool.InspectPi(context.Background(), env, harnessDir)
	if err != nil {
		t.Fatalf("InspectPi error: %v", err)
	}
	if inspected != want {
		t.Fatalf("InspectPi=%q want=%q", inspected, want)
	}

	planCount := func() int {
		count := 0
		for _, call := range fake.calls() {
			if strings.HasPrefix(call, "harness plan ") {
				count++
			}
		}
		return count
	}
	beforePlans := planCount()

	reusedRecord := &recorder{}
	reused := New(Options{
		Tool:             &fake.tool,
		Environment:      env,
		JobDirectory:     filepath.Join(t.TempDir(), "jobs"),
		HarnessDirectory: harnessDir,
		Publish:          reusedRecord.publish,
		RuntimeChanged:   reusedRecord.runtimeChanged,
		ProgressInterval: time.Second,
	})
	t.Cleanup(reused.Close)
	reused.Refresh(context.Background())
	waitFor(t, "existing Pi resolved via InspectPi without replanning", func() bool {
		return reused.PiExecutable() == want && reusedRecord.changes() == 1
	})
	if afterPlans := planCount(); afterPlans != beforePlans {
		t.Fatalf("expected InspectPi to reuse existing Pi without harness plan (%d -> %d)", beforePlans, afterPlans)
	}
}

func TestFailedPiProvisioningDoesNotFailLoadedSnapshot(t *testing.T) {
	fake := newFakeTool(t)
	fake.write("status.json", status(model(testModel, "loaded")))
	if err := os.WriteFile(filepath.Join(fake.state, "harness-plan-fail"), []byte("1"), 0o600); err != nil {
		t.Fatal(err)
	}
	harnessDir := filepath.Join(filepath.Dir(fake.state), "harness")
	library := New(Options{
		Tool:                  &fake.tool,
		Environment:           map[string]string{"LOCALMODELS_FAKE_TOOL": "1", "PATH": os.Getenv("PATH")},
		JobDirectory:          filepath.Join(t.TempDir(), "jobs"),
		HarnessDirectory:      harnessDir,
		EnsurePiRetryInterval: time.Minute,
	})
	t.Cleanup(library.Close)

	snapshot := library.Refresh(context.Background())
	if !snapshot.Available || modelState(snapshot, testModel).State != "loaded" {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	waitFor(t, "failed Pi attempt recorded", func() bool {
		return library.PiProvisionFailed()
	})
	if library.PiExecutable() != "" {
		t.Fatalf("unexpected PiExecutable=%q", library.PiExecutable())
	}
}

func TestEnsurePiRunsOutsideRefreshLockAndBacksOffOnFailure(t *testing.T) {
	fake := newFakeTool(t)
	const otherModel = "other-model:Q4_K_M"
	fake.write("status.json", status(model(testModel, "loaded"), model(otherModel, "absent")))
	waitGate := filepath.Join(fake.state, "harness-plan-wait")
	if err := os.WriteFile(waitGate, []byte("1"), 0o600); err != nil {
		t.Fatal(err)
	}
	harnessDir := filepath.Join(filepath.Dir(fake.state), "harness")
	record := &recorder{}
	library := New(Options{
		Tool:             &fake.tool,
		Environment:      map[string]string{"LOCALMODELS_FAKE_TOOL": "1", "HOME": t.TempDir(), "PATH": os.Getenv("PATH")},
		JobDirectory:     filepath.Join(t.TempDir(), "jobs"),
		HarnessDirectory: harnessDir,
		Publish:          record.publish,
		RuntimeChanged:   record.runtimeChanged,
		ProgressInterval: 10 * time.Millisecond,
	})
	t.Cleanup(library.Close)

	first := library.Refresh(context.Background())
	if !first.Available || modelState(first, testModel).State != "loaded" {
		t.Fatalf("first Refresh=%+v", first)
	}
	waitFor(t, "background harness plan started", func() bool {
		_, err := os.Stat(filepath.Join(fake.state, "harness-plan-entered"))
		return err == nil
	})

	// While EnsurePi is blocked on harness plan, another Refresh and a job's
	// phaseStarted status reread must proceed without blocking on refreshMu.
	second := library.Refresh(context.Background())
	if !second.Available || modelState(second, testModel).State != "loaded" {
		t.Fatalf("second Refresh=%+v", second)
	}
	downloaded, _ := json.Marshal(status(model(testModel, "loaded"), model(otherModel, "idle")))
	downloadWait := filepath.Join(fake.state, "download-wait")
	if err := os.WriteFile(downloadWait, []byte("1"), 0o600); err != nil {
		t.Fatal(err)
	}
	fake.script("download", fakeScript{
		Lines: []fakeLine{
			{Line: progressLine(otherModel, "download", 10, 100)},
			{Line: resultLine(otherModel), WaitFile: "download-wait"},
		},
		StatusAfter: downloaded,
	})
	if refusal, answered := library.Act(context.Background(), Action{Name: ActionDownload, Model: otherModel}, soon()); refusal != nil || !answered {
		t.Fatalf("download refusal=%+v answered=%v", refusal, answered)
	}
	waitFor(t, "phaseStarted published downloading snapshot while EnsurePi waits", func() bool {
		state := modelState(record.last(), otherModel)
		return state != nil && state.State == "downloading"
	})
	if got := library.PiExecutable(); got != "" {
		t.Fatalf("EnsurePi finished before waitGate was released: %q", got)
	}

	if err := os.Remove(downloadWait); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(waitGate); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(harnessDir, "tools", "pi", "1.3.0", "pi")
	waitFor(t, "blocked EnsurePi finished after gate released", func() bool {
		return library.PiExecutable() == want && record.changes() == 1
	})
	waitFor(t, "gated download completed after gate released", func() bool {
		state := modelState(record.last(), otherModel)
		return state != nil && state.State == "idle"
	})

	// Failed installs back off instead of retrying on every Refresh, then retry
	// once the backoff window elapses.
	fake2 := newFakeTool(t)
	fake2.write("status.json", status(model(testModel, "loaded")))
	failMarker := filepath.Join(fake2.state, "harness-plan-fail")
	if err := os.WriteFile(failMarker, []byte("1"), 0o600); err != nil {
		t.Fatal(err)
	}
	harnessDir2 := filepath.Join(filepath.Dir(fake2.state), "harness")
	record2 := &recorder{}
	var clockMu sync.Mutex
	currentTime := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	library2 := New(Options{
		Tool:                  &fake2.tool,
		Environment:           map[string]string{"LOCALMODELS_FAKE_TOOL": "1", "HOME": t.TempDir(), "PATH": os.Getenv("PATH")},
		JobDirectory:          filepath.Join(t.TempDir(), "jobs"),
		HarnessDirectory:      harnessDir2,
		Publish:               record2.publish,
		RuntimeChanged:        record2.runtimeChanged,
		EnsurePiRetryInterval: 30 * time.Second,
	})
	library2.now = func() time.Time {
		clockMu.Lock()
		defer clockMu.Unlock()
		return currentTime
	}
	t.Cleanup(library2.Close)

	library2.Refresh(context.Background())
	waitFor(t, "initial Pi install failure recorded", func() bool {
		return library2.PiProvisionFailed() && record2.changes() == 1
	})
	planCalls := func() int {
		count := 0
		for _, call := range fake2.calls() {
			if strings.HasPrefix(call, "harness plan ") {
				count++
			}
		}
		return count
	}
	if got := planCalls(); got != 1 {
		t.Fatalf("expected 1 harness plan attempt, got %d (%v)", got, fake2.calls())
	}

	library2.Refresh(context.Background())
	library2.Refresh(context.Background())
	if got := planCalls(); got != 1 {
		t.Fatalf("expected backoff to suppress retries before window elapses, got %d calls", got)
	}

	if err := os.Remove(failMarker); err != nil {
		t.Fatal(err)
	}
	clockMu.Lock()
	currentTime = currentTime.Add(31 * time.Second)
	clockMu.Unlock()

	library2.Refresh(context.Background())
	want2 := filepath.Join(harnessDir2, "tools", "pi", "1.3.0", "pi")
	waitFor(t, "Pi install retried and succeeded after backoff elapsed", func() bool {
		return library2.PiExecutable() == want2 && !library2.PiProvisionFailed() && record2.changes() == 2
	})
}
