package telemetry

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

const (
	defaultSampleCacheTTL  = 400 * time.Millisecond
	defaultCacheWalkTTL    = 30 * time.Second
	loopbackHTTPTimeout    = 1500 * time.Millisecond
	maxMetricsResponseSize = 256 << 10
	maxSlotsResponseSize   = 8 << 20
	maxDeployFileSize      = 1 << 20
	maxDeployKeySize       = 64 << 10
)

var sanitizeFilenameRE = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// Options configures a Collector.
type Options struct {
	// SnapshotLocalModels returns the latest local-models library snapshot when installed.
	SnapshotLocalModels func() *wire.LocalModelsSnapshot
	// LocalModelsStateDir is the localmodels state directory holding library/models/*.json
	// deploy records.
	LocalModelsStateDir string
	// LocalModelsBaseDir is the localmodels base directory (--base-dir) holding
	// downloaded model weights.
	LocalModelsBaseDir string
	// DiskPath selects the filesystem checked for disk total/free bytes; defaults to "/".
	DiskPath string
	// Tracker records in-flight and completed local inference requests; if nil a new one is created.
	Tracker *Tracker
	// Now overrides the clock in tests.
	Now func() time.Time
	// HTTPClient overrides the loopback HTTP client in tests.
	HTTPClient *http.Client
	// SampleCacheTTL coalesces concurrent sample calls within this window.
	SampleCacheTTL time.Duration
}

type metricsObservation struct {
	counters   LlamaCounters
	observedAt time.Time
}

// Collector samples rootless host hardware and live local LLM inference metrics.
type Collector struct {
	snapshotLocalModels func() *wire.LocalModelsSnapshot
	localModelsStateDir string
	localModelsBaseDir  string
	diskPath            string
	tracker             *Tracker
	now                 func() time.Time
	httpClient          *http.Client
	host                *hostSampler
	sampleCacheTTL      time.Duration

	mu               sync.Mutex
	cachedSnapshot   *wire.SystemTelemetrySnapshot
	cachedAt         time.Time
	lastSampleAt     time.Time
	prevMetrics      map[string]metricsObservation
	cachedModelBytes *uint64
	cachedModelAt    time.Time
}

