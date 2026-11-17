package collaboration

import (
	"context"
	"fmt"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomagent"
)

func TestMessageActivityRecordMatchesNativeTurn(t *testing.T) {
	callIDs := map[string]struct{}{"call-target": {}}
	turnIDs := map[string]struct{}{"turn-target": {}}
	tests := []struct {
		name   string
		record roomagent.RuntimeHistoryRecord
		want   bool
	}{
		{name: "same turn reasoning", record: roomagent.RuntimeHistoryRecord{TurnID: "turn-target", Category: "reasoning"}, want: true},
		{name: "same turn tool", record: roomagent.RuntimeHistoryRecord{TurnID: "turn-target", ToolCallID: "call-target"}, want: true},
		{name: "same call other turn", record: roomagent.RuntimeHistoryRecord{TurnID: "turn-other", ToolCallID: "call-target"}, want: false},
		{name: "other turn", record: roomagent.RuntimeHistoryRecord{TurnID: "turn-other"}, want: false},
		{name: "same call without turn", record: roomagent.RuntimeHistoryRecord{ToolCallID: "call-target"}, want: true},
		{name: "other call without turn", record: roomagent.RuntimeHistoryRecord{ToolCallID: "call-other"}, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := messageActivityRecordMatches(test.record, callIDs, turnIDs); got != test.want {
				t.Fatalf("match=%t want=%t", got, test.want)
			}
		})
	}
}

func TestMessageActivityRecordFallsBackToExactCallWithoutNativeTurn(t *testing.T) {
	callIDs := map[string]struct{}{"call-target": {}}
	if !messageActivityRecordMatches(roomagent.RuntimeHistoryRecord{ToolCallID: "call-target"}, callIDs, nil) {
		t.Fatal("exact tool call did not match")
	}
	if messageActivityRecordMatches(roomagent.RuntimeHistoryRecord{ToolCallID: "call-other"}, callIDs, nil) {
		t.Fatal("unrelated tool call matched")
	}
}

