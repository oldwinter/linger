package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentregistry"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/ids"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomagent"
	"github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

// modelSourceRunStopLifetime bounds the best-effort requests that stop the
// live processes of Runs a switch ended.
const modelSourceRunStopLifetime = 10 * time.Second

// modelSourceRefusalCodes maps the Computer's and Agent Service's refusals a
// Human can act on to their public code; any other is MODEL_SOURCE_FAILED.
var modelSourceRefusalCodes = map[string]httpapi.ModelSourceErrorCode{
	"TOOL_NOT_INSTALLED":       httpapi.ModelSourceErrorCodeModelSourceUnavailable,
	"MODEL_SOURCE_UNAVAILABLE": httpapi.ModelSourceErrorCodeModelSourceUnavailable,
	"MODEL_SOURCE_UNSUPPORTED": httpapi.ModelSourceErrorCodeModelSourceUnavailable,
	"RUNTIME_NOT_ENABLED":      httpapi.ModelSourceErrorCodeRuntimeNotEnabled,
	"LOAD_NO_ROOM":             httpapi.ModelSourceErrorCodeLocalModelNoRoom,
	"MEMORY_INSUFFICIENT":      httpapi.ModelSourceErrorCodeLocalModelNoRoom,
	"MODEL_UNKNOWN":            httpapi.ModelSourceErrorCodeLocalModelUnknown,
	"BYOK_INVALID_CONFIG":      httpapi.ModelSourceErrorCodeByokInvalidConfig,
	"BYOK_AUTH_FAILED":         httpapi.ModelSourceErrorCodeByokAuthFailed,
	"BYOK_MODEL_NOT_FOUND":     httpapi.ModelSourceErrorCodeByokModelNotFound,
	"BYOK_UNREACHABLE":         httpapi.ModelSourceErrorCodeByokUnreachable,
	"BYOK_UPSTREAM_REJECTED":   httpapi.ModelSourceErrorCodeByokUpstreamRejected,
	"MODEL_SOURCE_TIMEOUT":     httpapi.ModelSourceErrorCodeModelSourceUnconfirmed,
	"BYOK_CHECK_TIMEOUT":       httpapi.ModelSourceErrorCodeModelSourceUnconfirmed,
}

var modelSourceErrorMessages = map[httpapi.ModelSourceErrorCode]string{
	httpapi.ModelSourceErrorCodeLocalComputerOffline:          "Local Computer is offline",
	httpapi.ModelSourceErrorCodeModelSourceForbidden:          "Only the Computer's owner can change its model source",
	httpapi.ModelSourceErrorCodeModelSourceUnavailable:        "This Computer cannot switch model sources",
	httpapi.ModelSourceErrorCodeAgentHasActiveRuns:            "Agents on this Computer are working on tasks",
	httpapi.ModelSourceErrorCodeRuntimeNotEnabled:             "The selected AI runtime is not enabled on this Computer",
	httpapi.ModelSourceErrorCodeLocalModelNoRoom:              "There is not enough free memory on the Computer to load this model",
	httpapi.ModelSourceErrorCodeLocalModelUnknown:             "The Computer does not know this model",
	httpapi.ModelSourceErrorCodeByokInvalidConfig:             "The Computer rejected this endpoint configuration",
	httpapi.ModelSourceErrorCodeByokAuthFailed:                "The endpoint rejected the API key",
	httpapi.ModelSourceErrorCodeByokModelNotFound:             "The endpoint does not serve this model",
	httpapi.ModelSourceErrorCodeByokUnreachable:               "The Computer could not reach the endpoint",
	httpapi.ModelSourceErrorCodeByokUpstreamRejected:          "The endpoint rejected the test request",
	httpapi.ModelSourceErrorCodeModelSourceFailed:             "The Computer could not change its model source",
	httpapi.ModelSourceErrorCodeModelSourceServiceUnavailable: "Model sources are unavailable",
	httpapi.ModelSourceErrorCodeModelSourceUnconfirmed:        "The Computer did not answer in time",
}

