package connect

import (
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/discovery"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func TestMDNSPlainHTTPRequiresExplicitOptInAndHTTPSRequiresTOFU(t *testing.T) {
	store := state.NewAppStore(state.Options{DataDir: t.TempDir()})
	defer store.Disconnect()
	store.InjectDiscoveredHosts([]discovery.DiscoveredHost{
		{
			HostID:      "host_plain",
			Name:        "Dev Box",
			Host:        "192.168.1.90",
			Port:        48210,
			TLS:         false,
			PairingOpen: true,
		},
	})

	hub := NewHub(store)
	hub.SelectSegment(1)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		hub.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// P2-4a: Tapping PIN Pair on an mDNS tls=0 host must NOT auto-enable plain HTTP.
	if err := tt.Click("PIN Pair"); err != nil {
		t.Fatalf("click PIN Pair: %v", err)
	}
	tt.Frame()
	if hub.pinPlainHTTP {
		t.Fatal("expected mDNS tls=0 host NOT to auto-enable pinPlainHTTP without explicit opt-in")
	}
	if hub.pinProbing {
		t.Fatal("expected mDNS tls=0 host NOT to auto-probe over plain HTTP before user opt-in")
	}
	if !tt.HasText("Allow plain HTTP for this pairing") {
		t.Fatal("expected explicit plain HTTP opt-in control inside PIN sheet")
	}

	// P2-4b: HTTPS PIN sheet must NOT allow submitting when TOFU probe has not completed.
	hub.pinTargetURL = "https://192.168.1.90:48210"
	hub.pinPlainHTTP = false
	hub.pinProbing = false
	hub.pinTOFU = nil
	hub.pinCode = "123456"
	hub.pinSheetOpen = true
	tt.Frame()
	if err := tt.Click("Confirm & Pair"); err == nil && hub.busy {
		t.Fatal("expected Confirm & Pair to stay disabled when HTTPS TOFU fingerprint is missing")
	}
}
