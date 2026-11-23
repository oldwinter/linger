//go:build windows

package artifact

import (
	"os"

	"golang.org/x/sys/windows"
)

// Native installs on Windows build TeamHub on the user's machine.
func availableBytes(root string) (uint64, error) {
	path, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return 0, err
	}
	var available uint64
	if err := windows.GetDiskFreeSpaceEx(path, &available, nil, nil); err != nil {
		return 0, err
	}
	return available, nil
}

// openObject opens an object for reading and lets the object be deleted while
// it stays open. Deleting an unreferenced object is compensating cleanup
// (DeleteDetached), and a download may still be reading that object when it
// runs, so a delete must not depend on every reader having closed.
//
// os.Open does not ask for FILE_SHARE_DELETE, so on Windows a delete of an open
// object fails with a sharing violation until the last reader closes, and the
// object is then never reclaimed. The sharing mode below gives this platform
// the unlink-while-open behavior the other platforms already have.
func openObject(path string) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(
		name,
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: path, Err: err}
	}
	return os.NewFile(uintptr(handle), path), nil
}
