package reminder

// A Local Computer admits the events it observes on its owner's machine, such
// as a herdr agent pane, the way a connection grant admits app data.

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// ErrComputerRemoved reports that the Local Computer behind queued data is
// removed or no longer the Human's.
var ErrComputerRemoved = errors.New("local computer no longer belongs to the human")

// CheckComputer returns ErrComputerRemoved unless computerID is an enrolled
// Local Computer the Human still owns.
func CheckComputer(ctx context.Context, queries *store.Queries, tenantID, ownerActorID, computerID string) error {
	computer, err := queries.GetAgentRuntimeLocalComputer(ctx, computerID)
	if errors.Is(err, pgx.ErrNoRows) ||
		err == nil && (computer.RemovedAt.Valid || computer.OwnerTenantID != tenantID || computer.OwnerActorID != ownerActorID) {
		return ErrComputerRemoved
	}
	return err
}

// WakeAuthorized reports whether a queued wake's authority still admits it: the
// Local Computer that observed its event, still owned by the Human who speaks
// the wake, or else the exact connection grant generation, for this tenant and
// AnotherMe. An event wake needs one of the two; other wakes need neither.
func WakeAuthorized(ctx context.Context, queries *store.Queries, source, tenantID, authorID, agentID string, connectionGrant []byte, computerID pgtype.Text) (bool, error) {
	if computerID.Valid {
		err := CheckComputer(ctx, queries, tenantID, authorID, computerID.String)
		if errors.Is(err, ErrComputerRemoved) {
			return false, nil
		}
		return err == nil, err
	}
	var grant *GrantReference
	if err := json.Unmarshal(connectionGrant, &grant); err != nil {
		return false, err
	}
	if source != SourceEvent && grant == nil {
		return true, nil
	}
	err := grant.Check(ctx, queries)
	if errors.Is(err, ErrGrantRevoked) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return grant.TenantID == tenantID && grant.AgentActorID == agentID, nil
}
