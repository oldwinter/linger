package native

import (
	"bytes"
	"encoding/json"
	"maps"
	"os"
	"slices"
	"strings"
)

const claudeDisableNonessentialTrafficKey = "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"

// ClaudeEnvironment returns a copy of env with
// CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 set unless the caller already
// configured it, suppressing Claude Code's periodic /api/hello connectivity
// checks against local gateways without mutating env.
func ClaudeEnvironment(env map[string]string) map[string]string {
	cloned := maps.Clone(env)
	if cloned == nil {
		cloned = make(map[string]string, 1)
	}
	if !hasEnvKey(cloned, claudeDisableNonessentialTrafficKey) {
		cloned[claudeDisableNonessentialTrafficKey] = "1"
	}
	return cloned
}

// claudeInvocation returns a copy of inv whose child environment sets
// CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 unless the caller already
// configured it, without mutating inv.Env.
func claudeInvocation(inv Invocation) Invocation {
	out := inv
	out.Leading = slices.Clone(inv.Leading)
	var base []string
	if inv.Env == nil {
		base = os.Environ()
	} else {
		base = slices.Clone(inv.Env)
	}
	if !hasEnvEntry(base, claudeDisableNonessentialTrafficKey) {
		base = append(base, claudeDisableNonessentialTrafficKey+"=1")
	}
	out.Env = base
	return out
}

func hasEnvKey(env map[string]string, name string) bool {
	for key := range env {
		if strings.EqualFold(key, name) {
			return true
		}
	}
	return false
}

func hasEnvEntry(entries []string, name string) bool {
	for _, entry := range entries {
		if key, _, ok := strings.Cut(entry, "="); ok && strings.EqualFold(key, name) {
			return true
		}
	}
	return false
}

// Keys a parent Claude Code session sets about itself. A child must not
// inherit them, or it would identify as that session.
var claudeSessionKeys = []string{
	"CLAUDECODE",
	"CLAUDE_CODE_ENTRYPOINT",
	"CLAUDE_CODE_EXECPATH",
	"CLAUDE_CODE_SESSION_ID",
	"CLAUDE_CODE_SSE_PORT",
}

// childEnvironment renders Profile.Env for a provider process. It never
// consults the Daemon's own environment, which carries Daemon secrets.
func childEnvironment(env map[string]string) []string {
	kept := make(map[string]string, len(env))
	for key, value := range env {
		if !claudeSessionKey(key) {
			kept[key] = value
		}
	}
	return renderEnvironment(kept)
}

func claudeSessionKey(key string) bool {
	upper := strings.ToUpper(key)
	if strings.HasPrefix(upper, "CLAUDECODE_") {
		return true
	}
	for _, reserved := range claudeSessionKeys {
		if upper == reserved {
			return true
		}
	}
	return false
}

// profileInvocation is the invocation of a provider process: the profile's
// program, optional wrapper arguments, and the filtered child environment.
func profileInvocation(program string, leading []string, env map[string]string) Invocation {
	invocation := NewInvocation(program, leading)
	invocation.Env = childEnvironment(env)
	return invocation
}

// mcpNamespace is the MCP set an Operation runs with. The Daemon owns the MCP
// namespace of every Operation, so no set means the empty set, never the
// CLI's own servers: a prepare and the Run that adopts it always match.
func mcpNamespace(raw json.RawMessage) json.RawMessage {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return json.RawMessage(`{"mcpServers":{}}`)
	}
	return raw
}
