package lingercontext

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func orphanTestView(fixture *projectionRecoveryFixture, seed, content string) View {
	view := testView(seed)
	view.Mappings = []Mapping{
		fixture.mapping("inbox_view", "inbox", "read_only", "thread.md", content),
		{Kind: "playground", TargetPath: "playground", Access: "read_write"},
	}
	return view
}

func orphanedDirectories(t *testing.T, workspace string) []string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(filepath.Dir(workspace), orphanedProjectionPrefix+"*"))
	if err != nil {
		t.Fatal(err)
	}
	return matches
}

func requireContent(t *testing.T, path, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil || string(content) != expected {
		t.Fatalf("%s = %q, %v; want %q", path, content, err, expected)
	}
}

// A store lost while its workspaces survived, as when a data folder moves
// between app versions without its SQLite file, used to refuse every later
// View of the Context with the same conflict.
func TestLostStoreSetsAsideOrphanedProjectionAndRecovers(t *testing.T) {
	fixture := newProjectionRecoveryFixture(t)
	first := requireProjection(t, fixture, orphanTestView(fixture, "a", "old thread"))
	work := filepath.Join(first.WorkspacePath, "playground", "report.md")
	if err := os.WriteFile(work, []byte("agent work"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.store.db.Exec(`DELETE FROM context_views_v3`); err != nil {
		t.Fatal(err)
	}
	fixture.restart(t)

	for _, seed := range []string{"b", "c"} {
		ready := requireProjection(t, fixture, orphanTestView(fixture, seed, "new thread "+seed))
		if ready.WorkspacePath != first.WorkspacePath {
			t.Fatal("recovery moved the workspace")
		}
		requireContent(t, filepath.Join(ready.WorkspacePath, "inbox", "thread.md"), "new thread "+seed)
	}
	requireContent(t, work, "agent work")
	orphaned := orphanedDirectories(t, first.WorkspacePath)
	if len(orphaned) != 1 {
		t.Fatalf("orphaned projections = %v; want one, set aside only once", orphaned)
	}
	requireContent(t, filepath.Join(orphaned[0], "inbox", "thread.md"), "old thread")
	if _, err := os.Stat(filepath.Join(orphaned[0], "playground")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a writable mapping was set aside", err)
	}
}

// A data folder moved under a new name leaves rows naming the old path. The
// directory those rows name is gone, so no row claims the current workspace.
func TestRowNamingMovedDataFolderRecovers(t *testing.T) {
	fixture := newProjectionRecoveryFixture(t)
	first := requireProjection(t, fixture, orphanTestView(fixture, "a", "old thread"))
	moved := filepath.Join(filepath.Dir(fixture.viewsPath), "Simplex", "views", filepath.Base(filepath.Dir(first.WorkspacePath)), "workspace")
	if _, err := fixture.store.db.Exec(`UPDATE context_views_v3 SET workspace_path=?`, moved); err != nil {
		t.Fatal(err)
	}
	fixture.restart(t)
	ready := requireProjection(t, fixture, orphanTestView(fixture, "b", "new thread"))
	requireContent(t, filepath.Join(ready.WorkspacePath, "inbox", "thread.md"), "new thread")
	record, err := fixture.store.CurrentView(context.Background(), ready.View.ExecutionContextKey, ready.View.ViewDigest)
	if err != nil || record.WorkspacePath != first.WorkspacePath {
		t.Fatal("the row was not rewritten to the current workspace", record.WorkspacePath, err)
	}
}

// Windows spells one directory several ways (letter case, 8.3 short names,
// junctions). A row naming another spelling still owns its files, so nothing
// is set aside and unchanged files are reused.
func TestRowNamingAnotherSpellingOfWorkspaceKeepsOwnership(t *testing.T) {
	fixture := newProjectionRecoveryFixture(t)
	first := requireProjection(t, fixture, orphanTestView(fixture, "a", "same thread"))
	alias := filepath.Join(filepath.Dir(fixture.viewsPath), "views-alias")
	if err := os.Symlink(fixture.viewsPath, alias); err != nil {
		t.Skip("directory links are unavailable:", err)
	}
	spelled := filepath.Join(alias, filepath.Base(filepath.Dir(first.WorkspacePath)), "workspace")
	if _, err := fixture.store.db.Exec(`UPDATE context_views_v3 SET workspace_path=?`, spelled); err != nil {
		t.Fatal(err)
	}
	fixture.restart(t)
	view := orphanTestView(fixture, "b", "same thread")
	ready := requireProjection(t, fixture, view)
	requireContent(t, filepath.Join(ready.WorkspacePath, "inbox", "thread.md"), "same thread")
	if orphaned := orphanedDirectories(t, first.WorkspacePath); len(orphaned) != 0 {
		t.Fatalf("an owned projection was set aside: %v", orphaned)
	}
}

// A workspace the store still claims keeps refusing unowned files, and the
// refusal names the file.
func TestClaimedWorkspaceConflictNamesItsCause(t *testing.T) {
	fixture := newProjectionRecoveryFixture(t)
	first := requireProjection(t, fixture, orphanTestView(fixture, "a", "thread"))
	skills := filepath.Join(first.WorkspacePath, ".agents", "skills")
	if err := os.MkdirAll(skills, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skills, "note.txt"), []byte("local"), 0o600); err != nil {
		t.Fatal(err)
	}
	next := orphanTestView(fixture, "b", "thread")
	next.Mappings = append(next.Mappings, fixture.mapping("skills", ".agents/skills", "read_only", "note.txt", "remote"))
	_, err := fixture.store.applyTestView(context.Background(), next, fixture.server.URL)
	if !errors.Is(err, ErrContextConflict) || !strings.Contains(err.Error(), "note.txt") {
		t.Fatalf("conflict = %v; want ErrContextConflict naming note.txt", err)
	}
	requireContent(t, filepath.Join(skills, "note.txt"), "local")
	if orphaned := orphanedDirectories(t, first.WorkspacePath); len(orphaned) != 0 {
		t.Fatalf("a claimed workspace was set aside: %v", orphaned)
	}
}

func TestSameWorkspacePath(t *testing.T) {
	root := t.TempDir()
	existing := filepath.Join(root, "workspace")
	if err := os.Mkdir(existing, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		retained string
		want     bool
	}{
		{existing, true},
		{existing + string(filepath.Separator) + ".", true},
		{"", false},
		{filepath.Join(root, "missing"), false},
		{root, false},
	} {
		if got := sameWorkspacePath(test.retained, existing); got != test.want {
			t.Errorf("sameWorkspacePath(%q) = %v; want %v", test.retained, got, test.want)
		}
	}
}

func TestSetAsideMovesNothingWhenRootsOverlap(t *testing.T) {
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "inbox"), 0o700); err != nil {
		t.Fatal(err)
	}
	mappings := []Mapping{
		{Kind: "inbox", TargetPath: "inbox", Access: "read_only"},
		{Kind: "playground", TargetPath: "playground", Access: "read_write"},
		{Kind: "skills", TargetPath: "playground/x", Access: "read_only"},
	}
	destination, err := setAsideOrphanedProjection(workspace, mappings)
	if !errors.Is(err, ErrContextConflict) || destination != "" {
		t.Fatalf("setAsideOrphanedProjection = %q, %v; want a conflict", destination, err)
	}
	if _, err := os.Stat(filepath.Join(workspace, "inbox")); err != nil {
		t.Fatalf("inbox moved before the overlap was refused: %v", err)
	}
}
