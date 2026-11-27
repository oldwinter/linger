//go:build windows

package telemetry

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	relationProcessorCore   = 0
	maxWindowsSysInfoBuffer = 1 << 20
)

var (
	kernel32DLL                          = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalMemoryStatusEx             = kernel32DLL.NewProc("GlobalMemoryStatusEx")
	procGetSystemTimes                   = kernel32DLL.NewProc("GetSystemTimes")
	procGetLogicalProcessorInformationEx = kernel32DLL.NewProc("GetLogicalProcessorInformationEx")
)

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

type hostSampler struct {
	mu             sync.Mutex
	staticOnce     sync.Once
	osLabel        string
	chipName       string
	physicalCores  uint64
	logicalThreads uint64
	prevIdle       uint64
	prevKernel     uint64
	prevUser       uint64
	hasPrevTimes   bool
	nvidia         nvidiaSampler
}

func newHostSampler() *hostSampler {
	h := &hostSampler{}
	h.primeCPUTimes()
	return h
}

func (h *hostSampler) primeCPUTimes() {
	idle, kernel, user, ok := readWindowsSystemTimes()
	if !ok {
		return
	}
	h.mu.Lock()
	h.prevIdle, h.prevKernel, h.prevUser, h.hasPrevTimes = idle, kernel, user, true
	h.mu.Unlock()
}

func (h *hostSampler) initStatic() {
	h.staticOnce.Do(func() {
		h.chipName = readWindowsCPUBrand()
		if h.chipName == "" {
			h.chipName = "Windows CPU (" + runtime.GOARCH + ")"
		}
		h.osLabel = readWindowsOSLabel()

		logical := uint64(max(runtime.NumCPU(), 1))
		physical := logical
		if detected, ok := detectWindowsPhysicalCores(); ok && detected > 0 {
			physical = detected
		}
		if logical < physical {
			logical = physical
		}
		h.physicalCores = physical
		h.logicalThreads = logical
	})
}

func (h *hostSampler) sample(ctx context.Context, diskPath string, now time.Time) rawHostSample {
	h.initStatic()
	hostname, _ := os.Hostname()
	logicalThreads := h.logicalThreads
	clusterName := clipTelemetryString(h.chipName, 120)
	if clusterName == "" {
		clusterName = "CPU"
	}

	sample := rawHostSample{
		Architecture:      "host",
		Platform:          "windows",
		Arch:              wireArch(),
		Hostname:          clipTelemetryString(hostname, 200),
		ChipName:          clipTelemetryString(h.chipName, 200),
		OSLabel:           clipTelemetryString(h.osLabel, 200),
		CPUTotalCores:     h.physicalCores,
		CPULogicalThreads: &logicalThreads,
		CPUClusters: []wire.SystemTelemetryCpuCluster{{
			ID:    "cpu0",
			Name:  clusterName,
			Kind:  "generic",
			Cores: h.physicalCores,
		}},
	}

	var mem memoryStatusEx
	mem.Length = uint32(unsafe.Sizeof(mem))
	hasMemStatus := false
	if r1, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&mem))); r1 != 0 && mem.TotalPhys > 0 { //nolint:gosec // Win32 GlobalMemoryStatusEx fills a fixed-size MEMORYSTATUSEX struct
		hasMemStatus = true
		sample.SystemRAMTotalBytes = mem.TotalPhys
		sample.SystemRAMAvailableBytes = min(mem.AvailPhys, mem.TotalPhys)
		if mem.TotalPhys > sample.SystemRAMAvailableBytes {
			sample.ActiveAppsBytes = mem.TotalPhys - sample.SystemRAMAvailableBytes
		}
		switch {
		case mem.MemoryLoad >= 92:
			sample.MemoryPressure = "critical"
		case mem.MemoryLoad >= 80:
			sample.MemoryPressure = "warning"
		default:
			sample.MemoryPressure = "normal"
		}
	}

	// Query real pagefile usage directly from the kernel rather than GlobalMemoryStatusEx commit charge.
	if swapUsed, swapTotal, ok := sampleWindowsPagefile(); ok {
		sample.SwapTotalBytes = &swapTotal
		sample.SwapUsedBytes = &swapUsed
	} else if hasMemStatus {
		if mem.TotalPageFile > mem.TotalPhys {
			swapTotal := mem.TotalPageFile - mem.TotalPhys
			sample.SwapTotalBytes = &swapTotal
		} else {
			zero := uint64(0)
			sample.SwapTotalBytes = &zero
			sample.SwapUsedBytes = &zero
		}
	}

	if idle, kernel, user, ok := readWindowsSystemTimes(); ok {
		h.mu.Lock()
		if h.hasPrevTimes && idle >= h.prevIdle && kernel >= h.prevKernel && user >= h.prevUser {
			dIdle := idle - h.prevIdle
			dKernel := kernel - h.prevKernel
			dUser := user - h.prevUser
			dTotal := dKernel + dUser
			if dTotal > 0 && dTotal >= dIdle {
				pct := round1(clampFloat(float64(dTotal-dIdle)/float64(dTotal)*100, 0, 100))
				sample.CPULoadPct = &pct
				if len(sample.CPUClusters) == 1 {
					clusterPct := pct
					sample.CPUClusters[0].LoadPct = &clusterPct
				}
			}
		}
		h.prevIdle, h.prevKernel, h.prevUser, h.hasPrevTimes = idle, kernel, user, true
		h.mu.Unlock()
	}

	if gpus, throttleC, ok := h.nvidia.sample(ctx, now); ok {
		applyNvidiaSamples(&sample, gpus, throttleC)
	}

	sampleWindowsDisk(diskPath, &sample)

	return sample
}

