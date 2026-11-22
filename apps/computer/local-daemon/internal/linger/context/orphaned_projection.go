package lingercontext

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// orphanedProjectionPrefix names the directory beside a workspace that holds
// read-only projections no retained View owned.
const orphanedProjectionPrefix = "orphaned-projection-"

// sameWorkspacePath reports whether a retained row names this workspace. One
// directory has several spellings on Windows: letter case, an 8.3 short name,
// or a path through a junction. Two existing paths that open the same
// directory are the same workspace.
func sameWorkspacePath(retained, workspace string) bool {
	if retained == workspace {
		return true
	}
	if retained == "" || workspace == "" {
		return false
	}
	left, err := os.Stat(retained)
	if err != nil {
		return false
	}
	right, err := os.Stat(workspace)
	if err != nil {
		return false
	}
	return os.SameFile(left, right)
}

// setAsideOrphanedProjection moves the next View's read-only roots out of a
// workspace that no retained row claims. A store lost or replaced while its
// workspaces survived (a data folder moved between app versions, a SQLite
// file left behind by a locked copy) leaves projected files nothing owns, and
// every later View would refuse them. Nothing is deleted: the roots move to a
// new directory beside the workspace, so a local edit stays recoverable.
// It returns that directory, or "" when no root existed.
func setAsideOrphanedProjection(workspace string, mappings []Mapping) (string, error) {
	next := projectionOwnership{}
	if err := next.addMappings(workspace, mappings); err != nil {
		return "", err
	}
	roots := append([]string(nil), next.ReadOnlyRoots...)
	// An outer root carries the roots inside it.
	sort.Slice(roots, func(left, right int) bool { return len(roots[left]) < len(roots[right]) })
	// A writable tree is agent work; it is never moved. Every root is checked
	// before the first move, so a View that cannot publish moves nothing.
	for _, root := range roots {
		for _, writable := range next.WritableRoots {
			if pathWithin(root, writable) || pathWithin(writable, root) {
				return "", contextConflict("read-only mapping %s overlaps writable mapping %s", root, writable)
			}
		}
	}
	destination := ""
	for _, root := range roots {
		source := filepath.Join(workspace, root)
		info, err := os.Lstat(source)
		if errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return "", err
		}
		// A published root is read-only, and moving a directory rewrites it.
		// A link is moved as itself; chmod would follow it.
		if info.IsDir() && !directoryLink(info) {
			if err := os.Chmod(source, 0o700); err != nil { //nolint:gosec // owner-only directory mode
				return "", err
			}
		}
		if destination == "" {
			created, err := os.MkdirTemp(filepath.Dir(workspace), orphanedProjectionPrefix+"*")
			if err != nil {
				return "", err
			}
			destination = created
		}
		target := filepath.Join(destination, root)
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return destination, err
		}
		// The target is new, so this rename never replaces a directory; Windows
		// refuses that. A file another process holds open fails the rename and
		// the next Ensure tries again.
		if err := os.Rename(source, target); err != nil {
			return destination, fmt.Errorf("set aside orphaned Context projection %s: %w", root, err)
		}
	}
	return destination, nil
}

// contextConflict names the path and rule behind an ErrContextConflict, so a
// failed Run says what blocked it instead of only that something did.
func contextConflict(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrContextConflict, fmt.Sprintf(format, args...))
}
