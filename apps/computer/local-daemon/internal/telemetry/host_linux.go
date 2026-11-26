//go:build linux

package telemetry

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

type hostSampler struct {
	mu            sync.Mutex
	staticOnce    sync.Once
	osLabel       string
	chipName      string
	prevCPU       ProcCPUTimes
	hasPrevCPU    bool
	prevSwapPages uint64
	prevSwapAt    time.Time
	hasPrevSwap   bool
}

func newHostSampler() *hostSampler {
	return &hostSampler{}
}

func (h *hostSampler) initStatic() {
	h.staticOnce.Do(func() {
		if raw, err := os.ReadFile("/etc/os-release"); err == nil {
			for _, line := range strings.Split(string(raw), "\n") {
				if val, ok := strings.CutPrefix(line, "PRETTY_NAME="); ok {
					h.osLabel = strings.Trim(strings.TrimSpace(val), `"`)
					break
				}
			}
		}
		if h.osLabel == "" {
			h.osLabel = "Linux"
		}
		if raw, err := os.ReadFile("/proc/cpuinfo"); err == nil {
			for _, line := range strings.Split(string(raw), "\n") {
				key, val, ok := strings.Cut(line, ":")
				if !ok {
					continue
				}
				k := strings.TrimSpace(key)
				if k == "model name" || k == "Model" || k == "Hardware" {
					h.chipName = strings.TrimSpace(val)
					break
				}
			}
		}
		if h.chipName == "" {
			h.chipName = "Linux CPU (" + runtime.GOARCH + ")"
		}
	})
}

