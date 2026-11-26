package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

func TestParseVMStatAndSysctlHelpers(t *testing.T) {
	vmOut := `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    61515.
Pages active:                                 245270.
Pages inactive:                               231284.
Pages speculative:                             12564.
Pages wired down:                             660878.
Pages occupied by compressor:                 323837.
Swapins:                                      873645.
Swapouts:                                    1557499.
`
	vm, ok := ParseVMStat(vmOut)
	if !ok {
		t.Fatal("ParseVMStat failed")
	}
	if vm.PageSize != 16384 || vm.WiredPages != 660878 || vm.CompressedPages != 323837 || vm.Swapins != 873645 || vm.Swapouts != 1557499 {
		t.Fatalf("unexpected vm_stat: %+v", vm)
	}

	used, total, ok := ParseSwapUsage("total = 9216.00M  used = 8521.25M  free = 694.75M  (encrypted)")
	if !ok || total != 9216*(1<<20) || used == 0 {
		t.Fatalf("ParseSwapUsage=(%d,%d,%v)", used, total, ok)
	}

	avg, ok := ParseLoadAvg("{ 17.40 35.96 32.70 }")
	if !ok || len(avg) != 3 || avg[0] != 17.4 || avg[1] != 35.96 || avg[2] != 32.7 {
		t.Fatalf("ParseLoadAvg=(%v,%v)", avg, ok)
	}

	if p, ok := ParseMemoryPressureLevel("1\n"); !ok || p != "normal" {
		t.Fatalf("pressure 1 -> (%q,%v)", p, ok)
	}
	if p, ok := ParseMemoryPressureLevel("2"); !ok || p != "warning" {
		t.Fatalf("pressure 2 -> (%q,%v)", p, ok)
	}
	if p, ok := ParseMemoryPressureLevel("4"); !ok || p != "critical" {
		t.Fatalf("pressure 4 -> (%q,%v)", p, ok)
	}
	if _, ok := ParseMemoryPressureLevel("9"); ok {
		t.Fatal("expected unknown pressure level to fail")
	}
}

func TestParseAGXAndPMSet(t *testing.T) {
	ioreg := `
      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=8667414528,"Tiler Utilization %"=7,"Renderer Utilization %"=42,"Device Utilization %"=64,"In use system memory"=7633207296}
      "model" = "Apple M6"
      "gpu-core-count" = 12
`
	agx, ok := ParseAGXAccelerator(ioreg)
	if !ok {
		t.Fatal("ParseAGXAccelerator failed")
	}
	if agx.Model != "Apple M6" || agx.GPUCoreCount == nil || *agx.GPUCoreCount != 12 {
		t.Fatalf("unexpected AGX header: %+v", agx)
	}
	if agx.DeviceUtilPct == nil || *agx.DeviceUtilPct != 64 || agx.RendererUtilPct == nil || *agx.RendererUtilPct != 42 || agx.TilerUtilPct == nil || *agx.TilerUtilPct != 7 {
		t.Fatalf("unexpected AGX util: %+v", agx)
	}
	if agx.InUseSystemBytes == nil || *agx.InUseSystemBytes != 7633207296 {
		t.Fatalf("unexpected AGX memory: %+v", agx)
	}

	nominal, ok := ParsePMSetTherm("Note: No thermal warning level has been recorded\n")
	if !ok || nominal.Throttling || nominal.ThermalState != "nominal" || nominal.CPUSpeedLimitPct == nil || *nominal.CPUSpeedLimitPct != 100 {
		t.Fatalf("unexpected nominal pmset: %+v", nominal)
	}

	throttled, ok := ParsePMSetTherm("CPU_Speed_Limit = 72\nThermal_Level = 2\n")
	if !ok || !throttled.Throttling || throttled.ThermalState != "serious" || throttled.CPUSpeedLimitPct == nil || *throttled.CPUSpeedLimitPct != 72 {
		t.Fatalf("unexpected throttled pmset: %+v", throttled)
	}
}

