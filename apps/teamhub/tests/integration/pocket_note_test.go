package integration_test

import (
	"net/http"
	"testing"
)

func TestPocketNotesFollowTheHumanAcrossSessionsAndClearToNoPage(t *testing.T) {
	allowParallelIntegrationTest(t)
	env := newRoomMembershipEnv(t)
	alice := env.login("alice", alicePassword)
	otherDevice := env.login("alice", alicePassword)
	path := "/v0/tenants/" + acmeTenant + "/me/pocket-notes"
	type note struct {
		Date string `json:"date"`
		Text string `json:"text"`
	}
	type page struct {
		Today string `json:"today"`
		Items []note `json:"items"`
	}
	list := func(client *http.Client) page {
		t.Helper()
		status, _, body := env.request(client, http.MethodGet, path, nil, "")
		if status != http.StatusOK {
			t.Fatalf("list Pocket Notes status=%d body=%s", status, body)
		}
		var result page
		decode(t, body, &result)
		return result
	}

	status, _, body := env.request(alice, http.MethodPut, path+"/today", map[string]any{"text": "buy milk"}, "")
	if status != http.StatusOK {
		t.Fatalf("write Pocket Note status=%d body=%s", status, body)
	}
	var written note
	decode(t, body, &written)
	alicePage := list(alice)
	if written.Date != alicePage.Today || len(alicePage.Items) != 1 || alicePage.Items[0] != written {
		t.Fatalf("written=%+v listed=%+v", written, alicePage)
	}
	if otherPage := list(otherDevice); len(otherPage.Items) != 1 || otherPage.Items[0] != written {
		t.Fatalf("another session of the Human listed %+v", otherPage.Items)
	}

	if status, _, body = env.request(alice, http.MethodPut, path+"/today", map[string]any{"text": ""}, ""); status != http.StatusOK {
		t.Fatalf("clear Pocket Note status=%d body=%s", status, body)
	}
	if cleared := list(alice); len(cleared.Items) != 0 {
		t.Fatalf("cleared page still listed: %+v", cleared.Items)
	}
	// Both changes wait in one Tracking Item refresh a while later.
	var refreshes int
	var later bool
	if err := env.pool.QueryRow(t.Context(), `
		SELECT count(*), coalesce(bool_and(scheduled_at > now() + interval '4 minutes'), false)
		FROM river_job
		WHERE kind='voice.pocket_note_tracking' AND state='scheduled'
		  AND args->>'tenant_id'=$1 AND args->>'date'=$2
	`, acmeTenant, written.Date).Scan(&refreshes, &later); err != nil {
		t.Fatal(err)
	}
	if refreshes != 1 || !later {
		t.Fatalf("Pocket Note tracking refreshes=%d scheduled later=%v", refreshes, later)
	}
}

func TestPocketNotesDeletePastDaysOnly(t *testing.T) {
	allowParallelIntegrationTest(t)
	env := newRoomMembershipEnv(t)
	alice := env.login("alice", alicePassword)
	path := "/v0/tenants/" + acmeTenant + "/me/pocket-notes"
	if _, err := env.pool.Exec(t.Context(), `
		INSERT INTO pocket_notes(tenant_id,owner_actor_id,note_date,body)
		SELECT tenant_id,id,'2026-01-01','old note' FROM actors
		WHERE tenant_id=$1 AND account_id='account_alice' AND kind='human'
	`, acmeTenant); err != nil {
		t.Fatal(err)
	}
	status, _, body := env.request(alice, http.MethodPut, path+"/today", map[string]any{"text": "today's note"}, "")
	if status != http.StatusOK {
		t.Fatalf("write Pocket Note status=%d body=%s", status, body)
	}
	var today struct {
		Date string `json:"date"`
	}
	decode(t, body, &today)
	listed := func() []string {
		t.Helper()
		status, _, body := env.request(alice, http.MethodGet, path, nil, "")
		if status != http.StatusOK {
			t.Fatalf("list Pocket Notes status=%d body=%s", status, body)
		}
		var page struct {
			Items []struct {
				Date string `json:"date"`
			} `json:"items"`
		}
		decode(t, body, &page)
		dates := make([]string, 0, len(page.Items))
		for _, item := range page.Items {
			dates = append(dates, item.Date)
		}
		return dates
	}

	// Today's page stays editable and cannot be deleted.
	if status, _, body := env.request(alice, http.MethodDelete, path+"/"+today.Date, nil, ""); status != http.StatusBadRequest {
		t.Fatalf("delete today status=%d body=%s", status, body)
	}
	for range 2 {
		if status, _, body := env.request(alice, http.MethodDelete, path+"/2026-01-01", nil, ""); status != http.StatusNoContent {
			t.Fatalf("delete past day status=%d body=%s", status, body)
		}
	}
	if dates := listed(); len(dates) != 1 || dates[0] != today.Date {
		t.Fatalf("listed after delete=%v", dates)
	}
}

