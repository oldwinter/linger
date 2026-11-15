package lingercontext

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// moveViewsRoot closes the fixture's store, renames its view root, and opens the
// store at the new root. The database therefore keeps the retained paths of the
// directory that moved.
func moveViewsRoot(t *testing.T, fixture *projectionRecoveryFixture) string {
	t.Helper()
	if err := fixture.store.Close(); err != nil {
		t.Fatal(err)
	}
	moved := fixture.viewsPath + "-moved"
	if err := os.Rename(fixture.viewsPath, moved); err != nil {
		t.Fatal(err)
	}
	fixture.viewsPath = moved
	store, err := OpenViewStore(fixture.databasePath, moved, fixture.server.Client())
	if err != nil {
		t.Fatal(err)
	}
	fixture.store = store
	return moved
}

func TestApplyAdoptsAWorkspaceWhoseRootMoved(t *testing.T) {
	fixture := newProjectionRecoveryFixture(t)
	initial := testView("a")
	initial.Mappings = []Mapping{
		fixture.mapping("memory", "memory", "read_only", "note.md", "note"),
		{Kind: "playground", TargetPath: "playground", Access: "read_write"},
	}
	first := requireProjection(t, fixture, initial)
	skills := filepath.Join(first.WorkspacePath, ".agents", "skills")
	if err := os.MkdirAll(skills, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skills, "reachable.md"), []byte("reachable"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(first.WorkspacePath, ".claude", "skills")
	if err := os.MkdirAll(filepath.Dir(link), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := createTestDirectoryLink(skills, link); err != nil {
		t.Fatal(err)
	}

	moved := moveViewsRoot(t, fixture)
	next := testView("b")
	next.Mappings = initial.Mappings
	record := requireProjection(t, fixture, next)

	want := contextWorkspace(moved, initial.ExecutionContextKey)
	if record.WorkspacePath != want {
		t.Fatalf("workspace=%q, want the adopted path %q", record.WorkspacePath, want)
	}
	if _, err := os.Lstat(first.WorkspacePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("retained workspace is still present: %v", err)
	}
	if content, err := os.ReadFile(filepath.Join(record.WorkspacePath, "memory", "note.md")); err != nil || string(content) != "note" {
		t.Fatalf("retained read-only file=%q err=%v", content, err)
	}
	adoptedLink := filepath.Join(record.WorkspacePath, ".claude", "skills")
	target, err := os.Readlink(adoptedLink)
	if err != nil || filepath.Clean(target) != filepath.Join(record.WorkspacePath, ".agents", "skills") {
		t.Fatalf("link target=%q err=%v, want the moved target", target, err)
	}
	if content, err := os.ReadFile(filepath.Join(adoptedLink, "reachable.md")); err != nil || string(content) != "reachable" {
		t.Fatalf("adopted link does not reach the moved target: %v", err)
	}
	var stored string
	if err := fixture.store.db.QueryRow(`SELECT workspace_path FROM context_views_v3 WHERE execution_context_key=?`,
		initial.ExecutionContextKey).Scan(&stored); err != nil || stored != want {
		t.Fatalf("stored workspace=%q err=%v, want %q", stored, err, want)
	}
}

func TestApplyRepairsOnlyLinksThatMovedWithTheWorkspace(t *testing.T) {
	fixture := newProjectionRecoveryFixture(t)
	initial := testView("a")
	initial.Mappings = []Mapping{fixture.mapping("memory", "memory", "read_only", "note.md", "note")}
	first := requireProjection(t, fixture, initial)
	skills := filepath.Join(first.WorkspacePath, ".agents", "skills")
	if err := os.MkdirAll(skills, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skills, "reachable.md"), []byte("reachable"), 0o600); err != nil {
		t.Fatal(err)
	}
	movedLink := filepath.Join(first.WorkspacePath, ".claude", "skills")
	if err := os.MkdirAll(filepath.Dir(movedLink), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := createTestDirectoryLink(skills, movedLink); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	resolving := filepath.Join(first.WorkspacePath, "resolving")
	if err := createTestDirectoryLink(outside, resolving); err != nil {
		t.Fatal(err)
	}
	absent := filepath.Join(t.TempDir(), "elsewhere", "skills")
	unrelated := filepath.Join(first.WorkspacePath, "unrelated")
	if err := createTestDirectoryLink(absent, unrelated); err != nil {
		t.Fatal(err)
	}
	missingTail := filepath.Join(first.WorkspacePath, "gone", "target")
	unmatched := filepath.Join(first.WorkspacePath, "unmatched")
	if err := createTestDirectoryLink(missingTail, unmatched); err != nil {
		t.Fatal(err)
	}

	moveViewsRoot(t, fixture)
	next := testView("b")
	next.Mappings = initial.Mappings
	record := requireProjection(t, fixture, next)

	adoptedMovedLink := filepath.Join(record.WorkspacePath, ".claude", "skills")
	if target, err := os.Readlink(adoptedMovedLink); err != nil || filepath.Clean(target) != filepath.Join(record.WorkspacePath, ".agents", "skills") {
		t.Fatalf("moved link target=%q err=%v", target, err)
	}
	if content, err := os.ReadFile(filepath.Join(adoptedMovedLink, "reachable.md")); err != nil || string(content) != "reachable" {
		t.Fatalf("moved link does not reach its target: %v", err)
	}
	adoptedResolving := filepath.Join(record.WorkspacePath, "resolving")
	if target, err := os.Readlink(adoptedResolving); err != nil || filepath.Clean(target) != filepath.Clean(outside) {
		t.Fatalf("a resolving link changed: target=%q err=%v", target, err)
	}
	adoptedUnrelated := filepath.Join(record.WorkspacePath, "unrelated")
	if target, err := os.Readlink(adoptedUnrelated); err != nil || filepath.Clean(target) != filepath.Clean(absent) {
		t.Fatalf("a link outside the retained root changed: target=%q err=%v", target, err)
	}
	adoptedUnmatched := filepath.Join(record.WorkspacePath, "unmatched")
	if target, err := os.Readlink(adoptedUnmatched); err != nil || filepath.Clean(target) != filepath.Clean(missingTail) {
		t.Fatalf("a link whose tail is absent under the adopted root changed: target=%q err=%v", target, err)
	}
}

func TestEnsureAdoptsAMovedWorkspaceWithoutFetching(t *testing.T) {
	directory := t.TempDir()
	database := filepath.Join(directory, "views.sqlite")
	retainedRoot := filepath.Join(directory, "before", "views")
	content := newTestContent(t)
	file := content.file("note.md", []byte("note\n"))
	digest := content.publish(t, "context-1", "runtime-1", []Mapping{
		{Kind: "memory", TargetPath: "memory", Access: "read_only", Files: []FileInput{file}},
	}, nil, nil)
	source := ContentSource{ContentURL: content.url()}
	store, err := OpenViewStore(database, retainedRoot, nil)
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.Ensure(t.Context(), testRequest("context-1", digest), source)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	movedRoot := filepath.Join(directory, "after", "views")
	if err := os.MkdirAll(filepath.Dir(movedRoot), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(retainedRoot, movedRoot); err != nil {
		t.Fatal(err)
	}
	store, err = OpenViewStore(database, movedRoot, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = store.Close()
		makeWritable(movedRoot)
	})
	content.takeRequests()

	again, err := store.Ensure(t.Context(), testRequest("context-1", digest), source)
	if err != nil {
		t.Fatal(err)
	}
	want := contextWorkspace(movedRoot, "context-1")
	if again.WorkspacePath != want || first.WorkspacePath == want {
		t.Fatalf("workspace=%q, want the adopted path %q", again.WorkspacePath, want)
	}
	if requests := content.takeRequests(); len(requests) != 0 {
		t.Fatalf("reusing a moved workspace made requests: %v", requests)
	}
	current, err := store.CurrentView(t.Context(), "context-1", digest)
	if err != nil || current.WorkspacePath != want {
		t.Fatalf("current workspace=%q err=%v, want %q", current.WorkspacePath, err, want)
	}
	if content, err := os.ReadFile(filepath.Join(want, "memory", "note.md")); err != nil || string(content) != "note\n" {
		t.Fatalf("retained file=%q err=%v", content, err)
	}
}

func TestApplyDoesNotAdoptAWorkspaceThatDidNotMove(t *testing.T) {
	t.Run("different hash", func(t *testing.T) {
		fixture := newProjectionRecoveryFixture(t)
		initial := testView("a")
		initial.Mappings = []Mapping{fixture.mapping("memory", "memory", "read_only", "note.md", "note")}
		requireProjection(t, fixture, initial)
		moved := moveViewsRoot(t, fixture)
		retained := filepath.Join(moved, strings.Repeat("0", 32), "workspace")
		if _, err := fixture.store.db.Exec(`UPDATE context_views_v3 SET workspace_path=? WHERE execution_context_key=?`,
			retained, initial.ExecutionContextKey); err != nil {
			t.Fatal(err)
		}
		next := testView("b")
		next.Mappings = initial.Mappings
		if _, err := fixture.store.applyTestView(context.Background(), next, fixture.server.URL); !errors.Is(err, ErrContextConflict) {
			t.Fatalf("a workspace under another hash was adopted: %v", err)
		}
	})

	t.Run("retained path still present", func(t *testing.T) {
		fixture := newProjectionRecoveryFixture(t)
		initial := testView("a")
		initial.Mappings = []Mapping{fixture.mapping("memory", "memory", "read_only", "note.md", "note")}
		requireProjection(t, fixture, initial)
		retainedRoot := fixture.viewsPath
		t.Cleanup(func() { makeWritable(retainedRoot) })
		if err := fixture.store.Close(); err != nil {
			t.Fatal(err)
		}
		otherRoot := fixture.viewsPath + "-other"
		fixture.viewsPath = otherRoot
		store, err := OpenViewStore(fixture.databasePath, otherRoot, fixture.server.Client())
		if err != nil {
			t.Fatal(err)
		}
		fixture.store = store
		computed := contextWorkspace(otherRoot, initial.ExecutionContextKey)
		if err := os.MkdirAll(filepath.Join(computed, "memory"), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(computed, "memory", "note.md"), []byte("note"), 0o400); err != nil {
			t.Fatal(err)
		}
		next := testView("b")
		next.Mappings = initial.Mappings
		if _, err := fixture.store.applyTestView(context.Background(), next, fixture.server.URL); !errors.Is(err, ErrContextConflict) {
			t.Fatalf("a workspace whose retained path still exists was adopted: %v", err)
		}
	})

	t.Run("computed path absent", func(t *testing.T) {
		fixture := newProjectionRecoveryFixture(t)
		initial := testView("a")
		initial.Mappings = []Mapping{fixture.mapping("memory", "memory", "read_only", "note.md", "note")}
		requireProjection(t, fixture, initial)
		if err := fixture.store.Close(); err != nil {
			t.Fatal(err)
		}
		gone := fixture.viewsPath + "-gone"
		if err := os.Rename(fixture.viewsPath, gone); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { makeWritable(gone) })
		freshRoot := fixture.viewsPath + "-fresh"
		fixture.viewsPath = freshRoot
		store, err := OpenViewStore(fixture.databasePath, freshRoot, fixture.server.Client())
		if err != nil {
			t.Fatal(err)
		}
		fixture.store = store
		next := testView("b")
		next.Mappings = initial.Mappings
		record := requireProjection(t, fixture, next)
		want := contextWorkspace(freshRoot, initial.ExecutionContextKey)
		if record.WorkspacePath != want {
			t.Fatalf("workspace=%q, want the computed path %q", record.WorkspacePath, want)
		}
		if content, err := os.ReadFile(filepath.Join(want, "memory", "note.md")); err != nil || string(content) != "note" {
			t.Fatalf("a missing workspace did not receive a fresh projection: %q err=%v", content, err)
		}
	})
}