func TestMessageActivityHistoryReadsTheCompleteExactNativeTurn(t *testing.T) {
	inspector := &messageActivityInspectorStub{pages: map[string]roomagent.RuntimeHistory{
		"": {
			Status: "available", ProviderKind: "codex", PreviousCursor: "earlier",
			Records: []roomagent.RuntimeHistoryRecord{
				{Ordinal: 4, TurnID: "turn-target", Category: "reasoning"},
				{Ordinal: 5, TurnID: "turn-target", Category: "message"},
				{Ordinal: 6, TurnID: "turn-neighbor", Category: "message"},
			},
		},
		"earlier": {
			Status: "available", ProviderKind: "codex",
			Records: []roomagent.RuntimeHistoryRecord{
				{Ordinal: 0, Category: "lifecycle"},
				{Ordinal: 1, TurnID: "turn-target", Category: "message"},
				{Ordinal: 2, TurnID: "turn-target", ToolCallID: "call-target", Category: "tool_call"},
				{Ordinal: 3, TurnID: "turn-target", ToolCallID: "call-target", Category: "tool_result"},
			},
		},
	}}
	target := roomagent.RuntimeContextTarget{TenantID: "tenant-1", ContextKey: "context-1"}
	activityIDs := map[string]struct{}{"call-target": {}}

	identity, err := findMessageActivityIdentity(context.Background(), inspector, target, activityIDs, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, found := identity.turnIDs["turn-target"]; !found {
		t.Fatalf("turn IDs=%v", identity.turnIDs)
	}
	records, truncated, err := readMessageActivityRecords(context.Background(), inspector, target, identity)
	if err != nil {
		t.Fatal(err)
	}
	if truncated {
		t.Fatal("ordinary exact turn was truncated")
	}
	ordinals := make([]int, 0, len(records))
	for _, record := range records {
		ordinals = append(ordinals, record.Ordinal)
	}
	want := []int{1, 2, 3, 4, 5}
	if len(ordinals) != len(want) {
		t.Fatalf("ordinals=%v want=%v", ordinals, want)
	}
	for index := range want {
		if ordinals[index] != want[index] {
			t.Fatalf("ordinals=%v want=%v", ordinals, want)
		}
	}
}

func TestMessageActivityHistoryUsesPersistedNativeActivities(t *testing.T) {
	inspector := &messageActivityInspectorStub{pages: map[string]roomagent.RuntimeHistory{
		"": {Status: "available", ProviderKind: "codex", Records: []roomagent.RuntimeHistoryRecord{
			{Ordinal: 1, TurnID: "target-turn", ToolCallID: "call_cli", Category: "tool_call"},
			{Ordinal: 2, TurnID: "target-turn", Category: "reasoning"},
			{Ordinal: 3, TurnID: "other-turn", ToolCallID: "call_other", Category: "tool_call"},
		}},
	}}
	// A native activity ID: "native-" and the SHA-256 of the tool-call ID.
	for _, activityID := range []string{
		"native-" + "fc510e7a61a20c005db8225b6f1412ae2a8c2c0da9761b75e4667b1d692f676e",
		"call_cli", // Host Claude tool-use ID.
		"activity-" + "e3bb0c30dd84b186f252f69cd20cc9c5", // Local Computer, stable across recovery.
	} {
		activities := map[string]struct{}{activityID: {}}
		identity, err := findMessageActivityIdentity(context.Background(), inspector, roomagent.RuntimeContextTarget{}, activities, nil, []string{"operation_local"})
		if err != nil {
			t.Fatal(err)
		}
		records, _, err := readMessageActivityRecords(context.Background(), inspector, roomagent.RuntimeContextTarget{}, identity)
		if err != nil || len(records) != 2 || records[0].TurnID != "target-turn" || records[1].TurnID != "target-turn" {
			t.Fatalf("activity=%s records=%+v err=%v", activityID, records, err)
		}
	}
}

func TestMessageActivityHistoryReadsRecordedTurnWithoutLinkedCall(t *testing.T) {
	// The published activity names a nested call the native history never
	// records, as Codex code mode does; the Run's recorded turn still links.
	inspector := &messageActivityInspectorStub{pages: map[string]roomagent.RuntimeHistory{
		"": {Status: "available", ProviderKind: "codex", Records: []roomagent.RuntimeHistoryRecord{
			{Ordinal: 1, TurnID: "turn-earlier", Category: "message"},
			{Ordinal: 2, TurnID: "turn-run", Category: "lifecycle"},
			{Ordinal: 3, TurnID: "turn-run", ToolCallID: "call_outer", Category: "tool_call"},
			{Ordinal: 4, TurnID: "turn-run", ToolCallID: "call_outer", Category: "tool_result"},
			{Ordinal: 5, TurnID: "turn-run", Category: "message"},
		}},
	}}
	activities := map[string]struct{}{"activity-0123456789abcdef0123456789abcdef": {}}
	runTurns := []string{"turn-run", "turn-unrecorded"}
	identity, err := findMessageActivityIdentity(context.Background(), inspector, roomagent.RuntimeContextTarget{}, activities, runTurns, []string{"operation_local"})
	if err != nil {
		t.Fatal(err)
	}
	if len(identity.turnIDs) != 1 {
		t.Fatalf("turn IDs=%v, want only the turn the native history records", identity.turnIDs)
	}
	records, _, err := readMessageActivityRecords(context.Background(), inspector, roomagent.RuntimeContextTarget{}, identity)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 4 || records[0].Ordinal != 2 || records[3].Ordinal != 5 {
		t.Fatalf("records=%+v", records)
	}
}

func TestMessageActivityHistoryKeepsLinkedCallsAnOlderDaemonLeftWithoutTurn(t *testing.T) {
	// A Daemon that does not carry Codex turns forward stamps only the
	// lifecycle records; its linked calls still belong to the Run.
	inspector := &messageActivityInspectorStub{pages: map[string]roomagent.RuntimeHistory{
		"": {Status: "available", ProviderKind: "codex", Records: []roomagent.RuntimeHistoryRecord{
			{Ordinal: 1, TurnID: "turn-run", Category: "lifecycle"},
			{Ordinal: 2, ToolCallID: "call-target", Category: "tool_call"},
			{Ordinal: 3, ToolCallID: "call-target", Category: "tool_result"},
			{Ordinal: 4, ToolCallID: "call-other", Category: "tool_call"},
			{Ordinal: 5, TurnID: "turn-run", Category: "lifecycle"},
		}},
	}}
	activities := map[string]struct{}{"call-target": {}}
	identity, err := findMessageActivityIdentity(context.Background(), inspector, roomagent.RuntimeContextTarget{}, activities, []string{"turn-run"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	records, _, err := readMessageActivityRecords(context.Background(), inspector, roomagent.RuntimeContextTarget{}, identity)
	if err != nil {
		t.Fatal(err)
	}
	ordinals := make([]int, 0, len(records))
	for _, record := range records {
		ordinals = append(ordinals, record.Ordinal)
	}
	if want := []int{1, 2, 3, 5}; fmt.Sprint(ordinals) != fmt.Sprint(want) {
		t.Fatalf("ordinals=%v want=%v", ordinals, want)
	}
}

type messageActivityInspectorStub struct {
	pages map[string]roomagent.RuntimeHistory
}

func (s *messageActivityInspectorStub) ReadRuntimeHistory(
	_ context.Context,
	_ roomagent.RuntimeContextTarget,
	options roomagent.RuntimeHistoryReadOptions,
) (roomagent.RuntimeHistory, error) {
	cursor := ""
	if options.Cursor != nil {
		cursor = *options.Cursor
	}
	return s.pages[cursor], nil
}
