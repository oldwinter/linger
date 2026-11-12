package proactive

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/ids"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// Rule statuses and sources. Memory's nightly dreaming writes every newly
// learned rule as shadow; only active rules decide what AnotherMe does.
const (
	RuleShadow  = "shadow"
	RuleActive  = "active"
	RuleLearned = "learned"
	RuleByHuman = "user"
)

// Actions a judgment takes on one matter.
const (
	ActionNotify = "notify"
	ActionTrack  = "track"
	ActionSilent = "silent"
)

const (
	// maxRuleRunes matches the length Memory's dreaming may write.
	maxRuleRunes = 200
	// maxDeletedRules bounds what deleted rules are remembered against
	// relearning; the oldest go first.
	maxDeletedRules = 20
	// maxMatterRunes bounds how a Run names the matter of a divergence.
	maxMatterRunes = 300
	// keptDivergences is how many of a Human's latest shadow divergences stay.
	keptDivergences = 100
	// listedDivergences is how many of them My Rules shows.
	listedDivergences = 50
	// listedMandates is how many acts under mandates My Rules shows.
	listedMandates = 50
)

// Rule is one of a Human's own rules. Its ID is kept for its life; text and
// GuidelineVersion change when the Human edits it.
type Rule struct {
	ID         string     `json:"id"`
	Text       string     `json:"text"`
	Status     string     `json:"status"`
	Pinned     bool       `json:"pinned"`
	Source     string     `json:"source"`
	CreatedAt  time.Time  `json:"created_at"`
	PromotedAt *time.Time `json:"promoted_at"`
	// GuidelineVersion is the version that first held the rule as written.
	GuidelineVersion int `json:"guideline_version"`
	// Mandate is what the Human allows Another Me to do beyond reminding
	// when this rule applies. Only the Human sets it, on an active rule.
	Mandate string `json:"mandate"`
}

// DeletedRule is a rule the Human deleted; dreaming does not write it again
// without new feedback.
type DeletedRule struct {
	Text      string    `json:"text"`
	DeletedAt time.Time `json:"deleted_at"`
}

// Clue is an observation dreaming keeps until it is strong enough to be a
// rule. Memory owns its shape; TeamHub only shows it.
type Clue struct {
	Matter   string  `json:"matter"`
	Kind     string  `json:"kind"`
	Time     *string `json:"time"`
	Leaning  string  `json:"leaning"`
	Seen     int     `json:"seen"`
	LastSeen string  `json:"last_seen"`
}

// Guideline is one version of a Human's own rules: the shared general part
// lives with the Agent Service. Clues stay raw so a version the Human writes
// carries them over exactly as Memory wrote them.
type Guideline struct {
	Version      int
	Rules        []Rule
	DeletedRules []DeletedRule
	Clues        json.RawMessage
}

// DefaultGuideline is a new Human's guideline: general rules only.
func DefaultGuideline() Guideline { return Guideline{Version: 1} }

// ShadowRule is a rule that does not decide yet; a judgment records where it
// would have decided differently.
type ShadowRule struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// MandateRule is an active rule under which the Human allows Another Me to
// create a Work Item, or create and delegate it.
type MandateRule struct {
	ID      string `json:"id"`
	Text    string `json:"text"`
	Mandate string `json:"mandate"`
}

// JudgeRules is what one judgment reads of a guideline.
type JudgeRules struct {
	Version      int           `json:"version"`
	Rules        []string      `json:"rules"`
	ShadowRules  []ShadowRule  `json:"shadow_rules"`
	MandateRules []MandateRule `json:"mandate_rules"`
}

// JudgeRules splits the guideline into the active rules that decide and the
// shadow rules that are only compared.
func (g Guideline) JudgeRules() JudgeRules {
	judge := JudgeRules{Version: g.Version, Rules: []string{}, ShadowRules: []ShadowRule{}, MandateRules: []MandateRule{}}
	for _, rule := range g.Rules {
		switch rule.Status {
		case RuleActive:
			judge.Rules = append(judge.Rules, rule.Text)
			if mandateRank(rule.Mandate) > 0 {
				judge.MandateRules = append(judge.MandateRules, MandateRule{ID: rule.ID, Text: rule.Text, Mandate: rule.Mandate})
			}
		case RuleShadow:
			judge.ShadowRules = append(judge.ShadowRules, ShadowRule{ID: rule.ID, Text: rule.Text})
		}
	}
	return judge
}

