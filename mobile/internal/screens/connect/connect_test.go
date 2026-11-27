package connect_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/discovery"
	"github.com/oldwinter/linger/mobile/internal/screens/connect"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func newTestStoreAndHub(t *testing.T) (*state.AppStore, *connect.Hub) {
	t.Helper()
	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	t.Cleanup(store.Disconnect)
	return store, connect.NewHub(store)
}

func TestConnectionHubViewportsInsetsAndAccessibility(t *testing.T) {
	store, hub := newTestStoreAndHub(t)

	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	// Seed a saved host + live connection + mDNS radar host so all sections exercise real geometry.
	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}
	store.InjectDiscoveredHosts([]discovery.DiscoveredHost{
		{
			InstanceName:   "studio-mac._linger._tcp.local.",
			HostID:         "host_studio_mac",
			Name:           "Studio Mac",
			Host:           "192.168.1.42",
			Port:           48210,
			TLS:            true,
			TLSFingerprint: srv.Fingerprint,
			PairingOpen:    true,
			LastSeen:       time.Now(),
		},
	})

	for _, vp := range testutil.StandardMobileViewports {
		for _, dark := range []bool{false, true} {
			modeName := "light"
			if dark {
				modeName = "dark"
			}
			t.Run(vp.Name+"_"+modeName, func(t *testing.T) {
				view := func(c *ui.Context) {
					if dark {
						c.SetTheme(theme.TownDark())
					} else {
						c.SetTheme(theme.TownLight())
					}
					ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
						hub.View(c)
					})
				}

				tt := testutil.NewPhoneTester(view, vp)
				tt.Frame()
				if !tt.HasText("Saved Desktop & Remote Hosts") {
					t.Fatal("expected Saved Hosts section to render")
				}
				if !tt.HasText("Preview Desktop") {
					t.Fatal("expected active host name to render")
				}

				// Verify accessibility nodes exist for interactive controls.
				nodes := tt.AccessAll()
				if len(nodes) < 5 {
					t.Fatalf("expected rich accessibility tree, got %d nodes", len(nodes))
				}

				// Switch to Pair Desktop segment and test keyboard inset layout.
				hub.SelectSegment(1)
				testutil.ApplyKeyboardInset(tt, vp.Top)
				tt.Frame()
				if !tt.HasText("Nearby Computers") {
					t.Fatal("expected Nearby Computers section after switching to Pair Desktop")
				}
				if !tt.HasText("Studio Mac") {
					t.Fatal("expected mDNS discovered Studio Mac to render")
				}

				// Switch to Direct Login segment.
				hub.SelectSegment(2)
				tt.Frame()
				if !tt.HasText("Direct TeamHub Login") {
					t.Fatal("expected Direct Login form to render")
				}
				hub.SelectSegment(0)
			})
		}
	}
}

func TestConnectionHubTransientErrorClearsOnRecovery(t *testing.T) {
	store, hub := newTestStoreAndHub(t)

	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	// Trigger a transient error first.
	if _, err := store.PairWithURI(context.Background(), "linger://pair?v=1&host=bad/host&tls=0&code=abc", true); err == nil {
		t.Fatal("expected invalid URI error")
	}

	view := func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			hub.View(c)
		})
	}
	tt := testutil.NewPhoneTester(view, testutil.StandardMobileViewports[1])
	tt.Frame()
	if !tt.HasText("Dismiss") {
		t.Fatal("expected transient error banner to show before recovery")
	}

	// Recover by pairing cleanly via valid linger://pair?... URI against TLS-pinned FakeServer.
	hostPort := strings.TrimPrefix(srv.URL, "https://")
	host, portStr, _ := strings.Cut(hostPort, ":")
	uri := "linger://pair?v=1&host=" + host + "&port=" + portStr + "&tls=1&fp=" + srv.Fingerprint + "&code=" + srv.PairCode + "&name=Studio+Mac"
	if _, err := store.PairWithURI(context.Background(), uri, false); err != nil {
		t.Fatalf("PairWithURI recovery failed: %v", err)
	}
	tt.Frame()
	if tt.HasText("invalid host") {
		t.Fatal("stale transient error remained visible after successful recovery")
	}
	if !tt.HasText("Studio Mac") {
		t.Fatal("expected paired Studio Mac host after recovery")
	}
}

