//go:build unix

package artifact

import (
	"os"

	"golang.org/x/sys/unix"
)

func availableBytes(root string) (uint64, error) {
	var state unix.Statfs_t
	if err := unix.Statfs(root, &state); err != nil {
		return 0, err
	}
	return state.Bavail * uint64(state.Bsize), nil
}

// openObject opens an object for reading. A unix unlink succeeds while the file
// is open, so a delete during a read needs nothing from the open itself.
func openObject(path string) (*os.File, error) {
	return os.Open(path)
}
