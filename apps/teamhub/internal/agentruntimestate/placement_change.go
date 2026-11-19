package agentruntimestate

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

var (
	unreachableComputerTerminal = json.RawMessage(`{"type":"failed","error":"local_computer_unavailable","failure":{"code":"computer_unavailable"}}`)
	modelSourceSwitchTerminal   = json.RawMessage(`{"type":"canceled","reason":"model_source_switched"}`)
)

// TerminatedLocalRun is a running Run a placement change ended. RoomID names
// the Room of its Meta Context, where Agent Service can stop the live
// process; it is empty for any other Context.
type TerminatedLocalRun struct {
	RunID, AgentManagementID, RoomID string
}

// TerminateLocalWorkForUnreachableComputer ends the running Runs of an Agent
// that is moving away from a Computer that is not online: they can never
// finish there, like the Runs of an interrupted process. Queued Runs belong to
// no Computer and run on the new one after the move. A steer that waited for
// an ended Run becomes a queued Run when it is a Message and is settled as
// uncertain otherwise. It reports whether a Run ended, because that cannot be
// undone by a later rollback of the move. The caller holds the Agent
// registration lock and owns the transaction: Context locks follow the
// registration lock, and each Run's status Room follows its Context.
func TerminateLocalWorkForUnreachableComputer(ctx context.Context, queries *store.Queries, tenantID, agentActorID string) (bool, error) {
	ended, err := terminateRunningLocalWork(ctx, queries, tenantID, agentActorID, unreachableComputerTerminal)
	return len(ended) > 0, err
}

// TerminateLocalWorkForModelSourceSwitch cancels the running Runs of an Agent
// whose Computer switches to another model source because its owner chose to
// end them: they run on the old one. Queued Runs and steers fare as in
// TerminateLocalWorkForUnreachableComputer, and the caller holds the same
// locks.
func TerminateLocalWorkForModelSourceSwitch(ctx context.Context, queries *store.Queries, tenantID, agentActorID string) ([]TerminatedLocalRun, error) {
	return terminateRunningLocalWork(ctx, queries, tenantID, agentActorID, modelSourceSwitchTerminal)
}

func terminateRunningLocalWork(ctx context.Context, queries *store.Queries, tenantID, agentActorID string, terminal json.RawMessage) ([]TerminatedLocalRun, error) {
	if queries == nil || strings.TrimSpace(tenantID) == "" || strings.TrimSpace(agentActorID) == "" {
		return nil, ErrInvalid
	}
	contextKeys, err := queries.LockOpenAgentExecutionContextsForAgentRevocation(ctx, store.LockOpenAgentExecutionContextsForAgentRevocationParams{
		TenantID: tenantID, AgentActorID: agentActorID, RoomIds: []string{},
	})
	if err != nil {
		return nil, err
	}
	var ended []TerminatedLocalRun
	for _, contextKey := range contextKeys {
		running, err := queries.GetRunningAgentLocalRun(ctx, contextKey)
		if isNoRows(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		terminated, err := TerminateLocalRuns(ctx, queries, []string{running.RunID}, terminal)
		if err != nil {
			return nil, err
		}
		if len(terminated) > 0 {
			owner, err := queries.GetAgentExecutionContext(ctx, contextKey)
			if err != nil {
				return nil, err
			}
			for _, run := range terminated {
				if err := expireRuntimeHumanInteractions(ctx, queries, run.RunID, tenantID, agentActorID); err != nil {
					return nil, err
				}
				stopped := TerminatedLocalRun{RunID: run.RunID, AgentManagementID: owner.AgentManagementID}
				if owner.ContextKind == "meta" && owner.RoomID.Valid {
					stopped.RoomID = owner.RoomID.String
				}
				ended = append(ended, stopped)
			}
		}
		if err := settleSteersOfInterruptedRuns(ctx, queries, contextKey); err != nil {
			return nil, err
		}
	}
	return ended, nil
}