// NewCollector builds a rootless telemetry Collector.
func NewCollector(options Options) *Collector {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	tracker := options.Tracker
	if tracker == nil {
		tracker = NewTracker(now)
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{
			Timeout: loopbackHTTPTimeout,
			Transport: &http.Transport{
				Proxy:             nil,
				DisableKeepAlives: true,
			},
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}
	ttl := options.SampleCacheTTL
	if ttl <= 0 {
		ttl = defaultSampleCacheTTL
	}
	return &Collector{
		snapshotLocalModels: options.SnapshotLocalModels,
		localModelsStateDir: strings.TrimSpace(options.LocalModelsStateDir),
		localModelsBaseDir:  strings.TrimSpace(options.LocalModelsBaseDir),
		diskPath:            strings.TrimSpace(options.DiskPath),
		tracker:             tracker,
		now:                 now,
		httpClient:          client,
		host:                newHostSampler(),
		sampleCacheTTL:      ttl,
		prevMetrics:         make(map[string]metricsObservation),
	}
}

// Tracker returns the Collector's privacy-safe inference request tracker.
func (c *Collector) Tracker() *Tracker {
	if c == nil {
		return nil
	}
	return c.tracker
}

// Sample captures a fresh rootless hardware + local LLM inference telemetry snapshot.
func (c *Collector) Sample(ctx context.Context) (wire.SystemTelemetrySnapshot, error) {
	now := c.now()
	c.mu.Lock()
	if c.cachedSnapshot != nil && now.Sub(c.cachedAt) < c.sampleCacheTTL {
		snap := *c.cachedSnapshot
		c.mu.Unlock()
		return snap, nil
	}
	var sampleIntervalMs *uint64
	if !c.lastSampleAt.IsZero() && now.After(c.lastSampleAt) {
		ms := uint64(now.Sub(c.lastSampleAt).Milliseconds())
		sampleIntervalMs = &ms
	}
	c.mu.Unlock()

	rawHost := c.host.sample(ctx, c.diskPath, now)
	var library *wire.LocalModelsSnapshot
	if c.snapshotLocalModels != nil {
		library = c.snapshotLocalModels()
	}

	modelCacheBytes := c.modelCacheBytes(now)
	trackerSummary := c.tracker.Summary()
	inf, loadedWeightsBytes, loadedKVBytes, loadedComputeBytes := c.sampleInference(ctx, library, trackerSummary, now)

	// Merge host & library facts cleanly.
	hw := buildHardwareTelemetry(rawHost, library, modelCacheBytes, loadedWeightsBytes, loadedKVBytes, loadedComputeBytes, inf.DecodeTokS)

	// Fill theoretical decode ceiling and bandwidth efficiency when active weights + ceiling exist.
	if hw.Bandwidth.TheoreticalGbS != nil && *hw.Bandwidth.TheoreticalGbS > 0 && loadedWeightsBytes > 0 {
		activeWeightsGB := float64(loadedWeightsBytes) / 1e9
		if activeWeightsGB > 0 {
			ceilingTokS := round1(*hw.Bandwidth.TheoreticalGbS / activeWeightsGB)
			inf.TheoreticalDecodeCeilingTokS = &ceilingTokS
			if inf.DecodeTokS > 0 && ceilingTokS > 0 {
				eff := round1(clampFloat((inf.DecodeTokS/ceilingTokS)*100, 0, 100))
				inf.BandwidthEfficiencyPct = &eff
			}
		}
	}

	inf.Bottleneck = DiagnoseBottleneck(hw, inf)

	snapshot := wire.SystemTelemetrySnapshot{
		ObservedAt:       now.UTC().Format(time.RFC3339Nano),
		SampleIntervalMs: sampleIntervalMs,
		Hardware:         hw,
		Inference:        inf,
	}

	c.mu.Lock()
	c.cachedSnapshot = &snapshot
	c.cachedAt = now
	c.lastSampleAt = now
	c.mu.Unlock()

	return snapshot, nil
}

func buildHardwareTelemetry(
	raw rawHostSample,
	library *wire.LocalModelsSnapshot,
	modelCacheBytes *uint64,
	loadedWeightsBytes, loadedKVBytes, loadedComputeBytes uint64,
	liveDecodeTokS float64,
) wire.SystemTelemetryHardware {
	// Fall back to localmodels host facts when the platform probe omitted them.
	if library != nil && library.Host != nil {
		if raw.OSLabel == "" {
			raw.OSLabel = library.Host.OsLabel
		}
		if raw.SystemRAMTotalBytes == 0 && library.Host.RamTotalBytes > 0 {
			raw.SystemRAMTotalBytes = library.Host.RamTotalBytes
		}
		if raw.DiskFreeBytes == nil && library.Host.DiskFreeBytes > 0 {
			free := library.Host.DiskFreeBytes
			raw.DiskFreeBytes = &free
		}
		if raw.GPUName == "" && len(library.Host.Gpus) > 0 {
			raw.GPUName = library.Host.Gpus[0].Name
			if raw.VRAMTotalBytes == nil && library.Host.Gpus[0].TotalBytes > 0 {
				t := library.Host.Gpus[0].TotalBytes
				f := library.Host.Gpus[0].FreeBytes
				raw.VRAMTotalBytes = &t
				raw.VRAMFreeBytes = &f
				if t >= f {
					u := t - f
					raw.VRAMUsedBytes = &u
				}
				if raw.Platform != "darwin" {
					raw.Architecture = "discrete"
				}
			}
		}
	}

	systemTotal := raw.SystemRAMTotalBytes
	systemAvail := min(raw.SystemRAMAvailableBytes, systemTotal)
	systemUsed := uint64(0)
	if systemTotal > systemAvail {
		systemUsed = systemTotal - systemAvail
	}

	inferenceTotal := loadedWeightsBytes + loadedKVBytes + loadedComputeBytes

	mem := wire.SystemTelemetryMemory{
		RecommendedWorkingSetBytes: raw.RecommendedWorkingSetBytes,
		ModelWeightsBytes:          loadedWeightsBytes,
		KvCacheBytes:               loadedKVBytes,
		ComputeBufferBytes:         loadedComputeBytes,
		SystemRamTotalBytes:        systemTotal,
		SystemRamUsedBytes:         systemUsed,
		SystemRamAvailableBytes:    systemAvail,
		VramTotalBytes:             raw.VRAMTotalBytes,
		VramUsedBytes:              raw.VRAMUsedBytes,
		VramFreeBytes:              raw.VRAMFreeBytes,
		MemoryPressure:             raw.MemoryPressure,
		SwapUsedBytes:              raw.SwapUsedBytes,
		SwapTotalBytes:             raw.SwapTotalBytes,
		SwapIoMbS:                  raw.SwapIOMBs,
	}

	if raw.Architecture == "discrete" && raw.VRAMTotalBytes != nil && *raw.VRAMTotalBytes > 0 {
		mem.TotalBytes = *raw.VRAMTotalBytes
		// Guard against divergence when localmodels memory_bytes exceeds WDDM-reported VRAM.
		if inferenceTotal > mem.TotalBytes {
			overflow := inferenceTotal - mem.TotalBytes
			if mem.ComputeBufferBytes >= overflow {
				mem.ComputeBufferBytes -= overflow
				overflow = 0
			} else {
				overflow -= mem.ComputeBufferBytes
				mem.ComputeBufferBytes = 0
			}
			if overflow > 0 {
				if mem.KvCacheBytes >= overflow {
					mem.KvCacheBytes -= overflow
					overflow = 0
				} else {
					overflow -= mem.KvCacheBytes
					mem.KvCacheBytes = 0
				}
			}
			if overflow > 0 {
				if mem.ModelWeightsBytes >= overflow {
					mem.ModelWeightsBytes -= overflow
				} else {
					mem.ModelWeightsBytes = 0
				}
			}
			inferenceTotal = mem.ModelWeightsBytes + mem.KvCacheBytes + mem.ComputeBufferBytes
		}
		var vramUsed uint64
		if raw.VRAMUsedBytes != nil {
			vramUsed = min(*raw.VRAMUsedBytes, mem.TotalBytes)
		} else {
			vramUsed = min(inferenceTotal, mem.TotalBytes)
		}
		if inferenceTotal > vramUsed {
			vramUsed = min(inferenceTotal, mem.TotalBytes)
		}
		mem.UsedBytes = vramUsed
		if vramUsed > inferenceTotal {
			mem.ActiveAppsBytes = vramUsed - inferenceTotal
		} else {
			mem.ActiveAppsBytes = 0
		}
		if mem.TotalBytes > mem.UsedBytes {
			mem.FreeHeadroomBytes = mem.TotalBytes - mem.UsedBytes
		}
	} else {
		mem.TotalBytes = systemTotal
		compressed := min(raw.CompressedBytes, systemTotal)
		// Subtract GPU-pinned inference memory from raw OS wired/active pages to prevent double counting.
		remainingInference := inferenceTotal
		wired := raw.OSWiredBytes
		if wired >= remainingInference {
			wired -= remainingInference
			remainingInference = 0
		} else {
			remainingInference -= wired
			wired = 0
		}
		apps := raw.ActiveAppsBytes
		if apps >= remainingInference {
			apps -= remainingInference
		} else {
			apps = 0
		}
		mem.ActiveAppsBytes = apps
		sumUsed := mem.ModelWeightsBytes + mem.KvCacheBytes + mem.ComputeBufferBytes + wired + mem.ActiveAppsBytes + compressed
		if sumUsed > mem.TotalBytes {
			// Cap active apps first so bar segments never overflow total RAM.
			overflow := sumUsed - mem.TotalBytes
			if mem.ActiveAppsBytes >= overflow {
				mem.ActiveAppsBytes -= overflow
			} else {
				overflow -= mem.ActiveAppsBytes
				mem.ActiveAppsBytes = 0
				if wired >= overflow {
					wired -= overflow
				} else {
					wired = 0
				}
			}
			sumUsed = min(mem.ModelWeightsBytes+mem.KvCacheBytes+mem.ComputeBufferBytes+wired+mem.ActiveAppsBytes+compressed, mem.TotalBytes)
		}
		mem.OsWiredBytes = &wired
		mem.CompressedBytes = &compressed
		mem.UsedBytes = sumUsed
		if mem.TotalBytes > mem.UsedBytes {
			mem.FreeHeadroomBytes = mem.TotalBytes - mem.UsedBytes
		}
	}

	bw := wire.SystemTelemetryBandwidth{Source: "unavailable"}
	if peak, ok := TheoreticalBandwidthGBs(raw.ChipName, raw.GPUName); ok {
		bw.TheoreticalGbS = &peak
		if loadedWeightsBytes > 0 && liveDecodeTokS > 0 {
			bw.Source = "estimated"
			activeWeightsGB := float64(loadedWeightsBytes) / 1e9
			eff := round1(activeWeightsGB * liveDecodeTokS)
			bw.EffectiveDecodeGbS = &eff
			if peak > 0 {
				util := round1(clampFloat((eff/peak)*100, 0, 100))
				bw.UtilizationPct = &util
			}
		} else {
			bw.Source = "spec"
		}
	}

	clusters := raw.CPUClusters
	if clusters == nil {
		clusters = []wire.SystemTelemetryCpuCluster{}
	}

	return wire.SystemTelemetryHardware{
		Architecture: raw.Architecture,
		Platform:     raw.Platform,
		Arch:         raw.Arch,
		Hostname:     raw.Hostname,
		ChipName:     raw.ChipName,
		OsLabel:      raw.OSLabel,
		GpuName:      raw.GPUName,
		GpuCoreCount: raw.GPUCoreCount,
		AneCores:     raw.ANECores,
		Memory:       mem,
		Bandwidth:    bw,
		Disk: wire.SystemTelemetryDisk{
			TotalBytes:      raw.DiskTotalBytes,
			FreeBytes:       raw.DiskFreeBytes,
			ModelCacheBytes: modelCacheBytes,
		},
		Cpu: wire.SystemTelemetryCpu{
			TotalCores:     raw.CPUTotalCores,
			LogicalThreads: raw.CPULogicalThreads,
			LoadPct:        raw.CPULoadPct,
			LoadAvg:        raw.LoadAvg,
			Clusters:       clusters,
		},
		Gpu:     raw.GPU,
		Power:   raw.Power,
		Thermal: raw.Thermal,
	}
}

func (c *Collector) sampleInference(
	ctx context.Context,
	library *wire.LocalModelsSnapshot,
	tracker TrackerSummary,
	now time.Time,
) (inf wire.SystemTelemetryInference, weightsBytes, kvBytes, computeBytes uint64) {
	inf = wire.SystemTelemetryInference{
		TtftLiveMs:          tracker.TTFTLiveMs,
		TtftP50Ms:           tracker.TTFTP50Ms,
		TtftP95Ms:           tracker.TTFTP95Ms,
		TotalTokensSession:  tracker.TotalTokensSession,
		ActiveRequestsCount: tracker.ActiveCount,
		LoadedModels:        []wire.SystemTelemetryLoadedModel{},
		Slots:               []wire.SystemTelemetrySlot{},
		Requests:            tracker.Requests,
	}
	if inf.Requests == nil {
		inf.Requests = []wire.SystemTelemetryRequest{}
	}
	if library == nil || !library.Available {
		return inf, 0, 0, 0
	}

	var aggPrefillTokS, aggDecodeTokS float64
	var externalTokensDelta uint64
	var totalPromptTokens, totalCachedTokens uint64
	var kvUsedTokens, kvCapTokens uint64
	var serverProcessing uint64

	for _, model := range library.Models {
		if model.State != "loaded" {
			continue
		}
		engine := normalizeModelEngine(model.Engine)
		configuredSlots := uint64(1)
		if model.Concurrency != nil && *model.Concurrency > 0 {
			configuredSlots = *model.Concurrency
		}
		var modelSlots []wire.SystemTelemetrySlot
		var modelActiveSlots uint64
		var modelPrefill, modelDecode float64
		var modelProcessing uint64

		if model.Endpoint != nil && strings.TrimSpace(model.Endpoint.BaseURL) != "" {
			if baseURL, ok := loopbackRootURL(model.Endpoint.BaseURL); ok {
				apiKey := lookupLoopbackAPIKey(c.localModelsStateDir, model.ID, model.Endpoint.BaseURL)
				if counters, ok := c.fetchLlamaMetrics(ctx, baseURL, apiKey); ok {
					preRate, decRate, deltaTokens := c.diffMetrics(model.ID, counters, now)
					modelPrefill, modelDecode = preRate, decRate
					externalTokensDelta += deltaTokens
					if counters.Processing > 0 {
						modelProcessing = uint64(counters.Processing)
					}
				}
				if polledSlots, ok := c.fetchLlamaSlots(ctx, baseURL, apiKey, model.ID); ok && len(polledSlots) > 0 {
					modelSlots = polledSlots
					configuredSlots = uint64(len(polledSlots))
					for i := range modelSlots {
						if modelSlots[i].Busy {
							modelActiveSlots++
						}
						if modelSlots[i].NCtx != nil {
							kvCapTokens += *modelSlots[i].NCtx
						}
						var used uint64
						if modelSlots[i].PromptProcessed != nil {
							used += *modelSlots[i].PromptProcessed
						} else if modelSlots[i].PromptTokens != nil {
							used += *modelSlots[i].PromptTokens
						}
						if modelSlots[i].DecodedTokens != nil {
							used += *modelSlots[i].DecodedTokens
						}
						kvUsedTokens += used
						if modelSlots[i].PromptTokens != nil && *modelSlots[i].PromptTokens > 0 {
							totalPromptTokens += *modelSlots[i].PromptTokens
							if modelSlots[i].CachedPromptTokens != nil {
								totalCachedTokens += min(*modelSlots[i].CachedPromptTokens, *modelSlots[i].PromptTokens)
							}
						}
					}
				}
			}
		}

		if len(modelSlots) == 0 && configuredSlots > 0 {
			kvCapTokens += configuredSlots * model.ContextTokens
		}

		aggPrefillTokS += modelPrefill
		aggDecodeTokS += modelDecode
		serverProcessing += modelProcessing
		inf.TotalSlots += configuredSlots
		inf.ActiveSlots += modelActiveSlots
		for _, s := range modelSlots {
			if len(inf.Slots) < 64 {
				inf.Slots = append(inf.Slots, s)
			}
		}

		// Split loaded model footprint into weights, KV cache, and compute buffers.
		totalMem := model.MemoryBytes
		modelKV := uint64(float64(totalMem) * 0.12)
		modelCompute := uint64(float64(totalMem) * 0.06)
		modelWeights := totalMem - modelKV - modelCompute
		weightsBytes += modelWeights
		kvBytes += modelKV
		computeBytes += modelCompute

		status := "idle"
		switch {
		case modelDecode > 0.1:
			status = "decoding"
		case modelPrefill > 0.1:
			status = "prefilling"
		case modelActiveSlots > 0 || modelProcessing > 0:
			status = "serving"
		}

		var keepAlive *uint64
		if lastAct, ok := tracker.LastModelActivity[model.ID]; ok {
			elapsed := uint64(max(now.Sub(lastAct).Seconds(), 0))
			rem := uint64(0)
			if elapsed < defaultKeepAliveSeconds {
				rem = defaultKeepAliveSeconds - elapsed
			}
			keepAlive = &rem
		}

		kvCopy := modelKV
		inf.LoadedModels = append(inf.LoadedModels, wire.SystemTelemetryLoadedModel{
			ID:                    model.ID,
			Name:                  model.Name,
			Engine:                engine,
			Quant:                 model.Quant,
			VramBytes:             model.MemoryBytes,
			KvBytes:               &kvCopy,
			RamBytes:              model.HostRamBytes,
			ContextWindow:         model.ContextTokens,
			Slots:                 configuredSlots,
			ActiveSlots:           modelActiveSlots,
			KeepAliveRemainingSec: keepAlive,
			Status:                status,
			WarmDecodeTokS:        cloneFloatPtr(model.TokensPerSecond),
			WarmPrefillTokS:       cloneFloatPtr(model.PromptTokensPerSecond),
		})
		if len(inf.LoadedModels) >= 32 {
			break
		}
	}

	if externalTokensDelta > 0 && tracker.ActiveCount == 0 {
		// Record tokens from loopback callers that bypassed Daemon hooks.
		c.tracker.AddSessionTokens(externalTokensDelta)
		inf.TotalTokensSession += externalTokensDelta
	}

	inf.PrefillTokS = round1(aggPrefillTokS)
	inf.DecodeTokS = round1(aggDecodeTokS)
	if serverProcessing > inf.ActiveRequestsCount {
		inf.ActiveRequestsCount = serverProcessing
	}
	if inf.ActiveRequestsCount > inf.TotalSlots && inf.TotalSlots > 0 {
		inf.QueuedRequestsCount = inf.ActiveRequestsCount - inf.TotalSlots
	}
	inf.KvCacheTokensUsed = kvUsedTokens
	inf.KvCacheTokensCapacity = kvCapTokens
	if kvCapTokens > 0 {
		pct := round1(clampFloat((float64(kvUsedTokens)/float64(kvCapTokens))*100, 0, 100))
		inf.KvCacheUsedPct = &pct
	}
	if totalPromptTokens > 0 {
		hit := round1(clampFloat((float64(totalCachedTokens)/float64(totalPromptTokens))*100, 0, 100))
		inf.PrefixCacheHitRatePct = &hit
	} else {
		// Fall back to recent tracked requests if slots have no active prompt counters.
		var reqIn, reqCache uint64
		for _, r := range inf.Requests {
			reqIn += r.PromptTokens
			reqCache += r.CachedPromptTokens
		}
		if reqIn > 0 {
			hit := round1(clampFloat((float64(reqCache)/float64(reqIn))*100, 0, 100))
			inf.PrefixCacheHitRatePct = &hit
		}
	}
	return inf, weightsBytes, kvBytes, computeBytes
}

func (c *Collector) diffMetrics(modelID string, current LlamaCounters, now time.Time) (prefillTokS, decodeTokS float64, totalTokensDelta uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	prev, ok := c.prevMetrics[modelID]
	c.prevMetrics[modelID] = metricsObservation{counters: current, observedAt: now}
	if !ok {
		return 0, 0, 0
	}
	dPromptTok := current.PromptTokens - prev.counters.PromptTokens
	dPromptSec := current.PromptSeconds - prev.counters.PromptSeconds
	dPredTok := current.PredictedTokens - prev.counters.PredictedTokens
	dPredSec := current.PredictedSeconds - prev.counters.PredictedSeconds
	if dPromptTok < 0 || dPredTok < 0 {
		// Server restarted; counters reset.
		return 0, 0, 0
	}
	if dPromptTok > 0 && dPromptSec > 0 {
		prefillTokS = dPromptTok / dPromptSec
	}
	if dPredTok > 0 && dPredSec > 0 {
		decodeTokS = dPredTok / dPredSec
	}
	return prefillTokS, decodeTokS, uint64(dPromptTok + dPredTok)
}

func (c *Collector) fetchLlamaMetrics(ctx context.Context, baseURL, apiKey string) (LlamaCounters, bool) {
	body, ok := c.loopbackGet(ctx, baseURL+"/metrics", apiKey, maxMetricsResponseSize)
	if !ok {
		return LlamaCounters{}, false
	}
	return ParseLlamaMetrics(string(body))
}

func (c *Collector) fetchLlamaSlots(ctx context.Context, baseURL, apiKey, modelID string) ([]wire.SystemTelemetrySlot, bool) {
	body, ok := c.loopbackGet(ctx, baseURL+"/slots", apiKey, maxSlotsResponseSize)
	if !ok {
		return nil, false
	}
	return ParseLlamaSlots(body, modelID)
}

func (c *Collector) loopbackGet(ctx context.Context, rawURL, apiKey string, limit int64) ([]byte, bool) {
	reqCtx, cancel := context.WithTimeout(ctx, loopbackHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, false
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(body)) > limit {
		return nil, false
	}
	return body, true
}

func (c *Collector) modelCacheBytes(now time.Time) *uint64 {
	modelsDir := c.resolveModelCacheDir()
	if modelsDir == "" {
		return nil
	}
	c.mu.Lock()
	if c.cachedModelBytes != nil && now.Sub(c.cachedModelAt) < defaultCacheWalkTTL {
		v := *c.cachedModelBytes
		c.mu.Unlock()
		return &v
	}
	c.mu.Unlock()

	total := sumRegularFileBytes(modelsDir)
	c.mu.Lock()
	c.cachedModelBytes = &total
	c.cachedModelAt = now
	c.mu.Unlock()
	return &total
}

func (c *Collector) resolveModelCacheDir() string {
	candidates := make([]string, 0, 3)
	if c.localModelsBaseDir != "" {
		candidates = append(candidates, c.localModelsBaseDir)
	}
	if c.localModelsStateDir != "" {
		candidates = append(
			candidates,
			filepath.Clean(filepath.Join(c.localModelsStateDir, "..", "models")),
			filepath.Join(c.localModelsStateDir, "models"),
		)
	}
	for _, dir := range candidates {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return ""
}

func sumRegularFileBytes(dir string) uint64 {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	var total uint64
	for _, entry := range entries {
		if entry.IsDir() {
			total += sumRegularFileBytes(filepath.Join(dir, entry.Name()))
			continue
		}
		if info, infoErr := entry.Info(); infoErr == nil && info.Mode().IsRegular() && info.Size() > 0 {
			total += uint64(info.Size())
		}
	}
	return total
}

// loopbackRootURL validates that raw points at an HTTP loopback endpoint and
// returns scheme://host (stripping /v1 or any path) so /metrics and /slots work.
func loopbackRootURL(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "http" || parsed.Host == "" || parsed.User != nil {
		return "", false
	}
	host := parsed.Hostname()
	if !strings.EqualFold(host, "localhost") {
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return "", false
		}
	}
	return parsed.Scheme + "://" + parsed.Host, true
}

func normalizeModelEngine(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama.cpp":
		return "llama.cpp"
	case "polystrata":
		return "polystrata"
	case "strata":
		return "strata"
	case "mlx":
		return "mlx"
	default:
		return "other"
	}
}

