package roomagent

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
)

// localSystemTelemetryTimeout bounds one rootless telemetry sample across the
// Runner Gateway so a stalled Computer never hangs an HTTP or SSE tick.
const localSystemTelemetryTimeout = 12 * time.Second

// SystemTelemetryTarget names the owner's connected Computer a telemetry probe targets.
type SystemTelemetryTarget struct {
	TenantID, OwnerActorID, ComputerID string
}

// SystemTelemetryError carries a structured refusal code from Agent Service or
// the Local Computer Daemon (for example SYSTEM_TELEMETRY_UNSUPPORTED).
type SystemTelemetryError struct {
	Code    string
	Message string
}

func (e *SystemTelemetryError) Error() string { return "system telemetry refused: " + e.Code }

// SystemTelemetryManagement reads live rootless hardware and local LLM
// inference telemetry from an owned connected Computer.
type SystemTelemetryManagement interface {
	LocalComputerSystemTelemetry(ctx context.Context, target SystemTelemetryTarget) (nodeservicesinternal.SystemTelemetrySnapshot, error)
}

// LocalComputerSystemTelemetry requests one fresh telemetry snapshot from the Computer.
func (g *HTTPGateway) LocalComputerSystemTelemetry(ctx context.Context, target SystemTelemetryTarget) (nodeservicesinternal.SystemTelemetrySnapshot, error) {
	if !opaqueIDPattern.MatchString(target.TenantID) || !opaqueIDPattern.MatchString(target.OwnerActorID) || !opaqueIDPattern.MatchString(target.ComputerID) {
		return nodeservicesinternal.SystemTelemetrySnapshot{}, ErrLocalComputerNotFound
	}
	probeCtx, cancel := context.WithTimeout(ctx, localSystemTelemetryTimeout)
	defer cancel()
	response, err := g.client.GetLocalComputerSystemTelemetryWithResponse(probeCtx, target.TenantID, target.OwnerActorID, target.ComputerID)
	if err != nil {
		return nodeservicesinternal.SystemTelemetrySnapshot{}, fmt.Errorf("system telemetry probe: %w", err)
	}
	if response.StatusCode() == http.StatusOK && response.JSON200 != nil {
		return *response.JSON200, nil
	}
	return nodeservicesinternal.SystemTelemetrySnapshot{}, systemTelemetryGatewayError(
		response.StatusCode(),
		firstError(response.JSON409, response.JSON502, response.JSON503, response.JSON504),
	)
}

func systemTelemetryGatewayError(status int, body *nodeservicesinternal.ErrorResponse) error {
	switch {
	case status == http.StatusNotFound:
		return ErrLocalComputerNotFound
	case body != nil && body.Error.Code == "LOCAL_COMPUTER_OFFLINE":
		return ErrLocalComputerOffline
	case body != nil && body.Error.Code != "":
		return &SystemTelemetryError{Code: body.Error.Code, Message: body.Error.Message}
	}
	return fmt.Errorf("AgentManagement returned status %d for system telemetry", status)
}
