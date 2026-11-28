package taskexecution

import (
	"context"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// RuntimePresentationMaxLimit is the upper bound on history items returned by
// one Task runtime presentation page.
const RuntimePresentationMaxLimit = 200

// RuntimePresentationRunPage is one paginated snapshot of active and historical
// Runtime presentation Runs for a Task's work Room.
type RuntimePresentationRunPage struct {
	WorkRoomID   *string
	ActiveItems  []agentruntimestate.RoomRunStatusFields
	HistoryItems []agentruntimestate.RoomRunStatusFields
	NextCursor   *string
}

type presentationCursorPosition struct {
	createdAt pgtype.Timestamptz
	runID     string
}

// ListRuntimePresentationRunsForHuman reads active and paginated historical
// Runtime presentation Runs for a Task's work Room when accountID may read it.
func (s *Service) ListRuntimePresentationRunsForHuman(
	ctx context.Context,
	accountID string,
	taskID string,
	cursor *string,
	limit int,
) (RuntimePresentationRunPage, error) {
	before, valid := parsePresentationCursor(taskID, cursor)
	if !valid || limit < 1 || limit > RuntimePresentationMaxLimit {
		return RuntimePresentationRunPage{}, ErrInvalid
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return RuntimePresentationRunPage{}, err
	}
	defer tx.Rollback(ctx)
	queries := store.New(tx)
	item, err := queries.GetWorkItemForHuman(ctx, store.GetWorkItemForHumanParams{ID: taskID, AccountID: accountID})
	if errors.Is(err, pgx.ErrNoRows) {
		return RuntimePresentationRunPage{}, ErrNotFound
	}
	if err != nil {
		return RuntimePresentationRunPage{}, err
	}
	if item.Kind != "task" {
		return RuntimePresentationRunPage{}, ErrNotFound
	}
	_, err = queries.GetWorkItemRoomLink(ctx, store.GetWorkItemRoomLinkParams{WorkItemID: taskID, LinkType: "work"})
	if errors.Is(err, pgx.ErrNoRows) {
		return RuntimePresentationRunPage{
			ActiveItems:  []agentruntimestate.RoomRunStatusFields{},
			HistoryItems: []agentruntimestate.RoomRunStatusFields{},
		}, nil
	}
	if err != nil {
		return RuntimePresentationRunPage{}, err
	}
	roomID, err := queries.GetTaskRuntimePresentationRoomForAccount(ctx, store.GetTaskRuntimePresentationRoomForAccountParams{
		TaskID:    taskID,
		AccountID: accountID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return RuntimePresentationRunPage{}, ErrNotFound
	}
	if err != nil {
		return RuntimePresentationRunPage{}, err
	}
	query := store.ListTaskRuntimePresentationRunsParams{
		TaskID:     taskID,
		TenantID:   item.TenantID,
		RoomID:     roomID,
		ActiveOnly: true,
	}
	active, err := queries.ListTaskRuntimePresentationRuns(ctx, query)
	if err != nil {
		return RuntimePresentationRunPage{}, err
	}
	query.ActiveOnly = false
	query.BeforeCreatedAt, query.BeforeRunID = before.createdAt, before.runID
	query.ResultLimit = pgtype.Int4{Int32: int32(limit + 1), Valid: true}
	history, err := queries.ListTaskRuntimePresentationRuns(ctx, query)
	if err != nil {
		return RuntimePresentationRunPage{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RuntimePresentationRunPage{}, err
	}
	page := RuntimePresentationRunPage{
		WorkRoomID:  &roomID,
		ActiveItems: presentationRunFields(active),
	}
	if len(history) > limit {
		history = history[:limit]
		last := history[len(history)-1]
		next := base64.RawURLEncoding.EncodeToString([]byte(taskID + "\n" + strconv.FormatInt(last.CreatedAt.Time.UnixMicro(), 10) + "\n" + last.RunID))
		page.NextCursor = &next
	}
	page.HistoryItems = presentationRunFields(history)
	return page, nil
}

// parsePresentationCursor decodes the creation time and Run ID of the last
// history item a page returned.
func parsePresentationCursor(taskID string, cursor *string) (presentationCursorPosition, bool) {
	if cursor == nil {
		return presentationCursorPosition{}, true
	}
	decoded, err := base64.RawURLEncoding.DecodeString(*cursor)
	if err != nil {
		return presentationCursorPosition{}, false
	}
	parts := strings.Split(string(decoded), "\n")
	if len(parts) != 3 || parts[0] != taskID || parts[2] == "" {
		return presentationCursorPosition{}, false
	}
	micros, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || micros <= 0 {
		return presentationCursorPosition{}, false
	}
	return presentationCursorPosition{
		createdAt: pgtype.Timestamptz{Time: time.UnixMicro(micros).UTC(), Valid: true},
		runID:     parts[2],
	}, true
}

func presentationRunFields(rows []store.ListTaskRuntimePresentationRunsRow) []agentruntimestate.RoomRunStatusFields {
	items := make([]agentruntimestate.RoomRunStatusFields, 0, len(rows))
	for _, row := range rows {
		items = append(items, agentruntimestate.RoomRunStatusFields{
			RunID:            row.RunID,
			RoomID:           row.RoomID,
			RunStatus:        row.Status,
			Replied:          row.Replied,
			AgentActorID:     row.AgentActorID,
			AgentKind:        row.AgentKind,
			AgentDisplayName: row.AgentDisplayName,
			EventOrdinal:     row.EventOrdinal,
			StopReason:       row.StopReason,
			CreatedAt:        row.CreatedAt,
			UpdatedAt:        row.UpdatedAt,
		})
	}
	return items
}
