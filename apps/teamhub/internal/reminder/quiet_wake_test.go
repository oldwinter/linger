package reminder

import (
	"errors"
	"testing"
)

func TestEventWakeRequiresAnAuthority(t *testing.T) {
	err := EnqueueTx(t.Context(), nil, Wake{Source: SourceEvent, TenantID: "tenant", RoomID: "room", Body: "event"})
	if !errors.Is(err, ErrGrantRevoked) {
		t.Fatalf("unscoped event wake enqueued: %v", err)
	}
}

func TestEventWakeHasExactlyOneAuthority(t *testing.T) {
	wake := Wake{Source: SourceEvent, TenantID: "tenant", RoomID: "room", Body: "event", ComputerID: "computer-1", Grant: &GrantReference{ID: "grant", Revision: 1}}
	if err := EnqueueTx(t.Context(), nil, wake); err == nil || errors.Is(err, ErrGrantRevoked) {
		t.Fatalf("a wake with a grant and a Computer was not refused: %v", err)
	}
}
