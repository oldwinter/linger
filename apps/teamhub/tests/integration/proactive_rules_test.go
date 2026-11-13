package integration_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
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
		"created_at": "2026-11-01T08:00:00Z", "promoted_at": nil, "guideline_version": 1, "mandate": "none",
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

// TestProactiveMandatesActOnlyWhileTheHumanGrantsThem covers Phase B: only
// the Human grants a mandate, on an active rule; Another Me then creates a
// Work Item, or delegates a Task, once per rule and event, with an immutable
// Mandate shown on the Work Item and in My Rules; lowering the mandate stops
// later acts and marks earlier Mandates revoked.
func TestProactiveMandatesActOnlyWhileTheHumanGrantsThem(t *testing.T) {
	allowParallelIntegrationTest(t)
	env, pool := newConnectedAnotherMeEnv(t, nil)
	seedProactiveRules(t, pool, "actor_acme_alice", 2,
		proactiveRuleRecord(proactiveActiveRuleID, "client contract changes → remind directly", "active", false, "learned"),
		proactiveRuleRecord(proactiveShadowRuleID, "vendor invoices → track for follow-up", "shadow", false, "learned"))
	alice := env.login("alice", alicePassword)
	path := "/v0/tenants/" + acmeTenant + "/me/proactive-rules"
	setMandate := func(ruleID, mandate string) (int, proactive.RuleBook) {
		t.Helper()
		status, _, body := env.request(alice, http.MethodPut, path+"/"+ruleID+"/mandate", map[string]string{"mandate": mandate}, "")
		var book proactive.RuleBook
		if status == http.StatusOK {
			decode(t, body, &book)
		}
		return status, book
	}
	if status, _ := setMandate(proactiveShadowRuleID, "create"); status != http.StatusBadRequest {
		t.Fatalf("a shadow rule took a mandate: %d", status)
	}
	status, book := setMandate(proactiveActiveRuleID, "create")
	if status != http.StatusOK || book.Rules[0].Mandate != "create" || book.Rules[1].Mandate != "none" {
		t.Fatalf("grant status=%d rules=%+v", status, book.Rules)
	}
	guideline, err := proactive.StoredGuideline(pool)(t.Context(), proactive.Owner{TenantID: acmeTenant, ActorID: "actor_acme_alice"})
	if judge := guideline.JudgeRules(); err != nil || len(judge.MandateRules) != 1 || judge.MandateRules[0].ID != proactiveActiveRuleID {
		t.Fatalf("judge mandate rules=%+v err=%v", judge.MandateRules, err)
	}

	var managementID string
	if err := pool.QueryRow(t.Context(), `SELECT agent_management_id FROM agent_registrations
		WHERE represented_human_actor_id='actor_acme_alice' AND agent_type='anotherme'`).Scan(&managementID); err != nil {
		t.Fatal(err)
	}
	issued, err := agentcredential.New(pool).IssueManaged(t.Context(), managementID, "Mandate")
	if err != nil {
		t.Fatal(err)
	}
	roomID := anotherMeRoomID(t, pool, "actor_acme_alice")
	actOn := func(source, externalID string, delegate bool) (int, proactive.ActResult) {
		t.Helper()
		code, _, body := taskWorkerJSONRequest(t, env, http.MethodPost, "/api/agent/v1/proactive/acts", issued.AccessToken, map[string]any{
			"rule_id": proactiveActiveRuleID, "event_source": source, "event_external_id": externalID,
			"title": "Review the Acme contract change", "brief": "Acme changed the payment terms; compare them with the signed contract.",
			"delegate": delegate,
		}, taskDelegationRoomContext(roomID))
		var result proactive.ActResult
		if code == http.StatusOK {
			decode(t, body, &result)
		}
		return code, result
	}
	act := func(externalID string, delegate bool) (int, proactive.ActResult) {
		t.Helper()
		return actOn("gmail", externalID, delegate)
	}
	if code, _ := act("thread_1", true); code != http.StatusForbidden {
		t.Fatalf("delegating under a create mandate=%d", code)
	}
	code, created := act("thread_1", false)
	if code != http.StatusOK || created.WorkItemID == "" || created.Strength != "create" || created.Replay {
		t.Fatalf("act=%d %+v", code, created)
	}
	// A retried Run never creates a second Work Item.
	if code, again := act("thread_1", false); code != http.StatusOK || again.WorkItemID != created.WorkItemID || !again.Replay {
		t.Fatalf("replayed act=%d %+v", code, again)
	}
	mandateOf := func(workItemID string) map[string]any {
		t.Helper()
		status, _, body := env.request(alice, http.MethodGet, "/v0/work-items/"+workItemID, nil, "")
		var item struct {
			Kind    string         `json:"kind"`
			Mandate map[string]any `json:"mandate"`
		}
		if status != http.StatusOK {
			t.Fatalf("get Work Item status=%d body=%s", status, body)
		}
		decode(t, body, &item)
		item.Mandate["kind"] = item.Kind
		return item.Mandate
	}
	if mandate := mandateOf(created.WorkItemID); mandate["kind"] != "issue" || mandate["rule_id"] != proactiveActiveRuleID ||
		mandate["rule_text"] != "client contract changes → remind directly" || mandate["guideline_version"] != float64(3) ||
		mandate["event_external_id"] != "thread_1" || mandate["strength"] != "create" || mandate["revoked"] != false {
		t.Fatalf("Work Item mandate=%v", mandate)
	}
	// Each completion of a herdr pane is an outside event of its own: the
	// pane's next completion acts again, a retried act for one does not.
	completion := func(seq int64) string {
		return proactive.HerdrEvent(acmeTenant, "actor_acme_alice", proactive.HerdrReport{
			ComputerID: "computer_alice", Kind: proactive.HerdrAgentFinished, PaneID: "w1:p1", StateChangeSeq: seq,
		}).ExternalID
	}
	code, firstDone := actOn(proactive.SourceHerdr, completion(12), false)
	if code != http.StatusOK || firstDone.Replay || firstDone.WorkItemID == created.WorkItemID {
		t.Fatalf("first completion act=%d %+v", code, firstDone)
	}
	code, nextDone := actOn(proactive.SourceHerdr, completion(14), false)
	if code != http.StatusOK || nextDone.Replay || nextDone.WorkItemID == firstDone.WorkItemID {
		t.Fatalf("next completion act=%d %+v", code, nextDone)
	}
	if code, again := actOn(proactive.SourceHerdr, completion(12), false); code != http.StatusOK || !again.Replay || again.WorkItemID != firstDone.WorkItemID {
		t.Fatalf("replayed completion act=%d %+v", code, again)
	}
	if countRows(t, env, `SELECT count(*) FROM work_items WHERE created_by_actor_id=(SELECT actor_id FROM agent_registrations WHERE agent_management_id=$1)`, managementID) != 3 {
		t.Fatal("acts for three outside events did not create exactly three Work Items")
	}

	// Lowering the mandate is the revocation: later acts stop, the record stays.
	if status, _ := setMandate(proactiveActiveRuleID, "none"); status != http.StatusOK {
		t.Fatalf("revoke status=%d", status)
	}
	if code, _ := act("thread_2", false); code != http.StatusForbidden {
		t.Fatalf("act after revocation=%d", code)
	}
	if mandate := mandateOf(created.WorkItemID); mandate["revoked"] != true || mandate["strength"] != "create" {
		t.Fatalf("revoked Work Item mandate=%v", mandate)
	}

	status, book = setMandate(proactiveActiveRuleID, "create_and_delegate")
	if status != http.StatusOK || len(book.Mandates) != 3 || !slices.ContainsFunc(book.Mandates, func(m proactive.RuleMandate) bool { return m.WorkItemID == created.WorkItemID }) ||
		slices.ContainsFunc(book.Mandates, func(m proactive.RuleMandate) bool { return m.Revoked }) {
		t.Fatalf("My Rules mandates=%+v", book.Mandates)
	}
	code, delegated := act("thread_3", true)
	if code != http.StatusOK || delegated.Strength != "create_and_delegate" {
		t.Fatalf("delegated act=%d %+v", code, delegated)
	}
	if mandate := mandateOf(delegated.WorkItemID); mandate["kind"] != "task" || mandate["strength"] != "create_and_delegate" {
		t.Fatalf("delegated Task mandate=%v", mandate)
	}
	// Deleting the rule revokes every Mandate under it.
	if status, _, body := env.request(alice, http.MethodDelete, path+"/"+proactiveActiveRuleID, nil, ""); status != http.StatusOK ||
		!strings.Contains(string(body), `"revoked":true`) || strings.Contains(string(body), `"revoked":false`) {
		t.Fatalf("delete status=%d body=%s", status, body)
	}
}
