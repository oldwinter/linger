//go:build windows

package process

import (
	"os"
	"runtime"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	// ProcessHandleInformation (Windows 8+) enumerates open handles in the
	// current process with their kernel handle attributes and type indices.
	processHandleInformation = 51
	// ObjectTypeInformation queries only the kernel object type header name
	// ("File", "Section", etc.) without issuing IRPs to underlying drivers.
	objectTypeInformation = 2

	ntStatusSuccess              = 0x00000000
	ntStatusBufferOverflow       = 0x80000005
	ntStatusInfoLengthMismatch   = 0xC0000004
	ntStatusBufferTooSmall       = 0xC0000023
	objProtectClose              = 0x00000001
	objInherit                   = 0x00000002
	handleFlagProtectFromClose   = 0x00000002
	initialHandleSnapshotBufSize = 64 * 1024
	maxHandleSnapshotBufSize     = 32 * 1024 * 1024
)

var (
	ntdll                     = windows.NewLazySystemDLL("ntdll.dll")
	ntQueryInformationProcess = ntdll.NewProc("NtQueryInformationProcess")
	ntQueryObject             = ntdll.NewProc("NtQueryObject")
	kernel32HandleDLL         = windows.NewLazySystemDLL("kernel32.dll")
	getHandleInformationProc  = kernel32HandleDLL.NewProc("GetHandleInformation")
)

type processHandleSnapshotHeader struct {
	NumberOfHandles uintptr
	Reserved        uintptr
}

type processHandleTableEntryInfo struct {
	HandleValue      uintptr
	HandleCount      uintptr
	PointerCount     uintptr
	GrantedAccess    uint32
	ObjectTypeIndex  uint32
	HandleAttributes uint32
	Reserved         uint32
}

type objectTypeInformationHeader struct {
	TypeName windows.NTUnicodeString
}

// CloseInheritedHandles closes inherited non-stdio File handles (including
// Winsock AFD sockets, pipes, and disk files) leaked by a parent process that
// called CreateProcess with bInheritHandles=TRUE without
// PROC_THREAD_ATTRIBUTE_HANDLE_LIST. Non-File kernel objects (such as Thread,
// Process, IoCompletion, Event, Section, Mutant, Semaphore, Key, Token, and
// Timer handles) and any handle whose live flags or object type cannot be
// verified are never closed.
func CloseInheritedHandles() int {
	entries, ok := queryCurrentProcessHandles()
	if !ok || len(entries) == 0 {
		return 0
	}
	preserved := preservedStdHandles()
	return closeInheritedWindowsHandles(
		entries,
		preserved,
		queryHandleFlags,
		queryHandleTypeName,
		windows.CloseHandle,
	)
}

func preservedStdHandles() map[windows.Handle]struct{} {
	preserved := make(map[windows.Handle]struct{}, 9)
	add := func(handle windows.Handle) {
		if handle != 0 && handle != windows.InvalidHandle {
			preserved[handle] = struct{}{}
		}
	}
	for _, std := range []uint32{
		windows.STD_INPUT_HANDLE,
		windows.STD_OUTPUT_HANDLE,
		windows.STD_ERROR_HANDLE,
	} {
		if handle, err := windows.GetStdHandle(std); err == nil {
			add(handle)
		}
	}
	add(windows.Handle(syscall.Stdin))
	add(windows.Handle(syscall.Stdout))
	add(windows.Handle(syscall.Stderr))
	// Use SyscallConn instead of File.Fd so stdio pipes stay associated with
	// Go's IOCP netpoller.
	for _, file := range []*os.File{os.Stdin, os.Stdout, os.Stderr} {
		if file == nil {
			continue
		}
		if raw, err := file.SyscallConn(); err == nil {
			_ = raw.Control(func(fd uintptr) {
				add(windows.Handle(fd))
			})
		}
	}
	return preserved
}

func queryCurrentProcessHandles() ([]processHandleTableEntryInfo, bool) {
	if err := ntQueryInformationProcess.Find(); err != nil {
		return nil, false
	}
	size := initialHandleSnapshotBufSize
	for range 8 {
		words := make([]uint64, (size+7)/8)
		bufBytes := len(words) * 8
		var returnLength uint32
		r1, _, _ := ntQueryInformationProcess.Call(
			uintptr(windows.CurrentProcess()),
			uintptr(processHandleInformation),
			uintptr(unsafe.Pointer(&words[0])),
			uintptr(bufBytes),
			uintptr(unsafe.Pointer(&returnLength)),
		)
		status := uint32(r1)
		if status == ntStatusSuccess {
			headerSize := unsafe.Sizeof(processHandleSnapshotHeader{})
			entrySize := unsafe.Sizeof(processHandleTableEntryInfo{})
			if uintptr(bufBytes) < headerSize {
				return nil, false
			}
			header := (*processHandleSnapshotHeader)(unsafe.Pointer(&words[0]))
			maxEntries := (uintptr(bufBytes) - headerSize) / entrySize
			count := min(header.NumberOfHandles, maxEntries)
			if count == 0 {
				return nil, true
			}
			raw := unsafe.Slice(
				(*processHandleTableEntryInfo)(unsafe.Add(unsafe.Pointer(&words[0]), headerSize)),
				int(count),
			)
			entries := make([]processHandleTableEntryInfo, len(raw))
			copy(entries, raw)
			runtime.KeepAlive(words)
			return entries, true
		}
		if status != ntStatusInfoLengthMismatch && status != ntStatusBufferTooSmall && status != ntStatusBufferOverflow {
			return nil, false
		}
		next := uint64(size) * 2
		if needed := uint64(returnLength) + 4096; needed > next {
			next = needed
		}
		if next <= uint64(size) || next > maxHandleSnapshotBufSize {
			return nil, false
		}
		size = int(next)
	}
	return nil, false
}

