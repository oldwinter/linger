package document

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// WikiRefreshState is the one projection of a Wiki's refresh progress, shared
// by the Human's Wiki status and Memory's wait for a current publication.
type WikiRefreshState struct {
	// State is refreshing while a refresh runs or its follow-up is queued,
	// failed when the latest refresh failed or conflicted, otherwise idle.
	State string
	// FailureReason names an actionable Computer or Runtime cause when State is
	// failed, otherwise empty.
	FailureReason string
	// LatestRefreshID names the latest refresh, so a client that saw an
	// earlier failure can tell a new one apart.
	LatestRefreshID string
	PreviewRevision int64
}

// LoadWikiRefreshState reads the refresh state of a Human's Wiki; a Human with
// no Wiki root yet is idle.
func LoadWikiRefreshState(ctx context.Context, tx pgx.Tx, tenantID, ownerActorID string) (WikiRefreshState, error) {
	var state WikiRefreshState
	var lastErrorCode string
	err := tx.QueryRow(ctx, `SELECT coalesce(refresh.id,''), coalesce(refresh.preview_revision,0),
		CASE
		  WHEN refresh.status='staging' THEN 'refreshing'
		  WHEN refresh.id IS NOT NULL AND `+wikiRefreshFollowupPendingSQL+` THEN 'refreshing'
		  WHEN refresh.status IN ('failed','conflicted') THEN 'failed'
		  ELSE 'idle'
		END,
		CASE
		  WHEN refresh.status='failed' THEN coalesce(refresh.dispatch_last_error_code,'')
		  ELSE ''
		END
		FROM (SELECT $1::text AS tenant_id,$2::text AS actor_id) owner
		LEFT JOIN personal_wikis wiki ON wiki.tenant_id=owner.tenant_id
		 AND wiki.owner_actor_id=owner.actor_id AND wiki.deleted_at IS NULL
		LEFT JOIN LATERAL (
			SELECT id,status,preview_revision,dispatch_last_error_code FROM document_wiki_refreshes
			WHERE wiki_id=wiki.id AND tenant_id=wiki.tenant_id
			ORDER BY created_at DESC,id DESC LIMIT 1
		) refresh ON true`, tenantID, ownerActorID).Scan(
		&state.LatestRefreshID, &state.PreviewRevision, &state.State, &lastErrorCode,
	)
	if err != nil {
		return WikiRefreshState{}, err
	}
	if state.State == "failed" {
		state.FailureReason = personalWikiFailureReason(lastErrorCode)
	}
	return state, nil
}

// personalWikiFailureReason maps stored dispatch error codes to the actionable
// reasons exposed on the Personal Wiki status response.
func personalWikiFailureReason(code string) string {
	switch code {
	case "computer_offline", "runtime_incompatible", "runtime_auth_required", "runtime_unavailable":
		return code
	default:
		return ""
	}
}
