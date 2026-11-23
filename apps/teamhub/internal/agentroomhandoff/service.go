// Package agentroomhandoff hands a Human's request from the direct chat with
// their AnotherMe to that AnotherMe's Context in another Room. An Agent writes
// only in its Context Room, so the direct chat never posts in the other Room:
// it leaves a hidden handoff there that wakes the AnotherMe's own Context,
// which then decides what to say to that Room.
package agentroomhandoff

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentauth"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/idempotency"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/messagecreation"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

const (
	toolName             = "hand_off_to_room"
	idempotencyOperation = "hand_off_to_room"
	// MaxInstructionRunes bounds the instruction the receiving Context reads.
	MaxInstructionRunes = 8000
)

var (
	// ErrInvalid reports a malformed request.
	ErrInvalid = errors.New("Room handoff input is invalid")
	// ErrNotFromDirectChat reports a caller that is not an AnotherMe Meta in
	// its direct chat with its Human.
	ErrNotFromDirectChat = fmt.Errorf("%w: only an AnotherMe hands off from its direct chat", agentauth.ErrForbidden)
	// ErrNotRequestedByHuman reports a Run that nothing the Human did in the
	// direct chat started, such as a proactive wake, Routine or Task report.
	ErrNotRequestedByHuman = fmt.Errorf("%w: only a turn the Human started hands off", agentauth.ErrForbidden)
	// ErrRoomUnavailable reports a target Room that is missing, being
	// deleted, the direct chat itself, or lacks the AnotherMe or its Human.
	ErrRoomUnavailable = errors.New("Room handoff target is unavailable")
	// ErrIdempotencyConflict reports an invocation reused with other input.
	ErrIdempotencyConflict = errors.New("Room handoff invocation was reused with different input")
	// ErrUnavailable reports a receipt that no longer matches current facts.
	ErrUnavailable = errors.New("Room handoff service is unavailable")

	invocationPattern = regexp.MustCompile(`^agent-invocation-sha256:[a-f0-9]{64}$`)
	roomIDPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
)

// Input is one handoff request.
type Input struct {
	InvocationID string
	RoomID       string
	Instruction  string
}

// Result is the handoff in the target Room.
type Result struct {
	InboxID   string
	HandoffID string
	Replay    bool
}

type receipt struct {
	InboxID   string `json:"inbox_id"`
	HandoffID string `json:"handoff_id"`
}

// Service posts Room handoffs.
type Service struct {
	pool       *pgxpool.Pool
	authorizer *agentauth.Service
	now        func() time.Time
}

// New builds the Service.
func New(pool *pgxpool.Pool, authorizer *agentauth.Service) *Service {
	return &Service{pool: pool, authorizer: authorizer, now: time.Now}
}

