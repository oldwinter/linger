package agenttemplates

import (
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentregistry"
)

func TestInstructionsBoundCountsCharacters(t *testing.T) {
	t.Parallel()

	base := Template{
		TemplateID:   "example",
		Name:         "Example",
		Instructions: "Do the work.",
		AvatarKey:    "",
	}
	han := strings.Repeat("\u6c49", agentregistry.MaxInstructionsRunes)
	candidate := base
	candidate.Instructions = han
	if err := validate(&candidate, "example.json"); err != nil {
		t.Fatalf("instructions of %d characters must be valid: %v", agentregistry.MaxInstructionsRunes, err)
	}
	candidate.Instructions = han + "\u6c49"
	if err := validate(&candidate, "example.json"); err == nil {
		t.Fatal("instructions of one character more must be rejected")
	}
	candidate.Instructions = strings.Repeat("t", agentregistry.MaxInstructionsRunes)
	if err := validate(&candidate, "example.json"); err != nil {
		t.Fatalf("the ASCII bound must stay %d characters: %v", agentregistry.MaxInstructionsRunes, err)
	}
}
