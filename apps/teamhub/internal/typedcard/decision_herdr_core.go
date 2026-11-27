package typedcard

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// A herdr-core answer card is a question card bound to one terminal state
// (address, turn, status_ms) on its Human's Local Computer. When the Human
// answers, TeamHub delivers either the chosen option's configured key sequence
// or the chosen/typed single-line text into that terminal, at most once.

// HerdrCoreAnswerTarget names the herdr-core terminal state a question card
// answers, together with optional key sequences mapped by question option ID.
type HerdrCoreAnswerTarget struct {
	ComputerID string              `json:"computer_id"`
	Address    string              `json:"address"`
	Turn       int64               `json:"turn"`
	StatusMs   int64               `json:"status_ms"`
	OptionKeys map[string][]string `json:"option_keys,omitempty"`
}

// Delivery statuses of a herdr-core answer. Only HerdrCoreAnswerSent reached
// the terminal; HerdrCoreAnswerOutcomeUnknown may have.
const (
	HerdrCoreAnswerSent           = "sent"
	HerdrCoreAnswerTerminalClosed = "terminal_closed"
	HerdrCoreAnswerNotBlocked     = "terminal_not_blocked"
	HerdrCoreAnswerOutcomeUnknown = "outcome_unknown"
	HerdrCoreAnswerNotDelivered   = "not_delivered"
	HerdrCoreAnswerInvalid        = "invalid_answer"
	herdrCoreAnswerSending        = "sending"
)

const (
	maxHerdrCoreAddressRunes = 256
	maxHerdrCoreOptionKeys   = 16
	maxHerdrCoreKeyRunes     = 64
)

// HerdrCoreDelivery is one owner answer TeamHub delivers to a herdr-core
// terminal. Exactly one of Text or Keys is populated.
type HerdrCoreDelivery struct {
	TenantID          string
	OwnerActorID      string
	AgentManagementID string
	Target            HerdrCoreAnswerTarget
	Text              string
	Keys              []string
}

// HerdrCoreDeliverer delivers one owner answer to a herdr-core terminal and
// reports its delivery status. TeamHub never retries a delivery attempt.
type HerdrCoreDeliverer func(ctx context.Context, delivery HerdrCoreDelivery) string

// SetHerdrCoreDeliverer installs how herdr-core question card answers reach the
// Computer; without one an answered card is recorded as not delivered.
func (s *Service) SetHerdrCoreDeliverer(deliver HerdrCoreDeliverer) {
	s.herdrCoreDeliverer = deliver
}

func (target *HerdrCoreAnswerTarget) valid(questions []DecisionQuestion) bool {
	if target.ComputerID == "" || strings.TrimSpace(target.Address) == "" ||
		utf8.RuneCountInString(target.Address) > maxHerdrCoreAddressRunes ||
		target.Turn < 0 || target.StatusMs < 0 {
		return false
	}
	if len(target.OptionKeys) == 0 {
		return true
	}
	if len(questions) != 1 {
		return false
	}
	validOptions := make(map[string]struct{}, len(questions[0].Options))
	for _, opt := range questions[0].Options {
		validOptions[opt.ID] = struct{}{}
	}
	for optionID, keys := range target.OptionKeys {
		if _, ok := validOptions[optionID]; !ok {
			return false
		}
		if len(keys) == 0 || len(keys) > maxHerdrCoreOptionKeys {
			return false
		}
		for _, key := range keys {
			if strings.TrimSpace(key) == "" || utf8.RuneCountInString(key) > maxHerdrCoreKeyRunes ||
				strings.ContainsFunc(key, unicode.IsControl) {
				return false
			}
		}
	}
	return true
}

// herdrCoreAnswerPayload resolves the Human's choice into either a key sequence
// (when the chosen option declared OptionKeys) or validated single-line text.
func herdrCoreAnswerPayload(target HerdrCoreAnswerTarget, view questionView, answer decisionAnswer) (string, []string, bool) {
	rawValue, _ := answer.Answers[herdrAnswerQuestionID].(string)
	if len(view.Questions) == 1 {
		for _, option := range view.Questions[0].Options {
			if option.ID == rawValue {
				if keys := target.OptionKeys[option.ID]; len(keys) > 0 {
					return "", slices.Clone(keys), true
				}
				rawValue = option.Label
				break
			}
		}
	}
	if strings.TrimSpace(rawValue) == "" || utf8.RuneCountInString(rawValue) > maxHerdrAnswerRunes ||
		strings.ContainsFunc(rawValue, unicode.IsControl) {
		return "", nil, false
	}
	return rawValue, nil, true
}

type herdrCoreResult struct {
	HerdrCore string `json:"herdr_core"`
	Mode      string `json:"mode,omitempty"`
}

func herdrCoreResultOf(raw []byte) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	var stored struct {
		Data herdrCoreResult `json:"data"`
	}
	if err := json.Unmarshal(raw, &stored); err != nil {
		return "", err
	}
	return stored.Data.HerdrCore, nil
}

