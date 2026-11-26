package telemetry

import (
	"math"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

// DiagnoseBottleneck classifies the dominant runtime constraint from live
// hardware and inference telemetry using structured numeric signals only.
func DiagnoseBottleneck(hw wire.SystemTelemetryHardware, inf wire.SystemTelemetryInference) wire.SystemTelemetryBottleneck {
	// 1. Thermal throttling takes precedence because it caps both compute and bandwidth.
	if hw.Thermal.Throttling ||
		(hw.Thermal.CpuSpeedLimitPct != nil && *hw.Thermal.CpuSpeedLimitPct < 90) ||
		(hw.Thermal.GpuTempC != nil && hw.Thermal.ThrottleTempC != nil && *hw.Thermal.GpuTempC >= *hw.Thermal.ThrottleTempC-4) {
		var factor *float64
		if hw.Thermal.CpuSpeedLimitPct != nil {
			v := round1(100 - *hw.Thermal.CpuSpeedLimitPct)
			factor = &v
		} else if hw.Thermal.GpuTempC != nil && hw.Thermal.ThrottleTempC != nil && *hw.Thermal.ThrottleTempC > 0 {
			v := round1(clampFloat((*hw.Thermal.GpuTempC / *hw.Thermal.ThrottleTempC)*100, 0, 100))
			factor = &v
		}
		return wire.SystemTelemetryBottleneck{
			Kind:              "thermal_throttled",
			Severity:          "critical",
			DominantFactorPct: factor,
			ReasonCode:        "thermal_limit_active",
		}
	}

	// 2. VRAM / unified memory pressure or active swap thrashing degrades decode dramatically.
	memRatioPct := memoryPressureRatioPct(hw)
	swapThrashing := hw.Memory.SwapIoMbS != nil && *hw.Memory.SwapIoMbS >= 5.0
	if hw.Memory.MemoryPressure == "critical" ||
		(hw.Memory.MemoryPressure == "warning" && swapThrashing) ||
		(memRatioPct != nil && *memRatioPct >= 94) {
		severity := "warning"
		if hw.Memory.MemoryPressure == "critical" || swapThrashing {
			severity = "critical"
		}
		return wire.SystemTelemetryBottleneck{
			Kind:              "vram_pressure",
			Severity:          severity,
			DominantFactorPct: memRatioPct,
			ReasonCode:        "memory_headroom_low",
		}
	}

	activeWork := inf.ActiveRequestsCount > 0 || inf.ActiveSlots > 0 || inf.DecodeTokS > 0.1 || inf.PrefillTokS > 0.1
	if !activeWork {
		return wire.SystemTelemetryBottleneck{
			Kind:       "idle",
			Severity:   "info",
			ReasonCode: "no_active_inference",
		}
	}

	// 3. KV cache saturation limits context and concurrency headroom.
	if inf.KvCacheUsedPct != nil && *inf.KvCacheUsedPct >= 85 {
		v := round1(*inf.KvCacheUsedPct)
		return wire.SystemTelemetryBottleneck{
			Kind:              "kv_cache_bound",
			Severity:          "warning",
			DominantFactorPct: &v,
			ReasonCode:        "kv_cache_high",
		}
	}

	// 4. Prefill compute dominance when prompts are being processed without active decode.
	if inf.PrefillTokS > 1.0 && inf.DecodeTokS < 1.0 {
		var factor *float64
		if hw.Gpu.UtilPct != nil {
			v := round1(*hw.Gpu.UtilPct)
			factor = &v
		}
		return wire.SystemTelemetryBottleneck{
			Kind:              "prefill_compute_bound",
			Severity:          "info",
			DominantFactorPct: factor,
			ReasonCode:        "prefill_compute_active",
		}
	}

	// 5. Autoregressive decode is memory-bandwidth bound near the hardware ceiling.
	if hw.Bandwidth.UtilizationPct != nil && *hw.Bandwidth.UtilizationPct >= 75 {
		v := round1(clampFloat(*hw.Bandwidth.UtilizationPct, 0, 100))
		return wire.SystemTelemetryBottleneck{
			Kind:              "memory_bw_bound",
			Severity:          "healthy",
			DominantFactorPct: &v,
			ReasonCode:        "decode_near_bandwidth_ceiling",
		}
	}

	var factor *float64
	if hw.Bandwidth.UtilizationPct != nil && *hw.Bandwidth.UtilizationPct > 0 {
		v := round1(clampFloat(*hw.Bandwidth.UtilizationPct, 0, 100))
		factor = &v
	} else if hw.Gpu.UtilPct != nil {
		v := round1(*hw.Gpu.UtilPct)
		factor = &v
	}
	return wire.SystemTelemetryBottleneck{
		Kind:              "healthy",
		Severity:          "healthy",
		DominantFactorPct: factor,
		ReasonCode:        "inference_healthy",
	}
}

func memoryPressureRatioPct(hw wire.SystemTelemetryHardware) *float64 {
	if hw.Architecture == "discrete" && hw.Memory.VramTotalBytes != nil && *hw.Memory.VramTotalBytes > 0 && hw.Memory.VramUsedBytes != nil {
		v := round1(clampFloat((float64(*hw.Memory.VramUsedBytes)/float64(*hw.Memory.VramTotalBytes))*100, 0, 100))
		return &v
	}
	if hw.Memory.RecommendedWorkingSetBytes != nil && *hw.Memory.RecommendedWorkingSetBytes > 0 {
		usedForGPU := hw.Memory.ModelWeightsBytes + hw.Memory.KvCacheBytes + hw.Memory.ComputeBufferBytes
		if usedForGPU > 0 {
			v := round1(clampFloat((float64(usedForGPU)/float64(*hw.Memory.RecommendedWorkingSetBytes))*100, 0, 100))
			return &v
		}
	}
	if hw.Memory.TotalBytes > 0 {
		v := round1(clampFloat((float64(hw.Memory.UsedBytes)/float64(hw.Memory.TotalBytes))*100, 0, 100))
		return &v
	}
	return nil
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}
