package herdr

import "github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/provider/redact"

// maxTailBytes keeps a pane tail well inside the 8000 characters the Runner
// Gateway allows.
const maxTailBytes = 6000

// Redact removes obvious secrets from pane text and keeps its last lines
// within maxTailBytes. It is a best effort over common shapes, not a
// guarantee; the tail only helps the user see what the agent is asking.
func Redact(text string) string {
	return redact.Tail(redact.Text(text), maxTailBytes)
}
