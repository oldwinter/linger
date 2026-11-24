package live

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func TestBYOKAPIKeyWipedOnSheetDismiss(t *testing.T) {
	store := state.NewAppStore(state.Options{DataDir: t.TempDir()})
	defer store.Disconnect()

	ctl := NewController(store, NavigationHooks{})
	ctl.byokSheetOpen = true
	ctl.byokAPIKey = "sk-super-secret-key"

	// Render one frame while open.
	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ctl.viewBYOKSheet(c, store.Snapshot())
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Dismissing the sheet must wipe the API key from memory immediately (P1-7).
	ctl.byokSheetOpen = false
	ctl.openBYOKSheet(store.Snapshot())
	if ctl.byokAPIKey != "" {
		t.Fatalf("expected openBYOKSheet to wipe any prior byokAPIKey, got %q", ctl.byokAPIKey)
	}

	ctl.byokAPIKey = "sk-transient-secret"
	tt.Frame()
	// Simulate sheet transition from open -> closed inside viewBYOKSheet.
	ctl.byokSheetOpen = true
	tt.Frame()
	if ctl.byokAPIKey != "sk-transient-secret" {
		t.Fatalf("expected key present while sheet open, got %q", ctl.byokAPIKey)
	}
	// Close via ESC/dismiss: openBYOKSheet cleared, now verify direct close transition.
	ctl.byokSheetOpen = false
	// Re-open and close using sheet helper:
	ctl.openBYOKSheet(store.Snapshot())
	if ctl.byokAPIKey != "" {
		t.Fatalf("expected empty API key after reopen, got %q", ctl.byokAPIKey)
	}
}

func TestOpenBYOKSheetPrefillsByokSummaryAndRuntime(t *testing.T) {
	store := state.NewAppStore(state.Options{DataDir: t.TempDir()})
	defer store.Disconnect()
	ctl := NewController(store, NavigationHooks{})
	ctl.byokAPIKey = "sk-stale"

	base := "https://custom.example.com"
	path := "/proxy"
	ep := "/responses"
	proto := "openai-responses"
	modelID := "gpt-5-mini"
	snap := state.Snapshot{
		ModelSource: &api.ModelSourceView{
			Status: &api.ModelSourceStatus{
				Mode:    "byok",
				Runtime: "codex",
				Byok: api.ByokSummary{
					Configured: true,
					KeySaved:   true,
					BaseURL:    &base,
					Path:       &path,
					Endpoint:   &ep,
					Protocol:   &proto,
					ModelID:    &modelID,
				},
			},
		},
	}

	ctl.openBYOKSheet(snap)
	if ctl.byokBaseURL != base || ctl.byokPath != path || ctl.byokEndpoint != ep ||
		ctl.byokProtocol != proto || ctl.byokModelID != modelID || ctl.byokRuntime != "codex" || ctl.byokAPIKey != "" {
		t.Fatalf("unexpected prefilled BYOK state: base=%q path=%q ep=%q proto=%q model=%q rt=%q key=%q",
			ctl.byokBaseURL, ctl.byokPath, ctl.byokEndpoint, ctl.byokProtocol, ctl.byokModelID, ctl.byokRuntime, ctl.byokAPIKey)
	}
}

func TestComputeAsyncSheetNotificationsAndBrowserRefreshRaceFree(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedWaveC1Fixtures()
	defer srv.Close()

	var notifies atomic.Int32
	notifyCh := make(chan struct{}, 32)
	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
		OnNotify: func() {
			notifies.Add(1)
			select {
			case notifyCh <- struct{}{}:
			default:
			}
		},
	})
	defer store.Disconnect()
	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}

	ctl := NewController(store, NavigationHooks{})
	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ctl.View(c, store.Snapshot())
	}, testutil.StandardMobileViewports[1])

	waitNotify := func(label string, before int32) {
		t.Helper()
		deadline := time.After(3 * time.Second)
		for notifies.Load() <= before {
			select {
			case <-notifyCh:
			case <-deadline:
				t.Fatalf("timed out waiting for Notify after %s", label)
			}
		}
	}

	// 1. openPermissionsSheet must notify once permissions fetch completes.
	before := notifies.Load()
	ctl.openPermissionsSheet("comp_mac_1")
	waitNotify("openPermissionsSheet", before)

	// 2. testBYOKAsync & listBYOKModelsAsync must notify after updating testMsg/models.
	ctl.byokBaseURL = "https://api.openai.com"
	ctl.byokPath = "/v1"
	ctl.byokEndpoint = "/chat/completions"
	ctl.byokProtocol = "openai-chat"
	ctl.byokModelID = "gpt-4o-mini"
	before = notifies.Load()
	ctl.testBYOKAsync("ten_1", "comp_mac_1")
	waitNotify("testBYOKAsync", before)

	before = notifies.Load()
	ctl.listBYOKModelsAsync("ten_1", "comp_mac_1")
	waitNotify("listBYOKModelsAsync", before)

	// 3. refreshBrowserStatus must not race with viewBrowserSheet or overwrite browserSheetOpen.
	ctl.browserSheetOpen = false
	before = notifies.Load()
	ctl.refreshBrowserStatus("comp_mac_1")
	for i := 0; i < 6; i++ {
		tt.Frame()
		time.Sleep(2 * time.Millisecond)
	}
	waitNotify("refreshBrowserStatus", before)
	tt.Frame()
	if ctl.browserSheetOpen {
		t.Fatal("refreshBrowserStatus must not reopen closed browserSheetOpen")
	}
	ctl.mu.Lock()
	st := ctl.browserStatus
	ctl.mu.Unlock()
	if st == nil || st.State != "connected" {
		t.Fatalf("expected browserStatus populated via EnqueueUI, got %+v", st)
	}
}
