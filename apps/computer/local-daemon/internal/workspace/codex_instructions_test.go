package workspace

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/pelletier/go-toml/v2"
)

func TestCodexPersonalInstructionsStayOutOfAgentHomes(t *testing.T) {
	root := t.TempDir()
	shared, home := filepath.Join(root, ".codex"), filepath.Join(root, "runtime")
	if err := os.MkdirAll(filepath.Join(shared, "rules"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	opts := CodexHomeOptions{SharedHome: shared, UserHome: root, CodexVersion: "0.153.4"}
	// A home prepared before this rule still holds copies of the user's files.
	for _, name := range codexPersonalInstructionFiles {
		if err := os.WriteFile(filepath.Join(home, name), []byte("stale personal rule"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(shared, name), []byte("personal rule"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(shared, "rules", "mine.md"), []byte("personal rule"), 0600); err != nil {
		t.Fatal(err)
	}
	config := "model = 'm'\ninstructions = 'be brief'\ndeveloper_instructions = 'be brief'\n" +
		"model_instructions_file = 'rules/mine.md'\nexperimental_instructions_file = 'rules/mine.md'\n" +
		"[profiles.work]\ndeveloper_instructions = 'be brief'\nmodel_instructions_file = 'rules/mine.md'\n"
	if err := os.WriteFile(filepath.Join(shared, "config.toml"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareCodexHome(home, opts, slog.Default()); err != nil {
		t.Fatal(err)
	}
	for _, name := range codexPersonalInstructionFiles {
		if _, err := os.Lstat(filepath.Join(home, name)); !os.IsNotExist(err) {
			t.Fatalf("%s reached the Agent home: %v", name, err)
		}
		if data, _ := os.ReadFile(filepath.Join(shared, name)); string(data) != "personal rule" {
			t.Fatal("modified personal source")
		}
	}
	data, err := os.ReadFile(filepath.Join(home, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]any
	if err := toml.Unmarshal(data, &settings); err != nil {
		t.Fatal(err)
	}
	if settings["model"] != "m" {
		t.Fatalf("settings = %v", settings)
	}
	profiles, _ := settings["profiles"].(map[string]any)
	profile, _ := profiles["work"].(map[string]any)
	for _, table := range []map[string]any{settings, profile} {
		for _, key := range []string{"instructions", "developer_instructions", "model_instructions_file", "experimental_instructions_file"} {
			if _, ok := table[key]; ok {
				t.Fatalf("%s reached the Agent home: %v", key, table)
			}
		}
	}
}