var modelSourceErrorStatuses = map[httpapi.ModelSourceErrorCode]int{
	httpapi.ModelSourceErrorCodeLocalComputerOffline:          http.StatusServiceUnavailable,
	httpapi.ModelSourceErrorCodeModelSourceForbidden:          http.StatusForbidden,
	httpapi.ModelSourceErrorCodeModelSourceFailed:             http.StatusBadGateway,
	httpapi.ModelSourceErrorCodeModelSourceServiceUnavailable: http.StatusServiceUnavailable,
	httpapi.ModelSourceErrorCodeModelSourceUnconfirmed:        http.StatusGatewayTimeout,
}

// getLocalComputerModelSource shows any member of the Tenant whether the
// Computer is online; only its owner sees the model source, because the BYOK
// endpoint is theirs.
func (a *App) getLocalComputerModelSource(c *gin.Context) {
	computer, viewerID, ok := a.modelSourceComputer(c)
	if !ok {
		return
	}
	view := httpapi.ModelSourceView{
		ComputerId: computer.ComputerID, ViewerIsOwner: computer.Owner.OwnerActorID == viewerID,
		Online: localComputerOnline(computer.Status, computer.LastSeenAt, time.Now()),
	}
	if !view.ViewerIsOwner || !view.Online {
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, view)
		return
	}
	management, ok := a.modelSourceManagement(c)
	if !ok {
		return
	}
	status, err := management.LocalComputerModelSource(c.Request.Context(), modelSourceTarget(computer))
	var refusal *roomagent.ModelSourceError
	switch {
	case errors.Is(err, roomagent.ErrLocalComputerOffline):
		view.Online = false
	case errors.As(err, &refusal) && modelSourceRefusalCodes[refusal.Code] == httpapi.ModelSourceErrorCodeModelSourceUnavailable:
		// A Computer without model sources still shows as online.
	case err != nil:
		a.writeModelSourceFailure(c, computer.ComputerID, "status", err)
		return
	default:
		public, err := publicModelSourceStatus(status)
		if err != nil {
			a.internalError(c, "project Local Computer model source", err)
			return
		}
		view.Status = &public
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, view)
}

// switchLocalComputerModelSource switches the owner's Computer to another
// model source, then moves the Agents on it to the Runtime and model it now
// serves. Running work blocks the switch unless the owner chose to end it;
// work that starts while the Computer switches keeps its Agent where it is,
// and the owner is asked about it again.
func (a *App) switchLocalComputerModelSource(c *gin.Context) {
	var request httpapi.ModelSourceSwitchRequest
	if err := decodeJSON(c, &request); err != nil || !validModelSourceSwitch(request) {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Model source switch is invalid")
		return
	}
	computer, viewerID, ok := a.ownedOnlineModelSourceComputer(c)
	if !ok {
		return
	}
	management, ok := a.modelSourceManagement(c)
	if !ok {
		return
	}
	terminate := request.ForceTerminate != nil && *request.ForceTerminate
	tenantID := computer.Owner.TenantID
	if !terminate {
		busy, err := a.agents.BusyComputerAgents(c.Request.Context(), tenantID, viewerID, computer.ComputerID)
		if err != nil {
			a.internalError(c, "read busy Agents on a Local Computer", err)
			return
		}
		if len(busy) > 0 {
			a.writeAgentsBusy(c, busy)
			return
		}
	}
	command, err := reencodeJSON[nodeservicesinternal.ModelSourceApplyCommand](httpapi.ModelSourceSwitchRequest{
		Mode: request.Mode, Runtime: request.Runtime, LocalModelId: request.LocalModelId, Byok: request.Byok,
	})
	if err != nil {
		a.internalError(c, "encode model source switch", err)
		return
	}
	status, err := management.ApplyLocalComputerModelSource(c.Request.Context(), modelSourceTarget(computer), command)
	if err != nil {
		a.writeModelSourceFailure(c, computer.ComputerID, "apply", err)
		return
	}
	public, err := publicModelSourceStatus(status)
	if err != nil || status.RuntimeModel == "" {
		a.logger.Warn("model_source.status_invalid", "computer_id", computer.ComputerID)
		a.writeModelSourceError(c, httpapi.ModelSourceErrorCodeModelSourceFailed)
		return
	}
	effort := ""
	if status.ReasoningEffort != nil {
		effort = string(*status.ReasoningEffort)
	}
	result, err := a.agents.SwitchComputerRuntime(c.Request.Context(), agentregistry.ComputerRuntimeSwitch{
		TenantID: tenantID, OwnerActorID: viewerID, ComputerID: computer.ComputerID,
		RuntimeType: string(status.Runtime), Model: status.RuntimeModel, ReasoningEffort: effort,
		TerminateWork: terminate,
	})
	if err != nil {
		a.internalError(c, "switch Agents to a Local Computer's model source", err)
		return
	}
	a.stopTerminatedRuns(c.Request.Context(), result.TerminatedRuns)
	if len(result.BusyAgents) > 0 {
		// Work started after the first check. The Computer has switched and
		// the idle Agents moved; a retry that ends that work moves the rest.
		a.writeAgentsBusy(c, result.BusyAgents)
		return
	}
	updated, terminated := result.UpdatedAgents, len(result.TerminatedRuns)
	c.JSON(http.StatusOK, httpapi.ModelSourceView{
		ComputerId: computer.ComputerID, ViewerIsOwner: true, Online: true, Status: &public,
		UpdatedAgentCount: &updated, TerminatedRunCount: &terminated,
	})
}

