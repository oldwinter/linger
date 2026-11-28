package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/ids"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/proactive"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomagent"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/typedcard"
	api "github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
	agentapi "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
	"github.com/simplexai-labs/linger/contracts-go/teamhubinternal"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

const (
	herdrCoreAttachDomain      = "herdr-core-attach-v1"
	herdrCoreAttachTokenTTL    = 60 * time.Second
	herdrCoreAttachWSPath      = "/v1/herdr-core/attach"
	herdrCoreMaxPutBodyBytes   = 16 << 20
	herdrCoreOpCacheTTL        = 15 * time.Minute
	herdrCoreOpCacheMaxEntries = 1024
)

// HerdrCoreAttachTokenClaims matches Node Services' verified attach token shape.
type HerdrCoreAttachTokenClaims struct {
	V            int    `json:"v"`
	SessionID    string `json:"session_id"`
	ComputerID   string `json:"computer_id"`
	TenantID     string `json:"tenant_id"`
	OwnerActorID string `json:"owner_actor_id"`
	Address      string `json:"address"`
	Cols         int    `json:"cols"`
	Rows         int    `json:"rows"`
	Observe      bool   `json:"observe"`
	History      int    `json:"history"`
	Resumed      bool   `json:"resumed,omitempty"`
	Exp          int64  `json:"exp"`
}

// SignHerdrCoreAttachToken signs short-lived attach claims using HMAC-SHA256 in
// the exact base64url wire format verified by Node Services runner-herdr-core-stream.
func SignHerdrCoreAttachToken(claims HerdrCoreAttachTokenClaims, signingKey string) (string, error) {
	if signingKey == "" {
		return "", errors.New("attach token signing key is required")
	}
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	mac := hmac.New(sha256.New, []byte(signingKey))
	mac.Write([]byte(herdrCoreAttachDomain + "\n" + payload))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return payload + "." + signature, nil
}

type herdrCoreOpEntry struct {
	hash      [32]byte
	response  agentapi.AgentHerdrCoreCallResponse
	expiresAt time.Time
}

type herdrCoreOpCache struct {
	mu      sync.Mutex
	entries map[string]herdrCoreOpEntry
}

func newHerdrCoreOpCache() *herdrCoreOpCache {
	return &herdrCoreOpCache{entries: map[string]herdrCoreOpEntry{}}
}

func (c *herdrCoreOpCache) lookup(key string, hash [32]byte, now time.Time) (agentapi.AgentHerdrCoreCallResponse, bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return agentapi.AgentHerdrCoreCallResponse{}, false, false
	}
	if !now.Before(entry.expiresAt) {
		delete(c.entries, key)
		return agentapi.AgentHerdrCoreCallResponse{}, false, false
	}
	if entry.hash != hash {
		return agentapi.AgentHerdrCoreCallResponse{}, true, true
	}
	return entry.response, true, false
}

func (c *herdrCoreOpCache) store(key string, hash [32]byte, response agentapi.AgentHerdrCoreCallResponse, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= herdrCoreOpCacheMaxEntries {
		for existingKey, existing := range c.entries {
			if !now.Before(existing.expiresAt) {
				delete(c.entries, existingKey)
			}
		}
		if len(c.entries) >= herdrCoreOpCacheMaxEntries {
			for existingKey := range c.entries {
				delete(c.entries, existingKey)
				break
			}
		}
	}
	c.entries[key] = herdrCoreOpEntry{
		hash:      hash,
		response:  response,
		expiresAt: now.Add(herdrCoreOpCacheTTL),
	}
}

func (a *App) herdrCoreOpCache() *herdrCoreOpCache {
	if a.herdrCoreOps == nil {
		a.herdrCoreOps = newHerdrCoreOpCache()
	}
	return a.herdrCoreOps
}

// reportLocalComputerHerdrCoreEvent accepts a runner.herdr_core_event forwarded
// by Node Services, broadcasts a real-time herdr-core SSE invalidation hint for
// the Computer's Tenant, and queues proactive judgment for agent transitions.
func (a *App) reportLocalComputerHerdrCoreEvent(c *gin.Context) {
	var request teamhubinternal.HerdrCoreEventReport
	if err := decodeJSON(c, &request); err != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "herdr-core event is invalid")
		return
	}
	err := a.proactive.EnqueueHerdrCoreEvent(c.Request.Context(), herdrCoreReportFromRequest(request))
	switch {
	case err == nil:
		c.Status(http.StatusAccepted)
	case errors.Is(err, proactive.ErrInvalidEvent):
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "herdr-core event is invalid")
	case errors.Is(err, proactive.ErrUnknownComputer):
		a.writeError(c, http.StatusNotFound, "LOCAL_COMPUTER_NOT_FOUND", "Local Computer was not found")
	default:
		a.internalError(c, "queue herdr-core event", err)
	}
}

func herdrCoreReportFromRequest(request teamhubinternal.HerdrCoreEventReport) proactive.HerdrCoreReport {
	optionalString := func(value *string) string {
		if value == nil {
			return ""
		}
		return *value
	}
	var status *proactive.HerdrCoreStatus
	if request.Status != nil {
		var progress *float64
		if request.Status.Progress != nil {
			value := float64(*request.Status.Progress)
			progress = &value
		}
		status = &proactive.HerdrCoreStatus{
			State:    string(request.Status.State),
			Kind:     optionalString(request.Status.Kind),
			App:      optionalString(request.Status.App),
			Msg:      optionalString(request.Status.Msg),
			Progress: progress,
			Title:    optionalString(request.Status.Title),
		}
	}
	var labels map[string]string
	if request.Labels != nil {
		labels = *request.Labels
	}
	return proactive.HerdrCoreReport{
		ComputerID: request.ComputerId,
		Kind:       string(request.Kind),
		Address:    request.Address,
		Machine:    optionalString(request.Machine),
		Turn:       request.Turn,
		StatusMs:   request.StatusMs,
		Status:     status,
		Name:       optionalString(request.Name),
		Cwd:        optionalString(request.Cwd),
		Title:      optionalString(request.Title),
		Template:   optionalString(request.Template),
		Parent:     optionalString(request.Parent),
		Labels:     labels,
		Tail:       optionalString(request.Tail),
	}
}

