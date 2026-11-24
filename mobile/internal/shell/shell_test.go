package shell_test

import (
	"context"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/golden"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/screens/live"
	"github.com/oldwinter/linger/mobile/internal/shell"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestFiveTabShellNavigationBiometricsHooksAndThemes(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedWaveC1Fixtures()
	defer srv.Close()

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()

	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}
	store.SetActiveTab(state.TabRooms)

	appShell := shell.New(store, func() bool { return false })

	for _, vp := range testutil.StandardMobileViewports {
		t.Run(vp.Name, func(t *testing.T) {
			tt := testutil.NewPhoneTester(appShell.View, vp)
			tt.Frame()

			// Tab 0: Full Rooms List (Wave C-1)
			if !tt.HasText("Product Launch") || !tt.HasText("Catch-Up") {
				t.Fatal("expected full Rooms list with Catch-Up button on Tab 1")
			}

			// Tab 1: Full Live Control (Wave C-1)
			store.SetActiveTab(state.TabLive)
			appShell.Live().SelectSegment(live.SegmentCompute)
			tt.Frame()
			if !tt.HasText("Desktop Companion Host") || !tt.HasText("Qwen3 4B") {
				t.Fatal("expected live Compute & Local Models on Tab 2")
			}

			// Tab 2: Work
			store.SetActiveTab(state.TabWork)
			tt.Frame()
			if !tt.HasText("Ship Mobile Companion Wave B") || !tt.HasText("Morning Standup Digest") {
				t.Fatal("expected synced Work Items and Routines on Work tab")
			}

			// Tab 3: Library
			store.SetActiveTab(state.TabLibrary)
			tt.Frame()
			if !tt.HasText("Mobile Companion Architecture") {
				t.Fatal("expected synced Document on Library tab")
			}

			// Tab 4: More
			store.SetActiveTab(state.TabMore)
			store.Routers[state.TabMore].Replace("/more")
			tt.Frame()
			if !tt.HasText("Biometric App Lock") || !tt.HasText("Return Key Sends Message") {
				t.Fatal("expected More settings controls including Composer Return toggle")
			}

			// Verify Wave C-2 TabHooks pluggability and exported OpenRoom / OpenConnect helpers.
			hookRendered := false
			appShell.SetTabHooks(shell.TabHooks{
				RouteWork: func(c *ui.Context, r *ui.Route, _ state.Snapshot) {
					r.Title("Custom Work")
					hookRendered = true
					ui.Text(c, "Wave C-2 Work Plugged")
				},
			})
			store.SetActiveTab(state.TabWork)
			tt.Frame()
			if !hookRendered || !tt.HasText("Wave C-2 Work Plugged") {
				t.Fatal("expected Wave C-2 TabHooks.RouteWork to render")
			}
			appShell.SetTabHooks(shell.TabHooks{})

			appShell.OpenRoom("room_general")
			tt.Frame()
			if store.Snapshot().ActiveTab != state.TabRooms {
				t.Fatal("expected OpenRoom to switch to TabRooms")
			}

			// Biometric Lock Gate blocks tabs until unlocked.
			store.SetBiometricLocked(true)
			tt.Frame()
			if !tt.HasText("Linger Mobile is Locked") {
				t.Fatal("expected Biometric Lock Gate overlay")
			}
			store.SetBiometricLocked(false)
			store.SetActiveTab(state.TabRooms)
			store.Routers[state.TabRooms].Replace("/rooms")
			tt.Frame()
			if tt.HasText("Linger Mobile is Locked") {
				t.Fatal("expected lock gate cleared after unlock")
			}
		})
	}
}

func TestShellGoldenSnapshotsLightAndDark(t *testing.T) {
	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	_ = cfgStore.SetPreferences(config.AppPreferences{Theme: config.ThemeLight})
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()

	store.SetActiveTab(state.TabMore)
	store.Routers[state.TabMore].Replace("/more")
	appShell := shell.New(store, func() bool { return false })

	ttLight := testutil.NewPhoneTester(appShell.View, testutil.StandardMobileViewports[1])
	golden.Match(t, ttLight, "testdata/shell_more_light_390x844.png")

	_ = store.SetThemePreference(config.ThemeDark)
	ttDark := testutil.NewPhoneTester(appShell.View, testutil.StandardMobileViewports[1])
	golden.Match(t, ttDark, "testdata/shell_more_dark_390x844.png")
}
