package lingercontext

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/workspace"
)

// validateWorkspaceLinks keeps the projection boundary: a managed read-only
// mapping never contains a symbolic link. Playground and other writable
// trees are agent scratch; host links there are Trusted Host content, not a
// Context failure. Export still refuses to publish a path that contains a
// symlink. Dangling or cyclic links in writable trees are repository
// content and are left in place.
func validateWorkspaceLinks(workspace string, mappings []Mapping) error {
	canonical, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		return err
	}
	seen := map[string]struct{}{}
	for _, mapping := range mappings {
		if mapping.Access != "read_only" || mapping.TargetPath == "" {
			continue
		}
		root := filepath.Join(canonical, filepath.Clean(mapping.TargetPath))
		if root != canonical && !strings.HasPrefix(root, canonical+string(filepath.Separator)) {
			return errors.New("Context read-only projection path is outside the Workspace")
		}
		if _, ok := seen[root]; ok {
			continue
		}
		seen[root] = struct{}{}
		if err := rejectReadOnlyProjectionLinks(root); err != nil {
			return err
		}
	}
	return nil
}

// repairMovedWorkspaceLinks re-points the links of an adopted workspace whose
// target is still under the retained root. A junction such as .claude/skills
// stores an absolute target, so renaming the view root leaves it dangling even
// though the target moved with the workspace. A link that resolves, or whose
// target is not under the retained root, is left as it is.
func repairMovedWorkspaceLinks(retainedWorkspace, adoptedWorkspace string) error {
	return filepath.WalkDir(adoptedWorkspace, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&(os.ModeSymlink|os.ModeIrregular) == 0 {
			return nil
		}
		target, err := os.Readlink(path)
		if err != nil {
			return nil //nolint:nilerr // an unreadable link is outside the repair scope
		}
		if target != "" && !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(path), target)
		}
		if _, err := os.Stat(target); err == nil {
			return nil
		}
		relative, err := filepath.Rel(retainedWorkspace, target)
		if err != nil || relative == "." || relative == ".." ||
			strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return nil //nolint:nilerr // the target is not content of the retained workspace
		}
		moved := filepath.Join(adoptedWorkspace, relative)
		info, err := os.Stat(moved)
		if err != nil {
			return nil //nolint:nilerr // the target has no counterpart under the adopted root
		}
		if err := os.Remove(path); err != nil {
			return err
		}
		if info.IsDir() {
			return workspace.CreateDirectoryLink(moved, path)
		}
		return os.Symlink(moved, path)
	})
}

func rejectReadOnlyProjectionLinks(root string) error {
	info, err := os.Lstat(root)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if directoryLink(info) {
		return errors.New("Context read-only projection contains a symbolic link")
	}
	if !info.IsDir() {
		return nil
	}
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&(os.ModeSymlink|os.ModeIrregular) != 0 {
			return errors.New("Context read-only projection contains a symbolic link")
		}
		return nil
	})
}
