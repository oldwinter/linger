package app

import (
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentconnectedapps"
)

func TestConnectorAccountSelection(t *testing.T) {
	connections := []agentconnectedapps.ConnectedApp{
		{ConnectionID: "gmail-one", AppKey: "gmail", Identity: "same@example.com"},
		{ConnectionID: "gmail-two", AppKey: "gmail", Identity: "same@example.com"},
		{ConnectionID: "same@example.com", AppKey: "gmail", Identity: "other@example.com"},
		{ConnectionID: "slack-one", AppKey: "slack", Identity: "same@example.com"},
	}
	selected, candidates := selectConnectorAccount(connections, "gmail", "same@example.com")
	if selected == nil || selected.ConnectionID != "same@example.com" || len(candidates) != 0 {
		t.Fatal("connection ID must take precedence over labels")
	}
	selected, candidates = selectConnectorAccount(connections[:2], "gmail", "same@example.com")
	if selected != nil || len(candidates) != 2 {
		t.Fatal("duplicate labels must not select an arbitrary account")
	}
	selected, candidates = selectConnectorAccount(connections, "gmail", "")
	if selected != nil || len(candidates) != 3 {
		t.Fatal("multiple accounts require an explicit selector")
	}
	selected, _ = selectConnectorAccount(connections, "slack", "")
	if selected == nil || selected.ConnectionID != "slack-one" {
		t.Fatal("single account should be selected within the requested app")
	}
	selected, candidates = selectConnectorAccount(connections, "gmail", "not-delegated")
	if selected != nil || len(candidates) != 0 {
		t.Fatal("unknown selector must request consent instead of falling back")
	}
	selected, candidates = selectConnectorAccount(connections, "gmail", "OTHER@Example.com")
	if selected == nil || selected.ConnectionID != "same@example.com" || len(candidates) != 0 {
		t.Fatal("identity labels must match case-insensitively")
	}
	selected, candidates = selectConnectorAccount(connections, "gmail", "Gmail-One")
	if selected != nil || len(candidates) != 0 {
		t.Fatal("connection IDs must match exactly")
	}
	stale := "external_connection_971b3337eee6a6b2cfcb96fe9431099d"
	selected, candidates = selectConnectorAccount(connections[3:], "slack", stale)
	if selected != nil || len(candidates) != 1 || candidates[0].ConnectionID != "slack-one" {
		t.Fatal("a stale connection ID must list the granted accounts instead of substituting one")
	}
	selected, candidates = selectConnectorAccount(connections, "notion", stale)
	if selected != nil || len(candidates) != 0 {
		t.Fatal("a stale connection ID without granted accounts must request consent")
	}
	selected, _ = selectConnectorAccount([]agentconnectedapps.ConnectedApp{{ConnectionID: "linear-one", AppKey: "linear"}}, "linear", "")
	if selected == nil || selected.ConnectionID != "linear-one" {
		t.Fatal("apps without dedicated commands must still select a delegated account")
	}
}

func TestConnectorAuthorizationPrompt(t *testing.T) {
	for _, tc := range []struct{ selector, want string }{
		{"", "Please connect and authorize your Outlook Mail account so I can continue."},
		{"work@example.com", "Please connect and authorize the Outlook Mail account work@example.com so I can continue."},
		{"external_connection_971b3337eee6a6b2cfcb96fe9431099d", "Please connect and authorize your Outlook Mail account so I can continue."},
	} {
		if got := connectorAuthorizationPrompt("Outlook Mail", tc.selector); got != tc.want {
			t.Errorf("selector %q: got %q", tc.selector, got)
		}
	}
}
