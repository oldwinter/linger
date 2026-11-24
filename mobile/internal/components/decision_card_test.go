package components_test

import (
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func TestAll12DecisionCardsAndDuplicateTapProtection(t *testing.T) {
	patch := "--- a/app.go\n+++ b/app.go\n@@ -1,2 +1,3 @@\n package app\n+// added line\n func run() {}\n"
	subj := "Status Update"
	desc := "Release coordination room"
	appKey := "slack"
	acct := "alex@linger.dev"
	before := "Old prompt"
	reason := "Required for screen capture"

	rawJSON := func(v any) json.RawMessage {
		b, _ := json.Marshal(v)
		return b
	}

	cards := []api.DecisionRequestedMessageCard{
		{
			DecisionID: "d1", Kind: "runtime_permission", Status: "pending", Title: "Run go test", Version: 1,
			Requester:         api.MessageCardActorRef{ID: "a1", Kind: "agent", DisplayName: "Scout"},
			RuntimePermission: rawJSON(api.RuntimePermissionDecisionView{Kind: "code", Tool: "shell", Rationale: "Verify build", Input: "go test ./...", Patch: &patch}),
		},
		{
			DecisionID: "d2", Kind: "connector_write", Status: "pending", Title: "Send status email", Version: 1,
			ConnectorWrite: rawJSON(api.ConnectorWriteDecisionView{Kind: "message", App: "gmail", Account: acct, Message: &api.ConnectorConfirmationMessage{To: []string{"team@linger.dev"}, Subject: &subj, Body: "All green."}}),
		},
		{
			DecisionID: "d3", Kind: "question", Status: "pending", Title: "Choose target", Version: 1,
			Question: rawJSON(api.QuestionDecisionView{Questions: []api.DecisionQuestion{{ID: "q1", Prompt: "Release track?", Input: "single_select", Options: []api.DecisionQuestionOption{{ID: "beta", Label: "Beta"}, {ID: "prod", Label: "Prod"}}}}}),
		},
		{
			DecisionID: "d4", Kind: "agent_change", Status: "pending", Title: "Update Scout prompt", Version: 1,
			AgentChange: rawJSON(api.AgentChangeDecisionView{Action: "update", AgentName: "Scout", Changes: []api.AgentChangeConfirmationChange{{Field: "instructions", Before: &before, After: "New prompt"}}}),
		},
		{
			DecisionID: "d5", Kind: "room_creation", Status: "pending", Title: "Create Incident Room", Version: 1,
			RoomCreation: rawJSON(api.RoomCreationDecisionView{Name: "Incident 42", Description: &desc, MemberIDs: []string{"act_1", "act_2"}}),
		},
		{
			DecisionID: "d6", Kind: "connection_auth", Status: "pending", Title: "Authorize Slack", Version: 1,
			ConnectionAuth: rawJSON(api.ConnectionAuthDecisionView{AppKey: appKey, Account: &acct}),
		},
		{
			DecisionID: "d7", Kind: "provider_key", Status: "pending", Title: "Add Composio Key", Version: 1,
			ProviderKey: rawJSON(api.ProviderKeyDecisionView{AppKey: &appKey}),
		},
		{
			DecisionID: "d8", Kind: "search_key", Status: "pending", Title: "Add Search Key", Version: 1,
			SearchKey: rawJSON(api.SearchKeyDecisionView{Backend: "exa", Origin: "requested", Reason: "missing"}),
		},
		{
			DecisionID: "d9", Kind: "browser_connection", Status: "pending", Title: "Connect Chrome", Version: 1,
			BrowserConnection: rawJSON(api.BrowserConnectionDecisionView{ComputerID: "comp_1"}),
		},
		{
			DecisionID: "d10", Kind: "computer_permission", Status: "pending", Title: "Grant Screen Recording", Version: 1,
			ComputerPermission: rawJSON(api.ComputerPermissionDecisionView{ComputerID: "comp_1", Subject: "linger", Permissions: []string{"screen_recording"}, Reason: &reason}),
		},
		{
			DecisionID: "d11", Kind: "profile_setup_apps", Status: "pending", Title: "Connect Profile Apps", Version: 1,
			ProfileSetup: rawJSON(api.ProfileSetupDecisionView{Apps: []string{"github", "gmail"}}),
		},
		{
			DecisionID: "d12", Kind: "profile_setup_sources", Status: "pending", Title: "Share Profile Sources", Version: 1,
			ProfileSetup: rawJSON(api.ProfileSetupDecisionView{}),
		},
	}

	for _, card := range cards {
		card := card
		t.Run(card.Kind, func(t *testing.T) {
			st := &components.DecisionCardState{}
			view := func(c *ui.Context) {
				c.SetTheme(theme.TownLight())
				ui.Scroll(c).Fill().Background(c.Theme().Background).Children(func() {
					ui.Column(c).FillWidth().Padding(8, 8).Children(func() {
						components.DecisionCardView(c, "room_1", "Product Launch", card, st, components.DecisionCardCallbacks{
							ShowSourceRoomChip: true,
							OnJumpToRoom:       func(string) {},
						})
					})
				})
			}
			// Narrow 320x640 check ensures zero crash/overflow on smallest phone width.
			tt := testutil.NewPhoneTester(view, testutil.StandardMobileViewports[0])
			tt.Frame()
			if !tt.HasText(card.Title) {
				t.Fatalf("expected title %q to render for kind %s", card.Title, card.Kind)
			}
		})
	}

	// Verify busy lock disables duplicate Approve clicks and displays "Approving...".
	stBusy := &components.DecisionCardState{}
	stBusy.SetBusy("approve")
	clicks := 0
	busyView := func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		ui.Column(c).Fill().Background(c.Theme().Background).Padding(12, 12).Children(func() {
			components.DecisionCardView(c, "room_1", "Product Launch", cards[0], stBusy, components.DecisionCardCallbacks{
				OnDecide: func(_, _ string, _ api.DecisionRequest) { clicks++ },
			})
		})
	}
	ttBusy := testutil.NewPhoneTester(busyView, testutil.StandardMobileViewports[1])
	ttBusy.Frame()
	if !ttBusy.HasText("Approving...") {
		t.Fatal("expected busy label 'Approving...' while approve action is in flight")
	}
	ttBusy.Click("Approving...")
	ttBusy.Frame()
	if clicks != 0 {
		t.Fatalf("expected disabled busy Approve button to block duplicate taps, got %d clicks", clicks)
	}
}