// testLocalComputerModelSource probes a BYOK endpoint from the owner's
// Computer without saving it anywhere.
func (a *App) testLocalComputerModelSource(c *gin.Context) {
	var request httpapi.ByokTestRequest
	if err := decodeJSON(c, &request); err != nil || !request.Runtime.Valid() || !validByokInput(request.Byok) {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "BYOK configuration is invalid")
		return
	}
	computer, _, ok := a.ownedOnlineModelSourceComputer(c)
	if !ok {
		return
	}
	management, ok := a.modelSourceManagement(c)
	if !ok {
		return
	}
	input, err := reencodeJSON[nodeservicesinternal.ByokTestRequest](request)
	if err != nil {
		a.internalError(c, "encode BYOK test", err)
		return
	}
	result, err := management.TestLocalComputerByok(c.Request.Context(), modelSourceTarget(computer), input)
	if err != nil {
		a.writeModelSourceFailure(c, computer.ComputerID, "test", err)
		return
	}
	public, err := reencodeJSON[httpapi.ByokTestResult](result)
	if err != nil {
		a.internalError(c, "project BYOK test", err)
		return
	}
	c.JSON(http.StatusOK, public)
}

// listLocalComputerByokModels lists the models a BYOK endpoint serves, asked
// from the owner's Computer.
func (a *App) listLocalComputerByokModels(c *gin.Context) {
	var endpoint httpapi.ByokEndpointInput
	if err := decodeJSON(c, &endpoint); err != nil || strings.TrimSpace(endpoint.BaseUrl) == "" ||
		len(endpoint.BaseUrl) > 2048 || (endpoint.ApiKey != nil && len(*endpoint.ApiKey) > 4096) {
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "BYOK endpoint is invalid")
		return
	}
	computer, _, ok := a.ownedOnlineModelSourceComputer(c)
	if !ok {
		return
	}
	management, ok := a.modelSourceManagement(c)
	if !ok {
		return
	}
	input, err := reencodeJSON[nodeservicesinternal.ByokEndpointInput](endpoint)
	if err != nil {
		a.internalError(c, "encode BYOK endpoint", err)
		return
	}
	list, err := management.ListLocalComputerByokModels(c.Request.Context(), modelSourceTarget(computer), input)
	if err != nil {
		a.writeModelSourceFailure(c, computer.ComputerID, "models", err)
		return
	}
	public, err := reencodeJSON[httpapi.ByokModelList](list)
	if err != nil {
		a.internalError(c, "project BYOK models", err)
		return
	}
	c.JSON(http.StatusOK, public)
}

