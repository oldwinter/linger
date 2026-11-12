package typedcard

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func herdrQuestion(target *HerdrAnswerTarget, questions ...DecisionQuestion) DecisionCommand {
	return DecisionCommand{Question: &QuestionDecision{Prompt: "A coding agent waits", Questions: questions, Herdr: target}}
}

var herdrChoice = DecisionQuestion{ID: "answer", Prompt: "Use A or B?", Input: "radio", Options: []DecisionQuestionOption{{ID: "choice_1", Label: "A"}, {ID: "choice_2", Label: "B"}}}

func TestHerdrAnswerCardIsOneRadioQuestionBoundToOnePaneState(t *testing.T) {
	target := &HerdrAnswerTarget{ComputerID: "computer-1", PaneID: "w1:p1", StateChangeSeq: 5}
	draft, err := herdrQuestion(target, herdrChoice).draft()
	if err != nil {
		t.Fatal(err)
	}
	request, _ := json.Marshal(draft.request)
	if draft.kind != DecisionKindQuestion || string(request) != `{"herdr":{"computer_id":"computer-1","pane_id":"w1:p1","state_change_seq":5}}` {
		t.Fatalf("draft=%+v request=%s", draft, request)
	}
	second := herdrChoice
	second.ID = "more"
	checkbox := herdrChoice
	checkbox.Input = "checkbox"
	for name, command := range map[string]DecisionCommand{
		"two questions":   herdrQuestion(target, herdrChoice, second),
		"checkbox":        herdrQuestion(target, checkbox),
		"no pane":         herdrQuestion(&HerdrAnswerTarget{ComputerID: "computer-1", StateChangeSeq: 5}, herdrChoice),
		"no computer":     herdrQuestion(&HerdrAnswerTarget{PaneID: "w1:p1", StateChangeSeq: 5}, herdrChoice),
		"negative state":  herdrQuestion(&HerdrAnswerTarget{ComputerID: "computer-1", PaneID: "w1:p1", StateChangeSeq: -1}, herdrChoice),
		"AlterEgo's Task": {AlterEgoTaskID: "task-1", Question: herdrQuestion(target, herdrChoice).Question},
		"native question": {Question: &QuestionDecision{Prompt: "p", Questions: []DecisionQuestion{herdrChoice}, Herdr: target, Runtime: json.RawMessage(`{"run":"r"}`)}},
	} {
		if _, err := command.draft(); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err=%v", name, err)
		}
	}
}

// The pane gets exactly what the Human picked or wrote, as one line.
func TestHerdrAnswerTextIsTheHumansOwnAnswer(t *testing.T) {
	view := questionView{Questions: []DecisionQuestion{herdrChoice}}
	for answer, want := range map[string]string{"choice_2": "B", "Use C instead": "Use C instead"} {
		if text, ok := herdrAnswerText(view, decisionAnswer{Answers: map[string]any{"answer": answer}}); !ok || text != want {
			t.Fatalf("%q: text=%q ok=%v", answer, text, ok)
		}
	}
	for _, answer := range []any{"yes\nrm -rf ~", "\x1b[A", " ", strings.Repeat("a", maxHerdrAnswerRunes+1), []string{"choice_1"}} {
		if text, ok := herdrAnswerText(view, decisionAnswer{Answers: map[string]any{"answer": answer}}); ok {
			t.Fatalf("%q was accepted as %q", answer, text)
		}
	}
}

func TestAgentHearsAHerdrAnswerOnlyWithItsRecordedDelivery(t *testing.T) {
	target := HerdrAnswerTarget{ComputerID: "computer-1", PaneID: "w1:p1", StateChangeSeq: 5}
	request, _ := json.Marshal(decisionRuntimeRequest{Herdr: &target})
	view, _ := json.Marshal(questionView{Prompt: "A coding agent waits", Questions: []DecisionQuestion{herdrChoice}})
	answer, _ := json.Marshal(decisionAnswer{Decision: "submit", Answers: map[string]any{"answer": "choice_1"}})
	record := decisionRecord{Kind: DecisionKindQuestion, Status: "answered", Request: request, View: view, Answer: answer}
	for _, result := range [][]byte{nil, mustHerdrResult(t, herdrAnswerSending)} {
		record.Result = result
		if text, err := decisionNoticeText("decision-1", record); err != nil || text != "" {
			t.Fatalf("told before delivery was recorded: %q %v", text, err)
		}
	}
	record.Result = mustHerdrResult(t, HerdrAnswerPaneNotBlocked)
	text, err := decisionNoticeText("decision-1", record)
	if err != nil || !strings.Contains(text, "Use A or B? → A") || !strings.Contains(text, "herdr pane w1:p1 (state 5): pane_not_blocked") ||
		!strings.Contains(text, "never send an answer to the pane yourself") {
		t.Fatalf("notice=%q err=%v", text, err)
	}
}

func mustHerdrResult(t *testing.T, status string) []byte {
	t.Helper()
	encoded, err := encodeHerdrResult(status)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
