package live_test

import (
	"context"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/screens/live"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func setupLiveHarness(t *testing.T) (*testutil.FakeServer, *state.AppStore, *live.Controller) {
	t.Helper()
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedWaveC1Fixtures()
	t.Cleanup(srv.Close)

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	t.Cleanup(store.Disconnect)

	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}
	ctl := live.NewController(store, live.NavigationHooks{})
	return srv, store, ctl
}

func TestLiveOpsSegmentsApprovalsAgentsAndLocalModelsActions(t *testing.T) {
	_, store, ctl := setupLiveHarness(t)

	// Pending Approvals Inbox aggregates unresolved cards across room_general + room_ops!
	snap := store.Snapshot()
	if len(snap.PendingDecisions) < 3 {
		t.Fatalf("expected >=3 pending decisions aggregated across rooms, got %d", len(snap.PendingDecisions))
	}

	for _, vp := range testutil.StandardMobileViewports {
		t.Run(vp.Name, func(t *testing.T) {
			view := func(c *ui.Context) {
				c.SetTheme(theme.TownLight())
				ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
					ctl.View(c, store.Snapshot())
				})
			}
			tt := testutil.NewPhoneTester(view, vp)

			// Segment 0: Active Runs
			ctl.SelectSegment(live.SegmentRuns)
			tt.Frame()
			if !tt.HasText("Scout") || !tt.HasText("Watch Live") {
				t.Fatal("expected Active Runs card with Watch Live button")
			}

			// Segment 1: Pending Approvals Inbox
			ctl.SelectSegment(live.SegmentApprovals)
			tt.Frame()
			if !tt.HasText("Run go test in linger-mobile") || !tt.HasText("Send release update email") {
				t.Fatal("expected Pending Approvals Inbox to show cross-room decision cards")
			}

			// Segment 2: Agents & Skills
			ctl.SelectSegment(live.SegmentAgents)
			tt.Frame()
			if !tt.HasText("Scout") || !tt.HasText("Builder") || !tt.HasText("Code Reviewer") {
				t.Fatal("expected Tenant Agents and Templates in Agents segment")
			}

			// Segment 3: Compute, Computers, Local Models & BYOK
			ctl.SelectSegment(live.SegmentCompute)
			tt.Frame()
			if !tt.HasText("Desktop Companion Host") || !tt.HasText("Qwen3 4B") || !tt.HasText("Llama 3.3 8B") {
				t.Fatal("expected Companion host status and Local Models in Compute segment")
			}
			if !tt.HasText("Subscription") || tt.HasText("MANAGED") || tt.HasText("Managed") {
				t.Fatal("expected Subscription option and zero Managed option in Model Source switcher")
			}
		})
	}

	// Approve one decision and confirm Pending Approvals count decrements cleanly.
	beforeCount := len(store.Snapshot().PendingDecisions)
	if _, err := store.DecideCard(context.Background(), "room_ops", "dec_cw_1", api.DecisionRequest{
		Decision:        "approve",
		ExpectedVersion: 1,
	}); err != nil {
		t.Fatalf("DecideCard: %v", err)
	}
	afterCount := len(store.Snapshot().PendingDecisions)
	if afterCount != beforeCount-1 {
		t.Fatalf("expected pending approvals to drop from %d to %d, got %d", beforeCount, beforeCount-1, afterCount)
	}

	// Test Make Room & Load on Llama 3.3 8B (unloading Qwen3 4B first!).
	if err := store.ActOnLocalModel(context.Background(), "comp_mac_1", "llama3.3-8b:Q4_K_M", "load", []string{"qwen3-4b:Q4_K_M"}); err != nil {
		t.Fatalf("ActOnLocalModel Make Room & Load: %v", err)
	}
	lm := store.Snapshot().LocalModels
	if lm == nil {
		t.Fatal("expected updated LocalModels snapshot")
	}
	states := map[string]string{}
	for _, mv := range lm.Models {
		states[mv.Model.ID] = mv.Model.State
	}
	if states["qwen3-4b:Q4_K_M"] != "idle" || states["llama3.3-8b:Q4_K_M"] != "loaded" {
		t.Fatalf("expected qwen3 unloaded and llama3.3 loaded, got %+v", states)
	}

	// Test Model Source switches (local, subscription, byok) + strict TeamHub validation + BYOK test & list.
	rtPi := "pi"
	rtClaude := "claude"
	if _, err := store.SwitchModelSource(context.Background(), "comp_mac_1", api.ModelSourceSwitchRequest{Mode: "managed"}); err == nil {
		t.Fatal("expected \"managed\" mode switch to be rejected")
	}
	if _, err := store.SwitchModelSource(context.Background(), "comp_mac_1", api.ModelSourceSwitchRequest{
		Mode: "byok",
		Byok: &api.ByokInput{
			BaseURL: "https://api.openai.com", Path: "/v1", Endpoint: "/chat/completions", Protocol: "openai-chat", ModelID: "gpt-4o-mini",
		},
	}); err == nil {
		t.Fatal("expected \"byok\" switch with nil Runtime to be rejected")
	}
	if _, err := store.SwitchModelSource(context.Background(), "comp_mac_1", api.ModelSourceSwitchRequest{
		Mode:    "subscription",
		Runtime: &rtClaude,
	}); err != nil {
		t.Fatalf("SwitchModelSource (subscription): %v", err)
	}
	if store.Snapshot().ModelSource.Status.Mode != "subscription" {
		t.Fatalf("expected subscription mode, got %+v", store.Snapshot().ModelSource.Status)
	}
	if _, err := store.SwitchModelSource(context.Background(), "comp_mac_1", api.ModelSourceSwitchRequest{
		Mode:    "byok",
		Runtime: &rtPi,
		Byok: &api.ByokInput{
			BaseURL: "https://api.openai.com", Path: "/v1", Endpoint: "/chat/completions", Protocol: "openai-chat", ModelID: "gpt-4o-mini",
		},
	}); err != nil {
		t.Fatalf("SwitchModelSource (byok): %v", err)
	}
	if store.Snapshot().ModelSource.Status.Mode != "byok" {
		t.Fatalf("expected byok mode, got %+v", store.Snapshot().ModelSource.Status)
	}
	if _, err := store.SwitchModelSource(context.Background(), "comp_mac_1", api.ModelSourceSwitchRequest{
		Mode:    "local",
		Runtime: &rtPi,
	}); err != nil {
		t.Fatalf("SwitchModelSource (local): %v", err)
	}
	if store.Snapshot().ModelSource.Status.Mode != "local" {
		t.Fatalf("expected local mode, got %+v", store.Snapshot().ModelSource.Status)
	}
	cl := store.Client()
	res, err := cl.TestLocalComputerModelSourceTyped(context.Background(), "ten_1", "comp_mac_1", api.ByokInput{
		BaseURL: "https://api.openai.com", Path: "/v1", Endpoint: "/chat/completions", Protocol: "openai-chat", ModelID: "gpt-4o-mini",
	})
	if err != nil || !res.Ok {
		t.Fatalf("TestLocalComputerModelSourceTyped: %+v (%v)", res, err)
	}
	list, err := cl.ListLocalComputerByokModelsTyped(context.Background(), "ten_1", "comp_mac_1", api.ByokInput{
		BaseURL: "https://api.openai.com", Path: "/v1", Endpoint: "/chat/completions", Protocol: "openai-chat",
	})
	if err != nil || len(list.Models) != 2 {
		t.Fatalf("ListLocalComputerByokModelsTyped: %+v (%v)", list, err)
	}
}