func (h *hostSampler) sample(ctx context.Context, diskPath string, now time.Time) rawHostSample {
	h.initStatic()
	hostname, _ := os.Hostname()
	cores := uint64(max(runtime.NumCPU(), 1))

	sample := rawHostSample{
		Architecture:  "uma",
		Platform:      "linux",
		Arch:          wireArch(),
		Hostname:      clipTelemetryString(hostname, 200),
		ChipName:      clipTelemetryString(h.chipName, 200),
		OSLabel:       clipTelemetryString(h.osLabel, 200),
		CPUTotalCores: cores,
		CPUClusters: []wire.SystemTelemetryCpuCluster{{
			ID:    "cpu0",
			Name:  "CPU",
			Kind:  "generic",
			Cores: cores,
		}},
	}

	if raw, err := os.ReadFile("/proc/meminfo"); err == nil {
		if info, ok := ParseProcMeminfo(string(raw)); ok {
			sample.SystemRAMTotalBytes = info.MemTotal
			avail := info.MemAvailable
			if avail == 0 {
				avail = info.MemFree + info.Buffers + info.Cached
			}
			if avail > info.MemTotal {
				avail = info.MemTotal
			}
			sample.SystemRAMAvailableBytes = avail
			sample.OSWiredBytes = info.Slab + info.Mlocked + info.Unevictable
			sample.CompressedBytes = info.Zswap
			used := uint64(0)
			if info.MemTotal > avail {
				used = info.MemTotal - avail
			}
			if used > sample.OSWiredBytes+sample.CompressedBytes {
				sample.ActiveAppsBytes = used - sample.OSWiredBytes - sample.CompressedBytes
			}
			if info.SwapTotal > 0 {
				swapTotal := info.SwapTotal
				swapUsed := uint64(0)
				if info.SwapTotal > info.SwapFree {
					swapUsed = info.SwapTotal - info.SwapFree
				}
				sample.SwapTotalBytes = &swapTotal
				sample.SwapUsedBytes = &swapUsed
			}
			if info.MemTotal > 0 {
				availPct := float64(avail) / float64(info.MemTotal) * 100
				switch {
				case availPct < 8:
					sample.MemoryPressure = "critical"
				case availPct < 18:
					sample.MemoryPressure = "warning"
				default:
					sample.MemoryPressure = "normal"
				}
			}
		}
	}

	if raw, err := os.ReadFile("/proc/loadavg"); err == nil {
		if avg, ok := ParseLoadAvg(string(raw)); ok {
			sample.LoadAvg = avg
		}
	}

	if raw, err := os.ReadFile("/proc/stat"); err == nil {
		if cpuTimes, ok := ParseProcStatCPU(string(raw)); ok {
			h.mu.Lock()
			if h.hasPrevCPU && cpuTimes.Total > h.prevCPU.Total {
				dTotal := float64(cpuTimes.Total - h.prevCPU.Total)
				dIdle := float64(0)
				if cpuTimes.Idle >= h.prevCPU.Idle {
					dIdle = float64(cpuTimes.Idle - h.prevCPU.Idle)
				}
				pct := round1(clampFloat(((dTotal-dIdle)/dTotal)*100, 0, 100))
				sample.CPULoadPct = &pct
			}
			h.prevCPU = cpuTimes
			h.hasPrevCPU = true
			h.mu.Unlock()
		}
	}

	if raw, err := os.ReadFile("/proc/vmstat"); err == nil {
		if vmstat, ok := ParseProcVMStat(string(raw)); ok {
			pages := vmstat.Pswpin + vmstat.Pswpout
			pageSize := uint64(max(os.Getpagesize(), 4096))
			h.mu.Lock()
			if h.hasPrevSwap && now.After(h.prevSwapAt) && pages >= h.prevSwapPages {
				dt := now.Sub(h.prevSwapAt).Seconds()
				if dt > 0.05 {
					mbps := round1((float64(pages-h.prevSwapPages) * float64(pageSize) / (1 << 20)) / dt)
					sample.SwapIOMBs = &mbps
				}
			} else {
				zero := 0.0
				sample.SwapIOMBs = &zero
			}
			h.prevSwapPages = pages
			h.prevSwapAt = now
			h.hasPrevSwap = true
			h.mu.Unlock()
		}
	}

	if gpus, ok := sampleNvidiaSMI(ctx); ok {
		applyNvidiaSamples(&sample, gpus)
	} else {
		sampleLinuxAMDSysfs(&sample)
	}

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

func sampleLinuxAMDSysfs(sample *rawHostSample) {
	cards, err := filepath.Glob("/sys/class/drm/card*/device/gpu_busy_percent")
	if err != nil || len(cards) == 0 {
		return
	}
	devDir := filepath.Dir(cards[0])
	readU64 := func(name string) (uint64, bool) {
		raw, err := os.ReadFile(filepath.Join(devDir, name))
		if err != nil {
			return 0, false
		}
		v, err := strconv.ParseUint(strings.TrimSpace(string(raw)), 10, 64)
		return v, err == nil
	}
	if busy, ok := readU64("gpu_busy_percent"); ok {
		v := clampFloat(float64(busy), 0, 100)
		sample.GPU.UtilPct = &v
	}
	if total, ok := readU64("mem_info_vram_total"); ok && total > 0 {
		sample.Architecture = "discrete"
		sample.VRAMTotalBytes = &total
		if used, ok := readU64("mem_info_vram_used"); ok {
			sample.VRAMUsedBytes = &used
			if total >= used {
				free := total - used
				sample.VRAMFreeBytes = &free
			}
		}
	}
	if nameRaw, err := os.ReadFile(filepath.Join(devDir, "product_name")); err == nil {
		if name := strings.TrimSpace(string(nameRaw)); name != "" {
			sample.GPUName = clipTelemetryString(name, 200)
		}
	}
	if hwmonDirs, err := filepath.Glob(filepath.Join(devDir, "hwmon", "hwmon*")); err == nil && len(hwmonDirs) > 0 {
		if rawTemp, err := os.ReadFile(filepath.Join(hwmonDirs[0], "temp1_input")); err == nil {
			if milliC, err := strconv.ParseFloat(strings.TrimSpace(string(rawTemp)), 64); err == nil {
				c := round1(milliC / 1000.0)
				sample.Thermal.GpuTempC = &c
			}
		}
		if rawPow, err := os.ReadFile(filepath.Join(hwmonDirs[0], "power1_average")); err == nil {
			if microW, err := strconv.ParseFloat(strings.TrimSpace(string(rawPow)), 64); err == nil && microW >= 0 {
				w := round1(microW / 1e6)
				sample.Power.GpuW = &w
				sample.Power.PackageW = &w
			}
		}
	}
}
