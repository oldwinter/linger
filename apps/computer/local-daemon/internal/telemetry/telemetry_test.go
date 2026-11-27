package telemetry

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestParseNvidiaSMITemperature(t *testing.T) {
	// Modern RTX 4060 Ti driver: reports both headroom T.Limit (41 C) and absolute Target Temperature (83 C).
	rtx4060Ti := `==============NVSMI LOG==============

Timestamp                                 : Fri Nov 27 10:00:00 2026
Driver Version                            : 566.36
CUDA Version                              : 12.7

Attached GPUs                             : 1
GPU 00000000:01:00.0
    Temperature
        GPU Current Temp                  : 42 C
        GPU T.Limit Temp                  : 41 C
        GPU Shutdown T.Limit Temp         : -10 C
        GPU Slowdown T.Limit Temp         : -5 C
        GPU Max Operating T.Limit Temp    : 0 C
        GPU Target Temperature            : 83 C
        Memory Current Temp               : N/A
`
	if limit, ok := ParseNvidiaSMITemperature(rtx4060Ti); !ok || limit != 83 {
		t.Fatalf("RTX 4060 Ti limit=(%v,%v), want (83,true)", limit, ok)
	}

	// Older / datacenter format without Target Temperature: prefers Max Operating Temp.
	datacenter := `GPU 00000000:00:04.0
    Temperature
        GPU Current Temp                  : 48 C
        GPU T.Limit Temp                  : N/A
        GPU Shutdown Temp                 : 95 C
        GPU Slowdown Temp                 : 90 C
        GPU Max Operating Temp            : 85 C
        GPU Target Temperature            : N/A
`
	if limit, ok := ParseNvidiaSMITemperature(datacenter); !ok || limit != 85 {
		t.Fatalf("datacenter limit=(%v,%v), want (85,true)", limit, ok)
	}

	// Slowdown-only fallback.
	slowdownOnly := `GPU 00000000:00:04.0
    Temperature
        GPU Current Temp                  : 50 C
        GPU Slowdown Temp                 : 90 C
`
	if limit, ok := ParseNvidiaSMITemperature(slowdownOnly); !ok || limit != 90 {
		t.Fatalf("slowdown-only limit=(%v,%v), want (90,true)", limit, ok)
	}

	// Headroom reconstruction when Target/Max/Slowdown absolute temps are N/A.
	tlimitOnly := `GPU 00000000:01:00.0
    Temperature
        GPU Current Temp                  : 52 C
        GPU T.Limit Temp                  : 31 C
        GPU Max Operating T.Limit Temp    : 0 C
        GPU Target Temperature            : N/A
`
	if limit, ok := ParseNvidiaSMITemperature(tlimitOnly); !ok || limit != 83 {
		t.Fatalf("tlimit reconstruction=(%v,%v), want (83,true)", limit, ok)
	}

	// Bare headroom without current temp must NOT be confused with an absolute limit.
	bareHeadroom := `GPU 00000000:01:00.0
    Temperature
        GPU T.Limit Temp                  : 41 C
`
	if limit, ok := ParseNvidiaSMITemperature(bareHeadroom); ok {
		t.Fatalf("expected bare headroom to fail, got (%v,true)", limit)
	}

	// Multi-GPU output returns primary GPU 0 limit only.
	multiGPU := `GPU 00000000:01:00.0
    Temperature
        GPU Target Temperature            : 83 C
GPU 00000000:02:00.0
    Temperature
        GPU Target Temperature            : 90 C
`
	if limit, ok := ParseNvidiaSMITemperature(multiGPU); !ok || limit != 83 {
		t.Fatalf("multi-GPU limit=(%v,%v), want (83,true)", limit, ok)
	}

	if _, ok := ParseNvidiaSMITemperature("GPU 00000000:01:00.0\n    Temperature\n        GPU Target Temperature : N/A\n"); ok {
		t.Fatal("expected all-N/A output to return ok=false")
	}
}

