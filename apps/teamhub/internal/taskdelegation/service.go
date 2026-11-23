// Package taskdelegation lets a Room's Meta delegate Tasks to its own
// AlterEgo without Human approval.
package taskdelegation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentauth"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/messagecreation"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/tenantmembership"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/typedcard"
)

const (
	createTaskTool = "create_task"
	// MaxRunningTasks bounds concurrent AlterEgos competing for one Computer.
	MaxRunningTasks = 10
)

var (
	ErrInvalid             = errors.New("Task delegation input is invalid")
	ErrForbidden           = errors.New("Task delegation is forbidden for this Context")
	ErrLimitReached        = errors.New("the Agent already has the maximum number of running Tasks")
	ErrIdempotencyConflict = errors.New("Task delegation invocation was reused with different input")
	ErrUnavailable         = errors.New("Task delegation service is unavailable")

	invocationPattern = regexp.MustCompile(`^agent-invocation-sha256:[a-f0-9]{64}$`)
)

type CreateInput struct {
	InvocationID string
	Name         string
	Requirement  string
}

type CreateResult struct {
	TaskID string
	Replay bool
}

type persistedCreate struct {
	TaskID string `json:"task_id"`
}

type Service struct {
	pool     *pgxpool.Pool
	contexts *agentauth.Service
}

func New(pool *pgxpool.Pool, contexts *agentauth.Service) *Service {
	return &Service{pool: pool, contexts: contexts}
}