func encodeHerdrCoreResult(status, mode string) ([]byte, error) {
	return json.Marshal(map[string]any{
		"outcome": herdrCoreOutcome(status),
		"data":    herdrCoreResult{HerdrCore: status, Mode: mode},
	})
}

func herdrCoreOutcome(status string) string {
	switch status {
	case HerdrCoreAnswerSent:
		return "Your answer was delivered to the herdr-core terminal."
	case HerdrCoreAnswerTerminalClosed:
		return "Not delivered: the terminal or its coding agent is gone."
	case HerdrCoreAnswerNotBlocked:
		return "Not delivered: the coding agent already moved on from this question."
	case HerdrCoreAnswerOutcomeUnknown:
		return "The Computer did not confirm delivery; the answer may have reached the terminal. It is not sent again."
	case HerdrCoreAnswerInvalid:
		return "Not delivered: an answer sent to a terminal must be valid keys or a single line of text."
	case herdrCoreAnswerSending:
		return "Delivering the answer to the herdr-core terminal."
	default:
		return "Not delivered: the Computer or herdr-core is not available."
	}
}

// deliverHerdrCoreAnswer delivers an answered herdr-core question card to its
// terminal and notifies the asking Agent once. Sending is committed before
// contacting the Computer so a crash mid-delivery ends as outcome_unknown
// instead of replaying input into the terminal.
func (s *Service) deliverHerdrCoreAnswer(ctx context.Context, decisionID string) (bool, error) {
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
	if decision.Kind != DecisionKindQuestion || json.Unmarshal(decision.Request, &request) != nil || request.HerdrCore == nil {
		return false, nil
	}
	recorded, err := herdrCoreResultOf(decision.Result)
	if err != nil {
		return true, err
	}
	if decision.Status != "answered" || recorded != "" && recorded != herdrCoreAnswerSending {
		return true, tx.Commit(ctx)
	}
	status := ""
	if recorded == herdrCoreAnswerSending {
		status = HerdrCoreAnswerOutcomeUnknown
	}
	var view questionView
	var answer decisionAnswer
	if err := json.Unmarshal(decision.View, &view); err != nil {
		return true, err
	}
	if err := json.Unmarshal(decision.Answer, &answer); err != nil {
		return true, err
	}
	text, keys, ok := herdrCoreAnswerPayload(*request.HerdrCore, view, answer)
	mode := "text"
	if len(keys) > 0 {
		mode = "keys"
	}
	switch {
	case status != "":
	case !ok:
		status = HerdrCoreAnswerInvalid
	case s.herdrCoreDeliverer == nil || decision.AgentManagementID == "":
		status = HerdrCoreAnswerNotDelivered
	default:
		computer, err := queries.GetAgentRuntimeLocalComputer(ctx, request.HerdrCore.ComputerID)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && (computer.RemovedAt.Valid ||
			computer.OwnerTenantID != decision.TenantID || computer.OwnerActorID != decision.DeciderActorID) {
			status = HerdrCoreAnswerNotDelivered
		} else if err != nil {
			return true, err
		}
	}
	if status != "" {
		return true, s.finishHerdrCoreAnswer(ctx, tx, decisionID, status, mode)
	}
	sending, err := encodeHerdrCoreResult(herdrCoreAnswerSending, mode)
	if err != nil {
		return true, err
	}
	if err := queries.RecordDecisionResult(ctx, store.RecordDecisionResultParams{ID: decisionID, Result: sending}); err != nil {
		return true, err
	}
	if err := tx.Commit(ctx); err != nil {
		return true, err
	}
	status = s.herdrCoreDeliverer(ctx, HerdrCoreDelivery{
		TenantID:          decision.TenantID,
		OwnerActorID:      decision.DeciderActorID,
		AgentManagementID: decision.AgentManagementID,
		Target:            *request.HerdrCore,
		Text:              text,
		Keys:              keys,
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
	if recorded, err := herdrCoreResultOf(decision.Result); err != nil || recorded != herdrCoreAnswerSending {
		return true, err
	}
	return true, s.finishHerdrCoreAnswer(ctx, tx, decisionID, status, mode)
}

func (s *Service) finishHerdrCoreAnswer(ctx context.Context, tx pgx.Tx, decisionID, status, mode string) error {
	result, err := encodeHerdrCoreResult(status, mode)
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

func herdrCoreNoticeText(target HerdrCoreAnswerTarget, result []byte) (string, error) {
	status, err := herdrCoreResultOf(result)
	if err != nil || status == "" || status == herdrCoreAnswerSending {
		return "", err
	}
	return "\nDelivery to herdr-core terminal " + target.Address + " (turn " + strconv.FormatInt(target.Turn, 10) +
		", status_ms " + strconv.FormatInt(target.StatusMs, 10) + "): " + status + ". " + herdrCoreOutcome(status) +
		" Tell the Human whether it arrived; never send an answer to the terminal yourself.", nil
}
