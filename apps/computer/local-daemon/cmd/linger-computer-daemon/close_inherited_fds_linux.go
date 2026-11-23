//go:build linux

package main

import (
	"os"
	"strconv"
	"syscall"
)

// closeInheritedFDs closes file descriptors >= 3 that survived execve without
// FD_CLOEXEC (for example listening sockets leaked by a parent Electron
// process) while preserving stdio and Go runtime descriptors opened with
// O_CLOEXEC.
func closeInheritedFDs() {
	closeInheritedFDsFrom("/proc/self/fd", func(fd int) (int, error) {
		flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), syscall.F_GETFD, 0)
		if errno != 0 {
			return 0, errno
		}
		return int(flags), nil
	}, syscall.Close)
}

func closeInheritedFDsFrom(
	fdDir string,
	getFlags func(fd int) (int, error),
	closeFD func(fd int) error,
) int {
	entries, err := os.ReadDir(fdDir)
	if err != nil {
		return 0
	}
	closed := 0
	for _, entry := range entries {
		fd, err := strconv.Atoi(entry.Name())
		if err != nil || fd < 3 {
			continue
		}
		flags, err := getFlags(fd)
		if err != nil || flags&syscall.FD_CLOEXEC != 0 {
			continue
		}
		if closeFD(fd) == nil {
			closed++
		}
	}
	return closed
}
