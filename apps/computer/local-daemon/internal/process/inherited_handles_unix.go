//go:build unix

package process

import (
	"os"
	"runtime"
	"strconv"

	"golang.org/x/sys/unix"
)

const (
	defaultFallbackFDLimit = 4096
	maxFallbackFDLimit     = 65536
)

// CloseInheritedHandles closes file descriptors >= 3 that survived exec without
// FD_CLOEXEC (such as listening sockets or open app files leaked by a parent
// Electron process) while preserving stdio and Go runtime descriptors opened
// with O_CLOEXEC.
func CloseInheritedHandles() int {
	fdDir := "/dev/fd"
	if runtime.GOOS == "linux" {
		fdDir = "/proc/self/fd"
	}
	return closeInheritedFDsFrom(
		fdDir,
		func(fd int) (int, error) {
			return unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0)
		},
		unix.Close,
		fallbackFDLimit,
	)
}

func closeInheritedFDsFrom(
	fdDir string,
	getFlags func(fd int) (int, error),
	closeFD func(fd int) error,
	limitFn func() int,
) int {
	entries, err := os.ReadDir(fdDir)
	if err != nil {
		return closeInheritedFDsRange(limitFn(), getFlags, closeFD)
	}
	closed := 0
	for _, entry := range entries {
		fd, err := strconv.Atoi(entry.Name())
		if err != nil || fd < 3 {
			continue
		}
		if closeIfNonCloexec(fd, getFlags, closeFD) {
			closed++
		}
	}
	return closed
}

func closeInheritedFDsRange(
	limit int,
	getFlags func(fd int) (int, error),
	closeFD func(fd int) error,
) int {
	if limit <= 3 {
		return 0
	}
	closed := 0
	for fd := 3; fd < limit; fd++ {
		if closeIfNonCloexec(fd, getFlags, closeFD) {
			closed++
		}
	}
	return closed
}

func closeIfNonCloexec(
	fd int,
	getFlags func(fd int) (int, error),
	closeFD func(fd int) error,
) bool {
	flags, err := getFlags(fd)
	if err != nil || flags&unix.FD_CLOEXEC != 0 {
		return false
	}
	return closeFD(fd) == nil
}

func fallbackFDLimit() int {
	var limit unix.Rlimit
	if err := unix.Getrlimit(unix.RLIMIT_NOFILE, &limit); err != nil {
		return defaultFallbackFDLimit
	}
	if limit.Cur == unix.RLIM_INFINITY || limit.Cur > maxFallbackFDLimit {
		return maxFallbackFDLimit
	}
	return int(limit.Cur)
}