// herdrCoreComputerOwner authenticates the signed-in owner against computerId
// and confirms the Computer belongs to their Tenant and Actor.
func (a *App) herdrCoreComputerOwner(c *gin.Context) (tenantID, ownerActorID, computerID string, ok bool) {
	computerID = strings.TrimSpace(c.Param("computerId"))
	if computerID == "" {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "computerId is required")
		return "", "", "", false
	}
	p := currentPrincipal(c)
	tenantID, ownerActorID = p.Session.HumanTenantID, p.Session.HumanActorID
	if tenantID == "" || ownerActorID == "" {
		a.writeError(c, http.StatusUnauthorized, "UNAUTHENTICATED", "Active session is required")
		return "", "", "", false
	}
	if a.agentRuntimeState == nil {
		a.writeError(c, http.StatusServiceUnavailable, "HERDR_CORE_UNAVAILABLE", "Local Computers are unavailable")
		return "", "", "", false
	}
	computer, err := a.agentRuntimeState.GetLocalComputer(c.Request.Context(), computerID)
	switch {
	case errors.Is(err, agentruntimestate.ErrNotFound), errors.Is(err, agentruntimestate.ErrInvalid),
		err == nil && computer.Owner.TenantID != tenantID:
		a.writeError(c, http.StatusNotFound, "LOCAL_COMPUTER_NOT_FOUND", "Local Computer was not found")
		return "", "", "", false
	case err != nil:
		a.internalError(c, "read Local Computer for herdr-core", err)
		return "", "", "", false
	}
	if computer.Owner.OwnerActorID != ownerActorID {
		a.writeError(c, http.StatusForbidden, "FORBIDDEN", "Only the Computer's owner can access herdr-core")
		return "", "", "", false
	}
	if !localComputerOnline(computer.Status, computer.LastSeenAt, time.Now()) {
		a.writeError(c, http.StatusConflict, "LOCAL_COMPUTER_OFFLINE", "Local Computer is offline")
		return "", "", "", false
	}
	return tenantID, ownerActorID, computerID, true
}

func (a *App) callOwnerHerdrCore(
	c *gin.Context,
	toolName string,
	args map[string]any,
	deadlineMs int,
) (map[string]any, bool) {
	tenantID, ownerActorID, computerID, ok := a.herdrCoreComputerOwner(c)
	if !ok {
		return nil, false
	}
	caller, supported := a.localComputers.(roomagent.LocalComputerHerdrCore)
	if !supported || caller == nil {
		a.writeError(c, http.StatusServiceUnavailable, "HERDR_CORE_UNAVAILABLE", "herdr-core gateway is unavailable")
		return nil, false
	}
	result, err := caller.CallLocalComputerHerdrCore(c.Request.Context(), roomagent.LocalComputerHerdrCoreCall{
		TenantID:     tenantID,
		OwnerActorID: ownerActorID,
		ComputerID:   computerID,
		ToolName:     toolName,
		Arguments:    args,
		DeadlineMs:   deadlineMs,
	})
	if err != nil {
		a.writeHerdrCoreGatewayError(c, "herdr-core "+toolName, err)
		return nil, false
	}
	return result, true
}

func (a *App) writeHerdrCoreGatewayError(c *gin.Context, operation string, err error) {
	var toolErr *roomagent.LocalComputerToolError
	switch {
	case errors.Is(err, roomagent.ErrLocalComputerNotFound):
		a.writeError(c, http.StatusNotFound, "LOCAL_COMPUTER_NOT_FOUND", "Local Computer was not found")
	case errors.Is(err, roomagent.ErrLocalComputerOffline):
		a.writeError(c, http.StatusConflict, "LOCAL_COMPUTER_OFFLINE", "Local Computer is offline")
	case errors.Is(err, roomagent.ErrHerdrCoreUnsupported):
		a.writeError(c, http.StatusConflict, "HERDR_CORE_UNSUPPORTED", "Local Computer does not support herdr-core")
	case errors.Is(err, roomagent.ErrHerdrCoreTimeout):
		a.writeError(c, http.StatusGatewayTimeout, "HERDR_CORE_TIMEOUT", "Local Computer did not confirm the herdr-core request in time")
	case errors.As(err, &toolErr):
		switch toolErr.Code {
		case "not_found", "terminal_not_found", "doc_not_found":
			a.writeError(c, http.StatusNotFound, "HERDR_CORE_NOT_FOUND", toolErr.Message)
		case "invalid_request", "invalid_arguments":
			a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", toolErr.Message)
		case "version_conflict", "conflict", "terminal_not_blocked", "terminal_closed", "busy":
			a.writeError(c, http.StatusConflict, "HERDR_CORE_CONFLICT", toolErr.Message)
		case "outcome_unknown":
			a.writeError(c, http.StatusGatewayTimeout, "HERDR_CORE_TIMEOUT", toolErr.Message)
		case "unavailable", "herdr_core_unavailable", "computer_unavailable":
			a.writeError(c, http.StatusServiceUnavailable, "HERDR_CORE_UNAVAILABLE", toolErr.Message)
		default:
			a.writeError(c, http.StatusBadGateway, "HERDR_CORE_ERROR", toolErr.Message)
		}
	default:
		a.logger.Error(operation, "error", err)
		a.writeError(c, http.StatusServiceUnavailable, "HERDR_CORE_UNAVAILABLE", "herdr-core is temporarily unavailable")
	}
}

