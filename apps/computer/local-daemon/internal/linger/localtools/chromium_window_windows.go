package localtools

import (
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procGetClassName             = user32.NewProc("GetClassNameW")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessID = user32.NewProc("GetWindowThreadProcessId")
)

// chromiumWindow reports whether window, or with no window any top-level
// window of pid, is a Chromium frame: Chrome, Edge and Electron apps share
// the Chrome_WidgetWin class, and CEF hosts use CefBrowser. Cua decides its
// Chromium input routes by the same class names.
func chromiumWindow(pid, window int64) bool {
	if window > 0 {
		return chromiumClass(uintptr(window))
	}
	if pid <= 0 {
		return false
	}
	chromiumSearch.Lock()
	defer chromiumSearch.Unlock()
	chromiumSearch.pid, chromiumSearch.found = pid, false
	procEnumWindows.Call(chromiumSearchCallback(), 0)
	return chromiumSearch.found
}

// chromiumSearch holds one EnumWindows walk at a time. The Go runtime keeps
// every callback NewCallback makes, so the walk reuses one callback.
var chromiumSearch struct {
	sync.Mutex
	pid   int64
	found bool
}

var chromiumSearchCallback = sync.OnceValue(func() uintptr {
	return windows.NewCallback(func(hwnd, _ uintptr) uintptr {
		var owner uint32
		procGetWindowThreadProcessID.Call(hwnd, uintptr(unsafe.Pointer(&owner)))
		if int64(owner) == chromiumSearch.pid && chromiumClass(hwnd) {
			chromiumSearch.found = true
			return 0
		}
		return 1
	})
})

func chromiumClass(hwnd uintptr) bool {
	var name [64]uint16
	n, _, _ := procGetClassName.Call(hwnd, uintptr(unsafe.Pointer(&name[0])), uintptr(len(name)))
	class := windows.UTF16ToString(name[:n])
	return strings.HasPrefix(class, "Chrome_WidgetWin_") || strings.HasPrefix(class, "CefBrowser")
}
