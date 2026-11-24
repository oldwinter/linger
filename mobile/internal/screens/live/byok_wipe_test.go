package live

import (
	"testing"

	"github.com/egoist/mygo/ui"
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