func queryHandleFlags(handle windows.Handle) (uint32, error) {
	if err := getHandleInformationProc.Find(); err != nil {
		return 0, err
	}
	var flags uint32
	r1, _, callErr := getHandleInformationProc.Call(
		uintptr(handle),
		uintptr(unsafe.Pointer(&flags)),
	)
	if r1 == 0 {
		if callErr != nil {
			return 0, callErr
		}
		return 0, windows.ERROR_INVALID_HANDLE
	}
	return flags, nil
}

func queryHandleTypeName(handle windows.Handle) (string, bool) {
	if err := ntQueryObject.Find(); err != nil {
		return "", false
	}
	words := make([]uint64, 256)
	bufBytes := len(words) * 8
	var returnLength uint32
	r1, _, _ := ntQueryObject.Call(
		uintptr(handle),
		uintptr(objectTypeInformation),
		uintptr(unsafe.Pointer(&words[0])),
		uintptr(bufBytes),
		uintptr(unsafe.Pointer(&returnLength)),
	)
	if uint32(r1) != ntStatusSuccess {
		return "", false
	}
	info := (*objectTypeInformationHeader)(unsafe.Pointer(&words[0]))
	if info.TypeName.Buffer == nil || info.TypeName.Length == 0 || info.TypeName.Length%2 != 0 {
		return "", false
	}
	base := uintptr(unsafe.Pointer(&words[0]))
	ptr := uintptr(unsafe.Pointer(info.TypeName.Buffer))
	length := uintptr(info.TypeName.Length)
	if ptr < base || ptr > base+uintptr(bufBytes) {
		return "", false
	}
	offset := ptr - base
	if offset%2 != 0 || length > uintptr(bufBytes)-offset {
		return "", false
	}
	utf16Slice := unsafe.Slice((*uint16)(unsafe.Add(unsafe.Pointer(&words[0]), offset)), int(length/2))
	name := windows.UTF16ToString(utf16Slice)
	runtime.KeepAlive(words)
	return name, true
}

func closeInheritedWindowsHandles(
	entries []processHandleTableEntryInfo,
	preserved map[windows.Handle]struct{},
	getFlags func(windows.Handle) (uint32, error),
	getTypeName func(windows.Handle) (string, bool),
	closeHandle func(windows.Handle) error,
) int {
	closed := 0
	seen := make(map[windows.Handle]struct{})
	for _, entry := range entries {
		handle := windows.Handle(entry.HandleValue)
		if handle == 0 || handle == windows.InvalidHandle {
			continue
		}
		if _, keep := preserved[handle]; keep {
			continue
		}
		if _, dup := seen[handle]; dup {
			continue
		}
		seen[handle] = struct{}{}
		if !isInheritableSnapshotEntry(entry) {
			continue
		}
		if !isClosableLiveFlags(handle, getFlags) {
			continue
		}
		// Always query the live object type per handle instead of caching by
		// snapshot ObjectTypeIndex, because a recycled handle slot can hold a
		// different kernel object type than the snapshot recorded.
		typeName, ok := getTypeName(handle)
		if !ok || !isClosableInheritedObjectType(typeName) {
			continue
		}
		// Re-check live flags right before closing so a handle closed and
		// recycled as a non-inheritable File between checks is skipped.
		if !isClosableLiveFlags(handle, getFlags) {
			continue
		}
		if closeHandle(handle) == nil {
			closed++
		}
	}
	return closed
}

func isInheritableSnapshotEntry(entry processHandleTableEntryInfo) bool {
	return entry.HandleAttributes&objInherit != 0 && entry.HandleAttributes&objProtectClose == 0
}

func isClosableLiveFlags(handle windows.Handle, getFlags func(windows.Handle) (uint32, error)) bool {
	flags, err := getFlags(handle)
	if err != nil {
		return false
	}
	return flags&windows.HANDLE_FLAG_INHERIT != 0 && flags&handleFlagProtectFromClose == 0
}

func isClosableInheritedObjectType(typeName string) bool {
	return strings.EqualFold(typeName, "File")
}
