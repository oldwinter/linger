package integration_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentcredential"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
)

const (
	proactiveActiveRuleID = "pr_0000000000000000000000000000000a"
	proactiveShadowRuleID = "pr_0000000000000000000000000000000b"
)

func proactiveRuleRecord(id, text, status string, pinned bool, source string) map[string]any {
	rule := map[string]any{
		"id": id, "text": text, "status": status, "pinned": pinned, "source": source,
		"created_at": "2026-11-01T08:00:00Z", "promoted_at": nil, "guideline_version": 1,
	}
	if status == "active" {
		rule["promoted_at"] = "2026-11-01T08:00:00Z"
	}
	return rule
}

// seedProactiveRules writes a guideline version the way Memory's dreaming does.
func seedProactiveRules(t *testing.T, pool *pgxpool.Pool, ownerActorID string, version int, rules ...map[string]any) {
	t.Helper()
	encoded, _ := json.Marshal(rules)
	clues := `[{"matter":"Acme quote","kind":"client communication","time":null,"leaning":"remind_directly","seen":1,"last_seen":"2026-11-01"}]`
	if _, err := pool.Exec(t.Context(), `SELECT memory_source.record_proactive_guideline($1,$2,$3,$4::jsonb,'[]'::jsonb,$5::jsonb,'seeded')`,
		acmeTenant, ownerActorID, version, string(encoded), clues); err != nil {
		t.Fatal(err)
	}
}

