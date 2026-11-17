package voicequicknotes

import (
	"strings"
	"testing"
)

func TestParseKeepsNotesWithinTheMessageBounds(t *testing.T) {
	notes, err := Parse([]byte(`{"title":"  Product direction   and pricing  ","sections":[
		{"heading":"Pricing","bullets":["Wrap the experience as an API","", "Open the SDK, charge for service","Charge per seat","One too many"]},
		{"heading":"","bullets":["A section without a heading is dropped"]},
		{"heading":"Empty section","bullets":["  "]},
		{"heading":"Audience","bullets":["Founders and investors"]},
		{"heading":"Moat","bullets":["Context"]},
		{"heading":"Next steps","bullets":["Dogfood"]},
		{"heading":"Fifth section","bullets":["Past the limit"]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if notes.Title != "Product direction and pricing" || len(notes.Sections) != maxSections {
		t.Fatalf("notes=%+v", notes)
	}
	if first := notes.Sections[0]; first.Heading != "Pricing" || len(first.Bullets) != maxBullets || first.Bullets[1] != "Open the SDK, charge for service" {
		t.Fatalf("first section=%+v", first)
	}
	if notes.Sections[1].Heading != "Audience" || notes.Sections[3].Heading != "Next steps" {
		t.Fatalf("sections=%+v", notes.Sections)
	}
}

func TestParseClipsLongTextByRuneAndRejectsEmptyNotes(t *testing.T) {
	// A three-byte character, so clipping by bytes would split it.
	long := strings.Repeat("\u957f", maxBulletRunes+10)
	notes, err := Parse([]byte(`{"title":"T","sections":[{"heading":"H","bullets":["` + long + `"]}]}`))
	if err != nil || len([]rune(notes.Sections[0].Bullets[0])) != maxBulletRunes || !strings.HasSuffix(notes.Sections[0].Bullets[0], "…") {
		t.Fatalf("notes=%+v err=%v", notes, err)
	}
	for _, raw := range []string{`{"title":"","sections":[{"heading":"H","bullets":["b"]}]}`, `{"title":"T","sections":[]}`, `not json`} {
		if _, err := Parse([]byte(raw)); err == nil {
			t.Fatalf("%s parsed", raw)
		}
	}
}
