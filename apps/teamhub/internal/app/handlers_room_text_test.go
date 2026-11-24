package app

import (
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/roomcreation"
)

func TestValidRoomTextCountsCharacters(t *testing.T) {
	t.Parallel()

	han := strings.Repeat("\u6c49", roomcreation.MaxNameRunes)
	cases := []struct {
		name        string
		value       *string
		description *string
		want        bool
	}{
		{"120 Han characters", &han, nil, true},
		{"121 Han characters", pointer(han + "\u6c49"), nil, false},
		{"120 ASCII characters", pointer(strings.Repeat("t", 120)), nil, true},
		{"121 ASCII characters", pointer(strings.Repeat("t", 121)), nil, false},
		{"blank name", pointer("   "), nil, false},
		{"spaces around a full-length name", pointer("  " + han + "  "), nil, true},
		{"2000 Han description", pointer("Room"), pointer(strings.Repeat("\u4248", roomcreation.MaxDescriptionRunes)), true},
		{"2001 Han description", pointer("Room"), pointer(strings.Repeat("\u4248", roomcreation.MaxDescriptionRunes+1)), false},
		{"no fields to check", nil, nil, true},
		{"kana description at the bound", pointer("Room"), pointer(strings.Repeat("\u3042", roomcreation.MaxDescriptionRunes)), true},
		{"kana description past the bound", pointer("Room"), pointer(strings.Repeat("\u3042", roomcreation.MaxDescriptionRunes+1)), false},
	}
	for _, test := range cases {
		if got := validRoomText(test.value, test.description); got != test.want {
			t.Fatalf("%s: validRoomText = %v, want %v", test.name, got, test.want)
		}
	}
}

func pointer(value string) *string { return &value }
