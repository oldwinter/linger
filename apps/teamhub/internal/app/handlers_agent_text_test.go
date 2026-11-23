package app

import (
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentregistry"
)

func TestValidAgentTextCountsCharacters(t *testing.T) {
	t.Parallel()

	han := strings.Repeat("\u6c49", agentregistry.MaxNameRunes)
	if !validAgentText(han, "Instructions") {
		t.Fatal("an Agent name of 120 characters must be valid")
	}
	if validAgentText(han+"\u6c49", "Instructions") {
		t.Fatal("an Agent name of 121 characters must be rejected")
	}
	if !validAgentText(strings.Repeat("t", agentregistry.MaxNameRunes), "Instructions") {
		t.Fatal("the ASCII name bound must stay 120 characters")
	}
	if validAgentText("  ", "Instructions") || validAgentText("Agent", "  ") {
		t.Fatal("a blank name or instructions must be rejected")
	}

	instructions := strings.Repeat("\u4248", agentregistry.MaxInstructionsRunes)
	if !validAgentText("Agent", instructions) {
		t.Fatal("instructions of 50000 characters must be valid")
	}
	if validAgentText("Agent", instructions+"\u4248") {
		t.Fatal("instructions of 50001 characters must be rejected")
	}
	if !validAgentText("Agent", strings.Repeat("t", agentregistry.MaxInstructionsRunes)) {
		t.Fatal("the ASCII instructions bound must stay 50000 characters")
	}
	if validAgentText(string([]byte{0xff}), "Instructions") || validAgentText("Agent", string([]byte{0xff})) {
		t.Fatal("invalid UTF-8 must be rejected")
	}
}

func TestValidAgentNameCountsCharacters(t *testing.T) {
	t.Parallel()

	if !validAgentName(strings.Repeat("\u6c49", agentregistry.MaxNameRunes)) {
		t.Fatal("a rename to 120 characters must be valid")
	}
	if validAgentName(strings.Repeat("\u6c49", agentregistry.MaxNameRunes+1)) {
		t.Fatal("a rename to 121 characters must be rejected")
	}
	if !validAgentName("  " + strings.Repeat("\u6c49", agentregistry.MaxNameRunes) + "  ") {
		t.Fatal("surrounding spaces must not count against the bound")
	}
	if validAgentName("  ") || validAgentName("") || validAgentName(string([]byte{0xff})) {
		t.Fatal("a blank or invalid UTF-8 rename must be rejected")
	}
}
