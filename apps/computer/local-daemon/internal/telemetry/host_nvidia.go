//go:build linux || windows

package telemetry

import (
	"context"
	"os/exec"
)

func sampleNvidiaSMI(ctx context.Context) ([]NvidiaGPUSample, bool) {
	smi, err := exec.LookPath("nvidia-smi")
	if err != nil {
		return nil, false
	}
	out, ok := runCommandBounded(ctx, hostCommandTimeout, smi, "--query-gpu="+nvidiaSMIColumns, "--format=csv,noheader,nounits")
	if !ok {
		return nil, false
	}
	return ParseNvidiaSMI(out)
}

func applyNvidiaSamples(sample *rawHostSample, gpus []NvidiaGPUSample) {
	if len(gpus) == 0 {
		return
	}
	primary := gpus[0]
	sample.Architecture = "discrete"
	if primary.Name != "" {
		sample.GPUName = primary.Name
	}
	var totalBytes, usedBytes, freeBytes uint64
	var hasTotal, hasUsed, hasFree bool
	for _, g := range gpus {
		if g.MemoryTotalMB != nil {
			totalBytes += uint64(*g.MemoryTotalMB * (1 << 20))
			hasTotal = true
		}
		if g.MemoryUsedMB != nil {
			usedBytes += uint64(*g.MemoryUsedMB * (1 << 20))
			hasUsed = true
		}
		if g.MemoryFreeMB != nil {
			freeBytes += uint64(*g.MemoryFreeMB * (1 << 20))
			hasFree = true
		}
	}
	if hasTotal {
		sample.VRAMTotalBytes = &totalBytes
	}
	if hasUsed {
		sample.VRAMUsedBytes = &usedBytes
	}
	if hasFree {
		sample.VRAMFreeBytes = &freeBytes
	} else if hasTotal && hasUsed && totalBytes >= usedBytes {
		diff := totalBytes - usedBytes
		sample.VRAMFreeBytes = &diff
	}
	sample.GPU.UtilPct = primary.UtilPct
	sample.GPU.FreqMhz = primary.ClockMHz
	sample.GPU.MaxFreqMhz = primary.MaxClockMHz
	sample.Power.GpuW = primary.PowerDrawW
	sample.Power.PackageW = primary.PowerDrawW
	sample.Power.LimitW = primary.PowerLimitW
	sample.Thermal.GpuTempC = primary.TempC
	if primary.TempC != nil {
		capC := 87.0
		sample.Thermal.ThrottleTempC = &capC
		if *primary.TempC >= 84 {
			sample.Thermal.State = "critical"
		} else if *primary.TempC >= 78 {
			sample.Thermal.State = "serious"
		} else if *primary.TempC >= 68 {
			sample.Thermal.State = "fair"
		} else {
			sample.Thermal.State = "nominal"
		}
	}
	sample.Thermal.FanPct = primary.FanPct
	if primary.ThrottleReasons != "" {
		sample.Thermal.Throttling = true
		sample.Thermal.ThrottleReason = primary.ThrottleReasons
		if sample.Thermal.State == "" || sample.Thermal.State == "nominal" {
			sample.Thermal.State = "serious"
		}
	}
}
