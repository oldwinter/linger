//go:build darwin

package telemetry

import (
	"context"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

type hostSampler struct {
	mu                   sync.Mutex
	staticOnce           sync.Once
	osLabel              string
	chipName             string
	memSize              uint64
	totalCores           uint64
	clusters             []wire.SystemTelemetryCpuCluster
	metalWorkingSetBytes *uint64
	prevSwapPages        uint64
	prevSwapAt           time.Time
	hasPrevSwap          bool
}

func newHostSampler() *hostSampler {
	return &hostSampler{}
}

func (h *hostSampler) initStatic(ctx context.Context) {
	h.staticOnce.Do(func() {
		prodName, _ := runCommandBounded(ctx, hostCommandTimeout, "/usr/bin/sw_vers", "-productName")
		prodVer, _ := runCommandBounded(ctx, hostCommandTimeout, "/usr/bin/sw_vers", "-productVersion")
		h.osLabel = strings.TrimSpace(strings.TrimSpace(prodName) + " " + strings.TrimSpace(prodVer))
		if h.osLabel == "" {
			h.osLabel = "macOS"
		}

		if brand, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string"); ok {
			h.chipName = strings.TrimSpace(brand)
		}
		if rawMem, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/sysctl", "-n", "hw.memsize"); ok {
			if n, err := strconv.ParseUint(strings.TrimSpace(rawMem), 10, 64); err == nil {
				h.memSize = n
			}
		}
		if rawCPU, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/sysctl", "-n", "hw.ncpu"); ok {
			if n, err := strconv.ParseUint(strings.TrimSpace(rawCPU), 10, 64); err == nil {
				h.totalCores = n
			}
		}
		if h.totalCores == 0 {
			h.totalCores = uint64(max(runtime.NumCPU(), 1))
		}

		for level := range 4 {
			prefix := "hw.perflevel" + strconv.Itoa(level)
			rawCores, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/sysctl", "-n", prefix+".logicalcpu")
			if !ok {
				continue
			}
			cores, err := strconv.ParseUint(strings.TrimSpace(rawCores), 10, 64)
			if err != nil || cores == 0 {
				continue
			}
			name := "Cluster " + strconv.Itoa(level)
			if rawName, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/sysctl", "-n", prefix+".name"); ok {
				if trimmed := strings.TrimSpace(rawName); trimmed != "" {
					name = trimmed
				}
			}
			h.clusters = append(h.clusters, wire.SystemTelemetryCpuCluster{
				ID:    "perflevel" + strconv.Itoa(level),
				Name:  name,
				Kind:  normalizeClusterKind(name),
				Cores: cores,
			})
		}
		if len(h.clusters) == 0 && h.totalCores > 0 {
			h.clusters = []wire.SystemTelemetryCpuCluster{{
				ID:    "cpu0",
				Name:  "CPU",
				Kind:  "generic",
				Cores: h.totalCores,
			}}
		}

		// Read Metal recommendedMaxWorkingSetSize once via rootless JXA (zero CGo).
		if rawWS, ok := runCommandBounded(ctx, 2*time.Second, "/usr/bin/osascript", "-l", "JavaScript", "-e",
			`ObjC.import("Metal"); const d = $.MTLCreateSystemDefaultDevice(); d ? String(d.recommendedMaxWorkingSetSize) : ""`); ok {
			if ws, err := strconv.ParseUint(strings.TrimSpace(rawWS), 10, 64); err == nil && ws > 0 {
				h.metalWorkingSetBytes = &ws
			}
		}
	})
}

