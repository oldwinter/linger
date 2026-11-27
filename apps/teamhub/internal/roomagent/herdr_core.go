package roomagent

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	api "github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
)

// Errors returned by owner-scoped herdr-core Computer calls.
var (
	// ErrHerdrCoreUnsupported means the connected Computer release does not advertise herdr_core_v1.
	ErrHerdrCoreUnsupported = errors.New("Local Computer does not support herdr-core")
	// ErrHerdrCoreTimeout means the Computer did not finish the herdr-core call before the deadline.
	ErrHerdrCoreTimeout = errors.New("Local Computer did not confirm the herdr-core call in time")
)

// LocalComputerHerdrCore invokes owner-scoped herdr-core tools on a Local Computer.
type LocalComputerHerdrCore interface {
	CallLocalComputerHerdrCore(ctx context.Context, call LocalComputerHerdrCoreCall) (map[string]any, error)
}

// LocalComputerHerdrCoreCall names an owner-scoped herdr-core tool invocation.
type LocalComputerHerdrCoreCall struct {
	TenantID     string
	OwnerActorID string
	ComputerID   string
	ToolName     string
	Arguments    map[string]any
	DeadlineMs   int
}

// CallLocalComputerHerdrCore invokes one structured herdr_core tool on an owned
// Local Computer through Node Services.
func (g *HTTPGateway) CallLocalComputerHerdrCore(ctx context.Context, call LocalComputerHerdrCoreCall) (map[string]any, error) {
	if !opaqueIDPattern.MatchString(call.TenantID) || !opaqueIDPattern.MatchString(call.OwnerActorID) || !opaqueIDPattern.MatchString(call.ComputerID) {
		return nil, ErrLocalComputerNotFound
	}
	args := call.Arguments
	if args == nil {
		args = map[string]any{}
	}
	request := api.LocalComputerHerdrCoreCallRequest{
		ToolName:  api.HerdrCoreToolName(call.ToolName),
		Arguments: args,
	}
	if call.DeadlineMs > 0 {
		deadline := call.DeadlineMs
		request.DeadlineMs = &deadline
	}
	response, err := g.toolClient.CallLocalComputerHerdrCoreWithResponse(
		ctx, call.TenantID, call.OwnerActorID, call.ComputerID, request,
	)
	if err != nil {
		return nil, ErrHerdrCoreTimeout
	}
	switch response.StatusCode() {
	case http.StatusOK:
		if response.JSON200 == nil {
			return nil, fmt.Errorf("AgentManagement returned empty herdr-core result for %s", call.ToolName)
		}
		result := response.JSON200.Result
		if status, ok := result["status"].(string); ok {
			switch status {
			case "outcome_unknown":
				return nil, ErrHerdrCoreTimeout
			case "busy", "error", "unavailable", "not_found", "terminal_not_found", "doc_not_found", "version_conflict", "conflict", "invalid_request", "invalid_arguments", "terminal_closed", "terminal_not_blocked":
				detail, _ := result["detail"].(string)
				if detail == "" {
					detail, _ = result["message"].(string)
				}
				if detail == "" {
					detail = "herdr-core call returned status " + status
				}
				return nil, &LocalComputerToolError{Code: status, Message: detail}
			}
		}
		return result, nil
	case http.StatusBadRequest:
		msg := "Invalid herdr-core request"
		if response.JSON400 != nil && response.JSON400.Error.Message != "" {
			msg = response.JSON400.Error.Message
		}
		return nil, &LocalComputerToolError{Code: "invalid_request", Message: msg}
	case http.StatusNotFound:
		return nil, ErrLocalComputerNotFound
	case http.StatusConflict:
		if response.JSON409 != nil && response.JSON409.Error.Code == "HERDR_CORE_UNSUPPORTED" {
			return nil, ErrHerdrCoreUnsupported
		}
		return nil, ErrLocalComputerOffline
	case http.StatusServiceUnavailable:
		return nil, ErrLocalComputerOffline
	default:
		return nil, fmt.Errorf("AgentManagement returned status %d for herdr-core %s: %s", response.StatusCode(), call.ToolName, truncateUTF8(string(response.Body), 1000))
	}
}
