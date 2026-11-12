package app

import (
	"errors"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomagent"
	api "github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
	agentapi "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
	"github.com/simplexai-labs/linger/contracts-go/teamhubinternal"
)

// reportLocalComputerHerdrEvent queues a herdr pane event a connected
// Computer reported, for the proactive judgment of that Computer's owner.
func (a *App) reportLocalComputerHerdrEvent(c *gin.Context) {
	var request teamhubinternal.HerdrAgentEventReport
	if err := decodeJSON(c, &request); err != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "herdr event is invalid")
		return
	}
	optional := func(value *string) string {
		if value == nil {
			return ""
		}
		return *value
	}
	err := a.proactive.EnqueueHerdrEvent(c.Request.Context(), proactive.HerdrReport{
		ComputerID: request.ComputerId, Kind: string(request.Kind), PaneID: request.PaneId, StateChangeSeq: request.StateChangeSeq,
		Agent: optional(request.Agent), Name: optional(request.Name), Cwd: optional(request.Cwd), Title: optional(request.Title), Tail: optional(request.Tail),
	})
	switch {
	case err == nil:
		c.Status(http.StatusAccepted)
	case errors.Is(err, proactive.ErrInvalidEvent):
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "herdr event is invalid")
	case errors.Is(err, proactive.ErrUnknownComputer):
		a.writeError(c, http.StatusNotFound, "LOCAL_COMPUTER_NOT_FOUND", "Local Computer was not found")
	default:
		a.internalError(c, "queue herdr event", err)
	}
}

// answerAgentHerdrPane types the owner's answer into a blocked herdr agent
// pane on the owner's Local Computer. Only the owner's AnotherMe may answer;
// the Computer and its owner come from the Agent's placement, and the
// Computer checks the pane is still blocked on the same state. The answer is
// never retried.
func (a *App) answerAgentHerdrPane(c *gin.Context) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	auth, err := a.agentAuth.Authorize(ctx, token, "answer_herdr_pane")
	if a.writeAgentAuthError(c, "answer herdr pane", err) {
		return
	}
	if auth.Principal == nil {
		a.writeAgentAPIError(c, http.StatusForbidden, agentapi.AgentApiErrorCodeForbidden, "Answering herdr agents requires an Agent identity")
		return
	}
	var request agentapi.AnswerAgentHerdrPaneJSONRequestBody
	if !a.decodeAgentRequest(c, &request) {
		return
	}
	if strings.TrimSpace(request.PaneId) == "" || request.StateChangeSeq < 0 || strings.TrimSpace(request.Text) == "" ||
		utf8.RuneCountInString(request.Text) > 4000 || strings.ContainsFunc(request.Text, unicode.IsControl) {
		a.writeAgentAPIError(c, http.StatusBadRequest, agentapi.AgentApiErrorCodeInvalidRequest, "Send one line of at most 4000 characters, exactly as the Human answered, to a pane and state from a herdr event")
		return
	}
	computerID, ownerID, err := a.agents.LocalComputerPlacement(ctx, auth.TenantID, auth.AgentActorID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && ownerID != auth.UserArtifactOwnerActorID {
		a.writeAgentAPIError(c, http.StatusConflict, agentapi.AgentApiErrorCodeOperationForbidden, "Only the AnotherMe of the Computer's owner, running on that Computer, can answer its herdr agents")
		return
	}
	tools, supported := a.localComputers.(roomagent.LocalComputerTools)
	if err != nil || !supported {
		if err != nil {
			a.logger.Error("read herdr answer placement", "error", err)
		}
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "Answering herdr agents is temporarily unavailable")
		return
	}
	_, err = tools.CallLocalComputerTool(ctx, api.LocalComputerToolCall{
		TenantId: auth.TenantID, OwnerActorId: ownerID, ComputerId: computerID, AgentId: auth.AgentID,
		ToolSessionId: "herdr-answer", Server: api.Herdr, ToolName: "answer",
		Arguments: map[string]any{"pane_id": request.PaneId, "state_change_seq": request.StateChangeSeq, "text": request.Text},
	})
	status := agentapi.Sent
	var failure *roomagent.LocalComputerToolError
	switch {
	case err == nil:
	case errors.As(err, &failure) && failure.Code == "pane_closed":
		status = agentapi.PaneClosed
	case errors.As(err, &failure) && failure.Code == "pane_not_blocked":
		status = agentapi.PaneNotBlocked
	case errors.As(err, &failure) && failure.Code == "outcome_unknown":
		status = agentapi.OutcomeUnknown
	case errors.As(err, &failure) && failure.Code == "herdr_unavailable":
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "herdr is not running on the Computer, so nothing was sent")
		return
	default:
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "The Local Computer is offline or could not take the answer, so nothing was sent")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status, "computer_id": computerID})
}
