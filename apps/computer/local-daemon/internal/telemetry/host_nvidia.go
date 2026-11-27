//go:build linux || windows

package telemetry

import (
	"context"
	"os/exec"
	"sync"
	"time"
)

const nvidiaThermalMetaTTL = 5 * time.Minute

type nvidiaMetaCache struct {
	mu            sync.Mutex
	fetchedAt     time.Time
	hasAttempted  bool
	throttleTempC *float64
}

func (c *nvidiaMetaCache) throttleTemp(ctx context.Context, now time.Time) *float64 {
	c.mu.Lock()
	if c.hasAttempted && now.Sub(c.fetchedAt) < nvidiaThermalMetaTTL {
		cached := cloneFloatPtr(c.throttleTempC)
		c.mu.Unlock()
		return cached
	}
	c.mu.Unlock()

	var parsed *float64
	if smi, err := exec.LookPath("nvidia-smi"); err == nil {
		if out, ok := runCommandBounded(ctx, hostCommandTimeout, smi, "-q", "-d", "TEMPERATURE"); ok {
			if limitC, ok := ParseNvidiaSMITemperature(out); ok {
				parsed = &limitC
			}
		}
	}

	c.mu.Lock()
	c.hasAttempted = true
	c.fetchedAt = now
	c.throttleTempC = cloneFloatPtr(parsed)
	c.mu.Unlock()
	return parsed
}

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

func applyNvidiaSamples(sample *rawHostSample, gpus []NvidiaGPUSample, throttleTempC *float64) {
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
	// nvidia-smi reports GPU board power, not CPU/SoC package power.
	sample.Power.GpuW = primary.PowerDrawW
	sample.Power.LimitW = primary.PowerLimitW
	sample.Thermal.GpuTempC = primary.TempC
	sample.Thermal.ThrottleTempC = cloneFloatPtr(throttleTempC)
	if primary.TempC != nil {
		if throttleTempC != nil && *throttleTempC > 0 {
			switch {
			case *primary.TempC >= *throttleTempC-2:
				sample.Thermal.State = "critical"
			case *primary.TempC >= *throttleTempC-8:
				sample.Thermal.State = "serious"
			case *primary.TempC >= *throttleTempC-16:
				sample.Thermal.State = "fair"
			default:
				sample.Thermal.State = "nominal"
			}
		} else {
			switch {
			case *primary.TempC >= 84:
				sample.Thermal.State = "critical"
			case *primary.TempC >= 78:
				sample.Thermal.State = "serious"
			case *primary.TempC >= 68:
				sample.Thermal.State = "fair"
			default:
				sample.Thermal.State = "nominal"
			}
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