func (a *App) modelSourceComputer(c *gin.Context) (agentruntimestate.LocalComputer, string, bool) {
	tenantID, computerID := c.Param("tenantId"), c.Param("computerId")
	viewerID, ok := a.spaceHuman(c, tenantID)
	if !ok {
		return agentruntimestate.LocalComputer{}, "", false
	}
	if a.agentRuntimeState == nil {
		a.writeModelSourceError(c, httpapi.ModelSourceErrorCodeModelSourceServiceUnavailable)
		return agentruntimestate.LocalComputer{}, "", false
	}
	computer, err := a.agentRuntimeState.GetLocalComputer(c.Request.Context(), computerID)
	switch {
	case errors.Is(err, agentruntimestate.ErrNotFound), errors.Is(err, agentruntimestate.ErrInvalid),
		err == nil && (computer.Owner.TenantID != tenantID || computer.Status == "removed"):
		a.writeError(c, http.StatusNotFound, "LOCAL_COMPUTER_NOT_FOUND", "Local Computer was not found")
		return agentruntimestate.LocalComputer{}, "", false
	case err != nil:
		a.internalError(c, "read Local Computer for its model source", err)
		return agentruntimestate.LocalComputer{}, "", false
	}
	return computer, viewerID, true
}

func (a *App) ownedOnlineModelSourceComputer(c *gin.Context) (agentruntimestate.LocalComputer, string, bool) {
	computer, viewerID, ok := a.modelSourceComputer(c)
	switch {
	case !ok:
		return agentruntimestate.LocalComputer{}, "", false
	case computer.Owner.OwnerActorID != viewerID:
		a.writeModelSourceError(c, httpapi.ModelSourceErrorCodeModelSourceForbidden)
		return agentruntimestate.LocalComputer{}, "", false
	case !localComputerOnline(computer.Status, computer.LastSeenAt, time.Now()):
		a.writeModelSourceError(c, httpapi.ModelSourceErrorCodeLocalComputerOffline)
		return agentruntimestate.LocalComputer{}, "", false
	}
	return computer, viewerID, true
}

func (a *App) modelSourceManagement(c *gin.Context) (roomagent.ModelSourceManagement, bool) {
	management, ok := a.localComputers.(roomagent.ModelSourceManagement)
	if !ok || a.agents == nil {
		a.writeModelSourceError(c, httpapi.ModelSourceErrorCodeModelSourceServiceUnavailable)
		return nil, false
	}
	return management, true
}

func modelSourceTarget(computer agentruntimestate.LocalComputer) roomagent.ModelSourceTarget {
	return roomagent.ModelSourceTarget{
		TenantID: computer.Owner.TenantID, OwnerActorID: computer.Owner.OwnerActorID, ComputerID: computer.ComputerID,
	}
}

// stopTerminatedRuns asks Agent Service to stop the live processes of the
// Runs a switch ended. TeamHub already ended them; a failure only leaves a
// process running until its next exchange with TeamHub fences it.
func (a *App) stopTerminatedRuns(ctx context.Context, runs []agentruntimestate.TerminatedLocalRun) {
	gateway, ok := a.agentManagement.(roomagent.RunManagement)
	if !ok || len(runs) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), modelSourceRunStopLifetime)
	defer cancel()
	for _, run := range runs {
		if run.RoomID == "" {
			continue
		}
		if _, err := gateway.CancelRun(ctx, roomagent.RunCancelCommand{
			RequestID: ids.New("model_source_stop"), RunID: run.RunID, AgentID: run.AgentManagementID, RoomID: run.RoomID,
		}); err != nil {
			a.logger.Warn("model_source.run_stop_failed", "run_id", run.RunID, "error", err)
		}
	}
}

