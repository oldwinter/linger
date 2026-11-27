package herdrcore

import (
	"strings"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/provider/redact"
)

// maxTailBytes keeps a terminal tail comfortably within the Runner Gateway payload budget.
const maxTailBytes = 6000

// RedactSecrets removes obvious secret values and private keys from text
// without truncating from the front, suitable for bounded single-value fields
// such as OSC 7501 status messages.
func RedactSecrets(text string) string {
	return strings.TrimRight(redact.Text(text), " \t\r\n")
}

// Redact removes obvious secret values and private keys from terminal text and
// bounds the retained tail to maxTailBytes on a UTF-8 line boundary.
func Redact(text string) string {
	return redact.Tail(redact.Text(text), maxTailBytes)
}