// TestProactiveMyRulesCommandsAndShadowDivergences covers My Rules end to
// end: the Human lists, pins, edits, promotes and deletes their rules, each a
// new guideline version; their AnotherMe records shadow divergences only for
// current shadow rules; and a nightly write that read an older version cannot
// overwrite what the Human changed meanwhile.
func TestProactiveMyRulesCommandsAndShadowDivergences(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, pool := newConnectedAnotherMeEnv(t, nil)
	seedProactiveRules(t, pool, "actor_acme_alice", 2,
		proactiveRuleRecord(proactiveActiveRuleID, "client replies → remind directly", "active", false, "learned"),
		proactiveRuleRecord(proactiveShadowRuleID, "vendor invoices → track for follow-up", "shadow", false, "learned"))
	alice := env.login("alice", alicePassword)
	path := "/v0/tenants/" + acmeTenant + "/me/proactive-rules"
	call := func(method, route string, input any) (int, proactive.RuleBook) {
		t.Helper()
		status, _, body := env.request(alice, method, path+route, input, "")
		var book proactive.RuleBook
		if status == http.StatusOK {
			decode(t, body, &book)
		}
		return status, book
	}

	status, book := call(http.MethodGet, "", nil)
	if status != http.StatusOK || book.Version != 2 || len(book.Rules) != 2 || len(book.Clues) != 1 || book.Clues[0].Matter != "Acme quote" ||
		book.Rules[1].Status != proactive.RuleShadow || book.Rules[1].PromotedAt != nil {
		t.Fatalf("list status=%d book=%+v", status, book)
	}

	// AnotherMe records where the shadow rule would have acted otherwise.
	var managementID string
	if err := pool.QueryRow(t.Context(), `SELECT agent_management_id FROM agent_registrations
		WHERE represented_human_actor_id='actor_acme_alice' AND agent_type='anotherme'`).Scan(&managementID); err != nil {
		t.Fatal(err)
	}
	issued, err := agentcredential.New(pool).IssueManaged(t.Context(), managementID, "Shadow divergence")
	if err != nil {
		t.Fatal(err)
	}
	record := func(input map[string]any) int {
		t.Helper()
		encoded, _ := json.Marshal(input)
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, env.server.URL+"/api/agent/v1/proactive/shadow-divergences", bytes.NewReader(encoded))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+issued.AccessToken)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	divergence := map[string]any{"rule_id": proactiveShadowRuleID, "matter": "AWS invoice", "shadow_action": "track", "taken_action": "notify"}
	for range 2 {
		// A replay keeps one fact.
		if status := record(divergence); status != http.StatusOK {
			t.Fatalf("record divergence status=%d", status)
		}
	}
	for _, rejected := range []map[string]any{
		{"rule_id": proactiveActiveRuleID, "matter": "Acme reply", "shadow_action": "track", "taken_action": "notify"},
		{"rule_id": proactiveShadowRuleID, "matter": "AWS invoice", "shadow_action": "notify", "taken_action": "notify"},
		{"rule_id": proactiveShadowRuleID, "matter": " ", "shadow_action": "track", "taken_action": "notify"},
	} {
		if status := record(rejected); status != http.StatusNotFound && status != http.StatusBadRequest {
			t.Fatalf("divergence %v recorded: status=%d", rejected, status)
		}
	}
	status, book = call(http.MethodGet, "", nil)
	if status != http.StatusOK || len(book.Divergences) != 1 || book.Divergences[0].RuleID != proactiveShadowRuleID ||
		book.Divergences[0].GuidelineVersion != 2 || book.Divergences[0].ShadowAction != "track" || book.Divergences[0].TakenAction != "notify" {
		t.Fatalf("divergences=%+v", book.Divergences)
	}

	// Dreaming reads version 2, then the Human pins the active rule.
	status, book = call(http.MethodPut, "/"+proactiveActiveRuleID+"/pin", map[string]bool{"pinned": true})
	if status != http.StatusOK || book.Version != 3 || !book.Rules[0].Pinned || len(book.Clues) != 1 {
		t.Fatalf("pin status=%d book=%+v", status, book)
	}
	// Its write of version 3 without the pin fails instead of dropping it.
	_, err = pool.Exec(t.Context(), `SELECT memory_source.record_proactive_guideline($1,'actor_acme_alice',3,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'night')`, acmeTenant)
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) || postgresError.Code != "23505" {
		t.Fatalf("a nightly write from an older version was accepted: %v", err)
	}

	status, book = call(http.MethodPatch, "/"+proactiveShadowRuleID, map[string]string{"text": " vendor invoices, over 1000 → track for follow-up "})
	if status != http.StatusOK || book.Version != 4 || book.Rules[1].Text != "vendor invoices, over 1000 → track for follow-up" ||
		book.Rules[1].Source != proactive.RuleByHuman || book.Rules[1].Status != proactive.RuleShadow || book.Rules[1].GuidelineVersion != 4 {
		t.Fatalf("edit status=%d book=%+v", status, book)
	}
	if status, _ := call(http.MethodPatch, "/"+proactiveShadowRuleID, map[string]string{"text": "client replies → remind directly"}); status != http.StatusBadRequest {
		t.Fatalf("a duplicate rule text was accepted: %d", status)
	}

	status, book = call(http.MethodPost, "/"+proactiveShadowRuleID+"/promotion", nil)
	if status != http.StatusOK || book.Version != 5 || book.Rules[1].Status != proactive.RuleActive || book.Rules[1].PromotedAt == nil {
		t.Fatalf("promote status=%d book=%+v", status, book)
	}
	if status, _ := call(http.MethodPost, "/"+proactiveShadowRuleID+"/promotion", nil); status != http.StatusNotFound {
		t.Fatalf("promoting an active rule status=%d", status)
	}
	// Once promoted, the rule decides and no longer takes divergences.
	guideline, err := proactive.StoredGuideline(pool)(t.Context(), proactive.Owner{TenantID: acmeTenant, ActorID: "actor_acme_alice"})
	if judge := guideline.JudgeRules(); err != nil || len(judge.Rules) != 2 || len(judge.ShadowRules) != 0 {
		t.Fatalf("judge rules=%+v err=%v", judge, err)
	}
	if status := record(divergence); status != http.StatusNotFound {
		t.Fatalf("divergence for a promoted rule status=%d", status)
	}

	status, book = call(http.MethodDelete, "/"+proactiveActiveRuleID, nil)
	if status != http.StatusOK || book.Version != 6 || len(book.Rules) != 1 || book.Rules[0].ID != proactiveShadowRuleID {
		t.Fatalf("delete status=%d book=%+v", status, book)
	}
	var deleted string
	if err := pool.QueryRow(t.Context(), `SELECT deleted_rules->0->>'text' FROM memory_source.proactive_guidelines
		WHERE owner_actor_id='actor_acme_alice' AND version=6`).Scan(&deleted); err != nil || deleted != "client replies → remind directly" {
		t.Fatalf("deleted rule remembered=%q err=%v", deleted, err)
	}
	if status, _ := call(http.MethodDelete, "/"+proactiveActiveRuleID, nil); status != http.StatusNotFound {
		t.Fatalf("deleting a missing rule status=%d", status)
	}

	// Another Human's newer rules never show in this Human's book.
	seedProactiveRules(t, pool, "actor_acme_other", 9,
		proactiveRuleRecord("pr_0000000000000000000000000000000c", "someone else's rule", "active", false, "learned"))
	if status, book := call(http.MethodGet, "", nil); status != http.StatusOK || book.Version != 6 || len(book.Rules) != 1 {
		t.Fatalf("list after another Human's write status=%d book=%+v", status, book)
	}
}
