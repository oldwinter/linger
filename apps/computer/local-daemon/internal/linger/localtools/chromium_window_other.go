//go:build !windows

package localtools

// chromiumWindow is used only on Windows; see chromium_window_windows.go.
func chromiumWindow(pid, window int64) bool { return false }
