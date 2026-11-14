package collaboration

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/messagepin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

// PutMessagePin adds one conversation Message to the Room's Pinned list. It
// reports pgx.ErrNoRows when the Account cannot see the Room or Message.
func (s *Service) PutMessagePin(ctx context.Context, accountID, roomID, messageID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return internal("begin Message Pin transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := messagepin.Pin(ctx, s.queries.WithTx(tx), accountID, roomID, messageID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		return internal("pin Message", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return internal("commit Message Pin", err)
	}
	return nil
}

// DeleteMessagePin removes one Message from the Room's Pinned list. It reports
// pgx.ErrNoRows when the Account cannot see the Room or Message.
func (s *Service) DeleteMessagePin(ctx context.Context, accountID, roomID, messageID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return internal("begin Message Pin transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := messagepin.Unpin(ctx, s.queries.WithTx(tx), accountID, roomID, messageID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		return internal("unpin Message", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return internal("commit Message Pin", err)
	}
	return nil
}

// ListMessagePins reads the Room's Pinned Messages newest pin first. It reports
// pgx.ErrNoRows when the Account cannot see the Room.
func (s *Service) ListMessagePins(ctx context.Context, accountID, roomID string) (httpapi.MessagePinList, error) {
	rows, err := messagepin.List(ctx, s.queries, accountID, roomID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return httpapi.MessagePinList{}, err
		}
		return httpapi.MessagePinList{}, internal("list Message Pins", err)
	}
	items := make([]httpapi.MessagePin, 0, len(rows))
	for _, row := range rows {
		author := store.Actor{
			ID: row.AuthorActorID, TenantID: row.TenantID, Kind: row.AuthorKind,
			DisplayName: row.AuthorDisplayName, AccountID: row.AuthorAccountID,
			Handle: row.AuthorHandle, CreatedAt: row.AuthorCreatedAt,
		}
		message, err := messageModel(row.ID, row.TenantID, row.RoomID, row.Body, row.Segments, row.MessageKind, row.CardContextMessageID, row.ReplyToMessageID, row.CardTitle, row.CardKind, row.CreatedAt, author)
		if err == nil {
			err = ApplyMessageNotice(&message, row.Notice)
		}
		if err != nil {
			return httpapi.MessagePinList{}, internal("decode pinned Message content", err)
		}
		items = append(items, httpapi.MessagePin{
			Message: message, PinnedByActorId: row.PinnedByActorID, PinnedAt: row.PinnedAt.Time,
		})
	}
	return httpapi.MessagePinList{Items: items}, nil
}
