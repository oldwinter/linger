package roomagent

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
)

// localModelSourceRequestTimeout covers the Gateway's three-minute budget
// for a switch, which may install a Runtime or start Bifrost first.
const localModelSourceRequestTimeout = 185 * time.Second

// localModelSourceProbeTimeout bounds read-only status, BYOK check, and BYOK
// model-listing calls to the Gateway's 45-second budget plus transport headroom.
const localModelSourceProbeTimeout = 50 * time.Second

// ModelSourceTarget names the owner's connected Computer a model-source
// command goes to.
type ModelSourceTarget struct {
	TenantID, OwnerActorID, ComputerID string
}

// ModelSourceError is a refusal with the stable code the Computer or Agent
// Service reported, such as BYOK_AUTH_FAILED or RUNTIME_NOT_ENABLED.
type ModelSourceError struct {
	Code string
	// Message is the Computer's own display text for the refusal.
	Message string
}

func (e *ModelSourceError) Error() string { return "model source refused: " + e.Code }

// ModelSourceManagement reads, probes and switches the model source of the
// owner's connected Computer. A BYOK input carries the API key; it must never
// be logged or persisted.
type ModelSourceManagement interface {
	LocalComputerModelSource(ctx context.Context, target ModelSourceTarget) (nodeservicesinternal.ModelSourceStatus, error)
	ApplyLocalComputerModelSource(ctx context.Context, target ModelSourceTarget, command nodeservicesinternal.ModelSourceApplyCommand) (nodeservicesinternal.ModelSourceStatus, error)
	TestLocalComputerByok(ctx context.Context, target ModelSourceTarget, request nodeservicesinternal.ByokTestRequest) (nodeservicesinternal.ByokTestResult, error)
	ListLocalComputerByokModels(ctx context.Context, target ModelSourceTarget, endpoint nodeservicesinternal.ByokEndpointInput) (nodeservicesinternal.ByokModelList, error)
}

// LocalComputerModelSource reads the Computer's active model source.
func (g *HTTPGateway) LocalComputerModelSource(ctx context.Context, target ModelSourceTarget) (nodeservicesinternal.ModelSourceStatus, error) {
	if !validModelSourceTarget(target) {
		return nodeservicesinternal.ModelSourceStatus{}, ErrLocalComputerNotFound
	}
	probeCtx, cancel := context.WithTimeout(ctx, localModelSourceProbeTimeout)
	defer cancel()
	response, err := g.modelSourceClient.GetLocalComputerModelSourceWithResponse(probeCtx, target.TenantID, target.OwnerActorID, target.ComputerID)
	if err != nil {
		return nodeservicesinternal.ModelSourceStatus{}, fmt.Errorf("model source status: %w", err)
	}
	if response.StatusCode() == http.StatusOK && response.JSON200 != nil {
		return *response.JSON200, nil
	}
	return nodeservicesinternal.ModelSourceStatus{}, modelSourceGatewayError(response.StatusCode(),
		firstError(response.JSON409, response.JSON502, response.JSON503))
}

// ApplyLocalComputerModelSource switches the Computer's model source and
// returns the status the Computer reports after the switch.
func (g *HTTPGateway) ApplyLocalComputerModelSource(ctx context.Context, target ModelSourceTarget, command nodeservicesinternal.ModelSourceApplyCommand) (nodeservicesinternal.ModelSourceStatus, error) {
	if !validModelSourceTarget(target) {
		return nodeservicesinternal.ModelSourceStatus{}, ErrLocalComputerNotFound
	}
	response, err := g.modelSourceClient.ApplyLocalComputerModelSourceWithResponse(ctx, target.TenantID, target.OwnerActorID, target.ComputerID, command)
	if err != nil {
		// The transport error can wrap the request but never its body.
		return nodeservicesinternal.ModelSourceStatus{}, fmt.Errorf("model source apply: %w", err)
	}
	if response.StatusCode() == http.StatusOK && response.JSON200 != nil {
		return *response.JSON200, nil
	}
	return nodeservicesinternal.ModelSourceStatus{}, modelSourceGatewayError(response.StatusCode(),
		firstError(response.JSON400, response.JSON409, response.JSON502, response.JSON503))
}

// TestLocalComputerByok probes a BYOK endpoint from the Computer without
// saving it.
func (g *HTTPGateway) TestLocalComputerByok(ctx context.Context, target ModelSourceTarget, request nodeservicesinternal.ByokTestRequest) (nodeservicesinternal.ByokTestResult, error) {
	if !validModelSourceTarget(target) {
		return nodeservicesinternal.ByokTestResult{}, ErrLocalComputerNotFound
	}
	probeCtx, cancel := context.WithTimeout(ctx, localModelSourceProbeTimeout)
	defer cancel()
	response, err := g.modelSourceClient.TestLocalComputerByokWithResponse(probeCtx, target.TenantID, target.OwnerActorID, target.ComputerID, request)
	if err != nil {
		return nodeservicesinternal.ByokTestResult{}, fmt.Errorf("BYOK test: %w", err)
	}
	if response.StatusCode() == http.StatusOK && response.JSON200 != nil {
		return *response.JSON200, nil
	}
	return nodeservicesinternal.ByokTestResult{}, modelSourceGatewayError(response.StatusCode(),
		firstError(response.JSON400, response.JSON409, response.JSON502, response.JSON503))
}

// ListLocalComputerByokModels lists the models a BYOK endpoint serves, asked
// from the Computer so the key never leaves it.
func (g *HTTPGateway) ListLocalComputerByokModels(ctx context.Context, target ModelSourceTarget, endpoint nodeservicesinternal.ByokEndpointInput) (nodeservicesinternal.ByokModelList, error) {
	if !validModelSourceTarget(target) {
		return nodeservicesinternal.ByokModelList{}, ErrLocalComputerNotFound
	}
	probeCtx, cancel := context.WithTimeout(ctx, localModelSourceProbeTimeout)
	defer cancel()
	response, err := g.modelSourceClient.ListLocalComputerByokModelsWithResponse(probeCtx, target.TenantID, target.OwnerActorID, target.ComputerID, endpoint)
	if err != nil {
		return nodeservicesinternal.ByokModelList{}, fmt.Errorf("BYOK models: %w", err)
	}
	if response.StatusCode() == http.StatusOK && response.JSON200 != nil {
		return *response.JSON200, nil
	}
	return nodeservicesinternal.ByokModelList{}, modelSourceGatewayError(response.StatusCode(),
		firstError(response.JSON400, response.JSON409, response.JSON502, response.JSON503))
}

func validModelSourceTarget(target ModelSourceTarget) bool {
	return opaqueIDPattern.MatchString(target.TenantID) && opaqueIDPattern.MatchString(target.OwnerActorID) &&
		opaqueIDPattern.MatchString(target.ComputerID)
}

func modelSourceGatewayError(status int, body *nodeservicesinternal.ErrorResponse) error {
	switch {
	case status == http.StatusNotFound:
		return ErrLocalComputerNotFound
	case body != nil && body.Error.Code == "LOCAL_COMPUTER_OFFLINE":
		return ErrLocalComputerOffline
	case body != nil && body.Error.Code != "":
		return &ModelSourceError{Code: body.Error.Code, Message: body.Error.Message}
	}
	return fmt.Errorf("AgentManagement returned status %d for a model source command", status)
}