func lookupLoopbackAPIKey(stateDir, modelID, baseURL string) string {
	if stateDir == "" {
		return ""
	}
	modelsDir := filepath.Join(stateDir, "library", "models")
	entries, err := os.ReadDir(modelsDir)
	if err != nil {
		return ""
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	sanitizedTarget := sanitizeFilenameRE.ReplaceAllString(modelID, "_")
	normalizedTarget := strings.TrimRight(strings.ToLower(strings.TrimSpace(baseURL)), "/")

	type deployRecord struct {
		ID   string `json:"id"`
		Plan *struct {
			Endpoint *struct {
				BaseURL string `json:"base_url"`
			} `json:"endpoint"`
			Service *struct {
				DeployDir string `json:"deploy_dir"`
			} `json:"service"`
		} `json:"plan"`
	}

	for _, name := range names {
		path := filepath.Join(modelsDir, name)
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() > maxDeployFileSize {
			continue
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var rec deployRecord
		if json.Unmarshal(raw, &rec) != nil || rec.Plan == nil || rec.Plan.Service == nil {
			continue
		}
		fileBase := strings.TrimSuffix(name, ".json")
		matched := rec.ID == modelID || fileBase == sanitizedTarget ||
			(rec.Plan.Endpoint != nil && strings.TrimRight(strings.ToLower(strings.TrimSpace(rec.Plan.Endpoint.BaseURL)), "/") == normalizedTarget)
		if !matched {
			continue
		}
		deployDir := strings.TrimSpace(rec.Plan.Service.DeployDir)
		if deployDir == "" {
			return ""
		}
		keyPath := filepath.Join(deployDir, "api-key")
		keyInfo, err := os.Lstat(keyPath)
		if err != nil || !keyInfo.Mode().IsRegular() || keyInfo.Size() > maxDeployKeySize {
			return ""
		}
		if keyRaw, err := os.ReadFile(keyPath); err == nil {
			return strings.TrimSpace(string(keyRaw))
		}
	}
	return ""
}
