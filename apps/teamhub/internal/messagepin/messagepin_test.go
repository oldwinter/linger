package messagepin

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

type fakeQueries struct {
	messageAuthority    store.GetHumanMessagePinAuthorityRow
	messageAuthorityErr error
	roomAuthority       store.GetRoomMessagePinAuthorityRow
	roomAuthorityErr    error
	pinned              []store.PinMessageParams
	pinRows             int64
	pinErr              error
	unpinned            []store.UnpinMessageParams
	unpinRows           int64
	unpinErr            error
	list                []store.ListMessagePinsForRoomRow
	listErr             error
	listParams          []string
}

func (f *fakeQueries) GetHumanMessagePinAuthority(context.Context, store.GetHumanMessagePinAuthorityParams) (store.GetHumanMessagePinAuthorityRow, error) {
	return f.messageAuthority, f.messageAuthorityErr
}

func (f *fakeQueries) GetRoomMessagePinAuthority(context.Context, store.GetRoomMessagePinAuthorityParams) (store.GetRoomMessagePinAuthorityRow, error) {
	return f.roomAuthority, f.roomAuthorityErr
}

func (f *fakeQueries) PinMessage(_ context.Context, params store.PinMessageParams) (int64, error) {
	f.pinned = append(f.pinned, params)
	return f.pinRows, f.pinErr
}

func (f *fakeQueries) UnpinMessage(_ context.Context, params store.UnpinMessageParams) (int64, error) {
	f.unpinned = append(f.unpinned, params)
	return f.unpinRows, f.unpinErr
}

func (f *fakeQueries) ListMessagePinsForRoom(_ context.Context, roomID string) ([]store.ListMessagePinsForRoomRow, error) {
	f.listParams = append(f.listParams, roomID)
	return f.list, f.listErr
}

func TestPinUsesTheAuthorizedIdentityAndToleratesRepeats(t *testing.T) {
	queries := &fakeQueries{messageAuthority: store.GetHumanMessagePinAuthorityRow{
		MessageID: "message-1", TenantID: "tenant-1", RoomID: "room-1", ActorID: "human-1",
	}}
	for range 2 {
		if err := Pin(context.Background(), queries, "account-1", "room-1", "message-1"); err != nil {
			t.Fatalf("Pin() error = %v", err)
		}
	}
	want := store.PinMessageParams{TenantID: "tenant-1", RoomID: "room-1", MessageID: "message-1", PinnedByActorID: "human-1"}
	if len(queries.pinned) != 2 || queries.pinned[0] != want || queries.pinned[1] != want {
		t.Fatalf("PinMessage calls = %+v, want two of %+v", queries.pinned, want)
	}
}

func TestPinHidesAMessageTheCallerCannotSee(t *testing.T) {
	queries := &fakeQueries{messageAuthorityErr: pgx.ErrNoRows}
	err := Pin(context.Background(), queries, "account-1", "room-1", "message-1")
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("Pin() error = %v, want pgx.ErrNoRows", err)
	}
	if len(queries.pinned) != 0 {
		t.Fatalf("PinMessage calls = %+v, want none", queries.pinned)
	}
}

func TestUnpinUsesTheAuthorizedIdentityAndToleratesRepeats(t *testing.T) {
	queries := &fakeQueries{messageAuthority: store.GetHumanMessagePinAuthorityRow{
		MessageID: "message-1", TenantID: "tenant-1", RoomID: "room-1", ActorID: "human-1",
	}}
	for range 2 {
		if err := Unpin(context.Background(), queries, "account-1", "room-1", "message-1"); err != nil {
			t.Fatalf("Unpin() error = %v", err)
		}
	}
	want := store.UnpinMessageParams{RoomID: "room-1", MessageID: "message-1"}
	if len(queries.unpinned) != 2 || queries.unpinned[0] != want || queries.unpinned[1] != want {
		t.Fatalf("UnpinMessage calls = %+v, want two of %+v", queries.unpinned, want)
	}
}

func TestUnpinHidesAMessageTheCallerCannotSee(t *testing.T) {
	queries := &fakeQueries{messageAuthorityErr: pgx.ErrNoRows}
	err := Unpin(context.Background(), queries, "account-1", "room-1", "message-1")
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("Unpin() error = %v, want pgx.ErrNoRows", err)
	}
	if len(queries.unpinned) != 0 {
		t.Fatalf("UnpinMessage calls = %+v, want none", queries.unpinned)
	}
}

func TestListChecksRoomMembershipAndReturnsTheRoomPinProjection(t *testing.T) {
	rows := []store.ListMessagePinsForRoomRow{{PinnedByActorID: "human-2"}}
	queries := &fakeQueries{
		roomAuthority: store.GetRoomMessagePinAuthorityRow{RoomID: "room-1", TenantID: "tenant-1", ActorID: "human-1"},
		list:          rows,
	}
	got, err := List(context.Background(), queries, "account-1", "room-1")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(got) != 1 || got[0].PinnedByActorID != "human-2" {
		t.Fatalf("List() = %+v, want %+v", got, rows)
	}
	want := "room-1"
	if len(queries.listParams) != 1 || queries.listParams[0] != want {
		t.Fatalf("ListMessagePinsForRoom calls = %+v, want %q", queries.listParams, want)
	}
}

func TestListHidesARoomTheCallerCannotSee(t *testing.T) {
	queries := &fakeQueries{roomAuthorityErr: pgx.ErrNoRows}
	_, err := List(context.Background(), queries, "account-1", "room-1")
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("List() error = %v, want pgx.ErrNoRows", err)
	}
	if len(queries.listParams) != 0 {
		t.Fatalf("ListMessagePinsForRoom calls = %+v, want none", queries.listParams)
	}
}
