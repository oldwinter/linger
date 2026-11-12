package app

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentauth"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/taskdelegation"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/workitem"
	teamhubapi "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

// My Rules: the Human reads and changes their own Another Me rules. Every
// change appends a guideline version and answers with the new rule book.

func (a *App) proactiveRuleOwner(c *gin.Context) (proactive.Owner, bool) {
	tenantID, actorID, ok := a.pocketNoteOwner(c)
	return proactive.Owner{TenantID: tenantID, ActorID: actorID}, ok
}

func (a *App) listProactiveRules(c *gin.Context) {
	owner, ok := a.proactiveRuleOwner(c)
	if !ok {
		return
	}
	book, err := a.proactive.Rules(c.Request.Context(), owner)
	a.writeProactiveRuleBook(c, "list proactive rules", book, err)
}

func (a *App) editProactiveRule(c *gin.Context) {
	var request httpapi.ProactiveRuleEditRequest
	if decodeJSON(c, &request) != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "text is required")
		return
	}
	owner, ok := a.proactiveRuleOwner(c)
	if !ok {
		return
	}
	book, err := a.proactive.EditRule(c.Request.Context(), owner, c.Param("ruleId"), request.Text)
	a.writeProactiveRuleBook(c, "edit proactive rule", book, err)
}

func (a *App) deleteProactiveRule(c *gin.Context) {
	owner, ok := a.proactiveRuleOwner(c)
	if !ok {
		return
	}
	book, err := a.proactive.DeleteRule(c.Request.Context(), owner, c.Param("ruleId"))
	a.writeProactiveRuleBook(c, "delete proactive rule", book, err)
}

func (a *App) updateProactiveRulePin(c *gin.Context) {
	var request httpapi.ProactiveRulePinRequest
	if decodeJSON(c, &request) != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "pinned is required")
		return
	}
	owner, ok := a.proactiveRuleOwner(c)
	if !ok {
		return
	}
	book, err := a.proactive.PinRule(c.Request.Context(), owner, c.Param("ruleId"), request.Pinned)
	a.writeProactiveRuleBook(c, "pin proactive rule", book, err)
}

func (a *App) promoteProactiveRule(c *gin.Context) {
	owner, ok := a.proactiveRuleOwner(c)
	if !ok {
		return
	}
	book, err := a.proactive.PromoteRule(c.Request.Context(), owner, c.Param("ruleId"))
	a.writeProactiveRuleBook(c, "promote proactive rule", book, err)
}

func (a *App) updateProactiveRuleMandate(c *gin.Context) {
	var request httpapi.ProactiveRuleMandateRequest
	if decodeJSON(c, &request) != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "mandate is required")
		return
	}
	owner, ok := a.proactiveRuleOwner(c)
	if !ok {
		return
	}
	book, err := a.proactive.SetRuleMandate(c.Request.Context(), owner, c.Param("ruleId"), string(request.Mandate))
	if errors.Is(err, proactive.ErrInvalidRule) {
		a.writeError(c, http.StatusBadRequest, "PROACTIVE_MANDATE_INVALID", "Only an active rule can carry a mandate, and it is none, create or create_and_delegate")
		return
	}
	a.writeProactiveRuleBook(c, "set proactive rule mandate", book, err)
}

func (a *App) writeProactiveRuleBook(c *gin.Context, operation string, book proactive.RuleBook, err error) {
	switch {
	case err == nil:
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, book)
	case errors.Is(err, proactive.ErrRuleNotFound):
		a.writeError(c, http.StatusNotFound, "PROACTIVE_RULE_NOT_FOUND", "The rule was not found")
	case errors.Is(err, proactive.ErrInvalidRule):
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "The rule text must be 1 to 200 characters and differ from the other rules")
	default:
		a.internalError(c, operation, err)
	}
}

// recordProactiveShadowDivergence lets an AnotherMe judging proactively record
// where one of its Human's shadow rules would have acted differently.
func (a *App) recordProactiveShadowDivergence(c *gin.Context) {
	auth, err := a.agentAuth.Authorize(c.Request.Context(), strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "), "record_shadow_divergence")
	if err == nil && (auth.Principal == nil || auth.UserArtifactOwnerActorID == "") {
		err = agentauth.ErrForbidden
	}
	if a.writeAgentAuthError(c, "authorize shadow divergence", err) {
		return
	}
	var input proactive.ShadowDivergenceInput
	if err := decodeStrictJSON(http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10), &input, "one divergence object is required"); err != nil {
		a.writeAgentAPIError(c, http.StatusBadRequest, teamhubapi.AgentApiErrorCodeInvalidInput, "Invalid shadow divergence")
		return
	}
	owner := proactive.Owner{TenantID: auth.TenantID, ActorID: auth.UserArtifactOwnerActorID}
	divergence, err := a.proactive.RecordShadowDivergence(c.Request.Context(), owner, input)
	switch {
	case err == nil:
		c.JSON(http.StatusOK, divergence)
	case errors.Is(err, proactive.ErrInvalidRule):
		a.writeAgentAPIError(c, http.StatusBadRequest, teamhubapi.AgentApiErrorCodeInvalidInput, "A divergence names a matter and two different actions")
	case errors.Is(err, proactive.ErrRuleNotFound):
		a.writeAgentAPIError(c, http.StatusNotFound, teamhubapi.AgentApiErrorCodeNotFound, "The rule is not one of the Human's current shadow rules")
	default:
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, teamhubapi.AgentApiErrorCodeDependencyUnavailable, "The divergence could not be recorded")
	}
}

// actUnderProactiveMandate lets an AnotherMe create a Work Item, or delegate a
// Task, under one of its Human's rule mandates.
func (a *App) actUnderProactiveMandate(c *gin.Context) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return
	}
	var input proactive.ActInput
	if err := decodeStrictJSON(http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10), &input, "one act object is required"); err != nil {
		a.writeAgentAPIError(c, http.StatusBadRequest, teamhubapi.AgentApiErrorCodeInvalidInput, "Invalid act")
		return
	}
	result, err := a.proactive.Act(c.Request.Context(), a.agentAuth, token, input)
	switch {
	case err == nil:
		c.JSON(http.StatusOK, result)
	case errors.Is(err, proactive.ErrInvalidRule), errors.Is(err, taskdelegation.ErrInvalid), errors.Is(err, workitem.ErrInvalid):
		a.writeAgentAPIError(c, http.StatusBadRequest, teamhubapi.AgentApiErrorCodeInvalidInput, "An act names a rule, an event, a title and a brief")
	case errors.Is(err, proactive.ErrNoMandate):
		a.writeAgentAPIError(c, http.StatusForbidden, teamhubapi.AgentApiErrorCodeOperationForbidden, "The Human's current rules grant no mandate for this act; only remind or track")
	case errors.Is(err, taskdelegation.ErrLimitReached):
		a.writeAgentAPIError(c, http.StatusConflict, teamhubapi.AgentApiErrorCodeTaskLimitReached, "The AlterEgo already runs the maximum number of Tasks")
	case errors.Is(err, taskdelegation.ErrForbidden):
		a.writeAgentAPIError(c, http.StatusForbidden, teamhubapi.AgentApiErrorCodeOperationForbidden, "Acting is available only from the Room Context")
	default:
		a.writeAgentAuthError(c, "act under mandate", err)
	}
}
