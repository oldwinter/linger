package shell_test

import (
	"context"
	"testing"

	"github.com/egoist/mygo/ui/golden"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/shell"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestFiveTabShellNavigationBiometricsAndThemes(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
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

			// Tab 0: Rooms
			if !tt.HasText("Product Launch") {
				t.Fatal("expected synced Room 'Product Launch' on Rooms tab")
			}

			// Tab 1: Live
			store.SetActiveTab(state.TabLive)
			tt.Frame()
			if !tt.HasText("Desktop Runtime") || !tt.HasText("Qwen3 4B") {
				t.Fatal("expected live runtime and local model summary on Live tab")
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
			if !tt.HasText("Biometric App Lock") || !tt.HasText("Appearance") {
				t.Fatal("expected More settings controls")
			}

			// Biometric Lock Gate blocks tabs until unlocked.
			store.SetBiometricLocked(true)
			tt.Frame()
			if !tt.HasText("Linger Mobile is Locked") {
				t.Fatal("expected Biometric Lock Gate overlay")
			}
			store.SetBiometricLocked(false)
			store.SetActiveTab(state.TabRooms)
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

	// Route to More overview for deterministic visual snapshot (no async network jitter).
	store.SetActiveTab(state.TabMore)
	store.Routers[state.TabMore].Replace("/more")
	appShell := shell.New(store, func() bool { return false })

	ttLight := testutil.NewPhoneTester(appShell.View, testutil.StandardMobileViewports[1])
	golden.Match(t, ttLight, "testdata/shell_more_light_390x844.png")

	_ = store.SetThemePreference(config.ThemeDark)
	ttDark := testutil.NewPhoneTester(appShell.View, testutil.StandardMobileViewports[1])
	golden.Match(t, ttDark, "testdata/shell_more_dark_390x844.png")
}
