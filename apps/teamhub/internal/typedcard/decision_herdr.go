package typedcard

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// A herdr answer card is a question card bound to one state of one herdr
// agent pane on its Human's Local Computer. TeamHub, not the asking Agent,
// types the Human's own answer into that pane, at most once per card: the
// Agent supplies the question and choices, never the text that is sent.

// HerdrAnswerTarget is the pane state a herdr answer card answers.
type HerdrAnswerTarget struct {
	ComputerID     string `json:"computer_id"`
	PaneID         string `json:"pane_id"`
	StateChangeSeq int64  `json:"state_change_seq"`
}

// herdrAnswerQuestionID names the one question of a herdr answer card.
const herdrAnswerQuestionID = "answer"

// maxHerdrAnswerRunes bounds an answer typed into a pane.
const maxHerdrAnswerRunes = 4000

// Delivery statuses of a herdr answer. Only HerdrAnswerSent reached the pane;
// HerdrAnswerOutcomeUnknown may have.
const (
	HerdrAnswerSent           = "sent"
	HerdrAnswerPaneClosed     = "pane_closed"
	HerdrAnswerPaneNotBlocked = "pane_not_blocked"
	HerdrAnswerOutcomeUnknown = "outcome_unknown"
	HerdrAnswerNotDelivered   = "not_delivered"
	HerdrAnswerInvalid        = "invalid_answer"
	herdrAnswerSending        = "sending"
)

// HerdrDelivery is one answer TeamHub types into a pane: the card's Human
// owns the Computer, and AgentManagementID is the Agent placed there that
// asked.
type HerdrDelivery struct {
	TenantID, OwnerActorID, AgentManagementID string
	Target                                    HerdrAnswerTarget
	Text                                      string
}

// HerdrDeliverer sends one answer and reports its delivery status. It is
// never retried by TeamHub.
type HerdrDeliverer func(ctx context.Context, delivery HerdrDelivery) string

// SetHerdrDeliverer installs how answers reach the Computer; without one an
// answered card is recorded as not delivered.
func (s *Service) SetHerdrDeliverer(deliver HerdrDeliverer) {
	s.herdrDeliverer = deliver
}

func (target *HerdrAnswerTarget) valid() bool {
	return target.ComputerID != "" && strings.TrimSpace(target.PaneID) != "" && utf8.RuneCountInString(target.PaneID) <= 128 &&
		target.StateChangeSeq >= 0
}

// herdrAnswerQuestions is the one radio question of a herdr answer card: the
// Human picks one of the agent's choices or writes their own answer.
func herdrAnswerQuestions(questions []DecisionQuestion) bool {
	return len(questions) == 1 && questions[0].ID == herdrAnswerQuestionID && questions[0].Input == "radio"
}

// herdrAnswerText is the text a Human's answer types: the label of the
// option they picked, or what they wrote. ok is false for an answer that
// would act as more than one line of input.
func herdrAnswerText(view questionView, answer decisionAnswer) (string, bool) {
	value, _ := answer.Answers[herdrAnswerQuestionID].(string)
	if len(view.Questions) == 1 {
		for _, option := range view.Questions[0].Options {
			if option.ID == value {
				value = option.Label
			}
		}
	}
	if strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > maxHerdrAnswerRunes || strings.ContainsFunc(value, unicode.IsControl) {
		return "", false
	}
	return value, true
}

// herdrResult is what a herdr answer card records about its delivery.
type herdrResult struct {
	Herdr string `json:"herdr"`
}

func herdrResultOf(raw []byte) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	var stored struct {
		Data herdrResult `json:"data"`
	}
	if err := json.Unmarshal(raw, &stored); err != nil {
		return "", err
	}
	return stored.Data.Herdr, nil
}

func encodeHerdrResult(status string) ([]byte, error) {
	return json.Marshal(map[string]any{"outcome": herdrOutcome(status), "data": herdrResult{Herdr: status}})
}

// herdrOutcome is how a delivery status reads on the card and to the Agent.
func herdrOutcome(status string) string {
	switch status {
	case HerdrAnswerSent:
		return "Your answer was typed into the coding agent's pane."
	case HerdrAnswerPaneClosed:
		return "Not delivered: the pane or its coding agent is gone."
	case HerdrAnswerPaneNotBlocked:
		return "Not delivered: the coding agent already moved on from this question."
	case HerdrAnswerOutcomeUnknown:
		return "The Computer did not confirm delivery; the answer may have reached the pane. It is not sent again."
	case HerdrAnswerInvalid:
		return "Not delivered: an answer typed into a terminal must be one line."
	case herdrAnswerSending:
		return "Sending the answer to the coding agent."
	default:
		return "Not delivered: the Computer or herdr is not available."
	}
}

