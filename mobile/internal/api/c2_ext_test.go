package api_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestParseWikiGraphPayloadHTMLAndJSON(t *testing.T) {
	html := `<!doctype html><html><body><script>const graph={"root":"Knowledge Graph","nodes":[{"id":"projects/alpha","title":"Alpha","category":"Project"}],"edges":[{"source":"projects/alpha","target":"topics/go"}]};</script></body></html>`
	g, err := api.ParseWikiGraphPayload([]byte(html))
	if err != nil {
		t.Fatalf("ParseWikiGraphPayload(html): %v", err)
	}
	if len(g.Nodes) != 1 || g.Nodes[0].ID != "projects/alpha" || len(g.Edges) != 1 {
		t.Fatalf("unexpected parsed HTML graph: %+v", g)
	}

	rawJSON := `{"nodes":[{"id":"a","title":"A"},{"id":"b","title":"B"}],"edges":[{"source":"a","target":"b"}]}`
	g2, err := api.ParseWikiGraphPayload([]byte(rawJSON))
	if err != nil {
		t.Fatalf("ParseWikiGraphPayload(json): %v", err)
	}
	if len(g2.Nodes) != 2 || len(g2.Edges) != 1 {
		t.Fatalf("unexpected parsed JSON graph: %+v", g2)
	}
}

func TestPocketNoteAndVoiceKeyDualDecoding(t *testing.T) {
	var teamhubNote api.PocketNoteRecord
	if err := json.Unmarshal([]byte(`{"date":"2026-11-24","text":"Hello"}`), &teamhubNote); err != nil {
		t.Fatalf("unmarshal teamhub note: %v", err)
	}
	if teamhubNote.Date != "2026-11-24" || teamhubNote.Text != "Hello" {
		t.Fatalf("unexpected teamhub note: %+v", teamhubNote)
	}

	var legacyNote api.PocketNoteRecord
	if err := json.Unmarshal([]byte(`{"note_date":"2026-11-23","body":"Legacy"}`), &legacyNote); err != nil {
		t.Fatalf("unmarshal legacy note: %v", err)
	}
	if legacyNote.Date != "2026-11-23" || legacyNote.Text != "Legacy" {
		t.Fatalf("unexpected legacy note: %+v", legacyNote)
	}

	var envKey api.VoiceProviderKeyStatusC2
	if err := json.Unmarshal([]byte(`{"source":"environment","can_save":false}`), &envKey); err != nil {
		t.Fatalf("unmarshal voice key: %v", err)
	}
	if !envKey.Configured || envKey.CanSave {
		t.Fatalf("unexpected voice key status: %+v", envKey)
	}
}

func TestC2ExtendedEndpointsEndToEnd(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	client, err := srv.NewClient()
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	ctx := context.Background()

	// Work item create -> comment -> timeline -> transition -> archive
	wi, err := client.CreateWorkItemIdempotent(ctx, srv.TenantID, api.WorkItemCreateInput{
		Kind:  "issue",
		Title: "Verify idempotency",
	}, "")
	if err != nil || wi.Title != "Verify idempotency" {
		t.Fatalf("CreateWorkItemIdempotent: %+v (%v)", wi, err)
	}
	c, err := client.CreateWorkItemCommentIdempotent(ctx, wi.ID, "First comment", "")
	if err != nil || c.Body != "First comment" {
		t.Fatalf("CreateWorkItemCommentIdempotent: %+v (%v)", c, err)
	}
	if _, err := client.UpdateWorkItemComment(ctx, wi.ID, c.ID, "Edited comment", c.Version, ""); err != nil {
		t.Fatalf("UpdateWorkItemComment: %v", err)
	}
	if _, err := client.DeleteWorkItemComment(ctx, wi.ID, c.ID, c.Version+1, ""); err != nil {
		t.Fatalf("DeleteWorkItemComment: %v", err)
	}

	// Document upload multipart + link share + preview session
	uploaded, err := client.UploadTenantDocument(ctx, srv.TenantID, "notes.txt", "file", "text/plain", nil, []byte("hello upload"), "")
	if err != nil || uploaded.Title != "notes.txt" {
		t.Fatalf("UploadTenantDocument: %+v (%v)", uploaded, err)
	}
	ls, err := client.SetDocumentLinkShare(ctx, "doc_1", "viewer", 1, true)
	if err != nil || ls.URL == nil || !strings.Contains(*ls.URL, "share_tok_") {
		t.Fatalf("SetDocumentLinkShare: %+v (%v)", ls, err)
	}
	if err := client.RevokeDocumentLinkShare(ctx, "doc_1", ls.Version); err != nil {
		t.Fatalf("RevokeDocumentLinkShare: %v", err)
	}

	// Wiki graph
	graph, err := client.GetPersonalWikiGraphData(ctx, srv.TenantID)
	if err != nil || len(graph.Nodes) < 3 {
		t.Fatalf("GetPersonalWikiGraphData: %+v (%v)", graph, err)
	}

	// Proactive rules shadow promotion
	book, err := client.PromoteProactiveRuleBook(ctx, srv.TenantID, "rule_shadow_1")
	if err != nil || len(book.Rules) != 2 {
		t.Fatalf("PromoteProactiveRuleBook: %+v (%v)", book, err)
	}
	if book.Rules[1].Status != "active" {
		t.Fatalf("expected promoted rule active, got %+v", book.Rules[1])
	}
}