func (h *hostSampler) sample(ctx context.Context, diskPath string, now time.Time) rawHostSample {
	h.initStatic(ctx)

	hostname, _ := os.Hostname()
	sample := rawHostSample{
		Architecture:        "uma",
		Platform:            "darwin",
		Arch:                wireArch(),
		Hostname:            clipTelemetryString(hostname, 200),
		ChipName:            clipTelemetryString(h.chipName, 200),
		OSLabel:             clipTelemetryString(h.osLabel, 200),
		CPUTotalCores:       h.totalCores,
		CPUClusters:         append([]wire.SystemTelemetryCpuCluster(nil), h.clusters...),
		SystemRAMTotalBytes: h.memSize,
	}
	if ane, ok := AppleSiliconANECores(sample.ChipName); ok {
		sample.ANECores = &ane
	}
	if h.metalWorkingSetBytes != nil {
		ws := *h.metalWorkingSetBytes
		sample.RecommendedWorkingSetBytes = &ws
	}

	// Dynamic sysctl values: iogpu.wired_limit_mb, vm.loadavg, vm.swapusage, memory pressure.
	if rawLimit, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/sysctl", "-n", "iogpu.wired_limit_mb"); ok {
		if mb, err := strconv.ParseUint(strings.TrimSpace(rawLimit), 10, 64); err == nil && mb > 0 {
			ws := mb << 20
			sample.RecommendedWorkingSetBytes = &ws
		}
	}
	if rawLoad, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/sysctl", "-n", "vm.loadavg"); ok {
		if avg, ok := ParseLoadAvg(rawLoad); ok {
			sample.LoadAvg = avg
		}
	}
	if rawSwap, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/sysctl", "-n", "vm.swapusage"); ok {
		if used, total, ok := ParseSwapUsage(rawSwap); ok {
			sample.SwapUsedBytes = &used
			sample.SwapTotalBytes = &total
		}
	}
	if rawPressure, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/sysctl", "-n", "kern.memorystatus_vm_pressure_level"); ok {
		if pressure, ok := ParseMemoryPressureLevel(rawPressure); ok {
			sample.MemoryPressure = pressure
		}
	}

	// vm_stat page breakdown + swap I/O rate.
	if rawVM, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/bin/vm_stat"); ok {
		if vm, ok := ParseVMStat(rawVM); ok {
			availPages := vm.FreePages + vm.InactivePages + vm.Speculative
			availBytes := availPages * vm.PageSize
			if sample.SystemRAMTotalBytes > 0 && availBytes > sample.SystemRAMTotalBytes {
				availBytes = sample.SystemRAMTotalBytes
			}
			sample.SystemRAMAvailableBytes = availBytes
			sample.OSWiredBytes = vm.WiredPages * vm.PageSize
			sample.ActiveAppsBytes = vm.ActivePages * vm.PageSize
			sample.CompressedBytes = vm.CompressedPages * vm.PageSize

			swapPages := vm.Swapins + vm.Swapouts
			h.mu.Lock()
			if h.hasPrevSwap && now.After(h.prevSwapAt) && swapPages >= h.prevSwapPages {
				dt := now.Sub(h.prevSwapAt).Seconds()
				if dt > 0.05 {
					deltaBytes := float64(swapPages-h.prevSwapPages) * float64(vm.PageSize)
					mbps := round1((deltaBytes / (1 << 20)) / dt)
					sample.SwapIOMBs = &mbps
				}
			} else {
				zero := 0.0
				sample.SwapIOMBs = &zero
			}
			h.prevSwapPages = swapPages
			h.prevSwapAt = now
			h.hasPrevSwap = true
			h.mu.Unlock()
		}
	}

	// Rootless AGXAccelerator GPU telemetry.
	if rawIOReg, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/sbin/ioreg", "-r", "-c", "AGXAccelerator", "-d", "1"); ok {
		if agx, ok := ParseAGXAccelerator(rawIOReg); ok {
			if agx.Model != "" {
				sample.GPUName = clipTelemetryString(agx.Model, 200)
			}
			sample.GPUCoreCount = agx.GPUCoreCount
			sample.GPU.UtilPct = agx.DeviceUtilPct
			sample.GPU.RendererPct = agx.RendererUtilPct
			sample.GPU.TilerPct = agx.TilerUtilPct
			sample.GPU.InUseSystemBytes = agx.InUseSystemBytes
			sample.GPU.AllocSystemBytes = agx.AllocSystemBytes
		}
	}
	if sample.GPUName == "" && sample.ChipName != "" {
		sample.GPUName = sample.ChipName
	}

	// Rootless thermal / throttling status via pmset.
	if rawTherm, ok := runCommandBounded(ctx, hostCommandTimeout, "/usr/bin/pmset", "-g", "therm"); ok {
		if therm, ok := ParsePMSetTherm(rawTherm); ok {
			sample.Thermal.CpuSpeedLimitPct = therm.CPUSpeedLimitPct
			sample.Thermal.State = therm.ThermalState
			sample.Thermal.Throttling = therm.Throttling
			sample.Thermal.ThrottleReason = therm.ThrottleReason
		}
	}

	// Rootless instantaneous CPU utilization % across processes normalized by logical cores.
	if rawPS, ok := runCommandBounded(ctx, hostCommandTimeout, "/bin/ps", "-A", "-o", "%cpu"); ok {
		if loadPct, ok := parseDarwinPSCPU(rawPS, sample.CPUTotalCores); ok {
			sample.CPULoadPct = &loadPct
		}
	}

	// Disk free / total bytes via statfs.
	if diskPath == "" {
		diskPath = "/"
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(diskPath, &stat); err == nil && stat.Bsize > 0 {
		bsize := uint64(stat.Bsize)
		total := stat.Blocks * bsize
		free := stat.Bavail * bsize
		sample.DiskTotalBytes = &total
		sample.DiskFreeBytes = &free
	}

	return sample
}

func parseDarwinPSCPU(text string, totalCores uint64) (float64, bool) {
	if totalCores == 0 {
		return 0, false
	}
	var sum float64
	var seen bool
	for i, line := range strings.Split(text, "\n") {
		if i == 0 {
			continue
		}
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		v, err := strconv.ParseFloat(trimmed, 64)
		if err != nil || v < 0 {
			continue
		}
		sum += v
		seen = true
	}
	if !seen {
		return 0, false
	}
	return round1(clampFloat(sum/float64(totalCores), 0, 100)), true
}
