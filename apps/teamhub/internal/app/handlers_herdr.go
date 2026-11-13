package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomagent"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/typedcard"
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

// askAgentHerdrPane posts a question card that asks the owner of this
// AnotherMe's Local Computer how to answer a blocked herdr agent pane. The
// card is bound to the pane state the Computer reported; when the owner
// answers, TeamHub types exactly that answer into the pane (see
// deliverHerdrAnswer). The Agent supplies the question and choices, never the
// text that is sent, and has no other way to write to a pane.
func (a *App) askAgentHerdrPane(c *gin.Context) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	auth, err := a.agentAuth.Authorize(ctx, token, "ask_herdr_pane")
	if a.writeAgentAuthError(c, "ask about a herdr pane", err) {
		return
	}
	if auth.Principal == nil {
		a.writeAgentAPIError(c, http.StatusForbidden, agentapi.AgentApiErrorCodeForbidden, "Asking about herdr agents requires an Agent identity")
		return
	}
	var request agentapi.AskAgentHerdrPaneJSONRequestBody
	if !a.decodeAgentRequest(c, &request) {
		return
	}
	question, ok := herdrQuestion(request)
	if !ok {
		a.writeAgentAPIError(c, http.StatusBadRequest, agentapi.AgentApiErrorCodeInvalidRequest, "Ask one question of at most 2000 characters with 1 to 20 distinct choices of at most 200 characters, about a pane and state from a herdr event")
		return
	}
	computerID, ownerID, err := a.agents.LocalComputerPlacement(ctx, auth.TenantID, auth.AgentActorID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && ownerID != auth.UserArtifactOwnerActorID {
		a.writeAgentAPIError(c, http.StatusConflict, agentapi.AgentApiErrorCodeOperationForbidden, "Only the AnotherMe of the Computer's owner, running on that Computer, can ask about its herdr agents")
		return
	}
	if err != nil || a.typedCards == nil {
		if err != nil {
			a.logger.Error("read herdr question placement", "error", err)
		}
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "Asking about herdr agents is temporarily unavailable")
		return
	}
	askable, err := a.proactive.HerdrAskable(ctx, proactive.Owner{TenantID: auth.TenantID, ActorID: ownerID}, computerID, request.PaneId, request.StateChangeSeq)
	if err != nil {
		a.logger.Error("read herdr pane state", "error", err)
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "Asking about herdr agents is temporarily unavailable")
		return
	}
	switch askable {
	case proactive.HerdrAskUnreported:
		a.writeAgentAPIError(c, http.StatusConflict, agentapi.AgentApiErrorCodeOperationForbidden, "The Computer did not report this herdr pane state; ask only about the pane and state of a herdr event")
		return
	case proactive.HerdrAskGated:
		a.writeAgentAPIError(c, http.StatusConflict, agentapi.AgentApiErrorCodeHerdrAskGated, "Not now: it is quiet hours or the Human has had today's reminders. Do not tell them; follow this pane state up later in a Tracking Item with its pane and state, and ask when that follow-up comes")
		return
	}
	roomID, err := a.humanConfirmationRoom(ctx, auth, ownerID)
	if err != nil || roomID == "" || auth.RoomID != "" && roomID != auth.RoomID {
		a.writeAgentAPIError(c, http.StatusForbidden, agentapi.AgentApiErrorCodeForbidden, "Ask about herdr agents in your chat with the Computer's owner")
		return
	}
	question.Herdr = &typedcard.HerdrAnswerTarget{ComputerID: computerID, PaneID: request.PaneId, StateChangeSeq: request.StateChangeSeq}
	// One card per pane state: asking again returns it.
	digest := sha256.Sum256([]byte(computerID + "\x00" + request.PaneId + "\x00" + strconv.FormatInt(request.StateChangeSeq, 10)))
	result, err := a.typedCards.CreateDecision(ctx, roomID, auth.AgentID, "herdr-question-"+hex.EncodeToString(digest[:16]), digest[:], typedcard.DecisionCommand{
		Principal: auth.Principal, DeciderActorID: ownerID, Question: &question,
	})
	switch {
	case errors.Is(err, typedcard.ErrAssigneeNotMember), errors.Is(err, typedcard.ErrForbidden), errors.Is(err, typedcard.ErrNotFound), errors.Is(err, typedcard.ErrInvalid):
		a.writeAgentAPIError(c, http.StatusForbidden, agentapi.AgentApiErrorCodeForbidden, "Question cards are unavailable in this chat")
		return
	case err != nil:
		a.logger.Error("create herdr question card", "error", err)
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "Asking about herdr agents is temporarily unavailable")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "asked", "computer_id": computerID, "room_id": roomID, "message_id": result.MessageID, "interaction_id": result.DecisionID})
}