func TestMailCanvasCardRenderAndActions(t *testing.T) {
	sent := false
	declined := false
	mail := api.MailCanvasState{
		To:           "team@linger.dev",
		Subject:      "Release Candidate Notes",
		Body:         "All checks green.",
		Status:       "draft",
		SourceDigest: "sha256:digest_abc123456789",
		CanEdit:      true,
	}
	view := func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Padding(12, 12).Children(func() {
			components.MailCanvasCard(c, "doc_mail_1", mail, false, components.MailCanvasCallbacks{
				OnSend:    func(string, api.MailCanvasState) { sent = true },
				OnDecline: func(string, api.MailCanvasState) { declined = true },
			})
		})
	}
	tt := testutil.NewPhoneTester(view, testutil.StandardMobileViewports[1])
	tt.Frame()
	if !tt.HasText("Release Candidate Notes") || !tt.HasText("Send Email") || !tt.HasText("Don't send") {
		t.Fatal("expected MailCanvasCard title and actions")
	}
	tt.Click("Send Email")
	tt.Frame()
	if !sent {
		t.Fatal("expected Send Email click to invoke OnSend")
	}
	tt.Click("Don't send")
	tt.Frame()
	if !declined {
		t.Fatal("expected Don't send click to invoke OnDecline")
	}
}
