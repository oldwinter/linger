package herdr

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// maxTailBytes keeps a pane tail well inside the 8000 characters the Runner
// Gateway allows.
const maxTailBytes = 6000

var (
	privateKeyBlock = regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`)
	secretValue     = regexp.MustCompile(`(?i)\b([A-Z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|credential|private[_-]?key)[A-Z0-9_.-]*)(["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"',;]+)`)
	secretTokens    = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{12,}`),
		regexp.MustCompile(`\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}`),
		regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{20,}`),
		regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{20,}`),
		regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}`),
		regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`),
		regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{35}`),
		regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`),
	}
)

// Redact removes obvious secrets from pane text and keeps its last lines
// within maxTailBytes. It is a best effort over common shapes, not a
// guarantee; the tail only helps the user see what the agent is asking.
func Redact(text string) string {
	text = privateKeyBlock.ReplaceAllString(text, "[redacted private key]")
	text = secretValue.ReplaceAllString(text, "$1$2[redacted]")
	for _, pattern := range secretTokens {
		text = pattern.ReplaceAllString(text, "[redacted]")
	}
	text = strings.TrimRight(text, " \t\r\n")
	if len(text) <= maxTailBytes {
		return text
	}
	cut := len(text) - maxTailBytes
	for cut < len(text) && !utf8.RuneStart(text[cut]) {
		cut++
	}
	if newline := strings.IndexByte(text[cut:], '\n'); newline >= 0 && newline < len(text)-cut-1 {
		cut += newline + 1
	}
	return text[cut:]
}