// herdrQuestion is the card a herdr question asks: the coding agent's
// question with its choices, which the owner picks from or answers in their
// own words.
func herdrQuestion(request agentapi.AskAgentHerdrPaneJSONRequestBody) (typedcard.QuestionDecision, bool) {
	prompt := strings.TrimSpace(request.Question)
	if strings.TrimSpace(request.PaneId) == "" || utf8.RuneCountInString(request.PaneId) > 128 || request.StateChangeSeq < 0 ||
		prompt == "" || utf8.RuneCountInString(prompt) > 2000 || len(request.Options) == 0 || len(request.Options) > 20 {
		return typedcard.QuestionDecision{}, false
	}
	options := make([]typedcard.DecisionQuestionOption, 0, len(request.Options))
	seen := map[string]bool{}
	for index, label := range request.Options {
		label = strings.TrimSpace(label)
		if label == "" || utf8.RuneCountInString(label) > 200 || strings.ContainsFunc(label, unicode.IsControl) || seen[label] {
			return typedcard.QuestionDecision{}, false
		}
		seen[label] = true
		options = append(options, typedcard.DecisionQuestionOption{ID: "choice_" + strconv.Itoa(index+1), Label: label})
	}
	return typedcard.QuestionDecision{
		Prompt:    "A coding agent in herdr pane " + strings.TrimSpace(request.PaneId) + " waits for your answer",
		Questions: []typedcard.DecisionQuestion{{ID: "answer", Prompt: prompt, Input: "radio", Options: options}},
	}, true
}

// deliverHerdrAnswer types an owner's herdr answer into its pane through the
// Computer and classifies the result; TeamHub never retries it.
func (a *App) deliverHerdrAnswer(ctx context.Context, delivery typedcard.HerdrDelivery) string {
	tools, supported := a.localComputers.(roomagent.LocalComputerTools)
	if !supported {
		return typedcard.HerdrAnswerNotDelivered
	}
	_, err := tools.CallLocalComputerTool(ctx, api.LocalComputerToolCall{
		TenantId: delivery.TenantID, OwnerActorId: delivery.OwnerActorID, ComputerId: delivery.Target.ComputerID,
		AgentId: delivery.AgentManagementID, ToolSessionId: "herdr-answer", Server: api.Herdr, ToolName: "answer",
		Arguments: map[string]any{"pane_id": delivery.Target.PaneID, "state_change_seq": delivery.Target.StateChangeSeq, "text": delivery.Text},
	})
	var failure *roomagent.LocalComputerToolError
	switch {
	case err == nil:
		return typedcard.HerdrAnswerSent
	case !errors.As(err, &failure):
		a.logger.Error("deliver herdr answer", "error", err)
		return typedcard.HerdrAnswerOutcomeUnknown
	}
	switch failure.Code {
	case "pane_closed":
		return typedcard.HerdrAnswerPaneClosed
	case "pane_not_blocked":
		return typedcard.HerdrAnswerPaneNotBlocked
	case "invalid_answer":
		return typedcard.HerdrAnswerInvalid
	case "outcome_unknown":
		return typedcard.HerdrAnswerOutcomeUnknown
	default:
		// The Computer was offline, refused the call, or herdr is not running:
		// nothing was typed.
		return typedcard.HerdrAnswerNotDelivered
	}
}
