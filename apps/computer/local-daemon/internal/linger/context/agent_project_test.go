package lingercontext

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureGivesEachContextItsOwnAgentProject(t *testing.T) {
	content := newTestContent(t)
	store := openTestStore(t)
	source := ContentSource{ContentURL: content.url()}
	playground := []Mapping{{Kind: "playground", TargetPath: "playground", Access: "read_write"}}
	first, err := store.Ensure(t.Context(), testRequest("context-1", content.publish(t, "context-1", "runtime-1", playground, nil, nil)), source)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Ensure(t.Context(), testRequest("context-2", content.publish(t, "context-2", "runtime-1", playground, nil, nil)), source)
	if err != nil {
		t.Fatal(err)
	}
	if first.WorkspacePath == second.WorkspacePath {
		t.Fatal("two Contexts share one workspace")
	}
	for _, record := range []ViewRecord{first, second} {
		for _, file := range agentProjectFiles {
			got, err := os.ReadFile(filepath.Join(record.WorkspacePath, "agent", file.name))
			if err != nil || string(got) != file.content {
				t.Fatalf("%s=%q err=%v", file.name, got, err)
			}
		}
	}
	if err := os.WriteFile(filepath.Join(first.WorkspacePath, "agent", "package.json"), []byte(`{"dependencies":{"pptxgenjs":"^4.0.0"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(filepath.Join(second.WorkspacePath, "agent", "package.json")); err != nil || string(got) != defaultAgentProjectFile("package.json") {
		t.Fatalf("another Context's package.json=%q err=%v", got, err)
	}
}

func TestEnsureKeepsWhatTheAgentInstalled(t *testing.T) {
	content := newTestContent(t)
	store := openTestStore(t)
	source := ContentSource{ContentURL: content.url()}
	first := content.file("message.md", []byte("first\n"))
	digest := content.publish(t, "context-1", "runtime-1", []Mapping{
		{Kind: "inbox_view", TargetPath: "inbox", Access: "read_only", Files: []FileInput{first}},
	}, nil, nil)
	record, err := store.Ensure(t.Context(), testRequest("context-1", digest), source)
	if err != nil {
		t.Fatal(err)
	}
	installed := map[string]string{
		"pyproject.toml":                      "[project]\nname = \"context-packages\"\nversion = \"0.0.0\"\ndependencies = [\"pypdf>=5\"]\n",
		"package.json":                        `{"private":true,"dependencies":{"pptxgenjs":"^4.0.0"}}`,
		"node_modules/pptxgenjs/package.json": `{"name":"pptxgenjs"}`,
	}
	for name, body := range installed {
		target := filepath.Join(record.WorkspacePath, "agent", name)
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	next := content.file("message.md", []byte("second\n"))
	refreshed := content.publish(t, "context-1", "runtime-1", []Mapping{
		{Kind: "inbox_view", TargetPath: "inbox", Access: "read_only", Files: []FileInput{next}},
	}, nil, nil)
	if _, err := store.Ensure(t.Context(), testRequest("context-1", refreshed), source); err != nil {
		t.Fatal(err)
	}
	for name, body := range installed {
		if got, err := os.ReadFile(filepath.Join(record.WorkspacePath, "agent", name)); err != nil || string(got) != body {
			t.Fatalf("refresh changed %s: %q err=%v", name, got, err)
		}
	}

	// A file the Agent removed comes back on the next Run; the others stay.
	if err := os.Remove(filepath.Join(record.WorkspacePath, "agent", "package.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Ensure(t.Context(), testRequest("context-1", refreshed), source); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(filepath.Join(record.WorkspacePath, "agent", "package.json")); err != nil || string(got) != defaultAgentProjectFile("package.json") {
		t.Fatalf("restored package.json=%q err=%v", got, err)
	}
	if got, err := os.ReadFile(filepath.Join(record.WorkspacePath, "agent", "pyproject.toml")); err != nil || string(got) != installed["pyproject.toml"] {
		t.Fatalf("pyproject.toml=%q err=%v", got, err)
	}
}

func TestEnsureLeavesAnAgentEntryThatIsNotADirectory(t *testing.T) {
	content := newTestContent(t)
	store := openTestStore(t)
	source := ContentSource{ContentURL: content.url()}
	digest := content.publish(t, "context-1", "runtime-1", nil, nil, nil)
	record, err := store.Ensure(t.Context(), testRequest("context-1", digest), source)
	if err != nil {
		t.Fatal(err)
	}
	agent := filepath.Join(record.WorkspacePath, "agent")
	if err := os.RemoveAll(agent); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(agent, []byte("notes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Ensure(t.Context(), testRequest("context-1", digest), source); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(agent); err != nil || string(got) != "notes" {
		t.Fatalf("agent=%q err=%v", got, err)
	}
}

func defaultAgentProjectFile(name string) string {
	for _, file := range agentProjectFiles {
		if file.name == name {
			return file.content
		}
	}
	return ""
}
