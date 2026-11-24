package rooms

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func TestInspectorRefreshPreservesEditsNotifiesAndAvoidsDataRaces(t *testing.T) {
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
		ctl.viewInspectorSheet(c, store.Snapshot())
	}, testutil.StandardMobileViewports[1])

	// Open on UI thread and simulate user typing unsaved edits in Settings tab.
	ctl.openInspector("room_general", store.Snapshot())
	ctl.inspEditName = "Unsaved Room Title"
	ctl.inspEditDesc = "Unsaved Description"
	ctl.inspectorOpen = false // Verify background refresh does not reopen dismissed sheet.

	before := notifies.Load()
	ctl.refreshInspectorData("room_general")
	for i := 0; i < 6; i++ {
		tt.Frame()
		time.Sleep(2 * time.Millisecond)
	}

	deadline := time.After(3 * time.Second)
	for notifies.Load() <= before {
		select {
		case <-notifyCh:
		case <-deadline:
			t.Fatal("timed out waiting for Notify after refreshInspectorData")
		}
	}

	if ctl.inspEditName != "Unsaved Room Title" || ctl.inspEditDesc != "Unsaved Description" {
		t.Fatalf("refreshInspectorData clobbered unsaved fields: name=%q desc=%q", ctl.inspEditName, ctl.inspEditDesc)
	}
	if ctl.inspectorOpen {
		t.Fatal("refreshInspectorData must not mutate inspectorOpen")
	}
	ctl.mu.Lock()
	membersCount := len(ctl.inspMembers)
	pinsCount := len(ctl.inspPins)
	sharesCount := len(ctl.inspShares)
	hasTeamMd := ctl.inspTeamMd != nil
	ctl.mu.Unlock()
	if membersCount == 0 || pinsCount == 0 || sharesCount == 0 || !hasTeamMd {
		t.Fatalf("expected inspector data populated, got members=%d pins=%d shares=%d teamMd=%v",
			membersCount, pinsCount, sharesCount, hasTeamMd)
	}
}
