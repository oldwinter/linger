//go:build linux || windows

package telemetry

import "testing"

func TestApplyNvidiaSamplesPowerAndThermal(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	gpus := []NvidiaGPUSample{{
		Index:         0,
		Name:          "NVIDIA GeForce RTX 4060 Ti",
		MemoryTotalMB: f(16380),
		MemoryUsedMB:  f(1800),
		MemoryFreeMB:  f(14580),
		UtilPct:       f(4),
		PowerDrawW:    f(19.2),
		PowerLimitW:   f(165.0),
		TempC:         f(45),
		ClockMHz:      f(2535),
		MaxClockMHz:   f(3105),
		FanPct:        f(0),
	}}

	var withLimit rawHostSample
	applyNvidiaSamples(&withLimit, gpus, f(83))
	if withLimit.Power.PackageW != nil {
		t.Fatalf("expected Power.PackageW=nil on discrete NVIDIA GPU, got %v", *withLimit.Power.PackageW)
	}
	if withLimit.Power.GpuW == nil || *withLimit.Power.GpuW != 19.2 || withLimit.Power.LimitW == nil || *withLimit.Power.LimitW != 165.0 {
		t.Fatalf("unexpected Power: %+v", withLimit.Power)
	}
	if withLimit.Thermal.ThrottleTempC == nil || *withLimit.Thermal.ThrottleTempC != 83 {
		t.Fatalf("expected real ThrottleTempC=83, got %v", withLimit.Thermal.ThrottleTempC)
	}
	if withLimit.Thermal.State != "nominal" {
		t.Fatalf("expected nominal at 45C/83C, got %q", withLimit.Thermal.State)
	}

	// Near RTX 4060 Ti's 83C limit triggers critical even below the old 87C assumption.
	gpus[0].TempC = f(82)
	var hot rawHostSample
	applyNvidiaSamples(&hot, gpus, f(83))
	if hot.Thermal.State != "critical" {
		t.Fatalf("expected critical at 82C/83C, got %q", hot.Thermal.State)
	}

	// Without a reported thermal limit, ThrottleTempC remains nil (never hardcoded 87).
	gpus[0].TempC = f(45)
	var withoutLimit rawHostSample
	applyNvidiaSamples(&withoutLimit, gpus, nil)
	if withoutLimit.Thermal.ThrottleTempC != nil {
		t.Fatalf("expected nil ThrottleTempC when unavailable, got %v", *withoutLimit.Thermal.ThrottleTempC)
	}
	if withoutLimit.Thermal.State != "nominal" {
		t.Fatalf("expected nominal fallback state, got %q", withoutLimit.Thermal.State)
	}
}
