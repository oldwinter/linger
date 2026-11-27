//go:build windows

package process

import (
	"os"
	"runtime"
	"strings"
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

// CloseInheritedHandles closes inherited non-stdio File and Section handles
// (including Winsock sockets, pipes, disk files, and file mappings) leaked by
// a parent process that called CreateProcess with bInheritHandles=TRUE without
// PROC_THREAD_ATTRIBUTE_HANDLE_LIST.
func CloseInheritedHandles() int {
	entries, ok := queryCurrentProcessHandles()
	if !ok || len(entries) == 0 {
		return 0
	}
	preserved := preservedStdHandles()
	selected := selectInheritedWindowsHandles(
		entries,
		preserved,
		queryHandleFlags,
		queryHandleTypeName,
	)
	closed := 0
	for _, handle := range selected {
		if windows.CloseHandle(handle) == nil {
			closed++
		}
	}
	return closed
}

func preservedStdHandles() map[windows.Handle]struct{} {
	preserved := make(map[windows.Handle]struct{}, 6)
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
	for _, file := range []*os.File{os.Stdin, os.Stdout, os.Stderr} {
		if file != nil {
			add(windows.Handle(file.Fd()))
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
		buf := make([]byte, size)
		var returnLength uint32
		r1, _, _ := ntQueryInformationProcess.Call(
			uintptr(windows.CurrentProcess()),
			uintptr(processHandleInformation),
			uintptr(unsafe.Pointer(&buf[0])),
			uintptr(len(buf)),
			uintptr(unsafe.Pointer(&returnLength)),
		)
		status := uint32(r1)
		if status == ntStatusSuccess {
			headerSize := unsafe.Sizeof(processHandleSnapshotHeader{})
			entrySize := unsafe.Sizeof(processHandleTableEntryInfo{})
			if uintptr(len(buf)) < headerSize {
				return nil, false
			}
			header := (*processHandleSnapshotHeader)(unsafe.Pointer(&buf[0]))
			maxEntries := (uintptr(len(buf)) - headerSize) / entrySize
			count := min(header.NumberOfHandles, maxEntries)
			if count == 0 {
				return nil, true
			}
			raw := unsafe.Slice(
				(*processHandleTableEntryInfo)(unsafe.Add(unsafe.Pointer(&buf[0]), headerSize)),
				int(count),
			)
			entries := make([]processHandleTableEntryInfo, len(raw))
			copy(entries, raw)
			runtime.KeepAlive(buf)
			return entries, true
		}
		if status != ntStatusInfoLengthMismatch && status != ntStatusBufferTooSmall && status != ntStatusBufferOverflow {
			return nil, false
		}
		next := max(int(returnLength)+4096, size*2)
		if next > maxHandleSnapshotBufSize {
			return nil, false
		}
		size = next
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
	buf := make([]byte, 2048)
	var returnLength uint32
	r1, _, _ := ntQueryObject.Call(
		uintptr(handle),
		uintptr(objectTypeInformation),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		uintptr(unsafe.Pointer(&returnLength)),
	)
	if uint32(r1) != ntStatusSuccess {
		return "", false
	}
	info := (*objectTypeInformationHeader)(unsafe.Pointer(&buf[0]))
	if info.TypeName.Buffer == nil || info.TypeName.Length == 0 || info.TypeName.Length%2 != 0 {
		return "", false
	}
	base := uintptr(unsafe.Pointer(&buf[0]))
	ptr := uintptr(unsafe.Pointer(info.TypeName.Buffer))
	if ptr < base || ptr+uintptr(info.TypeName.Length) > base+uintptr(len(buf)) {
		return "", false
	}
	name := windows.UTF16ToString(unsafe.Slice(info.TypeName.Buffer, int(info.TypeName.Length/2)))
	runtime.KeepAlive(buf)
	return name, true
}

func selectInheritedWindowsHandles(
	entries []processHandleTableEntryInfo,
	preserved map[windows.Handle]struct{},
	getFlags func(windows.Handle) (uint32, error),
	getTypeName func(windows.Handle) (string, bool),
) []windows.Handle {
	typeNames := make(map[uint32]string)
	var selected []windows.Handle
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
		if entry.HandleAttributes&objInherit == 0 || entry.HandleAttributes&objProtectClose != 0 {
			continue
		}
		flags, err := getFlags(handle)
		if err != nil || flags&windows.HANDLE_FLAG_INHERIT == 0 || flags&handleFlagProtectFromClose != 0 {
			continue
		}
		typeName, cached := typeNames[entry.ObjectTypeIndex]
		if !cached {
			resolved, ok := getTypeName(handle)
			if !ok {
				continue
			}
			typeName = resolved
			if entry.ObjectTypeIndex != 0 {
				typeNames[entry.ObjectTypeIndex] = typeName
			}
		}
		if !isClosableInheritedObjectType(typeName) {
			continue
		}
		seen[handle] = struct{}{}
		selected = append(selected, handle)
	}
	return selected
}

func isClosableInheritedObjectType(typeName string) bool {
	return strings.EqualFold(typeName, "File") || strings.EqualFold(typeName, "Section")
}
