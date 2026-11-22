package app

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/config"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/typedcard"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/websearch"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

// maxReplayResultBytes bounds the replayed search results a key card hands
// its Agent; results past it are dropped from the end.
const maxReplayResultBytes = 24000

// registerWebSearch builds web search over the keys saved in the product,
// sealed with TEAMHUB_SECRET_ENCRYPTION_KEY. Without that key nothing can be
// saved and only DuckDuckGo, You.com without a key and direct work.
func (a *App) registerWebSearch(cfg config.Config, deps Deps) error {
	box, err := secretBox(cfg.ExternalApps.SecretEncryptionKey)
	if err != nil {
		return err
	}
	a.webSearch = websearch.New(a.queries, box, deps.WebSearch, a.logger)
	return nil
}

func (a *App) listWebSearchBackends(c *gin.Context) {
	params := contractParams[httpapi.ListWebSearchBackendsParams](c)
	list, err := a.webSearch.List(c.Request.Context(), params.IncludeQuota == nil || *params.IncludeQuota)
	if err != nil {
		a.internalError(c, "list web search backends", err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, list)
}

// saveWebSearchKey saves one backend's key. From a search_key card it first
// replays the request the card was posted for with the new key, so the
// provider proves the key on the call the Agent wanted and the Agent hears
// its results. Any signed-in Human may save a key; it is never echoed or
// logged.
func (a *App) saveWebSearchKey(c *gin.Context) {
	backend := websearch.Backend(c.Param("backend"))
	var request httpapi.SaveWebSearchKeyRequest
	if !websearch.KeyBackend(backend) || decodeJSON(c, &request) != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Web search key request is invalid")
		return
	}
	ctx := c.Request.Context()
	var replayed *typedcard.SearchKeyReplay
	var view websearch.BackendView
	var err error
	card := typedcard.SearchKeyCard{}
	if request.DecisionId != nil {
		card, err = a.typedCards.SearchKeyCardRequest(ctx, currentPrincipal(c).Session.AccountID, *request.DecisionId)
		switch {
		case errors.Is(err, typedcard.ErrNotFound):
			a.writeError(c, http.StatusNotFound, "NOT_FOUND", "The card was not found")
			return
		case errors.Is(err, typedcard.ErrForbidden):
			a.writeError(c, http.StatusForbidden, "FORBIDDEN", "Only the card's decision owner can add a key from it")
			return
		case errors.Is(err, typedcard.ErrInvalid):
			a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "The card does not ask for a web search key")
			return
		case err != nil:
			a.internalError(c, "read web search key card", err)
			return
		}
	}
	if card.Open && card.Request != nil {
		var replay websearch.Replay
		replay, err = a.webSearch.SaveReplayed(ctx, backend, request.ApiKey, webSearchRequestFromCard(*card.Request))
		if err == nil {
			view = replay.View
			replayed = searchKeyReplay(*request.DecisionId, replay)
		}
	} else {
		view, err = a.webSearch.SaveKey(ctx, backend, request.ApiKey)
	}
	switch {
	case errors.Is(err, websearch.ErrInvalid):
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Web search API key is invalid")
	case errors.Is(err, websearch.ErrKeyRejected):
		a.writeError(c, http.StatusBadRequest, "WEB_SEARCH_KEY_REJECTED", "The provider rejected this API key")
	case errors.Is(err, websearch.ErrStorageMissing):
		a.writeError(c, http.StatusServiceUnavailable, "WEB_SEARCH_KEY_STORAGE_UNAVAILABLE", "This deployment cannot store a web search API key")
	case errors.Is(err, websearch.ErrProviderUnavailable):
		a.writeError(c, http.StatusServiceUnavailable, "WEB_SEARCH_PROVIDER_UNAVAILABLE", "The provider could not be reached; try again")
	case err != nil:
		a.internalError(c, "save web search key", err)
	default:
		// The waiting Agents can search now. A failure leaves those cards for
		// the user to decline; it never fails the save.
		if err := a.typedCards.SettleSearchKeys(ctx, string(backend), replayed); err != nil {
			a.logger.Error("web_search.settle_cards_failed", "backend", string(backend), "error", err)
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, view)
	}
}

func webSearchRequestFromCard(stored typedcard.SearchKeyRequest) websearch.Request {
	return websearch.Request{
		Command: stored.Command, Backend: websearch.Backend(stored.Backend), Query: stored.Query, Limit: stored.Limit,
		Recency: stored.Recency, Sites: stored.Sites, URL: stored.URL,
	}
}

// searchKeyReplay is what the card the key was added from hands its Agent:
// the results, the page, or the agent error code of the failed call.
func searchKeyReplay(decisionID string, replay websearch.Replay) *typedcard.SearchKeyReplay {
	result := &typedcard.SearchKeyReplay{DecisionID: decisionID}
	switch {
	case replay.Failure != nil:
		code, _ := webSearchFailureStatus(replay.Failure)
		result.ErrorCode = string(code)
	case replay.Outcome.Page != nil:
		result.Page, _ = json.Marshal(replay.Outcome.Page)
	default:
		results := replay.Outcome.Results
		if results == nil {
			results = []websearch.Result{}
		}
		for {
			encoded, _ := json.Marshal(results)
			if len(encoded) <= maxReplayResultBytes || len(results) == 0 {
				result.Results = encoded
				break
			}
			results = results[:len(results)-1]
		}
	}
	return result
}

func (a *App) deleteWebSearchKey(c *gin.Context) {
	backend := websearch.Backend(c.Param("backend"))
	if !websearch.KeyBackend(backend) {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Web search backend is invalid")
		return
	}
	if err := a.webSearch.RemoveKey(c.Request.Context(), backend); err != nil {
		a.internalError(c, "remove web search key", err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (a *App) setWebSearchDefault(c *gin.Context) {
	var request httpapi.SetWebSearchDefaultRequest
	if decodeJSON(c, &request) != nil || !websearch.SearchBackend(websearch.Backend(request.Backend)) {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Web search default request is invalid")
		return
	}
	chosen, err := a.webSearch.SetDefault(c.Request.Context(), websearch.Backend(request.Backend))
	switch {
	case errors.Is(err, websearch.ErrNotReady):
		a.writeError(c, http.StatusConflict, "WEB_SEARCH_KEY_REQUIRED", "Add a working key for this backend first")
	case err != nil:
		a.internalError(c, "set web search default", err)
	default:
		c.JSON(http.StatusOK, chosen)
	}
}

func (a *App) clearWebSearchDefault(c *gin.Context) {
	chosen, err := a.webSearch.ClearDefault(c.Request.Context())
	if err != nil {
		a.internalError(c, "clear web search default", err)
		return
	}
	c.JSON(http.StatusOK, chosen)
}