func TestParseNvidiaSMIAndLinuxProc(t *testing.T) {
	smi := "0, NVIDIA GeForce RTX 4090, 24564, 18432, 6132, 88, 342.5, 450.0, 71, 2520, 2610, 62, 0x0000000000000000\n" +
		"1, NVIDIA L4, 23034, 4096, 18938, 12, 35.0, 72.0, 86, 1200, 2040, [N/A], 0x0000000000000080\n"
	gpus, ok := ParseNvidiaSMI(smi)
	if !ok || len(gpus) != 2 {
		t.Fatalf("ParseNvidiaSMI=%+v, ok=%v", gpus, ok)
	}
	if gpus[0].Name != "NVIDIA GeForce RTX 4090" || gpus[0].UtilPct == nil || *gpus[0].UtilPct != 88 || gpus[0].ThrottleReasons != "" {
		t.Fatalf("unexpected gpu[0]: %+v", gpus[0])
	}
	if gpus[1].FanPct != nil || gpus[1].ThrottleReasons != "hw_thermal_slowdown" {
		t.Fatalf("unexpected gpu[1]: %+v", gpus[1])
	}

	mem, ok := ParseProcMeminfo("MemTotal:       32768000 kB\nMemFree:         8192000 kB\nMemAvailable:   16384000 kB\nSlab:            1024000 kB\nSwapTotal:       4096000 kB\nSwapFree:        3072000 kB\n")
	if !ok || mem.MemTotal != 32768000*1024 || mem.MemAvailable != 16384000*1024 || mem.SwapTotal-mem.SwapFree != 1024000*1024 {
		t.Fatalf("unexpected proc meminfo: %+v", mem)
	}

	cpu, ok := ParseProcStatCPU("cpu  100 10 50 800 40 0 0 0 0 0\ncpu0 50 5 25 400 20 0 0 0 0 0\n")
	if !ok || cpu.Total != 1000 || cpu.Idle != 840 {
		t.Fatalf("unexpected proc stat: %+v", cpu)
	}

	pvm, ok := ParseProcVMStat("nr_free_pages 100\npswpin 120\npswpout 45\n")
	if !ok || pvm.Pswpin != 120 || pvm.Pswpout != 45 {
		t.Fatalf("unexpected proc vmstat: %+v", pvm)
	}
}

func TestTheoreticalBandwidthLookup(t *testing.T) {
	if bw, ok := TheoreticalBandwidthGBs("", "NVIDIA GeForce RTX 4090"); !ok || bw != 1008.0 {
		t.Fatalf("RTX 4090 bw=(%v,%v)", bw, ok)
	}
	if bw, ok := TheoreticalBandwidthGBs("Apple M6", "Apple M6"); !ok || bw != 153.0 {
		t.Fatalf("Apple M6 bw=(%v,%v)", bw, ok)
	}
	if bw, ok := TheoreticalBandwidthGBs("Apple M4 Max", ""); !ok || bw != 546.0 {
		t.Fatalf("Apple M4 Max bw=(%v,%v)", bw, ok)
	}
	if _, ok := TheoreticalBandwidthGBs("Unknown Custom Chip", "Mystery GPU"); ok {
		t.Fatal("expected unknown GPU to return ok=false")
	}
}

func TestParseLlamaMetricsAndSlotsPrivacy(t *testing.T) {
	metricsText := `# HELP llamacpp:prompt_tokens_total Total prompt tokens
llamacpp:prompt_tokens_total 1200
llamacpp:prompt_seconds_total 2.5
llamacpp:tokens_predicted_total 400
llamacpp:tokens_predicted_seconds_total 8.0
llamacpp:requests_processing 2
`
	m, ok := ParseLlamaMetrics(metricsText)
	if !ok || m.PromptTokens != 1200 || m.PredictedTokens != 400 || m.Processing != 2 {
		t.Fatalf("unexpected metrics: %+v", m)
	}

	// Slot JSON contains sensitive prompt & completion text that MUST be stripped.
	slotsJSON := `[{
		"id": 0,
		"n_ctx": 32768,
		"is_processing": true,
		"prompt": "TOP SECRET USER PROMPT DO NOT LEAK",
		"n_prompt_tokens": 4096,
		"n_prompt_tokens_processed": 3072,
		"n_prompt_tokens_cache": 2048,
		"next_token": [{"n_decoded": 128, "text": "SECRET MODEL COMPLETION"}]
	}]`
	slots, ok := ParseLlamaSlots([]byte(slotsJSON), "qwen3-4b:Q4_K_M")
	if !ok || len(slots) != 1 {
		t.Fatalf("ParseLlamaSlots=(%v,%v)", slots, ok)
	}
	encoded, err := json.Marshal(slots)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "SECRET") {
		t.Fatalf("privacy violation: slot telemetry leaked prompt/completion text: %s", encoded)
	}
	if !slots[0].Busy || *slots[0].NCtx != 32768 || *slots[0].CachedPromptTokens != 2048 || *slots[0].DecodedTokens != 128 {
		t.Fatalf("unexpected slot counters: %+v", slots[0])
	}
}