func (a *App) writeAgentsBusy(c *gin.Context, agents []agentregistry.BusyComputerAgent) {
	code := string(httpapi.ModelSourceErrorCodeAgentHasActiveRuns)
	details := make([]httpapi.ErrorDetail, len(agents))
	for index, agent := range agents {
		details[index] = httpapi.ErrorDetail{Code: &code, Field: "agent", Reason: agent.Name}
	}
	a.writeErrorWithDetails(c, http.StatusConflict, code, modelSourceErrorMessages[httpapi.ModelSourceErrorCodeAgentHasActiveRuns], details)
}

func (a *App) writeModelSourceFailure(c *gin.Context, computerID, action string, err error) {
	var refusal *roomagent.ModelSourceError
	switch {
	case errors.Is(err, roomagent.ErrLocalComputerNotFound):
		a.writeError(c, http.StatusNotFound, "LOCAL_COMPUTER_NOT_FOUND", "Local Computer was not found")
	case errors.Is(err, roomagent.ErrLocalComputerOffline):
		a.writeModelSourceError(c, httpapi.ModelSourceErrorCodeLocalComputerOffline)
	case errors.As(err, &refusal):
		code, known := modelSourceRefusalCodes[refusal.Code]
		if !known {
			a.logger.Warn("model_source.refused", "computer_id", computerID, "action", action, "refusal_code", refusal.Code)
			code = httpapi.ModelSourceErrorCodeModelSourceFailed
		}
		a.writeModelSourceError(c, code)
	default:
		a.logger.Error("model_source.failed", "computer_id", computerID, "action", action, "error", err)
		a.writeModelSourceError(c, httpapi.ModelSourceErrorCodeModelSourceServiceUnavailable)
	}
}

func (a *App) writeModelSourceError(c *gin.Context, code httpapi.ModelSourceErrorCode) {
	status, found := modelSourceErrorStatuses[code]
	if !found {
		status = http.StatusConflict
	}
	a.writeError(c, status, string(code), modelSourceErrorMessages[code])
}

func validModelSourceSwitch(request httpapi.ModelSourceSwitchRequest) bool {
	if request.Runtime != nil && !request.Runtime.Valid() {
		return false
	}
	switch request.Mode {
	case httpapi.ModelSourceModeByok:
		return request.Runtime != nil && request.LocalModelId == nil && request.Byok != nil && validByokInput(*request.Byok)
	case httpapi.ModelSourceModeSubscription:
		return request.Runtime != nil && *request.Runtime != httpapi.ModelSourceRuntimePi &&
			request.LocalModelId == nil && request.Byok == nil
	case httpapi.ModelSourceModeLocal:
		return (request.Runtime == nil || *request.Runtime == httpapi.ModelSourceRuntimePi) && request.Byok == nil &&
			(request.LocalModelId == nil || localModelIDPattern.MatchString(*request.LocalModelId))
	}
	return false
}

func validByokInput(input httpapi.ByokInput) bool {
	return strings.TrimSpace(input.BaseUrl) != "" && len(input.BaseUrl) <= 2048 &&
		strings.TrimSpace(input.ModelId) != "" && len(input.ModelId) <= 256 &&
		(input.ApiKey == nil || len(*input.ApiKey) <= 4096) &&
		(input.ContextWindow == nil || *input.ContextWindow >= 1)
}

func publicModelSourceStatus(status nodeservicesinternal.ModelSourceStatus) (httpapi.ModelSourceStatus, error) {
	public, err := reencodeJSON[httpapi.ModelSourceStatus](status)
	if err == nil && (!public.Mode.Valid() || !public.Runtime.Valid()) {
		err = errors.New("model source status has an unknown mode or Runtime")
	}
	return public, err
}

// reencodeJSON converts between generated contract types that share a wire
// shape.
func reencodeJSON[T any](value any) (T, error) {
	var converted T
	encoded, err := json.Marshal(value)
	if err == nil {
		err = json.Unmarshal(encoded, &converted)
	}
	return converted, err
}