func TestPocketNotesRejectStaleExpectedUpdatedAtAndAllowUnconditionalWrites(t *testing.T) {
	allowParallelIntegrationTest(t)
	env := newRoomMembershipEnv(t)
	alice := env.login("alice", alicePassword)
	path := "/v0/tenants/" + acmeTenant + "/me/pocket-notes"

	type note struct {
		Date      string `json:"date"`
		Text      string `json:"text"`
		UpdatedAt string `json:"updated_at"`
	}
	type errorEnvelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	readToday := func() string {
		t.Helper()
		status, _, body := env.request(alice, http.MethodGet, path, nil, "")
		if status != http.StatusOK {
			t.Fatalf("list Pocket Notes status=%d body=%s", status, body)
		}
		var page struct {
			Today string `json:"today"`
			Items []note `json:"items"`
		}
		decode(t, body, &page)
		for _, item := range page.Items {
			if item.Date == page.Today {
				return item.Text
			}
		}
		return ""
	}

	// First writer creates today's note expecting an empty page.
	status, _, body := env.request(alice, http.MethodPut, path+"/today", map[string]any{
		"text":                "Tab 1 words",
		"expected_updated_at": "",
	}, "")
	if status != http.StatusOK {
		t.Fatalf("create Pocket Note status=%d body=%s", status, body)
	}
	var first note
	decode(t, body, &first)
	if first.Text != "Tab 1 words" || first.UpdatedAt == "" {
		t.Fatalf("first=%+v", first)
	}

	// Competing writer expecting an empty page gets 409 POCKET_NOTE_CONFLICT.
	status, _, body = env.request(alice, http.MethodPut, path+"/today", map[string]any{
		"text":                "Tab 2 words",
		"expected_updated_at": "",
	}, "")
	if status != http.StatusConflict {
		t.Fatalf("competing empty create status=%d body=%s", status, body)
	}
	var conflict errorEnvelope
	decode(t, body, &conflict)
	if conflict.Error.Code != "POCKET_NOTE_CONFLICT" {
		t.Fatalf("conflict code=%q body=%s", conflict.Error.Code, body)
	}
	if got := readToday(); got != "Tab 1 words" {
		t.Fatalf("today text after empty conflict=%q", got)
	}

	// Writer with matching expected_updated_at succeeds and advances updated_at.
	status, _, body = env.request(alice, http.MethodPut, path+"/today", map[string]any{
		"text":                "Tab 1 + Tab 2",
		"expected_updated_at": first.UpdatedAt,
	}, "")
	if status != http.StatusOK {
		t.Fatalf("matching update status=%d body=%s", status, body)
	}
	var second note
	decode(t, body, &second)
	if second.UpdatedAt == first.UpdatedAt {
		t.Fatalf("updated_at did not advance: %q", second.UpdatedAt)
	}

	// Stale writer using first.UpdatedAt is rejected and does not overwrite second.
	status, _, body = env.request(alice, http.MethodPut, path+"/today", map[string]any{
		"text":                "Stale overwrite",
		"expected_updated_at": first.UpdatedAt,
	}, "")
	if status != http.StatusConflict {
		t.Fatalf("stale update status=%d body=%s", status, body)
	}
	if got := readToday(); got != "Tab 1 + Tab 2" {
		t.Fatalf("today text after stale conflict=%q", got)
	}

	// Stale clear is also rejected with 409.
	status, _, body = env.request(alice, http.MethodPut, path+"/today", map[string]any{
		"text":                "",
		"expected_updated_at": first.UpdatedAt,
	}, "")
	if status != http.StatusConflict {
		t.Fatalf("stale clear status=%d body=%s", status, body)
	}
	if got := readToday(); got != "Tab 1 + Tab 2" {
		t.Fatalf("today text after stale clear=%q", got)
	}

	// Malformed expected_updated_at returns 400 INVALID_REQUEST.
	status, _, body = env.request(alice, http.MethodPut, path+"/today", map[string]any{
		"text":                "Bad precondition",
		"expected_updated_at": "not-a-timestamp",
	}, "")
	if status != http.StatusBadRequest {
		t.Fatalf("invalid expected_updated_at status=%d body=%s", status, body)
	}

	// Matching clear deletes the row; a subsequent stale write using second.UpdatedAt conflicts.
	status, _, body = env.request(alice, http.MethodPut, path+"/today", map[string]any{
		"text":                "",
		"expected_updated_at": second.UpdatedAt,
	}, "")
	if status != http.StatusOK {
		t.Fatalf("matching clear status=%d body=%s", status, body)
	}
	status, _, body = env.request(alice, http.MethodPut, path+"/today", map[string]any{
		"text":                "Write after clear",
		"expected_updated_at": second.UpdatedAt,
	}, "")
	if status != http.StatusConflict {
		t.Fatalf("stale write after clear status=%d body=%s", status, body)
	}

	// Legacy callers omitting expected_updated_at remain backward compatible.
	status, _, body = env.request(alice, http.MethodPut, path+"/today", map[string]any{
		"text": "Unconditional legacy write",
	}, "")
	if status != http.StatusOK {
		t.Fatalf("legacy unconditional write status=%d body=%s", status, body)
	}
	if got := readToday(); got != "Unconditional legacy write" {
		t.Fatalf("today text after legacy write=%q", got)
	}
}
