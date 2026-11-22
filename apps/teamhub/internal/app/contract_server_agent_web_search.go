package app

import (
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/typedcard"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/websearch"
	api "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
)

// webSearchAction is the business action every web search command runs as.
const webSearchAction = "web_search"

// authorizeWebSearch decodes a web search command and authorizes its Agent.
func (a *App) authorizeWebSearch(c *gin.Context, input any, optional bool) (string, bool) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return "", false
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10))
	if err != nil || !(optional && len(body) == 0) && decodeStrictJSONBytes(body, input) != nil {
		a.writeAgentAPIError(c, http.StatusBadRequest, api.AgentApiErrorCodeInvalidInput, "Invalid web search request")
		return "", false
	}
	_, err = a.agentAuth.Authorize(c.Request.Context(), token, webSearchAction)
	if a.writeAgentAuthError(c, "authorize web search", err) {
		return "", false
	}
	c.Header("Cache-Control", "no-store")
	return token, true
}

func (a *App) searchAgentWeb(c *gin.Context) {
	var input api.WebSearchRequest
	token, ok := a.authorizeWebSearch(c, &input, false)
	if !ok {
		return
	}
	request := websearch.Request{Command: websearch.CommandSearch, Query: input.Query}
	if input.Backend != nil {
		request.Backend = websearch.Backend(*input.Backend)
	}
	if input.Limit != nil {
		// Normalize reads 0 as "use the default"; an explicit 0 is out of range.
		request.Limit = *input.Limit
		if request.Limit == 0 {
			request.Limit = -1
		}
	}
	if input.Recency != nil {
		request.Recency = string(*input.Recency)
	}
	if input.Sites != nil {
		request.Sites = *input.Sites
	}
	a.runAgentWebRequest(c, token, request)
}

func (a *App) openAgentWebPage(c *gin.Context) {
	var input api.WebOpenRequest
	token, ok := a.authorizeWebSearch(c, &input, false)
	if !ok {
		return
	}
	a.runAgentWebRequest(c, token, websearch.Request{Command: websearch.CommandOpen, Backend: websearch.Backend(input.Backend), URL: input.Url})
}

// runAgentWebRequest runs one search or page open. A missing or refused key,
// or the end of the keyless trial, posts (or reuses) the card asking the
// Agent's Human for a key, storing the request so a key added from the card
// replays it.
func (a *App) runAgentWebRequest(c *gin.Context, token string, request websearch.Request) {
	request, err := websearch.Normalize(request)
	if err != nil {
		a.writeAgentAPIError(c, http.StatusBadRequest, api.AgentApiErrorCodeInvalidInput, "Invalid web search request")
		return
	}
	outcome, err := a.webSearch.Run(c.Request.Context(), request)
	var failure *websearch.Failure
	switch {
	case err == nil && outcome.Page != nil:
		c.JSON(http.StatusOK, outcome.Page)
	case err == nil:
		results := outcome.Results
		if results == nil {
			results = []websearch.Result{}
		}
		c.JSON(http.StatusOK, gin.H{"results": results})
	case !errors.As(err, &failure):
		a.logger.Error("web_search.request_failed", "request_id", c.GetString("request_id"), "error_type", fmt.Sprintf("%T", err))
		a.writeAgentAPIError(c, http.StatusInternalServerError, api.AgentApiErrorCodeInternalError, "Web search could not complete the request")
	case failure.KeyFailure():
		a.requestSearchKey(c, token, failure, &request)
	default:
		code, status := webSearchFailureStatus(failure)
		details := &api.AgentApiErrorDetails{Backend: stringRef(string(failure.Backend))}
		if failure.Code == websearch.CodeQuotaExhausted || failure.Code == websearch.CodeRateLimited {
			ready := make([]string, len(failure.Ready))
			for i, b := range failure.Ready {
				ready[i] = string(b)
			}
			details.ReadyBackends = &ready
		}
		if seconds := int(failure.RetryAfter.Seconds()); seconds > 0 {
			details.RetryAfterSeconds = &seconds
		}
		a.writeAgentAPIErrorWithDetails(c, status, code, webSearchFailureMessage(failure), details)
	}
}