func sampleWindowsDisk(diskPath string, sample *rawHostSample) {
	vol := ResolveWindowsDiskVolume(diskPath, "")
	candidates := make([]string, 0, 3)
	if trimmed := strings.TrimSpace(diskPath); trimmed != "" && !strings.EqualFold(trimmed, vol) {
		candidates = append(candidates, trimmed)
	}
	candidates = append(candidates, vol)
	if !strings.EqualFold(vol, `C:\`) {
		candidates = append(candidates, `C:\`)
	}
	for _, target := range candidates {
		ptr, err := windows.UTF16PtrFromString(target)
		if err != nil {
			continue
		}
		var freeAvail, totalBytes, totalFree uint64
		if err := windows.GetDiskFreeSpaceEx(ptr, &freeAvail, &totalBytes, &totalFree); err == nil && totalBytes > 0 {
			sample.DiskTotalBytes = &totalBytes
			sample.DiskFreeBytes = &freeAvail
			return
		}
	}
}

func configureSubprocess(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_NO_WINDOW
}

func readWindowsSystemTimes() (idle, kernel, user uint64, ok bool) {
	var idleFT, kernelFT, userFT windows.Filetime
	//nolint:gosec // Win32 GetSystemTimes writes into caller-owned FILETIME structs.
	if r1, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleFT)),
		uintptr(unsafe.Pointer(&kernelFT)),
		uintptr(unsafe.Pointer(&userFT)),
	); r1 == 0 {
		return 0, 0, 0, false
	}
	return filetimeToUint64(idleFT), filetimeToUint64(kernelFT), filetimeToUint64(userFT), true
}

func sampleWindowsPagefile() (usedBytes, totalBytes uint64, ok bool) {
	pageSize := uint64(os.Getpagesize())
	if pageSize == 0 {
		pageSize = 4096
	}
	buf := make([]byte, 4096)
	for range 4 {
		var retLen uint32
		err := windows.NtQuerySystemInformation(
			windows.SystemPageFileInformation,
			unsafe.Pointer(&buf[0]), //nolint:gosec // NtQuerySystemInformation writes into caller-allocated byte buffer
			uint32(len(buf)),
			&retLen,
		)
		if errors.Is(err, windows.STATUS_INFO_LENGTH_MISMATCH) || errors.Is(err, windows.STATUS_BUFFER_TOO_SMALL) {
			nextSize := max(int(retLen)+256, len(buf)*2)
			if nextSize <= len(buf) || nextSize > maxWindowsSysInfoBuffer {
				return 0, 0, false
			}
			buf = make([]byte, nextSize)
			continue
		}
		if err != nil {
			return 0, 0, false
		}
		if retLen == 0 {
			return 0, 0, true
		}
		return ParseWindowsPagefileInfo(buf[:min(int(retLen), len(buf))], pageSize)
	}
	return 0, 0, false
}

func detectWindowsPhysicalCores() (uint64, bool) {
	if err := procGetLogicalProcessorInformationEx.Find(); err != nil {
		return 0, false
	}
	var bufLen uint32
	for range 3 {
		var buf []byte
		var ptr uintptr
		if bufLen > 0 {
			if bufLen > maxWindowsSysInfoBuffer {
				return 0, false
			}
			buf = make([]byte, bufLen)
			ptr = uintptr(unsafe.Pointer(&buf[0])) //nolint:gosec // GetLogicalProcessorInformationEx writes into caller-allocated byte buffer
		}
		r1, _, lastErr := procGetLogicalProcessorInformationEx.Call(
			uintptr(relationProcessorCore),
			ptr,
			uintptr(unsafe.Pointer(&bufLen)), //nolint:gosec // Win32 out-param receives required buffer length
		)
		if r1 != 0 {
			return ParseWindowsLogicalProcessorInfoEx(buf[:min(int(bufLen), len(buf))])
		}
		if !errors.Is(lastErr, windows.ERROR_INSUFFICIENT_BUFFER) || bufLen == 0 {
			return 0, false
		}
	}
	return 0, false
}

func readWindowsCPUBrand() string {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DESCRIPTION\System\CentralProcessor\0`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer key.Close()
	name, _, err := key.GetStringValue("ProcessorNameString")
	if err != nil {
		return ""
	}
	return NormalizeWindowsCPUBrand(name)
}

func readWindowsOSLabel() string {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		return "Windows"
	}
	defer key.Close()
	productName, _, _ := key.GetStringValue("ProductName")
	displayVersion, _, _ := key.GetStringValue("DisplayVersion")
	if displayVersion == "" {
		displayVersion, _, _ = key.GetStringValue("ReleaseId")
	}
	currentBuild, _, _ := key.GetStringValue("CurrentBuildNumber")
	return FormatWindowsOSLabel(productName, displayVersion, currentBuild)
}

func filetimeToUint64(ft windows.Filetime) uint64 {
	return (uint64(ft.HighDateTime) << 32) | uint64(ft.LowDateTime)
}