func writeHerdrCoreJSON(c *gin.Context, status int, payload any) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, payload)
}

func (a *App) getHerdrCoreStatus(c *gin.Context) {
	result, ok := a.callOwnerHerdrCore(c, "status", map[string]any{}, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) listHerdrCoreTerminals(c *gin.Context) {
	var params httpapi.ListHerdrCoreTerminalsParams
	if err := c.ShouldBindQuery(&params); err != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Invalid terminal list query parameters")
		return
	}
	args := map[string]any{"all": params.All != nil && *params.All}
	if params.Machine != nil && strings.TrimSpace(*params.Machine) != "" {
		args["machine"] = strings.TrimSpace(*params.Machine)
	}
	if params.RoomId != nil && strings.TrimSpace(*params.RoomId) != "" {
		args["room_id"] = strings.TrimSpace(*params.RoomId)
	}
	if params.WorkItemId != nil && strings.TrimSpace(*params.WorkItemId) != "" {
		args["work_item_id"] = strings.TrimSpace(*params.WorkItemId)
	}
	if params.Status != nil && strings.TrimSpace(*params.Status) != "" {
		args["status"] = strings.TrimSpace(*params.Status)
	}
	result, ok := a.callOwnerHerdrCore(c, "list", args, 0)
	if !ok {
		return
	}
	filtered := filterHerdrCoreTerminalsResult(result, params)
	writeHerdrCoreJSON(c, http.StatusOK, filtered)
}

// filterHerdrCoreTerminalsResult ensures machine, room_id, work_item_id, and
// status filters are consistently honored even when the Daemon returns a wider
// terminal list.
func filterHerdrCoreTerminalsResult(result map[string]any, params httpapi.ListHerdrCoreTerminalsParams) map[string]any {
	rawTerminals, hasTerminals := result["terminals"].([]any)
	if !hasTerminals {
		return result
	}
	machineFilter := ""
	if params.Machine != nil {
		machineFilter = strings.TrimSpace(*params.Machine)
	}
	roomFilter := ""
	if params.RoomId != nil {
		roomFilter = strings.TrimSpace(*params.RoomId)
	}
	workItemFilter := ""
	if params.WorkItemId != nil {
		workItemFilter = strings.TrimSpace(*params.WorkItemId)
	}
	statusFilter := ""
	if params.Status != nil {
		statusFilter = strings.TrimSpace(*params.Status)
	}
	if machineFilter == "" && roomFilter == "" && workItemFilter == "" && statusFilter == "" {
		return result
	}
	kept := make([]any, 0, len(rawTerminals))
	for _, item := range rawTerminals {
		terminal, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if machineFilter != "" {
			machine, _ := terminal["machine"].(string)
			if strings.EqualFold(machineFilter, "local") {
				if machine != "" && !strings.EqualFold(machine, "local") {
					continue
				}
			} else if machine != machineFilter {
				continue
			}
		}
		labels, _ := terminal["labels"].(map[string]any)
		if roomFilter != "" {
			roomVal, _ := labels[proactive.HerdrCoreLabelRoom].(string)
			if roomVal != roomFilter {
				continue
			}
		}
		if workItemFilter != "" {
			wiVal, _ := labels[proactive.HerdrCoreLabelWorkItem].(string)
			if wiVal != workItemFilter {
				continue
			}
		}
		if statusFilter != "" {
			statusObj, _ := terminal["status"].(map[string]any)
			stateStr, _ := statusObj["state"].(string)
			termState, _ := terminal["state"].(string)
			if !strings.EqualFold(stateStr, statusFilter) && !strings.EqualFold(termState, statusFilter) {
				continue
			}
		}
		kept = append(kept, terminal)
	}
	out := make(map[string]any, len(result))
	for k, v := range result {
		out[k] = v
	}
	out["terminals"] = kept
	return out
}

func (a *App) getHerdrCoreTerminal(c *gin.Context) {
	var params httpapi.GetHerdrCoreTerminalParams
	if err := c.ShouldBindQuery(&params); err != nil || strings.TrimSpace(params.Address) == "" {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address query parameter is required")
		return
	}
	result, ok := a.callOwnerHerdrCore(c, "get", map[string]any{"address": strings.TrimSpace(params.Address)}, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) readHerdrCoreTerminal(c *gin.Context) {
	var params httpapi.ReadHerdrCoreTerminalParams
	if err := c.ShouldBindQuery(&params); err != nil || strings.TrimSpace(params.Address) == "" {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address query parameter is required")
		return
	}
	lines := 120
	if params.Lines != nil {
		if *params.Lines < 1 || *params.Lines > 5000 {
			a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "lines must be between 1 and 5000")
			return
		}
		lines = *params.Lines
	}
	result, ok := a.callOwnerHerdrCore(c, "read", map[string]any{
		"address": strings.TrimSpace(params.Address),
		"lines":   lines,
	}, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) createHerdrCoreTerminal(c *gin.Context) {
	var request httpapi.HerdrCoreCreateTerminalRequest
	if err := decodeJSON(c, &request); err != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Invalid terminal create request")
		return
	}
	args := map[string]any{}
	if request.Argv != nil {
		args["argv"] = *request.Argv
	}
	if request.Line != nil {
		args["line"] = *request.Line
	}
	if request.Template != nil {
		args["template"] = *request.Template
	}
	if request.Task != nil {
		args["task"] = *request.Task
	}
	if request.Name != nil {
		args["name"] = *request.Name
	}
	if request.Cwd != nil {
		args["cwd"] = *request.Cwd
	}
	if request.On != nil {
		args["on"] = *request.On
	}
	if request.Keep != nil {
		args["keep"] = *request.Keep
	}
	if request.Labels != nil {
		args["labels"] = *request.Labels
	}
	if request.Parent != nil {
		args["parent"] = *request.Parent
	}
	if request.Rm != nil {
		args["rm"] = *request.Rm
	}
	if request.NoNotify != nil {
		args["no_notify"] = *request.NoNotify
	}
	if request.Size != nil {
		args["size"] = request.Size
	}
	result, ok := a.callOwnerHerdrCore(c, "run", args, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusCreated, result)
}

