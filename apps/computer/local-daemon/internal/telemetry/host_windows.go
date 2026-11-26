//go:build windows

package telemetry

import (
	"context"
	"os"
	"runtime"
	"sync"
	"time"
	"unsafe"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
	"golang.org/x/sys/windows"
)

var (
	kernel32DLL              = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalMemoryStatusEx = kernel32DLL.NewProc("GlobalMemoryStatusEx")
	procGetSystemTimes       = kernel32DLL.NewProc("GetSystemTimes")
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
	mu           sync.Mutex
	prevIdle     uint64
	prevKernel   uint64
	prevUser     uint64
	hasPrevTimes bool
}

func newHostSampler() *hostSampler {
	return &hostSampler{}
}

func (h *hostSampler) sample(ctx context.Context, diskPath string, _ time.Time) rawHostSample {
	hostname, _ := os.Hostname()
	cores := uint64(max(runtime.NumCPU(), 1))

	sample := rawHostSample{
		Architecture:  "uma",
		Platform:      "windows",
		Arch:          wireArch(),
		Hostname:      clipTelemetryString(hostname, 200),
		ChipName:      "Windows CPU (" + runtime.GOARCH + ")",
		OSLabel:       "Windows",
		CPUTotalCores: cores,
		CPUClusters: []wire.SystemTelemetryCpuCluster{{
			ID:    "cpu0",
			Name:  "CPU",
			Kind:  "generic",
			Cores: cores,
		}},
	}

	var mem memoryStatusEx
	mem.Length = uint32(unsafe.Sizeof(mem))
	if r1, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&mem))); r1 != 0 && mem.TotalPhys > 0 {
		sample.SystemRAMTotalBytes = mem.TotalPhys
		sample.SystemRAMAvailableBytes = min(mem.AvailPhys, mem.TotalPhys)
		if mem.TotalPhys > sample.SystemRAMAvailableBytes {
			sample.ActiveAppsBytes = mem.TotalPhys - sample.SystemRAMAvailableBytes
		}
		if mem.TotalPageFile > mem.TotalPhys {
			swapTotal := mem.TotalPageFile - mem.TotalPhys
			sample.SwapTotalBytes = &swapTotal
			if mem.TotalPageFile >= mem.AvailPageFile {
				usedPage := mem.TotalPageFile - mem.AvailPageFile
				if usedPage > sample.ActiveAppsBytes {
					swapUsed := min(usedPage-sample.ActiveAppsBytes, swapTotal)
					sample.SwapUsedBytes = &swapUsed
				}
			}
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

	var idleFT, kernelFT, userFT windows.Filetime
	if r1, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleFT)),
		uintptr(unsafe.Pointer(&kernelFT)),
		uintptr(unsafe.Pointer(&userFT)),
	); r1 != 0 {
		idle := filetimeToUint64(idleFT)
		kernel := filetimeToUint64(kernelFT)
		user := filetimeToUint64(userFT)
		h.mu.Lock()
		if h.hasPrevTimes {
			dIdle := idle - h.prevIdle
			dKernel := kernel - h.prevKernel
			dUser := user - h.prevUser
			dTotal := dKernel + dUser
			if dTotal > 0 && dTotal >= dIdle {
				pct := round1(clampFloat(float64(dTotal-dIdle)/float64(dTotal)*100, 0, 100))
				sample.CPULoadPct = &pct
			}
		}
		h.prevIdle, h.prevKernel, h.prevUser, h.hasPrevTimes = idle, kernel, user, true
		h.mu.Unlock()
	}

	if gpus, ok := sampleNvidiaSMI(ctx); ok {
		applyNvidiaSamples(&sample, gpus)
	}

	if diskPath == "" {
		diskPath = `C:\`
	}
	if ptr, err := windows.UTF16PtrFromString(diskPath); err == nil {
		var freeAvail, totalBytes, totalFree uint64
		if err := windows.GetDiskFreeSpaceEx(ptr, &freeAvail, &totalBytes, &totalFree); err == nil && totalBytes > 0 {
			sample.DiskTotalBytes = &totalBytes
			sample.DiskFreeBytes = &freeAvail
		}
	}

	return sample
}

func filetimeToUint64(ft windows.Filetime) uint64 {
	return (uint64(ft.HighDateTime) << 32) | uint64(ft.LowDateTime)
}