// Create starts a Task for the caller's own AlterEgo. The origin Room is the
// caller's Room Context; a Task Context cannot delegate.
func (s *Service) Create(
	ctx context.Context,
	token string,
	input CreateInput,
) (CreateResult, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Requirement = strings.TrimSpace(input.Requirement)
	if !invocationPattern.MatchString(input.InvocationID) || input.Name == "" || input.Requirement == "" ||
		utf8.RuneCountInString(input.Name) > 120 || utf8.RuneCountInString(input.Requirement) > 20000 {
		return CreateResult{}, ErrInvalid
	}
	if s == nil || s.pool == nil || s.contexts == nil {
		return CreateResult{}, ErrUnavailable
	}
	requestHash, err := hashRequest(input)
	if err != nil {
		return CreateResult{}, err
	}
	preflight, err := s.contexts.Authorize(ctx, token, createTaskTool)
	if err != nil {
		return CreateResult{}, err
	}
	if preflight.Target.Kind != "room" || preflight.RoomID == "" || preflight.ParticipantTaskID != "" {
		return CreateResult{}, ErrForbidden
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CreateResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := store.New(tx)
	// Take per-Agent advisory locks before any row lock or room-mutation fence:
	// Work Room creation takes tenantmembership.LockAgent, and both Room and Agent
	// deletion acquire it before agent_registrations and room-mutation locks.
	if err := tenantmembership.LockAgent(ctx, queries, preflight.AgentActorID); err != nil {
		return CreateResult{}, err
	}
	// Count and insert under one per-Agent lock so concurrent creates respect the cap.
	if err := queries.AcquireAdvisoryTransactionLock(ctx, "task-delegation|"+preflight.AgentActorID); err != nil {
		return CreateResult{}, err
	}
	authorization, err := s.contexts.AuthorizeInTx(ctx, tx, token, createTaskTool)
	if err != nil {
		return CreateResult{}, err
	}
	if authorization.Target.Kind != "room" || authorization.RoomID == "" || authorization.ParticipantTaskID != "" ||
		authorization.AgentActorID != preflight.AgentActorID {
		return CreateResult{}, ErrForbidden
	}
	receipt, replay, err := agentauth.LookupReceipt(ctx, tx, authorization.Principal, createTaskTool, input.InvocationID, requestHash)
	if errors.Is(err, agentauth.ErrReceiptConflict) {
		return CreateResult{}, ErrIdempotencyConflict
	}
	if err != nil {
		return CreateResult{}, err
	}
	if replay {
		var stored persistedCreate
		if err := json.Unmarshal(receipt.Body, &stored); err != nil || stored.TaskID == "" {
			return CreateResult{}, ErrUnavailable
		}
		if err := tx.Commit(ctx); err != nil {
			return CreateResult{}, err
		}
		return CreateResult{TaskID: stored.TaskID, Replay: true}, nil
	}
	taskID, err := StartInTx(ctx, tx, authorization, input.Name, input.Requirement,
		"task_delegation:"+operationKey(authorization, input.InvocationID))
	if err != nil {
		return CreateResult{}, err
	}
	body, err := json.Marshal(persistedCreate{TaskID: taskID})
	if err != nil {
		return CreateResult{}, err
	}
	if err := agentauth.SaveReceipt(ctx, tx, authorization.Principal, createTaskTool, input.InvocationID, requestHash,
		agentauth.Receipt{ResourceID: taskID, Body: body}); err != nil {
		return CreateResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return CreateResult{}, err
	}
	return CreateResult{TaskID: taskID}, nil
}

// StartInTx starts a Task for the authorized caller's own AlterEgo in the
// caller's transaction, from its Room Context, within the running-Task cap.
// sourceKey keeps the Task's origin unique; the caller owns idempotency.
func StartInTx(ctx context.Context, tx pgx.Tx, authorization agentauth.Authorization, name, requirement, sourceKey string) (string, error) {
	name, requirement = strings.TrimSpace(name), strings.TrimSpace(requirement)
	if name == "" || requirement == "" || utf8.RuneCountInString(name) > 120 || utf8.RuneCountInString(requirement) > 20000 {
		return "", ErrInvalid
	}
	if authorization.Target.Kind != "room" || authorization.RoomID == "" || authorization.ParticipantTaskID != "" {
		return "", ErrForbidden
	}
	queries := store.New(tx)
	// Count and insert under one per-Agent lock before locking the room so
	// concurrent creates follow canonical lock order and respect the cap.
	if err := queries.AcquireAdvisoryTransactionLock(ctx, "task-delegation|"+authorization.AgentActorID); err != nil {
		return "", err
	}
	if _, err := queries.LockActiveRoomForMutation(ctx, authorization.RoomID); errors.Is(err, pgx.ErrNoRows) {
		return "", ErrForbidden
	} else if err != nil {
		return "", err
	}
	running, err := queries.CountRunningDelegatedTasksForAgent(ctx, store.CountRunningDelegatedTasksForAgentParams{
		TenantID: authorization.TenantID, AgentActorID: authorization.AgentActorID,
	})
	if err != nil {
		return "", err
	}
	if running >= MaxRunningTasks {
		return "", ErrLimitReached
	}
	agent, err := queries.GetActor(ctx, store.GetActorParams{ID: authorization.AgentActorID, TenantID: authorization.TenantID})
	if err != nil {
		return "", err
	}
	sponsor, err := queries.GetActor(ctx, store.GetActorParams{ID: authorization.SponsorActorID, TenantID: authorization.TenantID})
	if errors.Is(err, pgx.ErrNoRows) || err == nil && (sponsor.Kind != "human" || !sponsor.AccountID.Valid) {
		return "", ErrForbidden
	}
	if err != nil {
		return "", err
	}
	quiet, err := startedByProactiveWake(ctx, queries, authorization)
	if err != nil {
		return "", err
	}
	created, err := typedcard.CreateDelegatedTaskInTx(ctx, tx, queries, typedcard.DelegatedTaskInput{
		TenantID: authorization.TenantID, OriginRoomID: authorization.RoomID,
		Agent: agent, AgentManagementID: authorization.AgentID, Sponsor: sponsor,
		Name: name, Requirement: requirement,
		SourceKey: sourceKey,
		Quiet:     quiet,
	})
	if errors.Is(err, typedcard.ErrInvalid) {
		return "", ErrInvalid
	}
	if err != nil {
		return "", err
	}
	return created.TaskID, nil
}

// startedByProactiveWake tells whether the Run creating the Task was started by
// a proactive wake (a review, plan, event or a Routine serving a Tracking Item)
// rather than by the Human, from the Run its request names. A plain Routine the
// Human set up is the Human's own request, so its Tasks stay ordinary.
func startedByProactiveWake(ctx context.Context, queries *store.Queries, authorization agentauth.Authorization) (bool, error) {
	run, err := messagecreation.ResolveRunClaim(ctx, queries, authorization.TenantID, authorization.AgentActorID, authorization.RoomID)
	if err != nil || !run.Valid {
		return false, err
	}
	source, err := queries.GetRunProactiveWakeSource(ctx, store.GetRunProactiveWakeSourceParams{RunID: run.String, RoomID: authorization.RoomID})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil && source != reminder.SourceScheduled, err
}

func hashRequest(input CreateInput) ([]byte, error) {
	encoded, err := json.Marshal([]string{input.Name, input.Requirement})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	return digest[:], nil
}

func operationKey(authorization agentauth.Authorization, invocationID string) string {
	key, _ := json.Marshal([]string{authorization.TenantID, authorization.AgentActorID, invocationID})
	digest := sha256.Sum256(key)
	return hex.EncodeToString(digest[:])
}