func TestSavedHostRemoveRequiresConfirmation(t *testing.T) {
	store, hub := newTestStoreAndHub(t)

	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}

	view := func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			hub.View(c)
		})
	}
	tt := testutil.NewPhoneTester(view, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Open host action sheet -> tap Unpair / Remove -> must show secondary confirmation before removing!
	if err := tt.Click("Host Preview Desktop"); err != nil {
		t.Fatalf("click Host Preview Desktop: %v", err)
	}
	for range 4 {
		tt.Frame()
		tt.Advance(300 * time.Millisecond)
		tt.Frame()
	}
	if err := tt.Click("Unpair & Remove Host"); err != nil {
		t.Fatalf("click Unpair & Remove Host: %v (texts=%v)", err, tt.Texts())
	}
	for range 4 {
		tt.Frame()
		tt.Advance(300 * time.Millisecond)
		tt.Frame()
	}
	if !tt.HasText("Remove Preview Desktop?") {
		t.Fatalf("expected secondary remove confirmation ActionSheet, texts=%v", tt.Texts())
	}
	if len(store.Snapshot().Hosts) != 1 {
		t.Fatalf("host was removed before confirmation: %d hosts", len(store.Snapshot().Hosts))
	}

	// Cancel preserves the host.
	if err := tt.Click("Cancel"); err != nil {
		t.Fatalf("click Cancel: %v", err)
	}
	for range 4 {
		tt.Frame()
		tt.Advance(300 * time.Millisecond)
		tt.Frame()
	}
	if len(store.Snapshot().Hosts) != 1 {
		t.Fatalf("host was removed after Cancel: %d hosts", len(store.Snapshot().Hosts))
	}

	// Re-open and confirm removal.
	if err := tt.Click("Host Preview Desktop"); err != nil {
		t.Fatalf("re-click Host Preview Desktop: %v", err)
	}
	for range 4 {
		tt.Frame()
		tt.Advance(300 * time.Millisecond)
		tt.Frame()
	}
	if err := tt.Click("Unpair & Remove Host"); err != nil {
		t.Fatalf("re-click Unpair & Remove Host: %v", err)
	}
	for range 4 {
		tt.Frame()
		tt.Advance(300 * time.Millisecond)
		tt.Frame()
	}
	if err := tt.Click("Unpair & Remove Host"); err != nil {
		t.Fatalf("confirm Unpair & Remove Host: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tt.Frame()
		if len(store.Snapshot().Hosts) == 0 {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatal("timed out waiting for confirmed host removal")
}

func TestConnectionHubGoldenSnapshots(t *testing.T) {
	store, hub := newTestStoreAndHub(t)

	// Deterministic static fixture (zero network RTT variance) for exact golden matching.
	fp := "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU"
	_ = store.UpdatePreferences(config.AppPreferences{Theme: config.ThemeLight})
	store.InjectDiscoveredHosts([]discovery.DiscoveredHost{
		{
			InstanceName:   "studio-mac._linger._tcp.local.",
			HostID:         "host_studio_mac",
			Name:           "Studio Mac",
			Host:           "192.168.1.42",
			Port:           48210,
			TLS:            true,
			TLSFingerprint: fp,
			PairingOpen:    true,
		},
	})
	hub.SelectSegment(1)

	lightView := func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			hub.View(c)
		})
	}
	ttLight := testutil.NewPhoneTester(lightView, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttLight, "testdata/connect_pair_light_390x844.png")

	darkView := func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			hub.View(c)
		})
	}
	ttDark := testutil.NewPhoneTester(darkView, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttDark, "testdata/connect_pair_dark_390x844.png")
}