func buildHerdrCoreSendArgs(request httpapi.HerdrCoreTerminalSendRequest) (map[string]any, int, string) {
	address := strings.TrimSpace(request.Address)
	if address == "" {
		return nil, 0, "address and text are required"
	}
	args := map[string]any{
		"address": address,
		"text":    request.Text,
	}
	if request.If != nil {
		if !request.If.Valid() {
			return nil, 0, "if must be one of idle, working, or blocked"
		}
		// herdr-core v0.1.21 terminal.send accepts only "idle" and "working" in
		// its own "if" parameter; passing "blocked" here routes to the Daemon,
		// which performs terminal.get CAS (live + blocked + optional turn) and
		// invokes terminal.send with force=true and no "if" field.
		args["if"] = string(*request.If)
	}
	if request.Turn != nil {
		if *request.Turn < 0 {
			return nil, 0, "turn must be non-negative"
		}
		args["turn"] = *request.Turn
	}
	if request.Force != nil {
		args["force"] = *request.Force
	}
	if request.Wait != nil {
		args["wait"] = *request.Wait
	}
	deadlineMs := 0
	if request.Timeout != nil {
		if *request.Timeout < 0 || *request.Timeout > 120_000 {
			return nil, 0, "timeout must be between 0 and 120000"
		}
		args["timeout"] = *request.Timeout
		if *request.Timeout >= 1000 {
			deadlineMs = *request.Timeout
		}
	}
	return args, deadlineMs, ""
}

