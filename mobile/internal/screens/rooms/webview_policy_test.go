package rooms

import (
	"testing"

	"github.com/oldwinter/linger/mobile/internal/state"
)

func TestHTMLFragmentNavigationPolicyAndClose(t *testing.T) {
	allowed := []string{"", "about:blank", "ABOUT:BLANK", "  about:blank  "}
	for _, u := range allowed {
		if !allowHTMLFragmentNavigation(u) {
			t.Fatalf("expected %q to be allowed in HTML fragment sandbox", u)
		}
	}

	blocked := []string{
		"file:///etc/passwd",
		"javascript:alert(1)",
		"linger://pair?code=123",
		"https://evil.example/phish",
		"http://127.0.0.1:48210/companion/v1/info",
		"data:text/html,<script>alert(1)</script>",
	}
	for _, u := range blocked {
		if allowHTMLFragmentNavigation(u) {
			t.Fatalf("expected %q to be blocked in HTML fragment sandbox", u)
		}
	}

	store := state.NewAppStore(state.Options{DataDir: t.TempDir()})
	defer store.Disconnect()
	ctl := NewController(store, NavigationHooks{})
	ctl.Close() // Safe when no WebView is allocated.
}
