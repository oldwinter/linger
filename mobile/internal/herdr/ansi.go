package herdr

import (
	"strings"
)

// SanitizeTerminalText strips ANSI/VT escape sequences (CSI, OSC, DCS, and
// two-byte ESC codes) and normalizes carriage returns while preserving UTF-8
// runes, tabs, and newlines for readable monospace rendering on mobile.
func SanitizeTerminalText(raw string) string {
	if raw == "" {
		return ""
	}
	var out strings.Builder
	out.Grow(len(raw))

	n := len(raw)
	for i := 0; i < n; {
		b := raw[i]
		if b == 0x1b {
			i = skipEscapeSequence(raw, i)
			continue
		}
		if b == '\r' {
			if i+1 < n && raw[i+1] == '\n' {
				out.WriteByte('\n')
				i += 2
				continue
			}
			// Standalone CR overwrites the current line (e.g. spinner/progress updates).
			cur := out.String()
			if idx := strings.LastIndexByte(cur, '\n'); idx >= 0 {
				out.Reset()
				out.WriteString(cur[:idx+1])
			} else {
				out.Reset()
			}
			i++
			continue
		}
		// Drop non-printable C0 control bytes except newline and tab.
		if b < 0x20 && b != '\n' && b != '\t' {
			i++
			continue
		}
		if b == 0x7f {
			i++
			continue
		}
		out.WriteByte(b)
		i++
	}
	return out.String()
}

func skipEscapeSequence(s string, start int) int {
	n := len(s)
	if start+1 >= n {
		return n
	}
	next := s[start+1]
	switch next {
	case '[':
		// CSI: ESC [ params intermediates final(0x40..0x7E)
		i := start + 2
		for i < n {
			c := s[i]
			i++
			if c >= 0x40 && c <= 0x7e {
				return i
			}
		}
		return n
	case ']', 'P', '^', '_':
		// OSC / DCS / PM / APC: terminated by BEL (0x07) or ST (ESC \)
		i := start + 2
		for i < n {
			if s[i] == 0x07 {
				return i + 1
			}
			if s[i] == 0x1b && i+1 < n && s[i+1] == '\\' {
				return i + 2
			}
			i++
		}
		return n
	case '(', ')', '*', '+':
		// Character set designation: ESC ( X
		if start+3 <= n {
			return start + 3
		}
		return n
	default:
		// Standard 2-byte ESC sequence.
		return start + 2
	}
}
