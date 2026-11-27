//go:build linux || windows

package telemetry

import (
	"context"
	"os/exec"
	"sync"
	"time"
)

const (
	nvidiaDynamicSampleTTL = 1200 * time.Millisecond
	nvidiaRetryBackoffTTL  = 60 * time.Second
)

type nvidiaCommandRunner func(ctx context.Context, args ...string) (string, bool)

type nvidiaSampler struct {
	mu sync.Mutex

	// run overrides nvidia-smi execution in unit tests.
	run nvidiaCommandRunner

	smiPath        string
	smiMissingAt   time.Time
	hasMissingPath bool

	lastSamples    []NvidiaGPUSample
	lastSampleAt   time.Time
	hasLastSamples bool

	// Static GPU specs cached once per collector lifetime.
	staticThermalDone  bool
	staticThermalTryAt time.Time
	throttleTempC      *float64
	staticMaxFreqMHz   *float64
}

func (n *nvidiaSampler) execSMI(ctx context.Context, now time.Time, args ...string) (string, bool) {
	n.mu.Lock()
	runner := n.run
	cachedPath := n.smiPath
	missing := n.hasMissingPath && now.Sub(n.smiMissingAt) < nvidiaRetryBackoffTTL
	n.mu.Unlock()

	if runner != nil {
		return runner(ctx, args...)
	}
	if missing {
		return "", false
	}
	smi := cachedPath
	if smi == "" {
		found, err := exec.LookPath("nvidia-smi")
		if err != nil {
			n.mu.Lock()
			n.hasMissingPath = true
			n.smiMissingAt = now
			n.mu.Unlock()
			return "", false
		}
		smi = found
		n.mu.Lock()
		n.smiPath = smi
		n.hasMissingPath = false
		n.mu.Unlock()
	}
	return runCommandBounded(ctx, hostCommandTimeout, smi, args...)
}

func (n *nvidiaSampler) sample(ctx context.Context, now time.Time) ([]NvidiaGPUSample, *float64, bool) {
	n.mu.Lock()
	if n.hasLastSamples && now.Sub(n.lastSampleAt) < nvidiaDynamicSampleTTL {
		gpus := cloneNvidiaSamples(n.lastSamples)
		throttleC := cloneFloatPtr(n.throttleTempC)
		n.mu.Unlock()
		return gpus, throttleC, true
	}
	n.mu.Unlock()

	out, ok := n.execSMI(ctx, now, "--query-gpu="+nvidiaSMIColumns, "--format=csv,noheader,nounits")
	if !ok {
		return nil, nil, false
	}
	gpus, ok := ParseNvidiaSMI(out)
	if !ok {
		return nil, nil, false
	}

	n.mu.Lock()
	if gpus[0].MaxClockMHz != nil && *gpus[0].MaxClockMHz > 0 {
		if n.staticMaxFreqMHz == nil {
			v := *gpus[0].MaxClockMHz
			n.staticMaxFreqMHz = &v
		}
	} else if n.staticMaxFreqMHz != nil {
		v := *n.staticMaxFreqMHz
		gpus[0].MaxClockMHz = &v
	}
	needThermal := !n.staticThermalDone && (n.staticThermalTryAt.IsZero() || now.Sub(n.staticThermalTryAt) >= nvidiaRetryBackoffTTL)
	throttleC := cloneFloatPtr(n.throttleTempC)
	n.mu.Unlock()

	if needThermal {
		if tempOut, tempOK := n.execSMI(ctx, now, "-q", "-d", "TEMPERATURE"); tempOK {
			var parsed *float64
			if limitC, hasLimit := ParseNvidiaSMITemperature(tempOut); hasLimit {
				parsed = &limitC
			}
			n.mu.Lock()
			n.staticThermalDone = true
			n.throttleTempC = cloneFloatPtr(parsed)
			throttleC = cloneFloatPtr(parsed)
			n.mu.Unlock()
		} else {
			n.mu.Lock()
			n.staticThermalTryAt = now
			n.mu.Unlock()
		}
	}

	n.mu.Lock()
	n.lastSamples = cloneNvidiaSamples(gpus)
	n.lastSampleAt = now
	n.hasLastSamples = true
	n.mu.Unlock()

	return gpus, throttleC, true
}

func cloneNvidiaSamples(src []NvidiaGPUSample) []NvidiaGPUSample {
	out := make([]NvidiaGPUSample, len(src))
	for i, g := range src {
		out[i] = NvidiaGPUSample{
			Index:           g.Index,
			Name:            g.Name,
			MemoryTotalMB:   cloneFloatPtr(g.MemoryTotalMB),
			MemoryUsedMB:    cloneFloatPtr(g.MemoryUsedMB),
			MemoryFreeMB:    cloneFloatPtr(g.MemoryFreeMB),
			UtilPct:         cloneFloatPtr(g.UtilPct),
			PowerDrawW:      cloneFloatPtr(g.PowerDrawW),
			PowerLimitW:     cloneFloatPtr(g.PowerLimitW),
			TempC:           cloneFloatPtr(g.TempC),
			ClockMHz:        cloneFloatPtr(g.ClockMHz),
			MaxClockMHz:     cloneFloatPtr(g.MaxClockMHz),
			FanPct:          cloneFloatPtr(g.FanPct),
			ThrottleReasons: g.ThrottleReasons,
		}
	}
	return out
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
