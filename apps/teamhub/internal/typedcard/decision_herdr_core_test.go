package typedcard

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
)

func herdrCoreQuestion(target *HerdrCoreAnswerTarget, questions ...DecisionQuestion) DecisionCommand {
	return DecisionCommand{Question: &QuestionDecision{
		Prompt:    "A coding agent waits",
		Questions: questions,
		HerdrCore: target,
	}}
}

var herdrCoreChoice = DecisionQuestion{
	ID:     "answer",
	Prompt: "Approve migration?",
	Input:  "radio",
	Options: []DecisionQuestionOption{
		{ID: "choice_1", Label: "Approve (y+Enter)"},
		{ID: "choice_2", Label: "Skip"},
	},
}

func TestHerdrCoreAnswerCardDraftValidation(t *testing.T) {
	target := &HerdrCoreAnswerTarget{
		ComputerID: "computer-1",
		Address:    "vps/t7",
		Turn:       4,
		StatusMs:   1732670400000,
		OptionKeys: map[string][]string{"choice_1": {"y", "Enter"}},
	}
	draft, err := herdrCoreQuestion(target, herdrCoreChoice).draft()
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(draft.request)
	if draft.kind != DecisionKindQuestion || !strings.Contains(string(encoded), `"herdr_core"`) ||
		!strings.Contains(string(encoded), `"address":"vps/t7"`) ||
		!strings.Contains(string(encoded), `"option_keys":{"choice_1":["y","Enter"]}`) {
		t.Fatalf("draft=%+v request=%s", draft, encoded)
	}

	checkbox := herdrCoreChoice
	checkbox.Input = "checkbox"
	for name, cmd := range map[string]DecisionCommand{
		"missing address": herdrCoreQuestion(&HerdrCoreAnswerTarget{ComputerID: "computer-1", Turn: 1, StatusMs: 1}, herdrCoreChoice),
		"negative turn":   herdrCoreQuestion(&HerdrCoreAnswerTarget{ComputerID: "computer-1", Address: "t7", Turn: -1, StatusMs: 1}, herdrCoreChoice),
		"negative status": herdrCoreQuestion(&HerdrCoreAnswerTarget{ComputerID: "computer-1", Address: "t7", Turn: 1, StatusMs: -1}, herdrCoreChoice),
		"unknown option":  herdrCoreQuestion(&HerdrCoreAnswerTarget{ComputerID: "computer-1", Address: "t7", Turn: 1, StatusMs: 1, OptionKeys: map[string][]string{"choice_99": {"y"}}}, herdrCoreChoice),
		"empty key slice": herdrCoreQuestion(&HerdrCoreAnswerTarget{ComputerID: "computer-1", Address: "t7", Turn: 1, StatusMs: 1, OptionKeys: map[string][]string{"choice_1": {}}}, herdrCoreChoice),
		"control char":    herdrCoreQuestion(&HerdrCoreAnswerTarget{ComputerID: "computer-1", Address: "t7", Turn: 1, StatusMs: 1, OptionKeys: map[string][]string{"choice_1": {"y\n"}}}, herdrCoreChoice),
		"checkbox":        herdrCoreQuestion(target, checkbox),
		"both targets": {
			Question: &QuestionDecision{
				Prompt:    "p",
				Questions: []DecisionQuestion{herdrCoreChoice},
				Herdr:     &HerdrAnswerTarget{ComputerID: "computer-1", PaneID: "w1:p1", StateChangeSeq: 1},
				HerdrCore: target,
			},
		},
	} {
		if _, err := cmd.draft(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: expected ErrInvalid, got %v", name, err)
		}
	}
}

func TestHerdrCoreAnswerPayloadSupportsKeysAndText(t *testing.T) {
	target := HerdrCoreAnswerTarget{
		ComputerID: "computer-1",
		Address:    "vps/t7",
		Turn:       4,
		StatusMs:   1000,
		OptionKeys: map[string][]string{"choice_1": {"y", "Enter"}},
	}
	view := questionView{Questions: []DecisionQuestion{herdrCoreChoice}}

	text, keys, ok := herdrCoreAnswerPayload(target, view, decisionAnswer{Answers: map[string]any{"answer": "choice_1"}})
	if !ok || text != "" || !slices.Equal(keys, []string{"y", "Enter"}) {
		t.Fatalf("choice_1 => text=%q keys=%v ok=%v", text, keys, ok)
	}

	text, keys, ok = herdrCoreAnswerPayload(target, view, decisionAnswer{Answers: map[string]any{"answer": "choice_2"}})
	if !ok || text != "Skip" || len(keys) != 0 {
		t.Fatalf("choice_2 => text=%q keys=%v ok=%v", text, keys, ok)
	}

	text, keys, ok = herdrCoreAnswerPayload(target, view, decisionAnswer{Answers: map[string]any{"answer": "Run dry-run first"}})
	if !ok || text != "Run dry-run first" || len(keys) != 0 {
		t.Fatalf("free text => text=%q keys=%v ok=%v", text, keys, ok)
	}

	for _, bad := range []any{"line1\nline2", "\x1b[A", "   "} {
		if _, _, ok := herdrCoreAnswerPayload(target, view, decisionAnswer{Answers: map[string]any{"answer": bad}}); ok {
			t.Fatalf("expected %q to be rejected", bad)
		}
	}
}

func TestHerdrCoreNoticeTextWaitsForRecordedDelivery(t *testing.T) {
	target := HerdrCoreAnswerTarget{ComputerID: "computer-1", Address: "vps/t7", Turn: 4, StatusMs: 1732670400000}
	request, _ := json.Marshal(decisionRuntimeRequest{HerdrCore: &target})
	view, _ := json.Marshal(questionView{Prompt: "A coding agent waits", Questions: []DecisionQuestion{herdrCoreChoice}})
	answer, _ := json.Marshal(decisionAnswer{Decision: "submit", Answers: map[string]any{"answer": "choice_1"}})
	record := decisionRecord{Kind: DecisionKindQuestion, Status: "answered", Request: request, View: view, Answer: answer}

	sending, err := encodeHerdrCoreResult(herdrCoreAnswerSending, "keys")
	if err != nil {
		t.Fatal(err)
	}
	for _, res := range [][]byte{nil, sending} {
		record.Result = res
		if notice, err := decisionNoticeText("decision-1", record); err != nil || notice != "" {
			t.Fatalf("notice before final result=%q err=%v", notice, err)
		}
	}

	sent, err := encodeHerdrCoreResult(HerdrCoreAnswerSent, "keys")
	if err != nil {
		t.Fatal(err)
	}
	record.Result = sent
	notice, err := decisionNoticeText("decision-1", record)
	if err != nil || !strings.Contains(notice, "Approve migration? → Approve (y+Enter)") ||
		!strings.Contains(notice, "herdr-core terminal vps/t7 (turn 4, status_ms 1732670400000): sent") {
		t.Fatalf("notice=%q err=%v", notice, err)
	}
}
