package native

import (
	"bytes"
	"encoding/json"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/permission"
)

// piReviewDialog titles the input dialog the managed extension opens for
// each command or MCP call; its placeholder is the call as JSON.
const piReviewDialog = "linger.permission_review"

// piVerdict is the answer the managed extension parses.
type piVerdict struct {
	Allow   bool   `json:"allow"`
	Message string `json:"message,omitempty"`
}

// answerDialog answers an extension UI request. The managed extension's
// review goes to the bound turn; any other dialog is cancelled, as no one
// can answer it, and notifications need no answer.
func (p *piProcess) answerDialog(frame []byte) {
	var request struct {
		ID          string `json:"id"`
		Method      string `json:"method"`
		Title       string `json:"title"`
		Placeholder string `json:"placeholder"`
	}
	if json.Unmarshal(frame, &request) != nil || request.ID == "" {
		return
	}
	switch request.Method {
	case "select", "confirm", "input", "editor":
	default:
		return
	}
	if request.Method != "input" || request.Title != piReviewDialog {
		go p.writeFrame(map[string]any{"type": "extension_ui_response", "id": request.ID, "cancelled": true})
		return
	}
	turn := p.boundTurn()
	go func() {
		verdict := piVerdict{Message: "No Run is waiting for this tool call"}
		if turn != nil {
			verdict = turn.review(request.Placeholder)
		}
		value, _ := json.Marshal(verdict)
		p.writeFrame(map[string]any{"type": "extension_ui_response", "id": request.ID, "value": string(value)})
	}()
}

// writeFrame writes one frame to Pi's stdin. A failed write leaves the
// dialog open until the turn ends and Pi is stopped or aborted.
func (p *piProcess) writeFrame(frame map[string]any) {
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if encoder.Encode(frame) != nil {
		return
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	_, _ = p.stdin.Write(encoded.Bytes())
}

// review judges one call the managed extension asked about. A turn without
// a reviewer allows every call, as Pi then runs with the Agent's full local
// authority.
func (t *piTurn) review(payload string) piVerdict {
	if t.reviewer == nil {
		return piVerdict{Allow: true}
	}
	var call struct {
		ToolName string         `json:"toolName"`
		Input    map[string]any `json:"input"`
	}
	if json.Unmarshal([]byte(payload), &call) != nil || call.ToolName == "" {
		return piVerdict{Message: "The tool call could not be read for permission review"}
	}
	verdict := t.reviewer.Review(t.runCtx, toolReview("pi", call.ToolName, call.ToolName == "bash", call.Input, t.dir))
	return piVerdict{Allow: verdict.Decision == permission.Allow, Message: verdict.Message}
}