// deliverHerdrAnswer types an answered herdr answer card's answer into its
// pane and hands the result to the Agent, once. The delivery is marked
// sending, and committed, before anything reaches the Computer; a run that
// finds it still sending stopped midway and records an unknown outcome
// instead of sending again. handled is false for any other decision.
func (s *Service) deliverHerdrAnswer(ctx context.Context, decisionID string) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	queries := store.New(tx)
	decision, err := queries.LockHerdrAnswerDecision(ctx, decisionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var request decisionRuntimeRequest
	if decision.Kind != DecisionKindQuestion || json.Unmarshal(decision.Request, &request) != nil || request.Herdr == nil {
		return false, nil
	}
	recorded, err := herdrResultOf(decision.Result)
	if err != nil {
		return true, err
	}
	if decision.Status != "answered" || recorded != "" && recorded != herdrAnswerSending {
		return true, tx.Commit(ctx)
	}
	status := ""
	if recorded == herdrAnswerSending {
		status = HerdrAnswerOutcomeUnknown
	}
	var view questionView
	var answer decisionAnswer
	if err := json.Unmarshal(decision.View, &view); err != nil {
		return true, err
	}
	if err := json.Unmarshal(decision.Answer, &answer); err != nil {
		return true, err
	}
	text, ok := herdrAnswerText(view, answer)
	switch {
	case status != "":
	case !ok:
		status = HerdrAnswerInvalid
	case s.herdrDeliverer == nil || decision.AgentManagementID == "":
		status = HerdrAnswerNotDelivered
	default:
		computer, err := queries.GetAgentRuntimeLocalComputer(ctx, request.Herdr.ComputerID)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && (computer.RemovedAt.Valid ||
			computer.OwnerTenantID != decision.TenantID || computer.OwnerActorID != decision.DeciderActorID) {
			status = HerdrAnswerNotDelivered
		} else if err != nil {
			return true, err
		}
	}
	if status != "" {
		return true, s.finishHerdrAnswer(ctx, tx, decisionID, status)
	}
	sending, err := encodeHerdrResult(herdrAnswerSending)
	if err != nil {
		return true, err
	}
	if err := queries.RecordDecisionResult(ctx, store.RecordDecisionResultParams{ID: decisionID, Result: sending}); err != nil {
		return true, err
	}
	if err := tx.Commit(ctx); err != nil {
		return true, err
	}
	status = s.herdrDeliverer(ctx, HerdrDelivery{
		TenantID: decision.TenantID, OwnerActorID: decision.DeciderActorID, AgentManagementID: decision.AgentManagementID,
		Target: *request.Herdr, Text: text,
	})
	tx, err = s.pool.Begin(ctx)
	if err != nil {
		return true, err
	}
	defer tx.Rollback(ctx)
	decision, err = store.New(tx).LockHerdrAnswerDecision(ctx, decisionID)
	if err != nil {
		return true, err
	}
	if recorded, err := herdrResultOf(decision.Result); err != nil || recorded != herdrAnswerSending {
		return true, err
	}
	return true, s.finishHerdrAnswer(ctx, tx, decisionID, status)
}

// finishHerdrAnswer records the delivery and tells the Agent in the same
// transaction, so the Agent hears it exactly once.
func (s *Service) finishHerdrAnswer(ctx context.Context, tx pgx.Tx, decisionID, status string) error {
	result, err := encodeHerdrResult(status)
	if err != nil {
		return err
	}
	if err := store.New(tx).RecordDecisionResult(ctx, store.RecordDecisionResultParams{ID: decisionID, Result: result}); err != nil {
		return err
	}
	if _, err := handOffDecisionInTx(ctx, tx, decisionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// herdrNoticeText tells the Agent where the Human's answer went.
func herdrNoticeText(target HerdrAnswerTarget, result []byte) (string, error) {
	status, err := herdrResultOf(result)
	if err != nil || status == "" || status == herdrAnswerSending {
		return "", err
	}
	return "\nDelivery to herdr pane " + target.PaneID + " (state " + strconv.FormatInt(target.StateChangeSeq, 10) + "): " + status +
		". " + herdrOutcome(status) + " Tell the Human whether it arrived; never send an answer to the pane yourself.", nil
}
