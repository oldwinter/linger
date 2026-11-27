package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomagent"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

const systemTelemetryStreamInterval = 1500 * time.Millisecond

var systemTelemetryErrorMessages = map[httpapi.SystemTelemetryErrorCode]string{
	httpapi.SystemTelemetryErrorCodeLocalComputerOffline: "Local Computer is offline",
	httpapi.SystemTelemetryErrorCodeUnsupported:          "Upgrade Local Computer to view live system telemetry",
	httpapi.SystemTelemetryErrorCodeFailed:               "Could not read system telemetry from this Computer",
	httpapi.SystemTelemetryErrorCodeTimeout:              "The Computer did not answer the telemetry probe in time",
	httpapi.SystemTelemetryErrorCodeServiceUnavailable:   "System telemetry is unavailable",
}

var systemTelemetryErrorStatuses = map[httpapi.SystemTelemetryErrorCode]int{
	httpapi.SystemTelemetryErrorCodeLocalComputerOffline: http.StatusServiceUnavailable,
	httpapi.SystemTelemetryErrorCodeUnsupported:          http.StatusConflict,
	httpapi.SystemTelemetryErrorCodeFailed:               http.StatusBadGateway,
	httpapi.SystemTelemetryErrorCodeTimeout:              http.StatusGatewayTimeout,
	httpapi.SystemTelemetryErrorCodeServiceUnavailable:   http.StatusServiceUnavailable,
}

// getLocalComputerSystemTelemetry returns one live hardware and LLM inference
// telemetry view for a Local Computer. Offline, non-owner, and older-daemon
// states return structured views cleanly so Settings > System renders honest UI.
func (a *App) getLocalComputerSystemTelemetry(c *gin.Context) {
	computer, viewerID, ok := a.systemTelemetryComputer(c)
	if !ok {
		return
	}
	view, err := a.sampleSystemTelemetryView(c.Request.Context(), computer, viewerID)
	if err != nil {
		a.writeSystemTelemetryFailure(c, computer.ComputerID, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, view)
}

// streamLocalComputerSystemTelemetry streams periodic live telemetry views over
// SSE for as long as the viewer keeps Settings > System open.
func (a *App) streamLocalComputerSystemTelemetry(c *gin.Context) {
	computer, viewerID, ok := a.systemTelemetryComputer(c)
	if !ok {
		return
	}
	principal := currentPrincipal(c)
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		a.internalError(c, "stream system telemetry", errors.New("response writer does not support flushing"))
		return
	}
	if _, err := fmt.Fprint(c.Writer, ": connected\n\n"); err != nil {
		return
	}
	flusher.Flush()
	if !a.ensureStreamSession(c, flusher, principal.Token) {
		return
	}

	writeFrame := func(ctx context.Context) bool {
		// Refresh Computer online state from store on every tick so reconnects show immediately.
		current, err := a.agentRuntimeState.GetLocalComputer(ctx, computer.ComputerID)
		if err != nil || current.Owner.TenantID != computer.Owner.TenantID || current.Status == "removed" {
			return false
		}
		view, err := a.sampleSystemTelemetryView(ctx, current, viewerID)
		if err != nil {
			if ctx.Err() != nil {
				return false
			}
			// Transient probe errors emit an online=true, telemetry=nil heartbeat frame rather than tearing down the SSE stream.
			view = httpapi.SystemTelemetryView{
				ComputerId:    current.ComputerID,
				DisplayName:   current.DisplayName,
				ViewerIsOwner: current.Owner.OwnerActorID == viewerID,
				Online:        localComputerOnline(current.Status, current.LastSeenAt, time.Now()),
				Supported:     true,
			}
		}
		encoded, err := json.Marshal(view)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(c.Writer, "event: telemetry\ndata: %s\n\n", encoded); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	if !writeFrame(c.Request.Context()) {
		return
	}

	ticker := time.NewTicker(systemTelemetryStreamInterval)
	defer ticker.Stop()
	expiresIn := time.Until(principal.Session.ExpiresAt.Time)
	if expiresIn < 0 {
		expiresIn = 0
	}
	expiry := time.NewTimer(expiresIn)
	defer expiry.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-a.streamsDone.Done():
			return
		case <-expiry.C:
			_ = a.ensureStreamSession(c, flusher, principal.Token)
			return
		case <-ticker.C:
			if !a.ensureStreamSession(c, flusher, principal.Token) {
				return
			}
			if !writeFrame(c.Request.Context()) {
				return
			}
		}
	}
}

