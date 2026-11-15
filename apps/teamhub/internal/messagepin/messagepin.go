// Package messagepin owns the Room-wide Pinned list of conversation Messages.
// A Pin is not a Message reaction or a per-member bookmark: any Room member may
// pin or unpin, and every mutation is idempotent so a retry never duplicates a
// Pin or fails an unpin that already happened.
package messagepin

import (
	"context"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// Queries is the slice of the sqlc store the package drives.
type Queries interface {
	GetHumanMessagePinAuthority(ctx context.Context, params store.GetHumanMessagePinAuthorityParams) (store.GetHumanMessagePinAuthorityRow, error)
	GetRoomMessagePinAuthority(ctx context.Context, params store.GetRoomMessagePinAuthorityParams) (store.GetRoomMessagePinAuthorityRow, error)
	PinMessage(ctx context.Context, params store.PinMessageParams) (int64, error)
	UnpinMessage(ctx context.Context, params store.UnpinMessageParams) (int64, error)
	ListMessagePinsForRoom(ctx context.Context, roomID string) ([]store.ListMessagePinsForRoomRow, error)
}

var _ Queries = (*store.Queries)(nil)

// Pin adds one Message to the Room's Pinned list. The authority read reports
// pgx.ErrNoRows for a caller who is not a member or cannot see the Message.
// A Message already pinned stays pinned and keeps its original pinner and time.
func Pin(ctx context.Context, queries Queries, accountID, roomID, messageID string) error {
	authority, err := queries.GetHumanMessagePinAuthority(ctx, store.GetHumanMessagePinAuthorityParams{
		AccountID: accountID, MessageID: messageID, RoomID: roomID,
	})
	if err != nil {
		return err
	}
	_, err = queries.PinMessage(ctx, store.PinMessageParams{
		TenantID: authority.TenantID, RoomID: authority.RoomID,
		MessageID: authority.MessageID, PinnedByActorID: authority.ActorID,
	})
	return err
}

// Unpin removes one Message from the Room's Pinned list. The authority read
// reports pgx.ErrNoRows for a caller who is not a member or cannot see the
// Message. A Message that is not pinned stays absent without an error.
func Unpin(ctx context.Context, queries Queries, accountID, roomID, messageID string) error {
	authority, err := queries.GetHumanMessagePinAuthority(ctx, store.GetHumanMessagePinAuthorityParams{
		AccountID: accountID, MessageID: messageID, RoomID: roomID,
	})
	if err != nil {
		return err
	}
	_, err = queries.UnpinMessage(ctx, store.UnpinMessageParams{
		RoomID: authority.RoomID, MessageID: authority.MessageID,
	})
	return err
}

// List reads the Room's Pinned Messages newest first, capped at 50. The
// authority read reports pgx.ErrNoRows for a caller who is not a member.
func List(ctx context.Context, queries Queries, accountID, roomID string) ([]store.ListMessagePinsForRoomRow, error) {
	authority, err := queries.GetRoomMessagePinAuthority(ctx, store.GetRoomMessagePinAuthorityParams{
		AccountID: accountID, RoomID: roomID,
	})
	if err != nil {
		return nil, err
	}
	return queries.ListMessagePinsForRoom(ctx, authority.RoomID)
}