func TestTrackerRollingTTFTAndOdometer(t *testing.T) {
	base := time.Date(2026, 11, 27, 1, 0, 0, 0, time.UTC)
	now := base
	tracker := NewTracker(func() time.Time { return now })

	tracker.BeginRequest("req-1", "Pi Agent", "qwen3-4b:Q4_K_M", "Qwen3 4B", 12)
	now = base.Add(150 * time.Millisecond)
	tracker.MarkFirstToken("req-1", now)

	summary := tracker.Summary()
	if summary.ActiveCount != 1 || summary.TTFTLiveMs == nil || *summary.TTFTLiveMs != 150 {
		t.Fatalf("unexpected active summary: %+v", summary)
	}
	if len(summary.Requests) != 1 || summary.Requests[0].Stage != "decoding" {
		t.Fatalf("expected decoding stage: %+v", summary.Requests)
	}

	now = base.Add(1150 * time.Millisecond)
	tracker.RecordModelResponse("req-1", "Pi Agent", "qwen3-4b:Q4_K_M", "Qwen3 4B", base, base.Add(150*time.Millisecond), now, 500, 300, 60, 12, 32768)

	// Add more TTFT samples to verify p50 / p95.
	for i, ttft := range []int64{100, 200, 300, 400, 500} {
		start := base.Add(time.Duration(i+2) * time.Second)
		first := start.Add(time.Duration(ttft) * time.Millisecond)
		end := first.Add(500 * time.Millisecond)
		tracker.RecordModelResponse(fmt.Sprintf("req-%d", i+2), "Model Call", "qwen3-4b:Q4_K_M", "Qwen3 4B", start, first, end, 100, 50, 25, 5, 32768)
	}

	after := tracker.Summary()
	if after.ActiveCount != 0 {
		t.Fatalf("expected 0 active requests, got %d", after.ActiveCount)
	}
	// Total tokens = (500+60) + 5*(100+25) = 560 + 625 = 1185.
	if after.TotalTokensSession != 1185 {
		t.Fatalf("TotalTokensSession=%d, want 1185", after.TotalTokensSession)
	}
	if after.TTFTP50Ms == nil || after.TTFTP95Ms == nil || *after.TTFTP50Ms <= 0 || *after.TTFTP95Ms < *after.TTFTP50Ms {
		t.Fatalf("unexpected TTFT percentiles: p50=%v p95=%v", after.TTFTP50Ms, after.TTFTP95Ms)
	}
}

func TestDiagnoseBottleneck(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	u := func(v uint64) *uint64 { return &v }

	// Thermal throttle wins over everything.
	b := DiagnoseBottleneck(
		wire.SystemTelemetryHardware{Thermal: wire.SystemTelemetryThermal{Throttling: true, CpuSpeedLimitPct: f(70)}},
		wire.SystemTelemetryInference{ActiveRequestsCount: 1, DecodeTokS: 30},
	)
	if b.Kind != "thermal_throttled" || b.Severity != "critical" {
		t.Fatalf("expected thermal_throttled, got %+v", b)
	}

	// VRAM / memory pressure.
	b = DiagnoseBottleneck(
		wire.SystemTelemetryHardware{Memory: wire.SystemTelemetryMemory{MemoryPressure: "critical", SwapIoMbS: f(12)}},
		wire.SystemTelemetryInference{ActiveRequestsCount: 1},
	)
	if b.Kind != "vram_pressure" || b.Severity != "critical" {
		t.Fatalf("expected vram_pressure, got %+v", b)
	}

	// Idle.
	b = DiagnoseBottleneck(
		wire.SystemTelemetryHardware{Memory: wire.SystemTelemetryMemory{TotalBytes: 24 << 30, UsedBytes: 10 << 30, MemoryPressure: "normal"}},
		wire.SystemTelemetryInference{},
	)
	if b.Kind != "idle" {
		t.Fatalf("expected idle, got %+v", b)
	}

	// KV cache bound.
	b = DiagnoseBottleneck(
		wire.SystemTelemetryHardware{Memory: wire.SystemTelemetryMemory{TotalBytes: 24 << 30, UsedBytes: 12 << 30, MemoryPressure: "normal"}},
		wire.SystemTelemetryInference{ActiveRequestsCount: 2, DecodeTokS: 20, KvCacheUsedPct: f(91)},
	)
	if b.Kind != "kv_cache_bound" {
		t.Fatalf("expected kv_cache_bound, got %+v", b)
	}

	// Memory bandwidth bound during active decode.
	b = DiagnoseBottleneck(
		wire.SystemTelemetryHardware{
			Memory:    wire.SystemTelemetryMemory{TotalBytes: 24 << 30, UsedBytes: 12 << 30, RecommendedWorkingSetBytes: u(18 << 30), MemoryPressure: "normal"},
			Bandwidth: wire.SystemTelemetryBandwidth{Source: "estimated", UtilizationPct: f(84)},
		},
		wire.SystemTelemetryInference{ActiveRequestsCount: 1, DecodeTokS: 48},
	)
	if b.Kind != "memory_bw_bound" || b.Severity != "healthy" {
		t.Fatalf("expected memory_bw_bound, got %+v", b)
	}
}