func (a *App) systemTelemetryComputer(c *gin.Context) (agentruntimestate.LocalComputer, string, bool) {
	tenantID, computerID := c.Param("tenantId"), c.Param("computerId")
	viewerID, ok := a.spaceHuman(c, tenantID)
	if !ok {
		return agentruntimestate.LocalComputer{}, "", false
	}
	if a.agentRuntimeState == nil {
		a.writeSystemTelemetryError(c, httpapi.SystemTelemetryErrorCodeServiceUnavailable)
		return agentruntimestate.LocalComputer{}, "", false
	}
	computer, err := a.agentRuntimeState.GetLocalComputer(c.Request.Context(), computerID)
	switch {
	case errors.Is(err, agentruntimestate.ErrNotFound), errors.Is(err, agentruntimestate.ErrInvalid),
		err == nil && (computer.Owner.TenantID != tenantID || computer.Status == "removed"):
		a.writeError(c, http.StatusNotFound, "LOCAL_COMPUTER_NOT_FOUND", "Local Computer was not found")
		return agentruntimestate.LocalComputer{}, "", false
	case err != nil:
		a.internalError(c, "read Local Computer for system telemetry", err)
		return agentruntimestate.LocalComputer{}, "", false
	}
	return computer, viewerID, true
}

func (a *App) sampleSystemTelemetryView(ctx context.Context, computer agentruntimestate.LocalComputer, viewerID string) (httpapi.SystemTelemetryView, error) {
	view := httpapi.SystemTelemetryView{
		ComputerId:    computer.ComputerID,
		DisplayName:   computer.DisplayName,
		ViewerIsOwner: computer.Owner.OwnerActorID == viewerID,
		Online:        localComputerOnline(computer.Status, computer.LastSeenAt, time.Now()),
		Supported:     true,
	}
	if !view.ViewerIsOwner || !view.Online {
		return view, nil
	}
	management, ok := a.localComputers.(roomagent.SystemTelemetryManagement)
	if !ok {
		return httpapi.SystemTelemetryView{}, &roomagent.SystemTelemetryError{Code: string(httpapi.SystemTelemetryErrorCodeServiceUnavailable)}
	}
	snapshot, err := management.LocalComputerSystemTelemetry(ctx, roomagent.SystemTelemetryTarget{
		TenantID:     computer.Owner.TenantID,
		OwnerActorID: computer.Owner.OwnerActorID,
		ComputerID:   computer.ComputerID,
	})
	var refusal *roomagent.SystemTelemetryError
	switch {
	case errors.Is(err, roomagent.ErrLocalComputerOffline):
		view.Online = false
		return view, nil
	case errors.As(err, &refusal) && refusal.Code == "SYSTEM_TELEMETRY_UNSUPPORTED":
		view.Supported = false
		return view, nil
	case err != nil:
		return httpapi.SystemTelemetryView{}, err
	}
	public, err := convertJSON[httpapi.SystemTelemetrySnapshot](snapshot)
	if err != nil {
		return httpapi.SystemTelemetryView{}, err
	}
	view.Telemetry = &public
	return view, nil
}

func (a *App) writeSystemTelemetryFailure(c *gin.Context, computerID string, err error) {
	var refusal *roomagent.SystemTelemetryError
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		a.logger.Warn("system_telemetry.timeout", "computer_id", computerID)
		a.writeSystemTelemetryError(c, httpapi.SystemTelemetryErrorCodeTimeout)
	case errors.As(err, &refusal):
		switch refusal.Code {
		case "SYSTEM_TELEMETRY_TIMEOUT", "SYSTEM_TELEMETRY_EXPIRED":
			a.writeSystemTelemetryError(c, httpapi.SystemTelemetryErrorCodeTimeout)
		case "SYSTEM_TELEMETRY_UNSUPPORTED":
			a.writeSystemTelemetryError(c, httpapi.SystemTelemetryErrorCodeUnsupported)
		case string(httpapi.SystemTelemetryErrorCodeServiceUnavailable):
			a.writeSystemTelemetryError(c, httpapi.SystemTelemetryErrorCodeServiceUnavailable)
		default:
			a.logger.Warn("system_telemetry.refused", "computer_id", computerID, "refusal_code", refusal.Code)
			a.writeSystemTelemetryError(c, httpapi.SystemTelemetryErrorCodeFailed)
		}
	default:
		a.logger.Warn("system_telemetry.failed", "computer_id", computerID, "error", err)
		a.writeSystemTelemetryError(c, httpapi.SystemTelemetryErrorCodeFailed)
	}
}

func (a *App) writeSystemTelemetryError(c *gin.Context, code httpapi.SystemTelemetryErrorCode) {
	status, found := systemTelemetryErrorStatuses[code]
	if !found {
		status = http.StatusBadGateway
	}
	a.writeError(c, status, string(code), systemTelemetryErrorMessages[code])
}