// webSearchFailureStatus maps a call that failed other than on its key to
// the agent error code and HTTP status.
func webSearchFailureStatus(failure *websearch.Failure) (api.AgentApiErrorCode, int) {
	switch failure.Code {
	case websearch.CodeQuotaExhausted:
		return api.AgentApiErrorCodeSearchQuotaExhausted, http.StatusPaymentRequired
	case websearch.CodeRateLimited:
		return api.AgentApiErrorCodeProviderRateLimited, http.StatusTooManyRequests
	case websearch.CodeUnsupported:
		return api.AgentApiErrorCodeInvalidInput, http.StatusBadRequest
	case websearch.CodePageUnreadable:
		return api.AgentApiErrorCodeToolExecutionFailed, http.StatusUnprocessableEntity
	default:
		return api.AgentApiErrorCodeDependencyUnavailable, http.StatusServiceUnavailable
	}
}

func webSearchFailureMessage(failure *websearch.Failure) string {
	name := websearch.DisplayName(failure.Backend)
	switch failure.Code {
	case websearch.CodeQuotaExhausted:
		return fmt.Sprintf("The %s account has no credit or quota left. Try another ready backend, or tell the user.", name)
	case websearch.CodeRateLimited:
		return fmt.Sprintf("%s is rate limiting web search. Wait and retry, or use another ready backend.", name)
	case websearch.CodeUnsupported:
		return fmt.Sprintf("%s cannot run this command with these filters; run teamhub web list to see what each backend supports.", name)
	case websearch.CodePageUnreadable:
		return fmt.Sprintf("%s could not read this page. Try --backend direct or another backend.", name)
	default:
		return fmt.Sprintf("%s could not be reached. Try again later or use another ready backend.", name)
	}
}

// searchKeyReasons names a key failure on the card.
var searchKeyReasons = map[websearch.Code]string{
	websearch.CodeKeyRequired: "missing", websearch.CodeKeyRejected: "rejected", websearch.CodeFreeLimit: "free_limit",
}

// postSearchKeyCard posts, or reuses, the card asking the Agent's Human for a
// web search key. request is the call to replay once a key is added from the
// card; nil for a connect request. It writes the error response itself when
// no card could be posted.
func (a *App) postSearchKeyCard(c *gin.Context, token string, failure *websearch.Failure, request *websearch.Request) (string, typedcard.CreateResult, bool) {
	decision := &typedcard.SearchKeyDecision{
		Prompt: searchKeyPrompt(failure), Backend: string(failure.Backend), Suggested: failure.Suggested, Reason: searchKeyReasons[failure.Code],
	}
	if request != nil {
		decision.Request = &typedcard.SearchKeyRequest{
			Command: request.Command, Backend: string(request.Backend), Query: request.Query, Limit: request.Limit,
			Recency: request.Recency, Sites: request.Sites, URL: request.URL,
		}
	}
	return a.postConnectorCard(c, token, webSearchAction, decision.Prompt, typedcard.DecisionCommand{SearchKey: decision})
}

// requestSearchKey posts the key card for a failed call and answers
// search_key_requested with the card and the backend it shows.
func (a *App) requestSearchKey(c *gin.Context, token string, failure *websearch.Failure, request *websearch.Request) {
	roomID, card, ok := a.postSearchKeyCard(c, token, failure, request)
	if !ok {
		return
	}
	origin := api.AgentApiErrorDetailsOrigin("requested")
	if failure.Suggested {
		origin = "suggested"
	}
	detailReason := api.AgentApiErrorDetailsReason(searchKeyReasons[failure.Code])
	a.writeAgentAPIErrorWithDetails(c, http.StatusConflict, api.AgentApiErrorCodeSearchKeyRequested, searchKeyRequestedMessage(failure),
		&api.AgentApiErrorDetails{
			Backend: stringRef(string(failure.Backend)), Origin: &origin, Reason: &detailReason,
			RoomId: &roomID, MessageId: &card.MessageID, InteractionId: &card.DecisionID,
		})
}