func TestCollectorWithLoopbackLlamaServer(t *testing.T) {
	var tick atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/metrics":
			n := tick.Add(1)
			if n == 1 {
				_, _ = fmt.Fprint(w, "llamacpp:prompt_tokens_total 100\nllamacpp:prompt_seconds_total 0.5\nllamacpp:tokens_predicted_total 50\nllamacpp:tokens_predicted_seconds_total 1.0\nllamacpp:requests_processing 1\n")
			} else {
				_, _ = fmt.Fprint(w, "llamacpp:prompt_tokens_total 500\nllamacpp:prompt_seconds_total 1.5\nllamacpp:tokens_predicted_total 150\nllamacpp:tokens_predicted_seconds_total 3.0\nllamacpp:requests_processing 1\n")
			}
		case "/slots":
			_, _ = fmt.Fprint(w, `[{"id":0,"n_ctx":16384,"is_processing":true,"prompt":"PRIVATE","n_prompt_tokens":400,"n_prompt_tokens_processed":400,"n_prompt_tokens_cache":200,"next_token":[{"n_decoded":100}]}]`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	now := time.Date(2026, 11, 27, 1, 10, 0, 0, time.UTC)
	slotsCount := uint64(2)
	collector := NewCollector(Options{
		Now:            func() time.Time { return now },
		SampleCacheTTL: 1 * time.Millisecond,
		SnapshotLocalModels: func() *wire.LocalModelsSnapshot {
			return &wire.LocalModelsSnapshot{
				Available: true,
				Models: []wire.LocalModel{{
					ID:            "qwen3-4b:Q4_K_M",
					Name:          "Qwen3 4B",
					Engine:        "llama.cpp",
					Quant:         "Q4_K_M",
					State:         "loaded",
					MemoryBytes:   4 << 30,
					ContextTokens: 16384,
					Concurrency:   &slotsCount,
					Endpoint:      &wire.LocalModelEndpoint{BaseURL: srv.URL + "/v1"},
				}},
			}
		},
	})

	snap1, err := collector.Sample(context.Background())
	if err != nil {
		t.Fatalf("first Sample failed: %v", err)
	}
	if snap1.Hardware.Platform == "" || len(snap1.Inference.LoadedModels) != 1 || len(snap1.Inference.Slots) != 1 {
		t.Fatalf("unexpected first snapshot: hw=%+v inf=%+v", snap1.Hardware, snap1.Inference)
	}

	now = now.Add(2 * time.Second)
	snap2, err := collector.Sample(context.Background())
	if err != nil {
		t.Fatalf("second Sample failed: %v", err)
	}
	// Delta: 400 prompt tokens / 1.0s = 400 tok/s; 100 pred tokens / 2.0s = 50 tok/s.
	if snap2.Inference.PrefillTokS != 400 || snap2.Inference.DecodeTokS != 50 {
		t.Fatalf("unexpected live rates: prefill=%v decode=%v", snap2.Inference.PrefillTokS, snap2.Inference.DecodeTokS)
	}
	if snap2.Inference.PrefixCacheHitRatePct == nil || *snap2.Inference.PrefixCacheHitRatePct != 50 {
		t.Fatalf("unexpected prefix cache hit rate: %v", snap2.Inference.PrefixCacheHitRatePct)
	}
	if snap2.Inference.TotalTokensSession != 500 {
		t.Fatalf("expected 500 session tokens from counter delta, got %d", snap2.Inference.TotalTokensSession)
	}
}

func TestCollectorLiveHostSmoke(t *testing.T) {
	collector := NewCollector(Options{})
	snap, err := collector.Sample(context.Background())
	if err != nil {
		t.Fatalf("live host Sample failed: %v", err)
	}
	if snap.ObservedAt == "" {
		t.Fatalf("missing observed_at")
	}
	if snap.Hardware.Memory.TotalBytes == 0 {
		t.Fatalf("expected non-zero host memory total_bytes, got %+v", snap.Hardware.Memory)
	}
	if snap.Hardware.Cpu.TotalCores == 0 {
		t.Fatalf("expected non-zero cpu total_cores, got %+v", snap.Hardware.Cpu)
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	t.Logf("LIVE_HOST_SNAPSHOT=%s", string(raw))
}
