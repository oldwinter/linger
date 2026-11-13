package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/herdr"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

type recordedHerdrPanes struct {
	status string
	err    error
	calls  []string
}

func (p *recordedHerdrPanes) Answer(_ context.Context, paneID string, seq uint64, text string) (string, error) {
	p.calls = append(p.calls, paneID+"|"+text)
	if seq != 7 {
		return herdr.AnswerPaneNotBlocked, nil
	}
	return p.status, p.err
}

func TestHerdrToolAnswersOnlyThroughTheHerdrBridge(t *testing.T) {
	answer := json.RawMessage(`{"pane_id":"w1:p1","state_change_seq":7,"text":"A"}`)
	if result, err := (&Daemon{}).callHerdr(t.Context(), "answer", answer); err != nil || result["status"] != herdr.AnswerUnavailable {
		t.Fatalf("without herdr: %v %v", result, err)
	}
	panes := &recordedHerdrPanes{status: herdr.AnswerSent}
	daemon := &Daemon{herdrPanes: panes}
	for _, test := range []struct {
		name, arguments, want string
	}{
		{"answer", `{"pane_id":"w1:p1","state_change_seq":7,"text":"A"}`, "ok"},
		{"answer", `{"pane_id":"w1:p1","state_change_seq":6,"text":"A"}`, herdr.AnswerPaneNotBlocked},
		{"answer", `{"pane_id":"","state_change_seq":7,"text":"A"}`, herdr.AnswerInvalid},
		{"prompt", `{"pane_id":"w1:p1","state_change_seq":7,"text":"A"}`, herdr.AnswerInvalid},
	} {
		result, err := daemon.callHerdr(t.Context(), test.name, json.RawMessage(test.arguments))
		if err != nil || result["status"] != test.want {
			t.Fatalf("%s %s: %v %v", test.name, test.arguments, result, err)
		}
	}
	if len(panes.calls) != 2 {
		t.Fatalf("calls=%v", panes.calls)
	}
	// A failed send may have typed the answer; it is never reported as sent.
	panes.err = errors.New("connection reset")
	if _, err := daemon.callHerdr(t.Context(), "answer", answer); err == nil {
		t.Fatal("an unconfirmed answer was reported")
	}
}

func TestHerdrEventGoesOutOnlyOnTheLiveConnection(t *testing.T) {
	daemon := &Daemon{computerID: "computer-1", now: func() time.Time { return time.Date(2026, 11, 13, 1, 0, 0, 0, time.UTC) }}
	event := herdr.Event{Kind: herdr.EventBlocked, PaneID: "w1:p1", StateChangeSeq: 3, Agent: "codex", Tail: "A or B?"}
	if err := daemon.PublishHerdrEvent(t.Context(), event); err == nil {
		t.Fatal("an event was reported without a connection")
	}
	stream := &browserEventStream{}
	daemon.diagnosticsStream = stream
	if err := daemon.PublishHerdrEvent(t.Context(), event); err != nil {
		t.Fatal(err)
	}
	var frame wire.RunnerHerdrEvent
	if len(stream.events) != 1 || stream.events[0].Type != protocol.EventHerdrAgent || json.Unmarshal(stream.events[0].Payload, &frame) != nil {
		t.Fatalf("events=%+v", stream.events)
	}
	if frame.Type != wire.TypeRunnerHerdrEvent || frame.RunnerID != "computer-1" || frame.SentAt != "2026-11-13T01:00:00Z" ||
		frame.Event.Kind != "agent_blocked" || frame.Event.PaneID != "w1:p1" || frame.Event.StateChangeSeq != 3 || frame.Event.Tail != "A or B?" {
		t.Fatalf("frame=%+v", frame)
	}
}