func (g Guideline) rule(id string) int {
	return slices.IndexFunc(g.Rules, func(rule Rule) bool { return rule.ID == id })
}

func guidelineFromRow(row store.GetLatestProactiveGuidelineRow) (Guideline, error) {
	guideline := Guideline{Version: int(row.Version), Clues: row.Clues}
	if err := json.Unmarshal(row.Rules, &guideline.Rules); err != nil {
		return Guideline{}, err
	}
	if err := json.Unmarshal(row.DeletedRules, &guideline.DeletedRules); err != nil {
		return Guideline{}, err
	}
	return guideline, nil
}

func latestGuideline(ctx context.Context, queries *store.Queries, owner Owner) (Guideline, error) {
	row, err := queries.GetLatestProactiveGuideline(ctx, store.GetLatestProactiveGuidelineParams{
		TenantID: owner.TenantID, OwnerActorID: owner.ActorID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DefaultGuideline(), nil
	}
	if err != nil {
		return Guideline{}, err
	}
	return guidelineFromRow(row)
}

// StoredGuideline reads the Human's latest guideline version, written by
// Memory's nightly dreaming or the Human's own changes; a Human without one
// uses the default.
func StoredGuideline(pool *pgxpool.Pool) GuidelineSource {
	return func(ctx context.Context, owner Owner) (Guideline, error) {
		return latestGuideline(ctx, store.New(pool), owner)
	}
}

// ErrRuleNotFound means the Human has no such rule, or none in the state the
// command needs.
var ErrRuleNotFound = errors.New("proactive rule not found")

// ErrInvalidRule means a rule command or a divergence is malformed.
var ErrInvalidRule = errors.New("proactive rule command is invalid")

// ShadowDivergence is one matter a Run judged differently from a shadow rule.
type ShadowDivergence struct {
	ID               string    `json:"id"`
	RuleID           string    `json:"rule_id"`
	GuidelineVersion int       `json:"guideline_version"`
	Matter           string    `json:"matter"`
	ShadowAction     string    `json:"shadow_action"`
	TakenAction      string    `json:"taken_action"`
	CreatedAt        time.Time `json:"created_at"`
}

// RuleBook is what My Rules shows: the Human's rules, the clues not yet
// strong enough to be rules, where shadow rules would have decided
// differently, and what Another Me did under the Human's mandates.
type RuleBook struct {
	Version     int                `json:"version"`
	Rules       []Rule             `json:"rules"`
	Clues       []Clue             `json:"clues"`
	Divergences []ShadowDivergence `json:"divergences"`
	Mandates    []RuleMandate      `json:"mandates"`
}

// Rules returns the Human's rule book.
func (s *Service) Rules(ctx context.Context, owner Owner) (RuleBook, error) {
	queries := store.New(s.pool)
	guideline, err := latestGuideline(ctx, queries, owner)
	if err != nil {
		return RuleBook{}, err
	}
	book := RuleBook{Version: guideline.Version, Rules: guideline.Rules, Clues: []Clue{}, Divergences: []ShadowDivergence{}, Mandates: []RuleMandate{}}
	if book.Rules == nil {
		book.Rules = []Rule{}
	}
	if len(guideline.Clues) > 0 {
		if err := json.Unmarshal(guideline.Clues, &book.Clues); err != nil {
			return RuleBook{}, err
		}
	}
	rows, err := queries.ListProactiveShadowDivergences(ctx, store.ListProactiveShadowDivergencesParams{
		TenantID: owner.TenantID, OwnerActorID: owner.ActorID, Take: listedDivergences,
	})
	if err != nil {
		return RuleBook{}, err
	}
	for _, row := range rows {
		book.Divergences = append(book.Divergences, ShadowDivergence{
			ID: row.ID, RuleID: row.RuleID, GuidelineVersion: int(row.GuidelineVersion), Matter: row.Matter,
			ShadowAction: row.ShadowAction, TakenAction: row.TakenAction, CreatedAt: row.CreatedAt.Time,
		})
	}
	mandates, err := queries.ListProactiveMandates(ctx, store.ListProactiveMandatesParams{
		TenantID: owner.TenantID, OwnerActorID: owner.ActorID, Take: listedMandates,
	})
	if err != nil {
		return RuleBook{}, err
	}
	for _, row := range mandates {
		mandate := RuleMandate{WorkItemID: row.WorkItemID, Number: row.Number, Title: row.Title, Revoked: row.Revoked.Bool, RecordedAt: row.OccurredAt.Time}
		if err := json.Unmarshal(row.Details, &mandate.Mandate); err != nil {
			return RuleBook{}, err
		}
		book.Mandates = append(book.Mandates, mandate)
	}
	return book, nil
}

// PinRule pins or unpins a rule. Dreaming never removes or rewrites a pinned
// rule.
func (s *Service) PinRule(ctx context.Context, owner Owner, ruleID string, pinned bool) (RuleBook, error) {
	note := "The Human unpinned a rule."
	if pinned {
		note = "The Human pinned a rule."
	}
	return s.changeRule(ctx, owner, ruleID, note, func(guideline *Guideline, index int, _ time.Time) error {
		guideline.Rules[index].Pinned = pinned
		return nil
	})
}

// EditRule rewrites a rule's text. The rule becomes the Human's own, which
// dreaming never removes or rewrites; its status is kept.
func (s *Service) EditRule(ctx context.Context, owner Owner, ruleID, text string) (RuleBook, error) {
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > maxRuleRunes {
		return RuleBook{}, ErrInvalidRule
	}
	return s.changeRule(ctx, owner, ruleID, "The Human edited a rule.", func(guideline *Guideline, index int, _ time.Time) error {
		for other, rule := range guideline.Rules {
			if other != index && rule.Text == text {
				return ErrInvalidRule
			}
		}
		rule := &guideline.Rules[index]
		if rule.Text != text {
			rule.Text = text
			rule.GuidelineVersion = guideline.Version + 1
		}
		rule.Source = RuleByHuman
		return nil
	})
}

// DeleteRule removes a rule and remembers its text, so dreaming does not
// learn it again from the evidence it was learned from.
func (s *Service) DeleteRule(ctx context.Context, owner Owner, ruleID string) (RuleBook, error) {
	return s.changeRule(ctx, owner, ruleID, "The Human deleted a rule.", func(guideline *Guideline, index int, now time.Time) error {
		deleted := DeletedRule{Text: guideline.Rules[index].Text, DeletedAt: now}
		guideline.Rules = slices.Delete(guideline.Rules, index, index+1)
		guideline.DeletedRules = append([]DeletedRule{deleted}, slices.DeleteFunc(guideline.DeletedRules, func(old DeletedRule) bool {
			return old.Text == deleted.Text
		})...)
		if len(guideline.DeletedRules) > maxDeletedRules {
			guideline.DeletedRules = guideline.DeletedRules[:maxDeletedRules]
		}
		return nil
	})
}

// PromoteRule makes a shadow rule active, so it decides from the next
// judgment on.
func (s *Service) PromoteRule(ctx context.Context, owner Owner, ruleID string) (RuleBook, error) {
	return s.changeRule(ctx, owner, ruleID, "The Human promoted a shadow rule to active.", func(guideline *Guideline, index int, now time.Time) error {
		rule := &guideline.Rules[index]
		if rule.Status != RuleShadow {
			return ErrRuleNotFound
		}
		rule.Status = RuleActive
		rule.PromotedAt = &now
		return nil
	})
}

// SetRuleMandate sets what Another Me may do beyond reminding when an active
// rule applies. Lowering it, or deleting the rule, revokes the mandate for
// later acts; acts already taken keep their records. A shadow rule carries
// none until it is promoted.
func (s *Service) SetRuleMandate(ctx context.Context, owner Owner, ruleID, mandate string) (RuleBook, error) {
	if mandate != MandateNone && mandateRank(mandate) == 0 {
		return RuleBook{}, ErrInvalidRule
	}
	return s.changeRule(ctx, owner, ruleID, "The Human set a rule's mandate to "+mandate+".", func(guideline *Guideline, index int, _ time.Time) error {
		rule := &guideline.Rules[index]
		if rule.Status != RuleActive && mandate != MandateNone {
			return ErrInvalidRule
		}
		rule.Mandate = mandate
		return nil
	})
}

// changeRule appends the next guideline version with one rule changed. A
// concurrent version, by dreaming or another command, makes it start over on
// the newer one.
func (s *Service) changeRule(ctx context.Context, owner Owner, ruleID, note string, change func(*Guideline, int, time.Time) error) (RuleBook, error) {
	for attempt := 0; ; attempt++ {
		err := s.appendGuideline(ctx, owner, ruleID, note, change)
		if attempt < 2 && isGuidelineVersionTaken(err) {
			continue
		}
		if err != nil {
			return RuleBook{}, err
		}
		return s.Rules(ctx, owner)
	}
}

func (s *Service) appendGuideline(ctx context.Context, owner Owner, ruleID, note string, change func(*Guideline, int, time.Time) error) error {
	queries := store.New(s.pool)
	guideline, err := latestGuideline(ctx, queries, owner)
	if err != nil {
		return err
	}
	index := guideline.rule(ruleID)
	if index < 0 {
		return ErrRuleNotFound
	}
	before, err := json.Marshal(guideline.Rules)
	if err != nil {
		return err
	}
	if err := change(&guideline, index, s.now().UTC()); err != nil {
		return err
	}
	rules, err := json.Marshal(guideline.Rules)
	if err != nil || string(rules) == string(before) {
		return err
	}
	if guideline.DeletedRules == nil {
		guideline.DeletedRules = []DeletedRule{}
	}
	deleted, err := json.Marshal(guideline.DeletedRules)
	if err != nil {
		return err
	}
	return queries.InsertProactiveGuideline(ctx, store.InsertProactiveGuidelineParams{
		TenantID: owner.TenantID, OwnerActorID: owner.ActorID, Version: int32(guideline.Version + 1),
		Rules: rules, DeletedRules: deleted, Clues: guideline.Clues, ChangeNote: note,
	})
}

func isGuidelineVersionTaken(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505" && postgresError.ConstraintName == "proactive_guidelines_pkey"
}

// ShadowDivergenceInput is what a Run reports when one of the Human's shadow
// rules would have handled a matter differently from what it did.
type ShadowDivergenceInput struct {
	RuleID       string `json:"rule_id"`
	Matter       string `json:"matter"`
	ShadowAction string `json:"shadow_action"`
	TakenAction  string `json:"taken_action"`
}

func validAction(action string) bool {
	return action == ActionNotify || action == ActionTrack || action == ActionSilent
}

// RecordShadowDivergence records that a current shadow rule would have
// handled a matter differently, under the guideline version that holds it.
func (s *Service) RecordShadowDivergence(ctx context.Context, owner Owner, input ShadowDivergenceInput) (ShadowDivergence, error) {
	matter := strings.TrimSpace(input.Matter)
	if !validAction(input.ShadowAction) || !validAction(input.TakenAction) || input.ShadowAction == input.TakenAction ||
		matter == "" || utf8.RuneCountInString(matter) > maxMatterRunes {
		return ShadowDivergence{}, ErrInvalidRule
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ShadowDivergence{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := store.New(tx)
	guideline, err := latestGuideline(ctx, queries, owner)
	if err != nil {
		return ShadowDivergence{}, err
	}
	index := guideline.rule(input.RuleID)
	if index < 0 || guideline.Rules[index].Status != RuleShadow {
		return ShadowDivergence{}, ErrRuleNotFound
	}
	divergence := ShadowDivergence{
		RuleID: input.RuleID, GuidelineVersion: guideline.Version, Matter: matter,
		ShadowAction: input.ShadowAction, TakenAction: input.TakenAction,
	}
	kept, err := queries.CreateProactiveShadowDivergence(ctx, store.CreateProactiveShadowDivergenceParams{
		ID: ids.New("psd"), TenantID: owner.TenantID, OwnerActorID: owner.ActorID, RuleID: divergence.RuleID,
		GuidelineVersion: int32(divergence.GuidelineVersion), Matter: matter,
		ShadowAction: divergence.ShadowAction, TakenAction: divergence.TakenAction,
	})
	if err != nil {
		return ShadowDivergence{}, err
	}
	divergence.ID, divergence.CreatedAt = kept.ID, kept.CreatedAt.Time
	if err := queries.PruneProactiveShadowDivergences(ctx, store.PruneProactiveShadowDivergencesParams{
		TenantID: owner.TenantID, OwnerActorID: owner.ActorID, Keep: keptDivergences,
	}); err != nil {
		return ShadowDivergence{}, err
	}
	return divergence, tx.Commit(ctx)
}
