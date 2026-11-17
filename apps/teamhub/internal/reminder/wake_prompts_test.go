package reminder

import (
	"io/fs"
	"path"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	builtinskills "github.com/simplexai-labs/linger/skills"
	"gopkg.in/yaml.v3"
)

func TestTrackingRoutineWakePutsItsNoteBeforeTheInstruction(t *testing.T) {
	record := store.RoomReminder{
		Instruction:     "Remind the Human about the review. Look up first: where the pricing talk was left.",
		TrackingItemID:  pgtype.Text{String: "ti_review", Valid: true},
		TrackingPurpose: pgtype.Text{String: "pre-meeting reminder", Valid: true},
	}
	body := wakeInstruction(record)
	note, instruction := strings.Index(body, "serves Tracking Item ti_review"), strings.Index(body, record.Instruction)
	if note < 0 || instruction <= note || !strings.Contains(body[:instruction], "Look up nothing it does not ask for") {
		t.Fatalf("wake=%q", body)
	}
}

func TestPlainRoutineWakeGetsNothingAdded(t *testing.T) {
	if note := trackingNote(store.RoomReminder{Instruction: "Start the NBA deck at 14:00 on Wednesday."}); note != "" {
		t.Fatalf("plain Routine note=%q", note)
	}
}

func TestArrangingTellsHowToAskForALookUp(t *testing.T) {
	arranging := Prompt(Arranging, nil)
	if !strings.Contains(arranging, "--content") || !strings.Contains(arranging, `"Look up first: `) {
		t.Fatalf("arranging=%q", arranging)
	}
	// It names exactly the guides of the package new Agents get, so every
	// guide is reachable and none it names is missing.
	pkg := proactiveSkillPackage(t)
	guides, err := fs.Glob(builtinskills.FS, path.Join(pkg, "references", "*.md"))
	if err != nil || len(guides) == 0 {
		t.Fatalf("guides of %s: %v %v", pkg, guides, err)
	}
	for _, guide := range guides {
		if !strings.Contains(arranging, "references/"+path.Base(guide)) {
			t.Fatalf("arranging misses %s: %q", guide, arranging)
		}
	}
	for _, named := range regexp.MustCompile(`references/[a-z-]+\.md`).FindAllString(arranging, -1) {
		if _, err := fs.Stat(builtinskills.FS, path.Join(pkg, named)); err != nil {
			t.Fatalf("arranging names %s, which %s lacks: %v", named, pkg, err)
		}
	}
}

func TestRoutineWakeAllowsAPreparedDocumentOrDeck(t *testing.T) {
	note := trackingNote(store.RoomReminder{TrackingItemID: pgtype.Text{String: "ti_review", Valid: true}})
	if !strings.Contains(note, "links to the document or deck") {
		t.Fatalf("tracking note=%q", note)
	}
	// The Skill says how to make a document or deck; the meetings guide says
	// which meetings deserve one and where to look.
	pkg := proactiveSkillPackage(t)
	skill, err := builtinskills.FS.ReadFile(path.Join(pkg, "SKILL.md"))
	for _, want := range []string{"teamhub docs create", "slide-deck Skill", "who will read it"} {
		if err != nil || !strings.Contains(string(skill), want) {
			t.Fatalf("SKILL.md misses %q: %v", want, err)
		}
	}
	meetings, err := builtinskills.FS.ReadFile(path.Join(pkg, "references", "meetings.md"))
	for _, want := range []string{"prep document", "a deck when the Human presents", "from the web", "earlier meetings with the same people"} {
		if err != nil || !strings.Contains(string(meetings), want) {
			t.Fatalf("meetings guide misses %q: %v", want, err)
		}
	}
}

// proactiveSkillPackage is the proactive-response package the catalog
// bootstraps, the one new Agents read.
func proactiveSkillPackage(t *testing.T) string {
	t.Helper()
	raw, err := builtinskills.FS.ReadFile("builtin/catalog.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Skills []struct {
			SkillID             string `yaml:"skill_id"`
			BootstrapManifestID string `yaml:"bootstrap_manifest_id"`
			Manifests           []struct {
				ManifestID  string `yaml:"manifest_id"`
				PackagePath string `yaml:"package_path"`
			} `yaml:"manifests"`
		} `yaml:"skills"`
	}
	if err := yaml.Unmarshal(raw, &catalog); err != nil {
		t.Fatal(err)
	}
	for _, skill := range catalog.Skills {
		if skill.SkillID != "simplexai_proactive_response" {
			continue
		}
		for _, manifest := range skill.Manifests {
			if manifest.ManifestID == skill.BootstrapManifestID {
				return manifest.PackagePath
			}
		}
	}
	t.Fatal("catalog has no bootstrap package for proactive-response")
	return ""
}
