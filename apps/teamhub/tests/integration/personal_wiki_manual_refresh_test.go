package integration_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/document"
)

type manualWikiRefreshResponse struct {
	Outcome string `json:"outcome"`
}

// The public refresh route admits a Human's own refresh, reports the running
// one instead of admitting another, reports unchanged sources once it has
// published, and refuses a caller without a Session.
func TestPersonalWikiManualRefreshOutcomes(t *testing.T) {
	allowParallelIntegrationTest(t)
	generator := &blockingUnifiedWikiGenerator{
		started: make(chan document.WikiCandidateGenerationRequest, 1),
		release: make(chan struct{}),
	}
	released := false
	t.Cleanup(func() {
		if !released {
			close(generator.release)
		}
	})
	env, alice := newRoomDocumentRealtimeEnvWithRuntimeOptions(t, 0, 0, 0,
		roomDocumentRuntimeTestOptions{wikiCandidateGenerator: generator})
	suffix := strings.ReplaceAll(time.Now().UTC().Format("150405.000000000"), ".", "")
	seedUnifiedWikiPublicAdmission(t, env, alice, suffix, true)
	path := "/v0/tenants/" + acmeTenant + "/personal-wiki/refresh"

	status, _, body := env.request(newClient(t), http.MethodPost, path, nil, "")
	if status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated refresh status=%d body=%s", status, body)
	}

	status, _, body = env.request(alice, http.MethodPost, path, nil, "")
	var accepted manualWikiRefreshResponse
	decode(t, body, &accepted)
	if status != http.StatusAccepted || accepted.Outcome != "accepted" {
		t.Fatalf("manual refresh status=%d outcome=%q body=%s", status, accepted.Outcome, body)
	}
	select {
	case <-generator.started:
	case <-time.After(5 * time.Second):
		t.Fatal("candidate generator did not receive the manual refresh")
	}
	refreshing := readPersonalWikiHTTPStatus(t, env, alice)
	if refreshing.State != "refreshing" || refreshing.LatestRefreshId == nil {
		t.Fatalf("Wiki during the manual refresh=%+v", refreshing)
	}

	status, _, body = env.request(alice, http.MethodPost, path, nil, "")
	var progress manualWikiRefreshResponse
	decode(t, body, &progress)
	if status != http.StatusAccepted || progress.Outcome != "in_progress" {
		t.Fatalf("refresh while generating status=%d outcome=%q body=%s", status, progress.Outcome, body)
	}

	close(generator.release)
	released = true
	waitForUnifiedWikiRefreshSettlement(t, env, *refreshing.LatestRefreshId)

	status, _, body = env.request(alice, http.MethodPost, path, nil, "")
	var latest manualWikiRefreshResponse
	decode(t, body, &latest)
	if status != http.StatusOK || latest.Outcome != "already_latest" {
		t.Fatalf("refresh after publication status=%d outcome=%q body=%s", status, latest.Outcome, body)
	}
}
