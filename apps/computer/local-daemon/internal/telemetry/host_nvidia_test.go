//go:build linux || windows

package telemetry

import (
	"context"
	"strings"
	"testing"
	"time"
)

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

	// Near RTX 4060 Ti's 83C limit triggers critical even below 87C.
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

func TestNvidiaSamplerCachingAndLifetimeStaticMeta(t *testing.T) {
	var dynamicCalls, tempCalls int
	sampler := &nvidiaSampler{
		run: func(_ context.Context, args ...string) (string, bool) {
			joined := strings.Join(args, " ")
			if strings.Contains(joined, "-d TEMPERATURE") {
				tempCalls++
				// Real RTX 4060 Ti pattern: headroom tlimit=35, actual target=83 C.
				return "GPU 00000000:01:00.0\n    Temperature\n        GPU Current Temp : 48 C\n        GPU T.Limit Temp : 35 C\n        GPU Target Temperature : 83 C\n", true
			}
			dynamicCalls++
			if dynamicCalls == 1 {
				return "0, NVIDIA GeForce RTX 4060 Ti, 16380, 1800, 14580, 4, 19.2, 165.0, 48, 2535, 3105, 0, 0x0000000000000001\n", true
			}
			// Simulate P8 idle omitting max clock on later poll.
			return "0, NVIDIA GeForce RTX 4060 Ti, 16380, 1900, 14480, 2, 15.0, 165.0, 46, 210, [N/A], 0, 0x0000000000000001\n", true
		},
	}

	t0 := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)
	gpus1, throttle1, ok := sampler.sample(context.Background(), t0)
	if !ok || len(gpus1) != 1 || throttle1 == nil || *throttle1 != 83 {
		t.Fatalf("first sample=(%v,%v,%v), want 83C", gpus1, throttle1, ok)
	}
	if dynamicCalls != 1 || tempCalls != 1 {
		t.Fatalf("expected 1 dynamic + 1 temp call, got %d / %d", dynamicCalls, tempCalls)
	}

	// Within dynamic TTL (1200ms): zero extra subprocesses.
	gpusCached, throttleCached, ok := sampler.sample(context.Background(), t0.Add(800*time.Millisecond))
	if !ok || len(gpusCached) != 1 || throttleCached == nil || *throttleCached != 83 {
		t.Fatalf("cached sample=(%v,%v,%v)", gpusCached, throttleCached, ok)
	}
	if dynamicCalls != 1 || tempCalls != 1 {
		t.Fatalf("expected cached sample with no extra calls, got %d / %d", dynamicCalls, tempCalls)
	}

	// After dynamic TTL (and even hours later): dynamic refreshes once, static thermal stays cached for lifetime,
	// and cached static max_freq_mhz fills in [N/A].
	gpus2, throttle2, ok := sampler.sample(context.Background(), t0.Add(2*time.Hour))
	if !ok || len(gpus2) != 1 || throttle2 == nil || *throttle2 != 83 {
		t.Fatalf("second sample=(%v,%v,%v)", gpus2, throttle2, ok)
	}
	if dynamicCalls != 2 || tempCalls != 1 {
		t.Fatalf("expected 2 dynamic + 1 lifetime temp call, got %d / %d", dynamicCalls, tempCalls)
	}
	if gpus2[0].MaxClockMHz == nil || *gpus2[0].MaxClockMHz != 3105 {
		t.Fatalf("expected cached static MaxClockMHz=3105, got %v", gpus2[0].MaxClockMHz)
	}
}
