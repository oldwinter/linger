//go:build windows

package process

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestSelectInheritedWindowsHandlesFiltersPreservedProtectedAndTypes(t *testing.T) {
	entries := []processHandleTableEntryInfo{
		{HandleValue: 0x10, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // preserved stdin
		{HandleValue: 0x14, ObjectTypeIndex: 1, HandleAttributes: 0},                            // not inheritable
		{HandleValue: 0x18, ObjectTypeIndex: 1, HandleAttributes: objInherit | objProtectClose}, // protected in snapshot
		{HandleValue: 0x1c, ObjectTypeIndex: 2, HandleAttributes: objInherit},                   // Event (skip)
		{HandleValue: 0x20, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // File (select)
		{HandleValue: 0x20, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // duplicate (dedup)
		{HandleValue: 0x24, ObjectTypeIndex: 3, HandleAttributes: objInherit},                   // Section (select)
		{HandleValue: 0x28, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // live flags clear inherit
		{HandleValue: 0x2c, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // live flags set protect
	}
	preserved := map[windows.Handle]struct{}{
		0x10: {},
	}
	liveFlags := map[windows.Handle]uint32{
		0x10: windows.HANDLE_FLAG_INHERIT,
		0x14: 0,
		0x18: windows.HANDLE_FLAG_INHERIT | handleFlagProtectFromClose,
		0x1c: windows.HANDLE_FLAG_INHERIT,
		0x20: windows.HANDLE_FLAG_INHERIT,
		0x24: windows.HANDLE_FLAG_INHERIT,
		0x28: 0,
		0x2c: windows.HANDLE_FLAG_INHERIT | handleFlagProtectFromClose,
	}
	typeByHandle := map[windows.Handle]string{
		0x1c: "Event",
		0x20: "File",
		0x24: "Section",
	}
	selected := selectInheritedWindowsHandles(
		entries,
		preserved,
		func(h windows.Handle) (uint32, error) {
			flags, ok := liveFlags[h]
			if !ok {
				return 0, windows.ERROR_INVALID_HANDLE
			}
			return flags, nil
		},
		func(h windows.Handle) (string, bool) {
			name, ok := typeByHandle[h]
			return name, ok
		},
	)
	want := []windows.Handle{0x20, 0x24}
	if !slices.Equal(selected, want) {
		t.Fatalf("selected = %v, want %v", selected, want)
	}
}

func makeInheritableListener(t *testing.T) (net.Listener, string) {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := listener.(*net.TCPListener).SyscallConn()
	if err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	var setErr error
	if err := raw.Control(func(fd uintptr) {
		setErr = windows.SetHandleInformation(windows.Handle(fd), windows.HANDLE_FLAG_INHERIT, windows.HANDLE_FLAG_INHERIT)
	}); err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	if setErr != nil {
		_ = listener.Close()
		t.Fatal(setErr)
	}
	return listener, listener.Addr().String()
}

// makeInheritableLockedFile opens a regular file with HANDLE_FLAG_INHERIT set
// and without FILE_SHARE_DELETE, so os.Remove fails if any process retains an
// open handle to it.
func makeInheritableLockedFile(t *testing.T) (windows.Handle, string) {
	t.Helper()
	filePath := filepath.Join(t.TempDir(), "v8_context_snapshot.bin")
	pathPtr, err := windows.UTF16PtrFromString(filePath)
	if err != nil {
		t.Fatal(err)
	}
	sa := &windows.SecurityAttributes{
		Length:        uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		InheritHandle: 1,
	}
	handle, err := windows.CreateFile(
		pathPtr,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		sa,
		windows.CREATE_ALWAYS,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	return handle, filePath
}

func TestCloseInheritedHandlesDropsLeakedSocketAndFileInSubprocess(t *testing.T) {
	if os.Getenv("LINGER_TEST_WIN_CLOSE_HANDLES_HELPER") == "1" {
		CloseInheritedHandles()
		fmt.Println("ready")
		buf := make([]byte, 1)
		_, _ = os.Stdin.Read(buf)
		os.Exit(0)
	}

	listener, addr := makeInheritableListener(t)
	fileHandle, filePath := makeInheritableLockedFile(t)
	closedParentResources := false
	defer func() {
		if !closedParentResources {
			_ = listener.Close()
			_ = windows.CloseHandle(fileHandle)
		}
	}()

	// Create explicit stdin/stdout pipes where only the child ends are inheritable.
	saInherit := &windows.SecurityAttributes{
		Length:        uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		InheritHandle: 1,
	}
	var childIn, parentIn, parentOut, childOut windows.Handle
	if err := windows.CreatePipe(&childIn, &parentIn, saInherit, 0); err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(parentIn)
	if err := windows.SetHandleInformation(parentIn, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		_ = windows.CloseHandle(childIn)
		t.Fatal(err)
	}
	if err := windows.CreatePipe(&parentOut, &childOut, saInherit, 0); err != nil {
		_ = windows.CloseHandle(childIn)
		t.Fatal(err)
	}
	defer windows.CloseHandle(parentOut)
	if err := windows.SetHandleInformation(parentOut, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		_ = windows.CloseHandle(childIn)
		_ = windows.CloseHandle(childOut)
		t.Fatal(err)
	}

	exe, err := os.Executable()
	if err != nil {
		_ = windows.CloseHandle(childIn)
		_ = windows.CloseHandle(childOut)
		t.Fatal(err)
	}
	t.Setenv("LINGER_TEST_WIN_CLOSE_HANDLES_HELPER", "1")
	cmdLine := syscall.EscapeArg(exe) + " -test.run=^TestCloseInheritedHandlesDropsLeakedSocketAndFileInSubprocess$"
	exePtr, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		_ = windows.CloseHandle(childIn)
		_ = windows.CloseHandle(childOut)
		t.Fatal(err)
	}
	cmdPtr, err := windows.UTF16PtrFromString(cmdLine)
	if err != nil {
		_ = windows.CloseHandle(childIn)
		_ = windows.CloseHandle(childOut)
		t.Fatal(err)
	}

	// Simulate Electron/libuv < 1.53: CreateProcess with bInheritHandles=true
	// and no PROC_THREAD_ATTRIBUTE_HANDLE_LIST leaks every inheritable handle.
	si := &windows.StartupInfo{
		Cb:        uint32(unsafe.Sizeof(windows.StartupInfo{})),
		Flags:     windows.STARTF_USESTDHANDLES,
		StdInput:  childIn,
		StdOutput: childOut,
		StdErr:    childOut,
	}
	var pi windows.ProcessInformation
	err = windows.CreateProcess(exePtr, cmdPtr, nil, nil, true, windows.CREATE_NO_WINDOW, nil, nil, si, &pi)
	_ = windows.CloseHandle(childIn)
	_ = windows.CloseHandle(childOut)
	if err != nil {
		t.Fatalf("CreateProcess failed: %v", err)
	}
	_ = windows.CloseHandle(pi.Thread)
	defer func() {
		_ = windows.TerminateProcess(pi.Process, 1)
		_, _ = windows.WaitForSingleObject(pi.Process, 5000)
		_ = windows.CloseHandle(pi.Process)
	}()

	stdoutFile := os.NewFile(uintptr(parentOut), "child-stdout")
	line, err := bufio.NewReader(stdoutFile).ReadString('\n')
	if err != nil || strings.TrimSpace(line) != "ready" {
		t.Fatalf("child readiness = %q, err = %v", line, err)
	}

	// Close the parent's handles while the child remains alive.
	_ = listener.Close()
	_ = windows.CloseHandle(fileHandle)
	closedParentResources = true

	if err := os.Remove(filePath); err != nil {
		t.Fatalf("file stayed locked while child is alive: %v", err)
	}
	rebound, err := net.Listen("tcp4", addr)
	if err != nil {
		t.Fatalf("TCP port %s stayed bound while child is alive: %v", addr, err)
	}
	_ = rebound.Close()

	// Closing child's stdin lets it exit cleanly.
	_ = windows.CloseHandle(parentIn)
	parentIn = 0
	if wait, err := windows.WaitForSingleObject(pi.Process, 5000); err != nil || wait != windows.WAIT_OBJECT_0 {
		t.Fatalf("child did not exit cleanly: wait=%v err=%v", wait, err)
	}
	var exitCode uint32
	if err := windows.GetExitCodeProcess(pi.Process, &exitCode); err != nil || exitCode != 0 {
		t.Fatalf("child exit code = %d, err = %v", exitCode, err)
	}
}