func TestParseWindowsPagefileInfo(t *testing.T) {
	makeEntry := func(nextOffset, totalPages, inUsePages, peakPages uint32) []byte {
		size := int(nextOffset)
		if size < 32 {
			size = 32
		}
		buf := make([]byte, size)
		binary.LittleEndian.PutUint32(buf[0:4], nextOffset)
		binary.LittleEndian.PutUint32(buf[4:8], totalPages)
		binary.LittleEndian.PutUint32(buf[8:12], inUsePages)
		binary.LittleEndian.PutUint32(buf[12:16], peakPages)
		return buf
	}

	const pageSize = uint64(4096)

	// Single pagefile: 4 GiB total, ~1.73 GiB used (453509 pages).
	single := makeEntry(0, 1048576, 453509, 500000)
	used, total, ok := ParseWindowsPagefileInfo(single, pageSize)
	if !ok || total != 1048576*pageSize || used != 453509*pageSize {
		t.Fatalf("single pagefile=(%d,%d,%v)", used, total, ok)
	}

	// Two chained pagefiles.
	e1 := makeEntry(48, 524288, 100000, 120000)
	e2 := makeEntry(0, 262144, 50000, 60000)
	chained := append(e1, e2...)
	used, total, ok = ParseWindowsPagefileInfo(chained, pageSize)
	if !ok || total != (524288+262144)*pageSize || used != (100000+50000)*pageSize {
		t.Fatalf("chained pagefiles=(%d,%d,%v)", used, total, ok)
	}

	// Disabled / zero pagefiles (empty return buffer).
	used, total, ok = ParseWindowsPagefileInfo(nil, pageSize)
	if !ok || used != 0 || total != 0 {
		t.Fatalf("empty pagefiles=(%d,%d,%v), want (0,0,true)", used, total, ok)
	}

	// Clamps in-use pages to total pages.
	clamped := makeEntry(0, 1000, 1500, 1500)
	used, total, ok = ParseWindowsPagefileInfo(clamped, pageSize)
	if !ok || used != 1000*pageSize || total != 1000*pageSize {
		t.Fatalf("clamped pagefile=(%d,%d,%v)", used, total, ok)
	}

	// Corrupt offset / zero page size.
	if _, _, ok := ParseWindowsPagefileInfo(make([]byte, 8), pageSize); ok {
		t.Fatal("expected truncated buffer to fail")
	}
	if _, _, ok := ParseWindowsPagefileInfo(makeEntry(8, 100, 10, 10), pageSize); ok {
		t.Fatal("expected invalid small NextEntryOffset to fail")
	}
	if _, _, ok := ParseWindowsPagefileInfo(single, 0); ok {
		t.Fatal("expected zero pageSize to fail")
	}
}

