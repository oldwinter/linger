//go:build windows

package process

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func closeWindowsHandle(handle *windows.Handle) {
	if handle == nil || *handle == 0 || *handle == windows.InvalidHandle {
		return
	}
	h := *handle
	*handle = 0
	_ = windows.CloseHandle(h)
}

func TestCloseInheritedWindowsHandlesFiltersPreservedProtectedAndTypes(t *testing.T) {
	entries := []processHandleTableEntryInfo{
		{HandleValue: 0x10, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // preserved stdin
		{HandleValue: 0x14, ObjectTypeIndex: 1, HandleAttributes: 0},                            // not inheritable
		{HandleValue: 0x18, ObjectTypeIndex: 1, HandleAttributes: objInherit | objProtectClose}, // protected in snapshot
		{HandleValue: 0x1c, ObjectTypeIndex: 2, HandleAttributes: objInherit},                   // Event (skip)
		{HandleValue: 0x20, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // File (close)
		{HandleValue: 0x20, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // duplicate (dedup)
		{HandleValue: 0x24, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // same ObjectTypeIndex as File, but live Thread (must not trust index cache)
		{HandleValue: 0x28, ObjectTypeIndex: 3, HandleAttributes: objInherit},                   // Section (skip)
		{HandleValue: 0x2c, ObjectTypeIndex: 4, HandleAttributes: objInherit},                   // Process (skip)
		{HandleValue: 0x30, ObjectTypeIndex: 5, HandleAttributes: objInherit},                   // IoCompletion (skip)
		{HandleValue: 0x34, ObjectTypeIndex: 6, HandleAttributes: objInherit},                   // Mutant (skip)
		{HandleValue: 0x38, ObjectTypeIndex: 7, HandleAttributes: objInherit},                   // Semaphore (skip)
		{HandleValue: 0x3c, ObjectTypeIndex: 8, HandleAttributes: objInherit},                   // Key (skip)
		{HandleValue: 0x40, ObjectTypeIndex: 9, HandleAttributes: objInherit},                   // Token (skip)
		{HandleValue: 0x44, ObjectTypeIndex: 10, HandleAttributes: objInherit},                  // WaitCompletionPacket (skip)
		{HandleValue: 0x48, ObjectTypeIndex: 11, HandleAttributes: objInherit},                  // ALPC Port (skip)
		{HandleValue: 0x4c, ObjectTypeIndex: 12, HandleAttributes: objInherit},                  // IRTimer (skip)
		{HandleValue: 0x50, ObjectTypeIndex: 13, HandleAttributes: objInherit},                  // query failure (fail closed)
		{HandleValue: 0x54, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // live flags clear inherit
		{HandleValue: 0x58, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // live flags set protect
		{HandleValue: 0x5c, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // recycled to non-inheritable File after type check
		{HandleValue: 0x60, ObjectTypeIndex: 1, HandleAttributes: objInherit},                   // second valid File (close)
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
		0x28: windows.HANDLE_FLAG_INHERIT,
		0x2c: windows.HANDLE_FLAG_INHERIT,
		0x30: windows.HANDLE_FLAG_INHERIT,
		0x34: windows.HANDLE_FLAG_INHERIT,
		0x38: windows.HANDLE_FLAG_INHERIT,
		0x3c: windows.HANDLE_FLAG_INHERIT,
		0x40: windows.HANDLE_FLAG_INHERIT,
		0x44: windows.HANDLE_FLAG_INHERIT,
		0x48: windows.HANDLE_FLAG_INHERIT,
		0x4c: windows.HANDLE_FLAG_INHERIT,
		0x50: windows.HANDLE_FLAG_INHERIT,
		0x54: 0,
		0x58: windows.HANDLE_FLAG_INHERIT | handleFlagProtectFromClose,
		0x5c: windows.HANDLE_FLAG_INHERIT,
		0x60: windows.HANDLE_FLAG_INHERIT,
	}
	typeByHandle := map[windows.Handle]string{
		0x1c: "Event",
		0x20: "File",
		0x24: "Thread",
		0x28: "Section",
		0x2c: "Process",
		0x30: "IoCompletion",
		0x34: "Mutant",
		0x38: "Semaphore",
		0x3c: "Key",
		0x40: "Token",
		0x44: "WaitCompletionPacket",
		0x48: "ALPC Port",
		0x4c: "IRTimer",
		0x5c: "File",
		0x60: "File",
	}
	flagQueries := make(map[windows.Handle]int)
	var closed []windows.Handle
	count := closeInheritedWindowsHandles(
		entries,
		preserved,
		func(h windows.Handle) (uint32, error) {
			flagQueries[h]++
			// Simulate handle 0x5c being recycled into a non-inheritable File
			// between the first live flag check and the pre-close recheck.
			if h == 0x5c && flagQueries[h] > 1 {
				return 0, nil
			}
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
		func(h windows.Handle) error {
			closed = append(closed, h)
			return nil
		},
	)
	want := []windows.Handle{0x20, 0x60}
	if count != len(want) || !slices.Equal(closed, want) {
		t.Fatalf("closed = %v (count=%d), want %v", closed, count, want)
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

func runCloseInheritedHandlesSubprocessHelper() {
	CloseInheritedHandles()
	if raw := os.Getenv("LINGER_TEST_WIN_EVENT_HANDLE"); raw != "" {
		val, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || windows.SetEvent(windows.Handle(val)) != nil {
			os.Exit(2)
		}
		_ = windows.CloseHandle(windows.Handle(val))
	}
	if raw := os.Getenv("LINGER_TEST_WIN_SECTION_HANDLE"); raw != "" {
		val, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			os.Exit(3)
		}
		h := windows.Handle(val)
		if _, err := queryHandleFlags(h); err != nil {
			os.Exit(3)
		}
		if typeName, ok := queryHandleTypeName(h); !ok || !strings.EqualFold(typeName, "Section") {
			os.Exit(4)
		}
		_ = windows.CloseHandle(h)
	}
	fmt.Println("ready")
	buf := make([]byte, 1)
	_, _ = os.Stdin.Read(buf)
	os.Exit(0)
}

func TestCloseInheritedHandlesDropsLeakedSocketAndFileInSubprocess(t *testing.T) {
	if os.Getenv("LINGER_TEST_WIN_CLOSE_HANDLES_HELPER") == "1" {
		runCloseInheritedHandlesSubprocessHelper()
	}

	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmdLine := syscall.EscapeArg(exe) + " -test.run=^TestCloseInheritedHandlesDropsLeakedSocketAndFileInSubprocess$"
	exePtr, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		t.Fatal(err)
	}
	cmdPtr, err := windows.UTF16PtrFromString(cmdLine)
	if err != nil {
		t.Fatal(err)
	}

	saInherit := &windows.SecurityAttributes{
		Length:        uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		InheritHandle: 1,
	}

	for iter := range 2 {
		t.Run(fmt.Sprintf("iter-%d", iter), func(t *testing.T) {
			listener, addr := makeInheritableListener(t)
			fileHandle, filePath := makeInheritableLockedFile(t)
			defer func() {
				if listener != nil {
					_ = listener.Close()
				}
				closeWindowsHandle(&fileHandle)
			}()

			eventHandle, err := windows.CreateEvent(saInherit, 1, 0, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer closeWindowsHandle(&eventHandle)

			sectionHandle, err := windows.CreateFileMapping(
				windows.InvalidHandle,
				saInherit,
				windows.PAGE_READWRITE,
				0,
				4096,
				nil,
			)
			if err != nil {
				t.Fatal(err)
			}
			defer closeWindowsHandle(&sectionHandle)

			// Create explicit stdin/stdout pipes where only the child ends are
			// inheritable. Wrap the parent ends in *os.File immediately and
			// clear the raw handle variables so only os.File.Close ever closes
			// them (avoiding double-close against os.File's GC finalizer).
			var childIn, parentIn, parentOut, childOut windows.Handle
			defer closeWindowsHandle(&childIn)
			defer closeWindowsHandle(&childOut)
			defer closeWindowsHandle(&parentIn)
			defer closeWindowsHandle(&parentOut)

			if err := windows.CreatePipe(&childIn, &parentIn, saInherit, 0); err != nil {
				t.Fatal(err)
			}
			if err := windows.SetHandleInformation(parentIn, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
				t.Fatal(err)
			}
			stdinFile := os.NewFile(uintptr(parentIn), "child-stdin")
			parentIn = 0
			defer func() { _ = stdinFile.Close() }()

			if err := windows.CreatePipe(&parentOut, &childOut, saInherit, 0); err != nil {
				t.Fatal(err)
			}
			if err := windows.SetHandleInformation(parentOut, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
				t.Fatal(err)
			}
			stdoutFile := os.NewFile(uintptr(parentOut), "child-stdout")
			parentOut = 0
			defer func() { _ = stdoutFile.Close() }()

			t.Setenv("LINGER_TEST_WIN_CLOSE_HANDLES_HELPER", "1")
			t.Setenv("LINGER_TEST_WIN_EVENT_HANDLE", strconv.FormatUint(uint64(eventHandle), 10))
			t.Setenv("LINGER_TEST_WIN_SECTION_HANDLE", strconv.FormatUint(uint64(sectionHandle), 10))

			// Simulate Electron/libuv < 1.53: CreateProcess with
			// bInheritHandles=true and no PROC_THREAD_ATTRIBUTE_HANDLE_LIST
			// leaks every inheritable handle.
			si := &windows.StartupInfo{
				Cb:        uint32(unsafe.Sizeof(windows.StartupInfo{})),
				Flags:     windows.STARTF_USESTDHANDLES,
				StdInput:  childIn,
				StdOutput: childOut,
				StdErr:    childOut,
			}
			var pi windows.ProcessInformation
			err = windows.CreateProcess(exePtr, cmdPtr, nil, nil, true, windows.CREATE_NO_WINDOW, nil, nil, si, &pi)
			closeWindowsHandle(&childIn)
			closeWindowsHandle(&childOut)
			if err != nil {
				t.Fatalf("CreateProcess failed: %v", err)
			}
			_ = windows.CloseHandle(pi.Thread)
			procHandle := pi.Process
			defer func() {
				if procHandle != 0 {
					_ = windows.TerminateProcess(procHandle, 1)
					_, _ = windows.WaitForSingleObject(procHandle, 5000)
					closeWindowsHandle(&procHandle)
				}
			}()

			line, err := bufio.NewReader(stdoutFile).ReadString('\n')
			if err != nil || strings.TrimSpace(line) != "ready" {
				t.Fatalf("child readiness = %q, err = %v", line, err)
			}

			// Close the parent's leaked File/socket handles while the child stays alive.
			_ = listener.Close()
			listener = nil
			closeWindowsHandle(&fileHandle)

			if err := os.Remove(filePath); err != nil {
				t.Fatalf("file stayed locked while child is alive: %v", err)
			}
			rebound, err := net.Listen("tcp4", addr)
			if err != nil {
				t.Fatalf("TCP port %s stayed bound while child is alive: %v", addr, err)
			}
			_ = rebound.Close()

			// The inherited Event must have been left open and signaled by the child.
			if wait, err := windows.WaitForSingleObject(eventHandle, 0); err != nil || wait != windows.WAIT_OBJECT_0 {
				t.Fatalf("inherited Event was not preserved/signaled by child: wait=%v err=%v", wait, err)
			}

			// Closing child's stdin lets it exit cleanly.
			_ = stdinFile.Close()
			if wait, err := windows.WaitForSingleObject(procHandle, 5000); err != nil || wait != windows.WAIT_OBJECT_0 {
				t.Fatalf("child did not exit cleanly: wait=%v err=%v", wait, err)
			}
			var exitCode uint32
			if err := windows.GetExitCodeProcess(procHandle, &exitCode); err != nil || exitCode != 0 {
				t.Fatalf("child exit code = %d, err = %v", exitCode, err)
			}
			closeWindowsHandle(&procHandle)
		})
	}

	// Run GC immediately so any accidental handle ownership bug against os.File
	// finalizers surfaces inside this test rather than a later test.
	runtime.GC()
	runtime.GC()
}

func TestCloseInheritedHandlesPreservesRuntimeUnderConcurrentPreemption(t *testing.T) {
	saInherit := &windows.SecurityAttributes{
		Length:        uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		InheritHandle: 1,
	}
	eventHandle, err := windows.CreateEvent(saInherit, 1, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer closeWindowsHandle(&eventHandle)

	sectionHandle, err := windows.CreateFileMapping(
		windows.InvalidHandle,
		saInherit,
		windows.PAGE_READWRITE,
		0,
		4096,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer closeWindowsHandle(&sectionHandle)

	nonInheritableFile, err := os.CreateTemp(t.TempDir(), "non-inheritable-*.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = nonInheritableFile.Close() }()
	if _, err := nonInheritableFile.WriteString("alive"); err != nil {
		t.Fatal(err)
	}

	nonInheritableListener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = nonInheritableListener.Close() }()

	// Verify an in-process inheritable locked File handle is closed while
	// preserving non-File and non-inheritable handles; never defer CloseHandle
	// on leakedFile across CloseInheritedHandles to avoid double-closing a
	// recycled handle slot.
	leakedFile, leakedPath := makeInheritableLockedFile(t)
	CloseInheritedHandles()
	if err := os.Remove(leakedPath); err != nil {
		if _, flagErr := queryHandleFlags(leakedFile); flagErr == nil {
			closeWindowsHandle(&leakedFile)
		}
		t.Fatalf("inheritable locked file remained open after CloseInheritedHandles: %v", err)
	}

	// Drive active OS threads, async preemption (runtime.preemptM), and GC
	// concurrently with repeated CloseInheritedHandles calls without starving
	// sibling packages during parallel `go test` runs.
	stop := make(chan struct{})
	var workSink atomic.Uint64
	var wg sync.WaitGroup
	for workerID := range 2 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			if id == 0 {
				runtime.LockOSThread()
				defer runtime.UnlockOSThread()
			}
			var sink uint64
			for {
				select {
				case <-stop:
					workSink.Add(sink)
					return
				default:
				}
				// Spin long enough for sysmon's 10ms quantum to trigger
				// runtime.preemptM, then yield briefly to avoid CPU starvation.
				deadline := time.Now().Add(15 * time.Millisecond)
				for time.Now().Before(deadline) {
					for j := range 50000 {
						sink += uint64(j*3 + id)
					}
				}
				ev, evErr := windows.CreateEvent(nil, 0, 0, nil)
				if evErr == nil {
					_ = windows.CloseHandle(ev)
				}
				time.Sleep(2 * time.Millisecond)
			}
		}(workerID)
	}

	for iter := range 25 {
		CloseInheritedHandles()
		if iter%5 == 0 {
			runtime.GC()
		}
		time.Sleep(2 * time.Millisecond)
	}

	close(stop)
	wg.Wait()
	_ = workSink.Load()
	runtime.GC()

	// Inheritable non-File handles must remain intact.
	if err := windows.SetEvent(eventHandle); err != nil {
		t.Fatalf("inheritable Event handle was corrupted: %v", err)
	}
	if typeName, ok := queryHandleTypeName(sectionHandle); !ok || !strings.EqualFold(typeName, "Section") {
		t.Fatalf("inheritable Section handle type = %q (ok=%v), want Section", typeName, ok)
	}

	// Non-inheritable Go stdlib File and socket handles must remain intact.
	if _, err := nonInheritableFile.Seek(0, io.SeekStart); err != nil {
		t.Fatalf("non-inheritable file seek failed: %v", err)
	}
	data, err := io.ReadAll(nonInheritableFile)
	if err != nil || string(data) != "alive" {
		t.Fatalf("non-inheritable file read = %q, err = %v", string(data), err)
	}
	accepted := make(chan error, 1)
	go func() {
		conn, acceptErr := nonInheritableListener.Accept()
		if acceptErr == nil {
			_ = conn.Close()
		}
		accepted <- acceptErr
	}()
	conn, err := net.Dial("tcp4", nonInheritableListener.Addr().String())
	if err != nil {
		t.Fatalf("non-inheritable listener dial failed: %v", err)
	}
	_ = conn.Close()
	if err := <-accepted; err != nil {
		t.Fatalf("non-inheritable listener accept failed: %v", err)
	}
}
