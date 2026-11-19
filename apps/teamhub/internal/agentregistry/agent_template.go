package agentregistry

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/collaboration"
	idgen "github.com/simplexai-labs/linger/apps/teamhub/internal/ids"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

var (
	agentAvatarKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$`)
	externalAppKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,119}$`)

	errInvalidAgentTemplateConnector = errors.New("Agent template Connector selection is invalid")
)

// ExecuteAgentTemplatePublication publishes an Agent template from the Space.
func (s *Service) ExecuteAgentTemplatePublication(
	ctx context.Context,
	accountID string,
	tenantID string,
	request httpapi.AgentTemplatePublishRequest,
) (httpapi.AgentTemplate, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return httpapi.AgentTemplate{}, err
	}
	defer tx.Rollback(ctx)
	queries := s.queries.WithTx(tx)
	publisher, err := queries.AuthorizeTenantAgentTemplate(ctx, store.AuthorizeTenantAgentTemplateParams{
		TenantID: tenantID, AccountID: textValue(accountID),
	})
	if err != nil {
		return httpapi.AgentTemplate{}, err
	}
	routines := []reminder.TemplateRoutine{}
	if request.SourceAgentActorId != nil {
		registration, err := queries.GetAgentRegistrationByActor(ctx, store.GetAgentRegistrationByActorParams{ActorID: *request.SourceAgentActorId, TenantID: tenantID})
		if err != nil {
			return httpapi.AgentTemplate{}, err
		}
		if registration.CreatedByActorID != publisher.ID {
			return httpapi.AgentTemplate{}, collaboration.ErrAgentSponsorRequired
		}
		if registration.Status != "active" {
			return httpapi.AgentTemplate{}, pgx.ErrNoRows
		}
		roomID, err := queries.GetCurrentDirectRoom(ctx, store.GetCurrentDirectRoomParams{TenantID: tenantID, HumanActorID: publisher.ID, AgentActorID: *request.SourceAgentActorId})
		if err == nil {
			routines, err = reminder.SnapshotTemplateInTx(ctx, queries, tenantID, roomID, *request.SourceAgentActorId)
			if err != nil {
				return httpapi.AgentTemplate{}, err
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return httpapi.AgentTemplate{}, err
		}
	}
	routineSnapshot, err := json.Marshal(routines)
	if err != nil {
		return httpapi.AgentTemplate{}, err
	}
	skillBindings, err := json.Marshal(emptySlice(pointerSlice(request.SkillBindings)))
	if err != nil {
		return httpapi.AgentTemplate{}, err
	}
	connectorBindings, err := json.Marshal(emptySlice(pointerSlice(request.ConnectorBindings)))
	if err != nil {
		return httpapi.AgentTemplate{}, err
	}
	templateID := idgen.New("agent_template")
	row, err := queries.InsertPublishedAgentTemplate(ctx, store.InsertPublishedAgentTemplateParams{
		TemplateID:         templateID,
		TenantID:           textValue(tenantID),
		Name:               request.Name,
		Description:        optionalString(request.Description),
		Instructions:       request.Instructions,
		AvatarKey:          optionalText(request.AvatarKey),
		SkillBindings:      skillBindings,
		ConnectorBindings:  connectorBindings,
		Routines:           routineSnapshot,
		PublishedByActorID: textValue(publisher.ID),
	})
	if err != nil {
		return httpapi.AgentTemplate{}, err
	}
	model, err := publishedAgentTemplateModel(row, publisher)
	if err != nil {
		return httpapi.AgentTemplate{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return httpapi.AgentTemplate{}, err
	}
	return model, nil
}

// NormalizeAgentTemplateConnectors checks a template's Connector references.
// They name Apps the consumer must authorize themselves. Only the catalog key
// is accepted, so no connection, account, or credential of the
// publisher can travel with a template.
func NormalizeAgentTemplateConnectors(input []httpapi.ExternalAppKey) ([]httpapi.ExternalAppKey, error) {
	connectors := make([]httpapi.ExternalAppKey, 0, len(input))
	if len(input) > 20 {
		return nil, errInvalidAgentTemplateConnector
	}
	seen := make(map[httpapi.ExternalAppKey]struct{}, len(input))
	for _, key := range input {
		if !externalAppKeyPattern.MatchString(key) {
			return nil, errInvalidAgentTemplateConnector
		}
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		connectors = append(connectors, key)
	}
	return connectors, nil
}

func listedAgentTemplateModel(row store.ListAgentTemplatesRow) (httpapi.AgentTemplate, error) {
	model, err := agentTemplateModel(store.AgentTemplate{
		TemplateID: row.TemplateID, Origin: row.Origin, TenantID: row.TenantID,
		Name: row.Name, Description: row.Description, Instructions: row.Instructions,
		AvatarKey: row.AvatarKey, SkillBindings: row.SkillBindings,
		ConnectorBindings:  row.ConnectorBindings,
		Routines:           row.Routines,
		PublishedByActorID: row.PublishedByActorID,
		CreatedAt:          row.CreatedAt, UpdatedAt: row.UpdatedAt,
	})
	if err != nil {
		return httpapi.AgentTemplate{}, err
	}
	if row.PublishedByActorID.Valid && row.PublishedByDisplayName.Valid {
		model.PublishedBy = &httpapi.ActorRef{
			Id:          row.PublishedByActorID.String,
			TenantId:    row.PublishedByTenantID.String,
			Kind:        httpapi.ActorKindHuman,
			DisplayName: row.PublishedByDisplayName.String,
		}
	}
	return model, nil
}

func publishedAgentTemplateModel(
	row store.AgentTemplate,
	publisher store.AuthorizeTenantAgentTemplateRow,
) (httpapi.AgentTemplate, error) {
	model, err := agentTemplateModel(row)
	if err != nil {
		return httpapi.AgentTemplate{}, err
	}
	model.PublishedBy = &httpapi.ActorRef{
		Id: publisher.ID, TenantId: row.TenantID.String,
		Kind: httpapi.ActorKindHuman, DisplayName: publisher.DisplayName,
	}
	return model, nil
}

func agentTemplateModel(row store.AgentTemplate) (httpapi.AgentTemplate, error) {
	var skills []httpapi.AgentSkillRegistration
	if err := json.Unmarshal(row.SkillBindings, &skills); err != nil {
		return httpapi.AgentTemplate{}, err
	}
	var connectors []httpapi.ExternalAppKey
	if len(row.ConnectorBindings) > 0 {
		if err := json.Unmarshal(row.ConnectorBindings, &connectors); err != nil {
			return httpapi.AgentTemplate{}, err
		}
	}
	var storedRoutines []reminder.TemplateRoutine
	if len(row.Routines) > 0 {
		if err := json.Unmarshal(row.Routines, &storedRoutines); err != nil {
			return httpapi.AgentTemplate{}, err
		}
	}
	routines := make([]httpapi.AgentTemplateRoutine, 0, len(storedRoutines))
	for _, item := range storedRoutines {
		routines = append(routines, agentTemplateRoutineModel(item))
	}
	model := httpapi.AgentTemplate{
		TemplateId:        row.TemplateID,
		Origin:            httpapi.AgentTemplateOrigin(row.Origin),
		Name:              row.Name,
		Description:       row.Description,
		Instructions:      row.Instructions,
		SkillBindings:     emptySlice(skills),
		ConnectorBindings: emptySlice(connectors),
		Routines:          emptySlice(routines),
		CreatedAt:         row.CreatedAt.Time,
		UpdatedAt:         row.UpdatedAt.Time,
	}
	if row.AvatarKey.Valid {
		avatarKey := row.AvatarKey.String
		model.AvatarKey = &avatarKey
	}
	return model, nil
}

func agentTemplateRoutineModel(item reminder.TemplateRoutine) httpapi.AgentTemplateRoutine {
	cadence := httpapi.RoutineCadence{
		Kind: httpapi.RoutineCadenceKind(item.Cadence.Kind), Timezone: item.Cadence.Timezone,
		Hour: item.Cadence.Hour, Minute: item.Cadence.Minute, RunAt: item.Cadence.RunAt,
	}
	if item.Cadence.Kind == "every_n_minutes" && item.Cadence.IntervalMinutes != nil {
		if *item.Cadence.IntervalMinutes%60 == 0 {
			hours := *item.Cadence.IntervalMinutes / 60
			cadence.Kind = httpapi.RoutineCadenceKindEveryNHours
			cadence.IntervalHours = &hours
		} else {
			minutes := *item.Cadence.IntervalMinutes
			cadence.Kind = httpapi.RoutineCadenceKindEveryNMinutes
			cadence.IntervalMinutes = &minutes
		}
	}
	if len(item.Cadence.Weekdays) > 0 {
		days := make([]httpapi.RoutineWeekday, 0, len(item.Cadence.Weekdays))
		for _, day := range item.Cadence.Weekdays {
			days = append(days, httpapi.RoutineWeekday(day))
		}
		cadence.Weekdays = &days
	}
	model := httpapi.AgentTemplateRoutine{
		Key: item.Key, Name: item.Name, Instruction: item.Instruction,
		Cadence: cadence, Enabled: item.Enabled,
		CreatedByRole: httpapi.AgentTemplateRoutineCreatedByRole(item.CreatedByRole),
	}
	if item.MentionRole != nil {
		role := httpapi.AgentTemplateRoutineMentionRole(*item.MentionRole)
		model.MentionRole = &role
	}
	return model
}

func emptySlice[T any](values []T) []T {
	if values == nil {
		return []T{}
	}
	return values
}

func optionalText(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return textValue(*value)
}

// ValidAgentAvatarKey guards the shape of an avatar key. Avatar keys are a
// product enumeration owned by the Product Client; TeamHub stores the
// selection.
func ValidAgentAvatarKey(value string) bool {
	return agentAvatarKeyPattern.MatchString(value)
}
