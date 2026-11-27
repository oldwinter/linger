//go:build !unix && !windows

package process

// CloseInheritedHandles is a no-op on targets without POSIX FDs or Win32 handles.
func CloseInheritedHandles() int { return 0 }
