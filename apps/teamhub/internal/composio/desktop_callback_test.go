package composio

import (
	"context"
	"strings"
	"testing"
)

func TestDesktopOAuthCallbackAllowsOnlyOneTimeLoopbackAddresses(t *testing.T) {
	valid := "http://127.0.0.1:43210/oauth/connector/" + strings.Repeat("a", 48)
	ctx, err := WithDesktopOAuthCallback(context.Background(), &valid)
	if err != nil || ctx.Value(desktopCallbackKey{}) != valid {
		t.Fatalf("valid callback rejected: %v", err)
	}
	for _, url := range []string{
		strings.Replace(valid, "127.0.0.1", "localhost", 1),
		strings.Replace(valid, "127.0.0.1", "example.test", 1),
		strings.Replace(valid, "43210", "65536", 1),
		valid + "?extra=1",
		strings.TrimSuffix(valid, "a"),
	} {
		if _, err := WithDesktopOAuthCallback(context.Background(), &url); err == nil {
			t.Errorf("accepted unexpected callback %q", url)
		}
	}
}
