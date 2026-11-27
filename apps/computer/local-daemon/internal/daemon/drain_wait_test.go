package daemon

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/transport"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/provider"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/provider/native"
)

type drainTestControlPlane struct {
	stream transport.Stream
}

func (p drainTestControlPlane) Connect(context.Context, transport.Hello) (transport.Stream, error) {
	return p.stream, nil
}

type ackingDrainStream struct {
	mu     sync.Mutex
	events []protocol.Event
	start  protocol.Command
	recvCh chan protocol.Command
}

func (s *ackingDrainStream) Send(_ context.Context, event protocol.Event) error {
	s.mu.Lock()
	s.events = append(s.events, event)
	s.mu.Unlock()
	if event.Type == protocol.EventOperationCancelled && event.Sequence > 0 {
		ack := s.start
		ack.Type = protocol.CommandOperationAck
		ack.ThroughSequence = event.Sequence
		s.recvCh <- ack
	}
	return nil
}

func (s *ackingDrainStream) Receive(ctx context.Context) (protocol.Command, error) {
	select {
	case command := <-s.recvCh:
		return command, nil
	case <-ctx.Done():
		return protocol.Command{}, ctx.Err()
	}
}

func (s *ackingDrainStream) Close() error { return nil }

func (s *ackingDrainStream) snapshotEvents() []protocol.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]protocol.Event(nil), s.events...)
}

type cancellableDrainBackend struct {
	started chan struct{}
}

func (b cancellableDrainBackend) Start(ctx context.Context, _ string, _ native.RunSpec) (*native.Run, error) {
	messages := make(chan native.Event)
	results := make(chan native.Outcome, 1)
	close(b.started)
	go func() {
		<-ctx.Done()
		close(messages)
		results <- native.Outcome{Status: "cancelled"}
		close(results)
	}()
	return &native.Run{Events: messages, Outcome: results}, nil
}

func TestDrainAndWaitDeliversStructuredStopReasonAndWaitsForAck(t *testing.T) {
	device, err := transport.GenerateIdentity()
	if err != nil {
		t.Fatal(err)
	}
	start := daemonOperationStart("operation-stop-tasks", "agent-1")
	stream := &ackingDrainStream{
		start:  start,
		recvCh: make(chan protocol.Command, 8),
	}
	stream.recvCh <- protocol.Command{Type: protocol.CommandRunnerWelcome, ConnectionEpoch: 1}
	stream.recvCh <- start
	started := make(chan struct{})

	d, err := newTestDaemon(t, Options{
		ComputerID:        "computer-1",
		ControlPlane:      drainTestControlPlane{stream: stream},
		IdentityStore:     fakeStore{value: device},
		OperationResolver: fakeOperationResolver{},
		Executor: provider.Executor{NewBackend: func(string, native.Profile) (native.Runtime, error) {
			return cancellableDrainBackend{started: started}, nil
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	runCtx, cancelRun := context.WithCancel(t.Context())
	defer cancelRun()
	runDone := make(chan error, 1)
	go func() {
		runDone <- d.runConnection(runCtx, device)
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("Operation did not start its Provider")
	}
	awaitOperationStarted(t, d)

	drainCtx, cancelDrain := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancelDrain()
	d.DrainAndWait(drainCtx, DesktopQuitStopTasksReason)

	if unacked := d.ledger.Unacknowledged(); unacked != 0 {
		t.Fatalf("unacknowledged events after DrainAndWait = %d, want 0", unacked)
	}
	cancelRun()
	<-runDone

	var cancelled *protocol.Event
	for _, event := range stream.snapshotEvents() {
		if event.OperationID == start.OperationID && event.Type == protocol.EventOperationCancelled {
			copyEvent := event
			cancelled = &copyEvent
		}
	}
	if cancelled == nil {
		t.Fatalf("expected operation.cancelled event, got %+v", stream.snapshotEvents())
	}
	var payload struct {
		Reason string `json:"reason"`
	}
	if err := json.Unmarshal(cancelled.Payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Reason != DesktopQuitStopTasksReason {
		t.Fatalf("cancelled reason = %q, want %q", payload.Reason, DesktopQuitStopTasksReason)
	}
}