func (a *App) sendHerdrCoreTerminalText(c *gin.Context) {
	var request httpapi.HerdrCoreTerminalSendRequest
	if err := decodeJSON(c, &request); err != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address and text are required")
		return
	}
	args, deadlineMs, invalidReason := buildHerdrCoreSendArgs(request)
	if invalidReason != "" {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", invalidReason)
		return
	}
	result, ok := a.callOwnerHerdrCore(c, "send", args, deadlineMs)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) sendHerdrCoreTerminalKeys(c *gin.Context) {
	var request httpapi.HerdrCoreTerminalKeysRequest
	if err := decodeJSON(c, &request); err != nil || strings.TrimSpace(request.Address) == "" || len(request.Keys) == 0 || len(request.Keys) > 128 {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address and 1 to 128 keys are required")
		return
	}
	result, ok := a.callOwnerHerdrCore(c, "keys", map[string]any{
		"address": strings.TrimSpace(request.Address),
		"keys":    request.Keys,
	}, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) interruptHerdrCoreTerminal(c *gin.Context) {
	var request httpapi.HerdrCoreTerminalInterruptRequest
	if err := decodeJSON(c, &request); err != nil || strings.TrimSpace(request.Address) == "" {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address is required")
		return
	}
	args := map[string]any{"address": strings.TrimSpace(request.Address)}
	deadlineMs := 0
	if request.Timeout != nil {
		if *request.Timeout < 0 || *request.Timeout > 120_000 {
			a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "timeout must be between 0 and 120000")
			return
		}
		args["timeout"] = *request.Timeout
		if *request.Timeout >= 1000 {
			deadlineMs = *request.Timeout
		}
	}
	result, ok := a.callOwnerHerdrCore(c, "interrupt", args, deadlineMs)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) killHerdrCoreTerminal(c *gin.Context) {
	var request httpapi.HerdrCoreTerminalKillRequest
	if err := decodeJSON(c, &request); err != nil || strings.TrimSpace(request.Address) == "" {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address is required")
		return
	}
	result, ok := a.callOwnerHerdrCore(c, "kill", map[string]any{
		"address": strings.TrimSpace(request.Address),
	}, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) deleteHerdrCoreTerminal(c *gin.Context) {
	var params httpapi.DeleteHerdrCoreTerminalParams
	if err := c.ShouldBindQuery(&params); err != nil || strings.TrimSpace(params.Address) == "" {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address query parameter is required")
		return
	}
	result, ok := a.callOwnerHerdrCore(c, "rm", map[string]any{
		"address": strings.TrimSpace(params.Address),
	}, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) putHerdrCoreTerminalFile(c *gin.Context) {
	var request httpapi.HerdrCoreTerminalPutRequest
	err := decodeStrictJSON(http.MaxBytesReader(c.Writer, c.Request.Body, herdrCoreMaxPutBodyBytes), &request, "address, name, and data_base64 are required")
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			a.writeError(c, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Upload payload exceeds limit")
			return
		}
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address, name, and data_base64 are required")
		return
	}
	if strings.TrimSpace(request.Address) == "" || strings.TrimSpace(request.Name) == "" {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address and name are required")
		return
	}
	result, ok := a.callOwnerHerdrCore(c, "put", map[string]any{
		"address":     strings.TrimSpace(request.Address),
		"name":        strings.TrimSpace(request.Name),
		"data_base64": request.DataBase64,
	}, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) listHerdrCoreTemplates(c *gin.Context) {
	result, ok := a.callOwnerHerdrCore(c, "templates", map[string]any{}, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) listHerdrCoreMachines(c *gin.Context) {
	result, ok := a.callOwnerHerdrCore(c, "machines", map[string]any{}, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) getHerdrCoreDoc(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" || utf8.RuneCountInString(name) > 128 {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "doc name is required")
		return
	}
	var params httpapi.GetHerdrCoreDocParams
	if err := c.ShouldBindQuery(&params); err != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Invalid query parameters")
		return
	}
	args := map[string]any{"name": name}
	if params.On != nil && strings.TrimSpace(*params.On) != "" {
		args["on"] = strings.TrimSpace(*params.On)
	}
	result, ok := a.callOwnerHerdrCore(c, "doc_get", args, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

func (a *App) putHerdrCoreDoc(c *gin.Context) {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" || utf8.RuneCountInString(name) > 128 {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "doc name is required")
		return
	}
	var params httpapi.PutHerdrCoreDocParams
	if err := c.ShouldBindQuery(&params); err != nil {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Invalid query parameters")
		return
	}
	var request httpapi.HerdrCoreDocPutRequest
	if err := decodeJSON(c, &request); err != nil || request.Version < 0 {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "version and value are required")
		return
	}
	args := map[string]any{
		"name":    name,
		"version": request.Version,
		"value":   request.Value,
	}
	if params.On != nil && strings.TrimSpace(*params.On) != "" {
		args["on"] = strings.TrimSpace(*params.On)
	}
	result, ok := a.callOwnerHerdrCore(c, "doc_set", args, 0)
	if !ok {
		return
	}
	writeHerdrCoreJSON(c, http.StatusOK, result)
}

// attachHerdrCoreTerminal authenticates the owner session, mints a short-lived
// HMAC attach token, opens the upstream binary PTY relay WebSocket on Node
// Services, upgrades the client connection, and proxies binary + text frames.
func (a *App) attachHerdrCoreTerminal(c *gin.Context) {
	tenantID, ownerActorID, computerID, ok := a.herdrCoreComputerOwner(c)
	if !ok {
		return
	}
	var params httpapi.AttachHerdrCoreTerminalParams
	if err := c.ShouldBindQuery(&params); err != nil || strings.TrimSpace(params.Address) == "" {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address query parameter is required")
		return
	}
	address := strings.TrimSpace(params.Address)
	if utf8.RuneCountInString(address) > 256 {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "address is too long")
		return
	}
	cols := 120
	if params.Cols != nil {
		cols = *params.Cols
	}
	rows := 36
	if params.Rows != nil {
		rows = *params.Rows
	}
	observe := true
	if params.Observe != nil {
		observe = *params.Observe
	}
	history := 200
	if params.History != nil {
		history = *params.History
	}
	resumed := false
	if params.Resumed != nil {
		resumed = *params.Resumed
	}
	if cols < 1 || cols > 500 || rows < 1 || rows > 200 || history < 0 || history > 10000 {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "cols, rows, or history out of range")
		return
	}
	if !websocket.IsWebSocketUpgrade(c.Request) {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "WebSocket upgrade is required")
		return
	}
	if a.cfg.NodeServicesURL == "" || a.cfg.NodeServicesInternalToken == "" {
		a.writeError(c, http.StatusServiceUnavailable, "HERDR_CORE_UNAVAILABLE", "Node Services PTY relay is unavailable")
		return
	}
	claims := HerdrCoreAttachTokenClaims{
		V:            1,
		SessionID:    ids.New("hcs"),
		ComputerID:   computerID,
		TenantID:     tenantID,
		OwnerActorID: ownerActorID,
		Address:      address,
		Cols:         cols,
		Rows:         rows,
		Observe:      observe,
		History:      history,
		Resumed:      resumed,
		Exp:          time.Now().UTC().Add(herdrCoreAttachTokenTTL).Unix(),
	}
	token, err := SignHerdrCoreAttachToken(claims, a.cfg.NodeServicesInternalToken)
	if err != nil {
		a.internalError(c, "sign herdr-core attach token", err)
		return
	}
	upstreamURL, err := herdrCoreAttachUpstreamURL(a.cfg.NodeServicesURL, token)
	if err != nil {
		a.internalError(c, "build herdr-core attach URL", err)
		return
	}
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	upstreamConn, upstreamResp, err := dialer.DialContext(c.Request.Context(), upstreamURL, nil)
	if err != nil {
		if upstreamResp != nil {
			_ = upstreamResp.Body.Close()
			switch upstreamResp.StatusCode {
			case http.StatusConflict:
				a.writeError(c, http.StatusConflict, "HERDR_CORE_ATTACH_UNAVAILABLE", "Computer is offline or does not support herdr-core attach")
				return
			case http.StatusUnauthorized, http.StatusForbidden:
				a.writeError(c, http.StatusBadGateway, "HERDR_CORE_ATTACH_REJECTED", "Upstream relay rejected attach token")
				return
			}
		}
		a.writeError(c, http.StatusServiceUnavailable, "HERDR_CORE_UNAVAILABLE", "Could not connect to PTY attach relay")
		return
	}
	defer func() { _ = upstreamConn.Close() }()

	upgrader := websocket.Upgrader{
		ReadBufferSize:  32 * 1024,
		WriteBufferSize: 32 * 1024,
		CheckOrigin:     a.allowHerdrCoreWSOrigin,
	}
	clientConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer func() { _ = clientConn.Close() }()

	proxyWebSockets(c.Request.Context(), clientConn, upstreamConn)
}

func (a *App) allowHerdrCoreWSOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsedOrigin, err := url.Parse(origin)
	if err != nil || parsedOrigin.Host == "" {
		return false
	}
	if strings.EqualFold(parsedOrigin.Host, r.Host) {
		return true
	}
	if a.cfg.PublicWebURL != "" {
		if parsedPublic, err := url.Parse(a.cfg.PublicWebURL); err == nil && strings.EqualFold(parsedOrigin.Host, parsedPublic.Host) {
			return true
		}
	}
	for _, allowed := range a.cfg.CORSAllowedOrigins {
		if strings.EqualFold(strings.TrimRight(allowed, "/"), strings.TrimRight(origin, "/")) {
			return true
		}
	}
	return false
}