// searchKeyRequestedMessage tells the Agent to wait for the card: a key saved
// from it replays the call and wakes the Agent with its results.
func searchKeyRequestedMessage(failure *websearch.Failure) string {
	name := websearch.DisplayName(failure.Backend)
	wait := "a card asking for it is in the chat. End your turn: the card's result wakes you with the results or what to run next. If the user declines, don't retry."
	switch failure.Code {
	case websearch.CodeFreeLimit:
		return "The free web search trial is used up. Waiting for the user to add a web search API key; " + wait
	case websearch.CodeKeyRejected:
		return fmt.Sprintf("Waiting for the user to replace the %s API key, which %s no longer accepts; %s", name, name, wait)
	default:
		return fmt.Sprintf("Waiting for the user to add a %s API key; %s", name, wait)
	}
}

// searchKeyPrompt is the Human-facing ask on the card.
func searchKeyPrompt(failure *websearch.Failure) string {
	name := websearch.DisplayName(failure.Backend)
	switch {
	case failure.Code == websearch.CodeFreeLimit && failure.Suggested:
		return fmt.Sprintf("The free web search trial is used up. Please add a web search API key so I can keep searching; %s is suggested.", name)
	case failure.Code == websearch.CodeFreeLimit:
		return fmt.Sprintf("The free %s trial is used up. Please add a %s API key so I can keep searching.", name, name)
	case failure.Code == websearch.CodeKeyRejected:
		return fmt.Sprintf("%s refused the saved API key. Please add a new key so I can search the web.", name)
	default:
		return fmt.Sprintf("Please add a %s API key so I can search the web.", name)
	}
}

func (a *App) listAgentWebBackends(c *gin.Context) {
	var input api.WebBackendsQuery
	if _, ok := a.authorizeWebSearch(c, &input, true); !ok {
		return
	}
	list, err := a.webSearch.List(c.Request.Context(), true)
	if err != nil {
		a.logger.Error("web_search.list_failed", "request_id", c.GetString("request_id"), "error_type", fmt.Sprintf("%T", err))
		a.writeAgentAPIError(c, http.StatusInternalServerError, api.AgentApiErrorCodeInternalError, "Web search backends could not be listed")
		return
	}
	if input.Backend != nil {
		kept := []websearch.BackendView{}
		for _, view := range list.Backends {
			if string(view.ID) == string(*input.Backend) {
				kept = append(kept, view)
			}
		}
		if len(kept) == 0 {
			a.writeAgentAPIError(c, http.StatusBadRequest, api.AgentApiErrorCodeInvalidInput, "Unknown web search backend")
			return
		}
		list.Backends = kept
	}
	c.JSON(http.StatusOK, list)
}

// connectAgentWebBackend answers ready for a backend that can run now, and
// otherwise posts the card asking the Human for its key.
func (a *App) connectAgentWebBackend(c *gin.Context) {
	var input api.WebConnectRequest
	token, ok := a.authorizeWebSearch(c, &input, false)
	if !ok {
		return
	}
	backend := websearch.Backend(input.Backend)
	if !websearch.KeyBackend(backend) {
		a.writeAgentAPIError(c, http.StatusBadRequest, api.AgentApiErrorCodeInvalidInput, "Unknown web search backend")
		return
	}
	view, err := a.webSearch.Backend(c.Request.Context(), backend)
	if err != nil {
		a.logger.Error("web_search.connect_failed", "request_id", c.GetString("request_id"), "error_type", fmt.Sprintf("%T", err))
		a.writeAgentAPIError(c, http.StatusInternalServerError, api.AgentApiErrorCodeInternalError, "Web search could not complete the request")
		return
	}
	if view.Status == "ready" {
		c.JSON(http.StatusOK, gin.H{"status": "ready", "backend": view})
		return
	}
	failure := &websearch.Failure{Code: websearch.CodeKeyRequired, Backend: backend}
	if view.Status == "key_rejected" {
		failure.Code = websearch.CodeKeyRejected
	}
	if roomID, card, ok := a.postSearchKeyCard(c, token, failure, nil); ok {
		c.JSON(http.StatusOK, gin.H{"status": "connection_requested", "room_id": roomID, "message_id": card.MessageID, "interaction_id": card.DecisionID})
	}
}

func stringRef(value string) *string { return &value }