func TestParseWindowsLogicalProcessorInfoExAndIdentity(t *testing.T) {
	// 6 physical cores (RelationProcessorCore = 0) + 1 non-core record (RelationCache = 2).
	var buf []byte
	appendRecord := func(rel, size uint32) {
		rec := make([]byte, size)
		binary.LittleEndian.PutUint32(rec[0:4], rel)
		binary.LittleEndian.PutUint32(rec[4:8], size)
		buf = append(buf, rec...)
	}
	for range 6 {
		appendRecord(0, 48)
	}
	appendRecord(2, 48)

	cores, ok := ParseWindowsLogicalProcessorInfoEx(buf)
	if !ok || cores != 6 {
		t.Fatalf("ParseWindowsLogicalProcessorInfoEx=(%d,%v), want (6,true)", cores, ok)
	}
	if _, ok := ParseWindowsLogicalProcessorInfoEx(nil); ok {
		t.Fatal("expected empty processor buffer to fail")
	}
	if _, ok := ParseWindowsLogicalProcessorInfoEx([]byte{0, 0, 0, 0, 4, 0, 0, 0}); ok {
		t.Fatal("expected malformed record size < 8 to fail")
	}

	if got := NormalizeWindowsCPUBrand("AMD Ryzen 5 7500F 6-Core Processor       "); got != "AMD Ryzen 5 7500F 6-Core Processor" {
		t.Fatalf("NormalizeWindowsCPUBrand=%q", got)
	}

	cases := []struct {
		product string
		display string
		build   string
		want    string
	}{
		{"Windows 10 Pro", "24H2", "26200", "Windows 11 Pro 24H2 (26200)"},
		{"Windows 10 Pro", "", "26200", "Windows 11 Pro (26200)"},
		{"Windows 11 Pro", "24H2", "22631", "Windows 11 Pro 24H2 (22631)"},
		{"Windows 10 Home", "22H2", "19045", "Windows 10 Home 22H2 (19045)"},
		{"Windows Server 2025 Standard", "24H2", "26100", "Windows Server 2025 Standard 24H2 (26100)"},
		{"", "", "26200", "Windows 11 (26200)"},
		{"", "", "", "Windows"},
	}
	for _, tc := range cases {
		if got := FormatWindowsOSLabel(tc.product, tc.display, tc.build); got != tc.want {
			t.Fatalf("FormatWindowsOSLabel(%q,%q,%q)=%q, want %q", tc.product, tc.display, tc.build, got, tc.want)
		}
	}

	volCases := []struct {
		diskPath string
		baseDir  string
		want     string
	}{
		{"", `D:\linger\runtime\localmodels\models`, `D:\`},
		{"", `d:/custom/models`, `D:\`},
		{`E:\data`, `D:\linger\models`, `E:\`},
		{"", `\\nas01\models\linger`, `\\nas01\models\`},
		{"", `relative/path`, `C:\`},
		{"", "", `C:\`},
	}
	for _, tc := range volCases {
		if got := ResolveWindowsDiskVolume(tc.diskPath, tc.baseDir); got != tc.want {
			t.Fatalf("ResolveWindowsDiskVolume(%q,%q)=%q, want %q", tc.diskPath, tc.baseDir, got, tc.want)
		}
	}
}

func TestModelCacheBytesResolution(t *testing.T) {
	now := time.Date(2026, 11, 27, 2, 0, 0, 0, time.UTC)

	// 1. Explicit LocalModelsBaseDir takes precedence.
	root := t.TempDir()
	baseDir := filepath.Join(root, "models")
	nested := filepath.Join(baseDir, "qwen3-4b")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "weights.gguf"), make([]byte, 4096), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(baseDir, "manifest.json"), make([]byte, 256), 0o600); err != nil {
		t.Fatal(err)
	}

	c := NewCollector(Options{
		LocalModelsStateDir: filepath.Join(root, "state"),
		LocalModelsBaseDir:  baseDir,
	})
	got := c.modelCacheBytes(now)
	if got == nil || *got != 4352 {
		t.Fatalf("explicit base dir modelCacheBytes=%v, want 4352", got)
	}

	// 2. Falls back to sibling ../models when LocalModelsBaseDir is omitted.
	stateDir := filepath.Join(root, "state")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	cSibling := NewCollector(Options{LocalModelsStateDir: stateDir})
	gotSibling := cSibling.modelCacheBytes(now)
	if gotSibling == nil || *gotSibling != 4352 {
		t.Fatalf("sibling fallback modelCacheBytes=%v, want 4352", gotSibling)
	}

	// 3. Returns nil when directories are unset or missing.
	cMissing := NewCollector(Options{LocalModelsBaseDir: filepath.Join(root, "does-not-exist")})
	if gotMissing := cMissing.modelCacheBytes(now); gotMissing != nil {
		t.Fatalf("missing dir modelCacheBytes=%v, want nil", *gotMissing)
	}
}

func TestDiscreteHardwareTelemetrySemantics(t *testing.T) {
	const GiB = uint64(1 << 30)
	vramTotal := 16 * GiB
	vramUsed := 2 * GiB
	vramFree := 14 * GiB
	gpuW := 18.5
	limitW := 165.0
	threads := uint64(12)

	idleRaw := rawHostSample{
		Architecture:            "discrete",
		Platform:                "windows",
		Arch:                    "x86_64",
		Hostname:                "home-win",
		ChipName:                "AMD Ryzen 5 7500F 6-Core Processor",
		OSLabel:                 "Windows 11 Pro 24H2 (26200)",
		GPUName:                 "NVIDIA GeForce RTX 4060 Ti",
		SystemRAMTotalBytes:     32 * GiB,
		SystemRAMAvailableBytes: 20 * GiB,
		VRAMTotalBytes:          &vramTotal,
		VRAMUsedBytes:           &vramUsed,
		VRAMFreeBytes:           &vramFree,
		CPUTotalCores:           6,
		CPULogicalThreads:       &threads,
		Power: wire.SystemTelemetryPower{
			GpuW:   &gpuW,
			LimitW: &limitW,
		},
	}

	idleHW := buildHardwareTelemetry(idleRaw, nil, nil, 0, 0, 0, 0)
	if idleHW.Bandwidth.TheoreticalGbS == nil || *idleHW.Bandwidth.TheoreticalGbS != 288 {
		t.Fatalf("expected RTX 4060 Ti 288 GB/s ceiling, got %+v", idleHW.Bandwidth)
	}
	if idleHW.Bandwidth.Source != "spec" || idleHW.Bandwidth.EffectiveDecodeGbS != nil || idleHW.Bandwidth.UtilizationPct != nil {
		t.Fatalf("expected idle known-SKU bandwidth source=spec without effective rate, got %+v", idleHW.Bandwidth)
	}
	if idleHW.Memory.OsWiredBytes != nil || idleHW.Memory.CompressedBytes != nil {
		t.Fatalf("expected UMA-only fields omitted on discrete host, got wired=%v compressed=%v", idleHW.Memory.OsWiredBytes, idleHW.Memory.CompressedBytes)
	}
	if idleHW.Power.PackageW != nil || idleHW.Power.GpuW == nil || *idleHW.Power.GpuW != 18.5 {
		t.Fatalf("expected honest GPU power without package_w alias, got %+v", idleHW.Power)
	}
	if idleHW.Cpu.TotalCores != 6 || idleHW.Cpu.LogicalThreads == nil || *idleHW.Cpu.LogicalThreads != 12 {
		t.Fatalf("expected 6C/12T CPU metadata, got %+v", idleHW.Cpu)
	}
	encoded, err := json.Marshal(idleHW.Memory)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "os_wired_bytes") || strings.Contains(string(encoded), "compressed_bytes") {
		t.Fatalf("discrete memory JSON must omit UMA-only fields: %s", encoded)
	}

	// Active decode transitions bandwidth source to "estimated".
	activeHW := buildHardwareTelemetry(idleRaw, nil, nil, 8*GiB, 1*GiB, 1*GiB, 25.0)
	if activeHW.Bandwidth.Source != "estimated" || activeHW.Bandwidth.EffectiveDecodeGbS == nil || activeHW.Bandwidth.UtilizationPct == nil {
		t.Fatalf("expected estimated bandwidth while decoding, got %+v", activeHW.Bandwidth)
	}

	// Guard VRAM arithmetic when WDDM under-reports vram_used_bytes below inferenceTotal,
	// and even when inferenceTotal exceeds vramTotal (hybrid spillover).
	wddmUnder := buildHardwareTelemetry(idleRaw, nil, nil, 10*GiB, 1*GiB, 1*GiB, 0)
	if wddmUnder.Memory.ActiveAppsBytes != 0 || wddmUnder.Memory.UsedBytes != 12*GiB || wddmUnder.Memory.FreeHeadroomBytes != 4*GiB {
		t.Fatalf("unexpected WDDM under-report memory math: %+v", wddmUnder.Memory)
	}
	spillover := buildHardwareTelemetry(idleRaw, nil, nil, 16*GiB, 2*GiB, 1*GiB, 0)
	sumSegments := spillover.Memory.ModelWeightsBytes + spillover.Memory.KvCacheBytes + spillover.Memory.ComputeBufferBytes + spillover.Memory.ActiveAppsBytes + spillover.Memory.FreeHeadroomBytes
	if spillover.Memory.ActiveAppsBytes != 0 || spillover.Memory.UsedBytes != 16*GiB || sumSegments != 16*GiB {
		t.Fatalf("unexpected spillover memory math: %+v (sum=%d)", spillover.Memory, sumSegments)
	}

	// Windows host without nvidia-smi stays "host" (never falsely "uma") and omits macOS-only wired/compressed fields.
	winHostRaw := rawHostSample{
		Architecture:            "host",
		Platform:                "windows",
		Arch:                    "x86_64",
		Hostname:                "home-win-no-smi",
		ChipName:                "AMD Ryzen 5 7500F 6-Core Processor",
		OSLabel:                 "Windows 11 Pro 24H2 (26200)",
		SystemRAMTotalBytes:     32 * GiB,
		SystemRAMAvailableBytes: 18 * GiB,
		ActiveAppsBytes:         14 * GiB,
		CPUTotalCores:           6,
		CPULogicalThreads:       &threads,
	}
	winHostHW := buildHardwareTelemetry(winHostRaw, nil, nil, 0, 0, 0, 0)
	if winHostHW.Architecture != "host" {
		t.Fatalf("expected host architecture when no GPU telemetry, got %q", winHostHW.Architecture)
	}
	if winHostHW.Memory.OsWiredBytes != nil || winHostHW.Memory.CompressedBytes != nil {
		t.Fatalf("expected Windows host architecture to omit UMA-only fields, got wired=%v compressed=%v", winHostHW.Memory.OsWiredBytes, winHostHW.Memory.CompressedBytes)
	}
	if winHostHW.Memory.TotalBytes != 32*GiB || winHostHW.Memory.UsedBytes != 14*GiB || winHostHW.Memory.FreeHeadroomBytes != 18*GiB {
		t.Fatalf("unexpected Windows host memory breakdown: %+v", winHostHW.Memory)
	}
}

func TestCollectorLiveHostSmoke(t *testing.T) {
	collector := NewCollector(Options{SampleCacheTTL: 1 * time.Millisecond})
	snap1, err := collector.Sample(context.Background())
	if err != nil {
		t.Fatalf("live host first Sample failed: %v", err)
	}
	if snap1.ObservedAt == "" {
		t.Fatalf("missing observed_at")
	}
	if snap1.Hardware.Memory.TotalBytes == 0 {
		t.Fatalf("expected non-zero host memory total_bytes, got %+v", snap1.Hardware.Memory)
	}
	if snap1.Hardware.Cpu.TotalCores == 0 {
		t.Fatalf("expected non-zero cpu total_cores, got %+v", snap1.Hardware.Cpu)
	}

	time.Sleep(120 * time.Millisecond)
	snap2, err := collector.Sample(context.Background())
	if err != nil {
		t.Fatalf("live host second Sample failed: %v", err)
	}
	if snap2.SampleIntervalMs == nil || *snap2.SampleIntervalMs == 0 {
		t.Fatalf("expected positive sample_interval_ms on second sample, got %v", snap2.SampleIntervalMs)
	}
	if snap2.Hardware.Cpu.LoadPct == nil {
		t.Fatalf("expected non-nil cpu.load_pct after two samples, got %+v", snap2.Hardware.Cpu)
	}
	if *snap2.Hardware.Cpu.LoadPct < 0 || *snap2.Hardware.Cpu.LoadPct > 100 {
		t.Fatalf("expected cpu.load_pct in [0, 100], got %v", *snap2.Hardware.Cpu.LoadPct)
	}
	raw, err := json.Marshal(snap2)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	t.Logf("LIVE_HOST_SNAPSHOT=%s", string(raw))
}