func herdrCoreAttachUpstreamURL(nodeServicesBaseURL, token string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(nodeServicesBaseURL, "/"))
	if err != nil || parsed.Host == "" {
		return "", errors.New("invalid NodeServicesURL")
	}
	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	default:
		return "", errors.New("unsupported NodeServicesURL scheme")
	}
	parsed.Path = herdrCoreAttachWSPath
	query := url.Values{}
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

// proxyWebSockets pumps binary and text frames bidirectionally between client
// and upstream Node Services relay until either side closes or ctx ends.
func proxyWebSockets(ctx context.Context, clientConn, upstreamConn *websocket.Conn) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var wg sync.WaitGroup
	pump := func(dst, src *websocket.Conn) {
		defer wg.Done()
		defer cancel()
		for {
			msgType, payload, err := src.ReadMessage()
			if err != nil {
				closeCode := websocket.CloseNormalClosure
				closeReason := ""
				var closeErr *websocket.CloseError
				if errors.As(err, &closeErr) && closeErr.Code >= 1000 && closeErr.Code != 1005 && closeErr.Code != 1006 {
					closeCode = closeErr.Code
					closeReason = closeErr.Text
				}
				_ = dst.WriteControl(
					websocket.CloseMessage,
					websocket.FormatCloseMessage(closeCode, closeReason),
					time.Now().Add(2*time.Second),
				)
				return
			}
			if msgType != websocket.BinaryMessage && msgType != websocket.TextMessage {
				continue
			}
			if err := dst.WriteMessage(msgType, payload); err != nil {
				return
			}
		}
	}

	wg.Add(2)
	go pump(upstreamConn, clientConn)
	go pump(clientConn, upstreamConn)

	go func() {
		<-ctx.Done()
		_ = clientConn.Close()
		_ = upstreamConn.Close()
	}()
	wg.Wait()
}

// askAgentHerdrCoreTerminal posts a question card bound to one blocked
// herdr-core terminal state (address, turn, status_ms). Options may carry
// optional key sequences so owner clicks can deliver either keys or text.
func (a *App) askAgentHerdrCoreTerminal(c *gin.Context) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	auth, err := a.agentAuth.Authorize(ctx, token, "ask_herdr_core_terminal")
	if a.writeAgentAuthError(c, "ask about a herdr-core terminal", err) {
		return
	}
	if auth.Principal == nil {
		a.writeAgentAPIError(c, http.StatusForbidden, agentapi.AgentApiErrorCodeForbidden, "Asking about herdr-core terminals requires an Agent identity")
		return
	}
	var request agentapi.AgentHerdrCoreAskRequest
	if !a.decodeAgentRequest(c, &request) {
		return
	}
	question, optionKeys, ok := herdrCoreQuestion(request)
	if !ok {
		a.writeAgentAPIError(c, http.StatusBadRequest, agentapi.AgentApiErrorCodeInvalidRequest, "Ask one question of at most 2000 characters with 1 to 20 distinct options, bound to address, turn, and status_ms")
		return
	}
	computerID, ownerID, err := a.agents.LocalComputerPlacement(ctx, auth.TenantID, auth.AgentActorID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && ownerID != auth.UserArtifactOwnerActorID {
		a.writeAgentAPIError(c, http.StatusConflict, agentapi.AgentApiErrorCodeOperationForbidden, "Only the AnotherMe of the Computer's owner, running on that Computer, can ask about its herdr-core terminals")
		return
	}
	if err != nil || a.typedCards == nil {
		if err != nil {
			a.logger.Error("read herdr-core question placement", "error", err)
		}
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "Asking about herdr-core terminals is temporarily unavailable")
		return
	}
	askable, err := a.proactive.HerdrCoreAskable(ctx, proactive.Owner{TenantID: auth.TenantID, ActorID: ownerID}, computerID, strings.TrimSpace(request.Address), request.Turn, request.StatusMs)
	if err != nil {
		a.logger.Error("read herdr-core terminal state", "error", err)
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "Asking about herdr-core terminals is temporarily unavailable")
		return
	}
	switch askable {
	case proactive.HerdrAskUnreported:
		a.writeAgentAPIError(c, http.StatusConflict, agentapi.AgentApiErrorCodeOperationForbidden, "The Computer did not report this herdr-core terminal state; ask only about an address, turn, and status_ms from a herdr_core event")
		return
	case proactive.HerdrAskGated:
		a.writeAgentAPIError(c, http.StatusConflict, agentapi.AgentApiErrorCodeHerdrAskGated, "Not now: it is quiet hours or the Human has had today's reminders. Record this terminal state in a Tracking Item and ask when that follow-up comes")
		return
	}
	roomID, err := a.humanConfirmationRoom(ctx, auth, ownerID)
	if err != nil || roomID == "" || auth.RoomID != "" && roomID != auth.RoomID {
		a.writeAgentAPIError(c, http.StatusForbidden, agentapi.AgentApiErrorCodeForbidden, "Ask about herdr-core terminals in your chat with the Computer's owner")
		return
	}
	address := strings.TrimSpace(request.Address)
	question.HerdrCore = &typedcard.HerdrCoreAnswerTarget{
		ComputerID: computerID,
		Address:    address,
		Turn:       request.Turn,
		StatusMs:   request.StatusMs,
		OptionKeys: optionKeys,
	}
	digest := sha256.Sum256([]byte(
		computerID + "\x00" + address + "\x00" +
			strconv.FormatInt(request.Turn, 10) + "\x00" +
			strconv.FormatInt(request.StatusMs, 10),
	))
	result, err := a.typedCards.CreateDecision(ctx, roomID, auth.AgentID, "herdr-core-question-"+hex.EncodeToString(digest[:16]), digest[:], typedcard.DecisionCommand{
		Principal: auth.Principal, DeciderActorID: ownerID, Question: &question,
	})
	if a.writeAgentDecisionCardError(c, "create herdr-core question card", "Question cards are unavailable in this chat", "Asking about herdr-core terminals is temporarily unavailable", err) {
		return
	}
	c.JSON(http.StatusOK, agentapi.AgentHerdrCoreAskResponse{
		Status:        agentapi.AgentHerdrCoreAskResponseStatusAsked,
		ComputerId:    computerID,
		RoomId:        roomID,
		MessageId:     result.MessageID,
		InteractionId: result.DecisionID,
	})
}

