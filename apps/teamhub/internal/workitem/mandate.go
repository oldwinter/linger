package workitem

import (
	"context"
	"encoding/json"
	"time"

	idgen "github.com/simplexai-labs/linger/apps/teamhub/internal/ids"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// Mandate strengths a Human grants Another Me on one of their active rules.
const (
	MandateCreate            = "create"
	MandateCreateAndDelegate = "create_and_delegate"
)

// Mandate is the authority under which Another Me created a Work Item: one
// active rule of its Human, as that rule stood in the guideline version it
// judged by, and the outside event it acted on. It is recorded once, with the
// Work Item, and never changes.
type Mandate struct {
	OwnerActorID     string `json:"owner_actor_id"`
	RuleID           string `json:"rule_id"`
	RuleText         string `json:"rule_text"`
	GuidelineVersion int    `json:"guideline_version"`
	EventSource      string `json:"event_source"`
	EventExternalID  string `json:"event_external_id"`
	Strength         string `json:"strength"`
}

// ItemMandate is a recorded Mandate as it reads now: revoked once the Human's
// current rules no longer grant its strength.
type ItemMandate struct {
	Mandate
	Revoked    bool      `json:"revoked"`
	RecordedAt time.Time `json:"recorded_at"`
}

// RecordMandateInTx records the Mandate as an activity of the Work Item, in
// the transaction that creates it.
func RecordMandateInTx(ctx context.Context, queries *store.Queries, workItemID, tenantID, actorID string, mandate Mandate) error {
	details, err := json.Marshal(mandate)
	if err != nil {
		return err
	}
	return queries.CreateWorkItemMandateActivity(ctx, store.CreateWorkItemMandateActivityParams{
		ID: idgen.New("activity"), WorkItemID: workItemID, TenantID: tenantID, ActorID: actorID, Details: details,
	})
}

func loadMandates(ctx context.Context, queries *store.Queries, workItemIDs []string) (map[string]*ItemMandate, error) {
	rows, err := queries.ListWorkItemMandatesByItems(ctx, workItemIDs)
	if err != nil {
		return nil, err
	}
	mandates := make(map[string]*ItemMandate, len(rows))
	for _, row := range rows {
		mandate := ItemMandate{Revoked: row.Revoked.Bool, RecordedAt: row.OccurredAt.Time}
		if err := json.Unmarshal(row.Details, &mandate.Mandate); err != nil {
			return nil, err
		}
		mandates[row.WorkItemID] = &mandate
	}
	return mandates, nil
}