// HandOff posts the handoff in input.RoomID, or returns the receipt of the
// same invocation.
func (s *Service) HandOff(ctx context.Context, token string, input Input) (Result, error) {
	instruction := strings.TrimSpace(input.Instruction)
	if !invocationPattern.MatchString(input.InvocationID) || !roomIDPattern.MatchString(input.RoomID) ||
		instruction == "" || utf8.RuneCountInString(instruction) > MaxInstructionRunes {
		return Result{}, ErrInvalid
	}
	if s == nil || s.pool == nil || s.authorizer == nil {
		return Result{}, ErrUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	authorization, err := s.authorizer.AuthorizeInTx(ctx, tx, token, toolName)
	if err != nil {
		return Result{}, err
	}
	queries := store.New(tx)
	human := authorization.UserArtifactOwnerActorID
	directRoomID, err := directChat(ctx, queries, authorization)
	if err != nil {
		return Result{}, err
	}

	requestHash := sha256.Sum256([]byte(input.RoomID + "\x00" + instruction))
	key := idempotency.AgentKey(authorization.AgentActorID, idempotencyOperation,
		agentauth.IdempotencyKey(idempotencyOperation, input.InvocationID))
	if err := idempotency.Lock(ctx, tx, key); err != nil {
		return Result{}, err
	}
	record, found, err := idempotency.Lookup(ctx, tx, key, requestHash[:])
	if errors.Is(err, idempotency.ErrConflict) {
		return Result{}, ErrIdempotencyConflict
	}
	if err != nil {
		return Result{}, err
	}
	if found {
		var stored receipt
		if json.Unmarshal(record.Body, &stored) != nil || record.InvocationID != input.InvocationID ||
			stored.HandoffID != record.ResourceID || stored.InboxID != "room:"+input.RoomID {
			return Result{}, ErrUnavailable
		}
		if err := tx.Commit(ctx); err != nil {
			return Result{}, err
		}
		return Result{InboxID: stored.InboxID, HandoffID: stored.HandoffID, Replay: true}, nil
	}

	if err := requireHumanRequest(ctx, queries, authorization, directRoomID, human); err != nil {
		return Result{}, err
	}
	humanActor, agentActor, err := targetMembers(ctx, queries, authorization, directRoomID, input.RoomID)
	if err != nil {
		return Result{}, err
	}
	handoffID := handoffMessageID(authorization.AgentActorID, input.InvocationID)
	text, err := handoffText(handoffID, directRoomID, input.RoomID, instruction, human, s.now())
	if err != nil {
		return Result{}, err
	}
	// The Human speaks the hidden message so the AnotherMe does not ignore it
	// as its own; the mention wakes only that AnotherMe's Context.
	persisted, err := messagecreation.CardHandoff(ctx, queries, messagecreation.Draft{
		ID: handoffID, TenantID: authorization.TenantID, RoomID: input.RoomID, Author: humanActor,
		HumanWaiting: true,
	}, agentActor, text)
	if err != nil {
		return Result{}, err
	}
	if _, err := messagecreation.Publish(ctx, queries, persisted); err != nil {
		return Result{}, err
	}
	stored := receipt{InboxID: "room:" + input.RoomID, HandoffID: handoffID}
	body, err := json.Marshal(stored)
	if err != nil {
		return Result{}, err
	}
	if err := idempotency.Save(ctx, tx, key, requestHash[:], idempotency.Record{
		ResourceID: handoffID, Status: http.StatusOK, Body: body, InvocationID: input.InvocationID,
	}); err != nil {
		return Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	return Result{InboxID: stored.InboxID, HandoffID: handoffID}, nil
}

// directChat returns the caller's Context Room when it is the AnotherMe's
// live direct chat with its Human.
func directChat(ctx context.Context, queries *store.Queries, authorization agentauth.Authorization) (string, error) {
	human := authorization.UserArtifactOwnerActorID
	if authorization.AgentType != "anotherme" || authorization.ParticipantTaskID != "" ||
		authorization.Target.Kind != "room" || authorization.RoomID == "" || human == "" {
		return "", ErrNotFromDirectChat
	}
	direct, err := queries.GetDirectRoomByPair(ctx, store.GetDirectRoomByPairParams{
		TenantID: authorization.TenantID, HumanActorID: human, AgentActorID: authorization.AgentActorID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFromDirectChat
	}
	if err != nil {
		return "", err
	}
	if direct.ID != authorization.RoomID || direct.DeletionStartedAt.Valid {
		return "", ErrNotFromDirectChat
	}
	return direct.ID, nil
}

// requireHumanRequest admits only the Run the request names when it carries
// a message the Human wrote, or a card they decided, in the direct chat. A
// proactive wake, Routine or Task callback runs there too, often on content
// from outside (mail, events, documents), and must not reach other Rooms.
func requireHumanRequest(
	ctx context.Context,
	queries *store.Queries,
	authorization agentauth.Authorization,
	directRoomID, human string,
) error {
	runID := messagecreation.RunClaim(ctx)
	if runID == "" {
		return ErrNotRequestedByHuman
	}
	started, err := queries.IsRunStartedByDirectChatHuman(ctx, store.IsRunStartedByDirectChatHumanParams{
		RoomID: directRoomID, RunID: runID, TenantID: authorization.TenantID,
		AgentActorID: authorization.AgentActorID, HumanActorID: human,
	})
	if err != nil {
		return err
	}
	if !started {
		return ErrNotRequestedByHuman
	}
	return nil
}

// targetMembers locks the live target Room and returns its Human and
// AnotherMe members, key-share locked until the handoff commits.
func targetMembers(
	ctx context.Context,
	queries *store.Queries,
	authorization agentauth.Authorization,
	directRoomID, roomID string,
) (store.Actor, store.Actor, error) {
	if roomID == directRoomID {
		return store.Actor{}, store.Actor{}, ErrRoomUnavailable
	}
	if thread, err := queries.GetThreadRoomByRoomID(ctx, roomID); err == nil && thread.RoomID == roomID {
		return store.Actor{}, store.Actor{}, ErrRoomUnavailable
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return store.Actor{}, store.Actor{}, err
	}
	active, err := queries.LockActiveRoomForMutation(ctx, roomID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && active != roomID {
		return store.Actor{}, store.Actor{}, ErrRoomUnavailable
	}
	if err != nil {
		return store.Actor{}, store.Actor{}, err
	}
	member := func(actorID, kind string) (store.Actor, error) {
		actor, err := queries.GetRoomActorMember(ctx, store.GetRoomActorMemberParams{RoomID: roomID, ActorID: actorID})
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Actor{}, ErrRoomUnavailable
		}
		if err != nil {
			return store.Actor{}, err
		}
		if actor.TenantID != authorization.TenantID || actor.Kind != kind {
			return store.Actor{}, ErrRoomUnavailable
		}
		return actor, nil
	}
	humanActor, err := member(authorization.UserArtifactOwnerActorID, "human")
	if err != nil {
		return store.Actor{}, store.Actor{}, err
	}
	agentActor, err := member(authorization.AgentActorID, "agent")
	if err != nil {
		return store.Actor{}, store.Actor{}, err
	}
	return humanActor, agentActor, nil
}

// handoffMessageID derives the hidden message from the invocation, so one
// invocation posts at most one handoff.
func handoffMessageID(agentActorID, invocationID string) string {
	digest := sha256.Sum256([]byte("room-handoff:" + agentActorID + ":" + invocationID))
	return "message_" + hex.EncodeToString(digest[:16])
}

func handoffText(handoffID, directRoomID, roomID, instruction, humanActorID string, requestedAt time.Time) (string, error) {
	payload, err := json.Marshal(struct {
		Kind          string    `json:"kind"`
		HandoffID     string    `json:"handoff_id"`
		OriginRoomID  string    `json:"origin_room_id"`
		OriginInboxID string    `json:"origin_room_inbox_id"`
		RoomInboxID   string    `json:"room_inbox_id"`
		Instruction   string    `json:"instruction"`
		RequestedBy   string    `json:"requested_by"`
		RequestedAt   time.Time `json:"requested_at"`
	}{
		"room_handoff", handoffID, directRoomID, "room:" + directRoomID, "room:" + roomID,
		instruction, humanActorID, requestedAt.UTC(),
	})
	if err != nil {
		return "", err
	}
	prompt := fmt.Sprintf(`<room-handoff-pattern>
Your Human asked for this in your direct chat, and you there handed it to you here. Carry out the
instruction in this Room: read this Room's history with teamhub message read, then post here and
mention each Agent who should act. Reply only to the Inbox room:%s. Messages of the direct chat are
not copied into this Room. When the work is done or needs your Human's decision, tell them with
teamhub message direct. Never hand this work back.
</room-handoff-pattern>`, roomID)
	return " Room handoff=" + string(payload) + "\n" + prompt, nil
}