func herdrCoreQuestion(request agentapi.AgentHerdrCoreAskRequest) (typedcard.QuestionDecision, map[string][]string, bool) {
	address := strings.TrimSpace(request.Address)
	prompt := strings.TrimSpace(request.Question)
	if address == "" || utf8.RuneCountInString(address) > 256 || request.Turn < 0 || request.StatusMs < 0 ||
		prompt == "" || utf8.RuneCountInString(prompt) > 2000 || len(request.Options) == 0 || len(request.Options) > 20 {
		return typedcard.QuestionDecision{}, nil, false
	}
	options := make([]typedcard.DecisionQuestionOption, 0, len(request.Options))
	var optionKeys map[string][]string
	seen := map[string]bool{}
	for index, opt := range request.Options {
		if strings.ContainsFunc(opt.Label, unicode.IsControl) {
			return typedcard.QuestionDecision{}, nil, false
		}
		label := strings.TrimSpace(opt.Label)
		if label == "" || utf8.RuneCountInString(label) > 200 || seen[label] {
			return typedcard.QuestionDecision{}, nil, false
		}
		seen[label] = true
		id := "choice_" + strconv.Itoa(index+1)
		options = append(options, typedcard.DecisionQuestionOption{ID: id, Label: label})
		if opt.Keys != nil {
			keys := *opt.Keys
			if len(keys) == 0 || len(keys) > 16 {
				return typedcard.QuestionDecision{}, nil, false
			}
			cleanKeys := make([]string, 0, len(keys))
			for _, key := range keys {
				if strings.ContainsFunc(key, unicode.IsControl) {
					return typedcard.QuestionDecision{}, nil, false
				}
				key = strings.TrimSpace(key)
				if key == "" || utf8.RuneCountInString(key) > 64 {
					return typedcard.QuestionDecision{}, nil, false
				}
				cleanKeys = append(cleanKeys, key)
			}
			if optionKeys == nil {
				optionKeys = map[string][]string{}
			}
			optionKeys[id] = cleanKeys
		}
	}
	return typedcard.QuestionDecision{
		Prompt:    "A coding agent in herdr-core terminal " + address + " waits for your answer",
		Questions: []typedcard.DecisionQuestion{{ID: "answer", Prompt: prompt, Input: "radio", Options: options}},
	}, optionKeys, true
}

