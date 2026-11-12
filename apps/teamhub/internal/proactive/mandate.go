package proactive

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentauth"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/taskdelegation"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/workitem"
)

// MandateNone leaves Another Me only reminding and tracking under a rule.
const MandateNone = "none"

// ActTool is the Agent business action of acting under a mandate.
const ActTool = "act_under_mandate"

// ErrNoMandate means none of the Human's current rules grants the act: the
// rule is gone, not active, or its mandate is lower than the act needs.
var ErrNoMandate = errors.New("the rule grants no mandate for this act")

// mandateRank orders strengths; a higher one includes the lower.
func mandateRank(mandate string) int {
	switch mandate {
	case workitem.MandateCreate:
		return 1
	case workitem.MandateCreateAndDelegate:
		return 2
	}
	return 0
}

// RuleMandate is one Work Item Another Me created under a mandate, as My
// Rules lists it.
type RuleMandate struct {
	workitem.Mandate
	WorkItemID string    `json:"work_item_id"`
	Number     int64     `json:"number"`
	Title      string    `json:"title"`
	Revoked    bool      `json:"revoked"`
	RecordedAt time.Time `json:"recorded_at"`
}

// ActInput is one act Another Me takes under a rule's mandate for one outside
// event: a Work Item, or a Task delegated to its own AlterEgo.
type ActInput struct {
	RuleID          string `json:"rule_id"`
	EventSource     string `json:"event_source"`
	EventExternalID string `json:"event_external_id"`
	Title           string `json:"title"`
	Brief           string `json:"brief"`
	Delegate        bool   `json:"delegate"`
}

// ActResult names the Work Item the act created; Replay marks a repeated act
// for the same rule and event.
type ActResult struct {
	WorkItemID string `json:"work_item_id"`
	Strength   string `json:"strength"`
	Replay     bool   `json:"replay"`
}

func (input ActInput) valid() bool {
	title, brief := strings.TrimSpace(input.Title), strings.TrimSpace(input.Brief)
	source, external := strings.TrimSpace(input.EventSource), strings.TrimSpace(input.EventExternalID)
	return title != "" && utf8.RuneCountInString(title) <= 120 && brief != "" && utf8.RuneCountInString(brief) <= 20000 &&
		source != "" && utf8.RuneCountInString(source) <= 100 && external != "" && utf8.RuneCountInString(external) <= 500
}

// Act creates the Work Item, or delegates the Task, and records its Mandate
// in one transaction, only while one of the Human's active rules grants that
// strength. The act is idempotent per rule and event: a retried Run gets the
// Work Item the first one created.
func (s *Service) Act(ctx context.Context, contexts agentauth.Authorizer, token string, input ActInput) (ActResult, error) {
	if !input.valid() {
		return ActResult{}, ErrInvalidRule
	}
	input.EventSource, input.EventExternalID = strings.TrimSpace(input.EventSource), strings.TrimSpace(input.EventExternalID)
	strength := workitem.MandateCreate
	if input.Delegate {
		strength = workitem.MandateCreateAndDelegate
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ActResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	auth, err := contexts.AuthorizeInTx(ctx, tx, token, ActTool)
	if err != nil {
		return ActResult{}, err
	}
	if auth.Principal == nil || auth.UserArtifactOwnerActorID == "" {
		return ActResult{}, agentauth.ErrForbidden
	}
	key, _ := json.Marshal([]string{input.RuleID, input.EventSource, input.EventExternalID})
	digest := sha256.Sum256(key)
	invocation := "agent-invocation-sha256:" + hex.EncodeToString(digest[:])
	receipt, replay, err := agentauth.LookupReceipt(ctx, tx, auth.Principal, ActTool, invocation, digest[:])
	if err != nil {
		return ActResult{}, err
	}
	if replay {
		var stored ActResult
		if err := json.Unmarshal(receipt.Body, &stored); err != nil {
			return ActResult{}, err
		}
		stored.Replay = true
		return stored, tx.Commit(ctx)
	}
	queries := store.New(tx)
	owner := Owner{TenantID: auth.TenantID, ActorID: auth.UserArtifactOwnerActorID}
	guideline, err := latestGuideline(ctx, queries, owner)
	if err != nil {
		return ActResult{}, err
	}
	index := guideline.rule(input.RuleID)
	if index < 0 || guideline.Rules[index].Status != RuleActive || mandateRank(guideline.Rules[index].Mandate) < mandateRank(strength) {
		return ActResult{}, ErrNoMandate
	}
	mandate := workitem.Mandate{
		OwnerActorID: owner.ActorID, RuleID: input.RuleID, RuleText: guideline.Rules[index].Text,
		GuidelineVersion: guideline.Version, EventSource: input.EventSource, EventExternalID: input.EventExternalID,
		Strength: strength,
	}
	result := ActResult{Strength: strength}
	if input.Delegate {
		result.WorkItemID, err = taskdelegation.StartInTx(ctx, tx, auth, input.Title, input.Brief, "proactive_mandate:"+hex.EncodeToString(digest[:]))
		if err == nil {
			err = workitem.RecordMandateInTx(ctx, queries, result.WorkItemID, auth.TenantID, auth.AgentActorID, mandate)
		}
	} else {
		var item workitem.Item
		item, err = workitem.CreateForAgentInTx(ctx, tx, auth.AgentID, workitem.CreateInput{
			Kind: "issue", Title: input.Title, Description: input.Brief, Priority: "medium", OriginRoomID: auth.RoomID,
		}, mandate)
		result.WorkItemID = item.ID
	}
	if err != nil {
		return ActResult{}, err
	}
	body, err := json.Marshal(result)
	if err != nil {
		return ActResult{}, err
	}
	if err := agentauth.SaveReceipt(ctx, tx, auth.Principal, ActTool, invocation, digest[:],
		agentauth.Receipt{ResourceID: result.WorkItemID, Body: body}); err != nil {
		return ActResult{}, err
	}
	return result, tx.Commit(ctx)
}
