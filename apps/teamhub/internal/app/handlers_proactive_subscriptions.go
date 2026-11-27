package app

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	teamhubapi "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

func (a *App) listWorkItemSubscriptions(c *gin.Context) {
	items, err := a.proactive.ListTaskSubscriptionsForHuman(
		c.Request.Context(),
		currentPrincipal(c).Session.AccountID,
		c.Param("workItemId"),
	)
	switch {
	case err == nil:
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, httpapi.TaskSubscriptionList{
			Items: publicTaskSubscriptionModels(items),
		})
	case errors.Is(err, proactive.ErrWorkItemNotFound):
		a.writeError(c, http.StatusNotFound, "NOT_FOUND", "Work Item was not found")
	default:
		a.internalError(c, "list Work Item subscriptions", err)
	}
}

func (a *App) dropWorkItemSubscription(c *gin.Context) {
	var request httpapi.TaskSubscriptionDropRequest
	if c.Request.Body != nil {
		if err := decodeStrictJSON(http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10), &request, "optional drop reason object"); err != nil && !errors.Is(err, io.EOF) {
			a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Invalid subscription drop request")
			return
		}
	}
	reason := ""
	if request.Reason != nil {
		reason = *request.Reason
	}
	dropped, err := a.proactive.DropTaskSubscriptionForHuman(
		c.Request.Context(),
		currentPrincipal(c).Session.AccountID,
		c.Param("workItemId"),
		c.Param("subscriptionId"),
		reason,
	)
	switch {
	case err == nil:
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, publicTaskSubscriptionModel(dropped))
	case errors.Is(err, proactive.ErrInvalidSubscriptionDrop):
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Subscription drop request is invalid")
	case errors.Is(err, proactive.ErrSubscriptionForbidden):
		a.writeError(c, http.StatusForbidden, "FORBIDDEN", "Only the subscription owner can drop this subscription")
	case errors.Is(err, proactive.ErrWorkItemNotFound), errors.Is(err, proactive.ErrSubscriptionNotFound):
		a.writeError(c, http.StatusNotFound, "NOT_FOUND", "Subscription was not found")
	default:
		a.internalError(c, "drop Work Item subscription", err)
	}
}

func (a *App) listAgentProactiveSubscriptions(c *gin.Context) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return
	}
	var input proactive.ListSubscriptionsForAgentInput
	if c.Request.Body != nil {
		if err := decodeStrictJSON(http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10), &input, "one subscription query object is required"); err != nil && !errors.Is(err, io.EOF) {
			a.writeAgentAPIError(c, http.StatusBadRequest, teamhubapi.AgentApiErrorCodeInvalidInput, "Invalid subscription list request")
			return
		}
	}
	items, err := a.proactive.ListSubscriptionsForAgent(c.Request.Context(), a.agentAuth, token, input)
	switch {
	case err == nil:
		c.JSON(http.StatusOK, teamhubapi.TaskSubscriptionList{
			Items: agentTaskSubscriptionModels(items),
		})
	case errors.Is(err, proactive.ErrInvalidSubscriptionDrop):
		a.writeAgentAPIError(c, http.StatusBadRequest, teamhubapi.AgentApiErrorCodeInvalidInput, "Invalid subscription filter")
	default:
		a.writeAgentAuthError(c, "list proactive subscriptions", err)
	}
}

func (a *App) dropAgentProactiveSubscription(c *gin.Context) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return
	}
	var input proactive.DropSubscriptionForAgentInput
	if err := decodeStrictJSON(http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10), &input, "one subscription drop object is required"); err != nil {
		a.writeAgentAPIError(c, http.StatusBadRequest, teamhubapi.AgentApiErrorCodeInvalidInput, "Invalid subscription drop request")
		return
	}
	result, err := a.proactive.DropSubscriptionForAgent(c.Request.Context(), a.agentAuth, token, input)
	switch {
	case err == nil:
		c.JSON(http.StatusOK, teamhubapi.ProactiveSubscriptionDropResult{
			Subscription: agentTaskSubscriptionModel(result.Subscription),
			Replay:       result.Replay,
		})
	case errors.Is(err, proactive.ErrInvalidSubscriptionDrop):
		a.writeAgentAPIError(c, http.StatusBadRequest, teamhubapi.AgentApiErrorCodeInvalidInput, "A subscription drop names a valid subscription_id and an optional reason up to 500 characters")
	case errors.Is(err, proactive.ErrSubscriptionNotFound):
		a.writeAgentAPIError(c, http.StatusNotFound, teamhubapi.AgentApiErrorCodeNotFound, "The subscription was not found")
	case errors.Is(err, proactive.ErrSubscriptionForbidden):
		a.writeAgentAPIError(c, http.StatusForbidden, teamhubapi.AgentApiErrorCodeOperationForbidden, "Only Another Me acting for the subscription owner can drop this subscription")
	default:
		a.writeAgentAuthError(c, "drop proactive subscription", err)
	}
}