func TestLiveGoldenSnapshots(t *testing.T) {
	srv, store, ctl := setupLiveHarness(t)
	_ = srv

	// Normalize RTT to fixed value in snapshot so golden PNG is 100% deterministic.
	fixed := time.Date(2026, 1, 15, 10, 0, 0, 0, time.UTC)
	baseSnap := store.Snapshot()
	baseSnap.RTTMs = 12
	for i := range baseSnap.ActiveRuns {
		baseSnap.ActiveRuns[i].CreatedAt = fixed
	}

	// 1. Pending Approvals Inbox (Town Light, 390x844)
	ctl.SelectSegment(live.SegmentApprovals)
	ttApp := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			ctl.View(c, baseSnap)
		})
	}, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttApp, "testdata/live_approvals_light_390x844.png")

	// 2. Compute & Local Models Control Center (Town Dark, 390x844)
	ctl.SelectSegment(live.SegmentCompute)
	ttComp := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			ctl.View(c, baseSnap)
		})
	}, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttComp, "testdata/live_compute_dark_390x844.png")
}

func TestLiveDestructiveActionsRequireConfirmation(t *testing.T) {
	_, store, ctl := setupLiveHarness(t)

	view := func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			ctl.View(c, store.Snapshot())
		})
	}
	tt := testutil.NewPhoneTester(view, testutil.StandardMobileViewports[1])

	// 1. Live > Runs Stop requires confirmation ActionSheet before stopping active run.
	ctl.SelectSegment(live.SegmentRuns)
	tt.Frame()
	if err := tt.Click("Stop"); err != nil {
		t.Fatalf("click Stop: %v", err)
	}
	tt.Frame()
	tt.Advance(400 * time.Millisecond)
	tt.Frame()
	if !tt.HasText("Stop Scout in Product Launch? The active turn will be interrupted immediately.") {
		t.Fatalf("expected Stop confirmation ActionSheet naming agent & room, texts=%v", tt.Texts())
	}
	// Run must still be active until explicitly confirmed.
	if len(store.Snapshot().ActiveRuns) == 0 || store.Snapshot().ActiveRuns[0].Status == "aborted" {
		t.Fatalf("run was stopped before user confirmed ActionSheet: %+v", store.Snapshot().ActiveRuns)
	}
	if err := tt.Click("Keep Running"); err != nil {
		t.Fatalf("click Keep Running: %v", err)
	}
	for range 6 {
		tt.Frame()
		tt.Advance(400 * time.Millisecond)
		tt.Frame()
		if !tt.HasText("Keep Running") {
			break
		}
	}

	// 2. Live > Compute Make Room & Load requires confirmation ActionSheet naming models to unload.
	ctl.SelectSegment(live.SegmentCompute)
	tt.Frame()
	for range 16 {
		r, ok := tt.Find("Make Room & Load")
		if ok && r.Y >= 60 && r.Y+r.H <= 780 {
			break
		}
		tt.Scroll(200, 400, 0, 260)
		tt.Frame()
	}
	if err := tt.Click("Make Room & Load"); err != nil {
		t.Fatalf("click Make Room & Load: %v", err)
	}
	tt.Frame()
	tt.Advance(400 * time.Millisecond)
	tt.Frame()
	if !tt.HasText("Unload & Load") {
		t.Fatalf("expected Make Room & Load confirmation ActionSheet, texts=%v", tt.Texts())
	}
	// Qwen3 4B must still be loaded before confirming.
	for _, mv := range store.Snapshot().LocalModels.Models {
		if mv.Model.ID == "qwen3-4b:Q4_K_M" && mv.Model.State != "loaded" {
			t.Fatalf("loaded model was unloaded before confirmation: %+v", mv.Model)
		}
	}
	if err := tt.Click("Unload & Load"); err != nil {
		t.Fatalf("confirm Unload & Load: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tt.Frame()
		found := false
		for _, mv := range store.Snapshot().LocalModels.Models {
			if mv.Model.ID == "llama3.3-8b:Q4_K_M" && mv.Model.State == "loaded" {
				found = true
			}
		}
		if found {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatal("timed out waiting for confirmed Make Room & Load to finish")
}