// callAgentHerdrCore proxies an allowlisted herdr_core tool call for an Agent
// placed on a Local Computer, enforcing owner placement and optional
// operation_id idempotency.
func (a *App) callAgentHerdrCore(c *gin.Context) {
	token, ok := a.agentCommandBearer(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	auth, err := a.agentAuth.Authorize(ctx, token, "call_herdr_core")
	if a.writeAgentAuthError(c, "call herdr-core", err) {
		return
	}
	if auth.Principal == nil {
		a.writeAgentAPIError(c, http.StatusForbidden, agentapi.AgentApiErrorCodeForbidden, "Calling herdr-core requires an Agent identity")
		return
	}
	var request agentapi.AgentHerdrCoreCallRequest
	if !a.decodeAgentRequest(c, &request) {
		return
	}
	if !request.ToolName.Valid() || request.ToolName == agentapi.HerdrCoreToolNameAnswer {
		a.writeAgentAPIError(c, http.StatusBadRequest, agentapi.AgentApiErrorCodeInvalidInput, "Unsupported herdr-core tool name")
		return
	}
	if request.Arguments == nil {
		request.Arguments = map[string]any{}
	}
	if request.ToolName == agentapi.HerdrCoreToolNameSend {
		if rawIf, hasIf := request.Arguments["if"]; hasIf && rawIf != nil {
			ifStr, ok := rawIf.(string)
			if !ok || !httpapi.HerdrCoreTerminalSendRequestIf(ifStr).Valid() {
				a.writeAgentAPIError(c, http.StatusBadRequest, agentapi.AgentApiErrorCodeInvalidToolArguments, "send argument if must be one of idle, working, or blocked")
				return
			}
		}
	}
	if request.DeadlineMs != nil && (*request.DeadlineMs < 1000 || *request.DeadlineMs > 120000) {
		a.writeAgentAPIError(c, http.StatusBadRequest, agentapi.AgentApiErrorCodeInvalidInput, "deadline_ms must be between 1000 and 120000")
		return
	}
	computerID, ownerID, err := a.agents.LocalComputerPlacement(ctx, auth.TenantID, auth.AgentActorID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && auth.UserArtifactOwnerActorID != "" && ownerID != auth.UserArtifactOwnerActorID) {
		a.writeAgentAPIError(c, http.StatusForbidden, agentapi.AgentApiErrorCodeOperationForbidden, "Agent is not placed on an authorized owner Local Computer")
		return
	}
	if err != nil {
		a.logger.Error("read herdr-core agent placement", "error", err)
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "herdr-core is temporarily unavailable")
		return
	}
	tools, supported := a.localComputers.(roomagent.LocalComputerTools)
	if !supported || tools == nil {
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "herdr-core gateway is unavailable")
		return
	}

	var opCacheKey string
	var opHash [32]byte
	opID := ""
	if request.OperationId != nil {
		opID = strings.TrimSpace(*request.OperationId)
	}
	if opID == "" {
		opID = strings.TrimSpace(c.GetHeader("X-TeamHub-Operation-Id"))
	}
	if opID != "" {
		opCacheKey = auth.AgentID + ":" + opID
		canonical, err := json.Marshal(struct {
			ComputerID string         `json:"computer_id"`
			ToolName   string         `json:"tool_name"`
			Arguments  map[string]any `json:"arguments"`
			DeadlineMs *int           `json:"deadline_ms,omitempty"`
		}{computerID, string(request.ToolName), request.Arguments, request.DeadlineMs})
		if err != nil {
			a.writeAgentAPIError(c, http.StatusBadRequest, agentapi.AgentApiErrorCodeInvalidInput, "Invalid herdr-core arguments")
			return
		}
		opHash = sha256.Sum256(canonical)
		if cached, found, conflict := a.herdrCoreOpCache().lookup(opCacheKey, opHash, time.Now()); found {
			if conflict {
				a.writeAgentAPIError(c, http.StatusConflict, agentapi.AgentApiErrorCodeIdempotencyConflict, "operation_id was already used with a different herdr-core request")
				return
			}
			c.JSON(http.StatusOK, cached)
			return
		}
	}

	toolCall := api.LocalComputerToolCall{
		TenantId:      auth.TenantID,
		OwnerActorId:  ownerID,
		ComputerId:    computerID,
		AgentId:       auth.AgentID,
		ToolSessionId: "hc-agent-" + auth.AgentID,
		Server:        api.HerdrCore,
		ToolName:      string(request.ToolName),
		Arguments:     request.Arguments,
		DeadlineMs:    request.DeadlineMs,
	}
	var result map[string]any
	if rawTools, ok := a.localComputers.(roomagent.LocalComputerToolResults); ok {
		result, err = rawTools.CallLocalComputerToolResult(ctx, toolCall)
		if err == nil {
			err = roomagent.ClassifyHerdrCoreResult(result)
		}
	} else {
		result, err = tools.CallLocalComputerTool(ctx, toolCall)
	}
	if err != nil {
		var toolErr *roomagent.LocalComputerToolError
		if errors.As(err, &toolErr) {
			switch toolErr.Code {
			case "invalid_request", "invalid_arguments":
				a.writeAgentAPIError(c, http.StatusBadRequest, agentapi.AgentApiErrorCodeInvalidToolArguments, toolErr.Message)
				return
			case "not_found", "terminal_not_found", "doc_not_found":
				a.writeAgentAPIError(c, http.StatusNotFound, agentapi.AgentApiErrorCodeNotFound, toolErr.Message)
				return
			case "computer_unavailable", "unavailable", "herdr_core_unavailable":
				a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, toolErr.Message)
				return
			default:
				a.writeAgentAPIError(c, http.StatusConflict, agentapi.AgentApiErrorCodeToolExecutionFailed, toolErr.Message)
				return
			}
		}
		a.writeAgentAPIError(c, http.StatusServiceUnavailable, agentapi.AgentApiErrorCodeDependencyUnavailable, "herdr-core call failed")
		return
	}
	response := agentapi.AgentHerdrCoreCallResponse{
		ComputerId: computerID,
		ToolName:   request.ToolName,
		Result:     result,
	}
	if opCacheKey != "" {
		a.herdrCoreOpCache().store(opCacheKey, opHash, response, time.Now())
	}
	c.JSON(http.StatusOK, response)
}

// deliverHerdrCoreAnswer delivers an owner's herdr-core question card answer
// (either keys via answer_keys or text via answer_text) through the Computer
// and classifies the result. The Daemon handles herdr_core/answer by verifying
// terminal.get (state == "live", status.state == "blocked", turn == expected)
// and then invoking terminal.keys (for keys) or terminal.send with force=true
// and no "if" field (for text, since herdr-core v0.1.21 rejects if="blocked").
func (a *App) deliverHerdrCoreAnswer(ctx context.Context, delivery typedcard.HerdrCoreDelivery) string {
	tools, supported := a.localComputers.(roomagent.LocalComputerTools)
	if !supported || tools == nil {
		return typedcard.HerdrCoreAnswerNotDelivered
	}
	args := map[string]any{
		"address":   delivery.Target.Address,
		"turn":      delivery.Target.Turn,
		"status_ms": delivery.Target.StatusMs,
	}
	if len(delivery.Keys) > 0 {
		args["keys"] = delivery.Keys
	} else {
		args["text"] = delivery.Text
	}
	_, err := tools.CallLocalComputerTool(ctx, api.LocalComputerToolCall{
		TenantId:      delivery.TenantID,
		OwnerActorId:  delivery.OwnerActorID,
		ComputerId:    delivery.Target.ComputerID,
		AgentId:       delivery.AgentManagementID,
		ToolSessionId: "herdr-core-answer",
		Server:        api.HerdrCore,
		ToolName:      "answer",
		Arguments:     args,
	})
	var failure *roomagent.LocalComputerToolError
	switch {
	case err == nil:
		return typedcard.HerdrCoreAnswerSent
	case !errors.As(err, &failure):
		a.logger.Error("deliver herdr-core answer", "error", err)
		return typedcard.HerdrCoreAnswerOutcomeUnknown
	}
	switch failure.Code {
	case "terminal_closed", "pane_closed":
		return typedcard.HerdrCoreAnswerTerminalClosed
	case "terminal_not_blocked", "pane_not_blocked":
		return typedcard.HerdrCoreAnswerNotBlocked
	case "invalid_answer":
		return typedcard.HerdrCoreAnswerInvalid
	case "outcome_unknown":
		return typedcard.HerdrCoreAnswerOutcomeUnknown
	default:
		return typedcard.HerdrCoreAnswerNotDelivered
	}
}