func publicTaskSubscriptionModels(items []proactive.Subscription) []httpapi.TaskSubscription {
	models := make([]httpapi.TaskSubscription, 0, len(items))
	for _, item := range items {
		models = append(models, publicTaskSubscriptionModel(item))
	}
	return models
}

func publicTaskSubscriptionModel(sub proactive.Subscription) httpapi.TaskSubscription {
	model := httpapi.TaskSubscription{
		Id:                  sub.ID,
		TenantId:            sub.TenantID,
		OwnerActorId:        sub.OwnerActorID,
		TaskId:              sub.TaskID,
		SourceType:          httpapi.TaskSubscriptionSourceType(sub.SourceType),
		NormalizedSourceKey: sub.NormalizedSourceKey,
		Status:              httpapi.TaskSubscriptionStatus(sub.Status),
		CreatedByActorId:    sub.CreatedByActorID,
		CreatedAt:           sub.CreatedAt,
		DroppedAt:           sub.DroppedAt,
	}
	if sub.DisplayLabel != "" {
		label := sub.DisplayLabel
		model.DisplayLabel = &label
	}
	if sub.RuleID != "" {
		ruleID := sub.RuleID
		model.RuleId = &ruleID
	}
	if sub.DroppedByKind != "" {
		kind := httpapi.TaskSubscriptionDroppedByKind(sub.DroppedByKind)
		model.DroppedByKind = &kind
	}
	if sub.DroppedByActorID != "" {
		actorID := sub.DroppedByActorID
		model.DroppedByActorId = &actorID
	}
	if sub.DropReason != "" {
		reason := sub.DropReason
		model.DropReason = &reason
	}
	return model
}

func agentTaskSubscriptionModels(items []proactive.Subscription) []teamhubapi.TaskSubscription {
	models := make([]teamhubapi.TaskSubscription, 0, len(items))
	for _, item := range items {
		models = append(models, agentTaskSubscriptionModel(item))
	}
	return models
}

func agentTaskSubscriptionModel(sub proactive.Subscription) teamhubapi.TaskSubscription {
	model := teamhubapi.TaskSubscription{
		Id:                  sub.ID,
		TenantId:            sub.TenantID,
		OwnerActorId:        sub.OwnerActorID,
		TaskId:              sub.TaskID,
		SourceType:          teamhubapi.TaskSubscriptionSourceType(sub.SourceType),
		NormalizedSourceKey: sub.NormalizedSourceKey,
		Status:              teamhubapi.TaskSubscriptionStatus(sub.Status),
		CreatedByActorId:    sub.CreatedByActorID,
		CreatedAt:           sub.CreatedAt,
		DroppedAt:           sub.DroppedAt,
	}
	if sub.DisplayLabel != "" {
		label := sub.DisplayLabel
		model.DisplayLabel = &label
	}
	if sub.RuleID != "" {
		ruleID := sub.RuleID
		model.RuleId = &ruleID
	}
	if sub.DroppedByKind != "" {
		kind := teamhubapi.TaskSubscriptionDroppedByKind(sub.DroppedByKind)
		model.DroppedByKind = &kind
	}
	if sub.DroppedByActorID != "" {
		actorID := sub.DroppedByActorID
		model.DroppedByActorId = &actorID
	}
	if sub.DropReason != "" {
		reason := sub.DropReason
		model.DropReason = &reason
	}
	return model
}
