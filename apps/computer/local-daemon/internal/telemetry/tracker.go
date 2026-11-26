package telemetry

import (
	"math"
	"slices"
	"strings"
	"sync"
	"time"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

const (
	ttftRingCapacity        = 64
	recentRequestsCapacity  = 24
	defaultKeepAliveSeconds = 300
)

type trackedRequest struct {
	id                 string
	client             string
	modelID            string
	modelName          string
	stage              string
	slotID             *uint64
	promptTokens       uint64
	promptProcessed    uint64
	cachedPromptTokens uint64
	decodedTokens      uint64
	ttftMs             *float64
	gatewayMs          float64
	prefillMs          float64
	decodeMs           float64
	liveDecodeTokS     *float64
	contextUsedPct     *float64
	startedAt          time.Time
	firstTokenAt       time.Time
	completedAt        *time.Time
}

// Tracker records privacy-safe numeric lifecycle metadata for local inference
// requests flowing through the Daemon: in-flight stages, rolling TTFT p50/p95,
// session token odometer, and per-model last-activity timestamps. Prompt and
// completion text never enter this type.
type Tracker struct {
	mu                 sync.Mutex
	now                func() time.Time
	inFlight           map[string]*trackedRequest
	completed          []*trackedRequest
	ttftRing           []float64
	ttftNext           int
	ttftLiveMs         *float64
	totalTokensSession uint64
	lastModelActivity  map[string]time.Time
}

// NewTracker constructs an empty Tracker.
func NewTracker(now func() time.Time) *Tracker {
	if now == nil {
		now = time.Now
	}
	return &Tracker{
		now:               now,
		inFlight:          make(map[string]*trackedRequest),
		ttftRing:          make([]float64, 0, ttftRingCapacity),
		lastModelActivity: make(map[string]time.Time),
	}
}

// BeginRequest registers a newly admitted inference call as prefilling.
func (t *Tracker) BeginRequest(id, client, modelID, modelName string, gatewayMs float64) {
	if t == nil || strings.TrimSpace(id) == "" {
		return
	}
	now := t.now()
	if client == "" {
		client = "Local Agent"
	}
	if modelID == "" {
		modelID = "local-model"
	}
	if modelName == "" {
		modelName = modelID
	}
	if gatewayMs < 0 {
		gatewayMs = 0
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.inFlight[id] = &trackedRequest{
		id:        clipTelemetryString(id, 128),
		client:    clipTelemetryString(client, 120),
		modelID:   clipTelemetryString(modelID, 160),
		modelName: clipTelemetryString(modelName, 200),
		stage:     "prefilling",
		gatewayMs: round1(gatewayMs),
		startedAt: now,
	}
	t.lastModelActivity[modelID] = now
}

// MarkFirstToken transitions an in-flight call into decoding and records live TTFT.
func (t *Tracker) MarkFirstToken(id string, at time.Time) {
	if t == nil || strings.TrimSpace(id) == "" {
		return
	}
	if at.IsZero() {
		at = t.now()
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	req := t.inFlight[id]
	if req == nil || !req.firstTokenAt.IsZero() {
		return
	}
	req.firstTokenAt = at
	req.stage = "decoding"
	ttft := float64(max(at.Sub(req.startedAt).Milliseconds(), 0))
	prefill := max(ttft-req.gatewayMs, 0)
	req.ttftMs = &ttft
	req.prefillMs = round1(prefill)
	t.recordTTFTLocked(ttft)
}

// RecordModelResponse records a completed model request (such as Pi or
// model_invoke completion) with exact timings and token counts.
func (t *Tracker) RecordModelResponse(
	id, client, modelID, modelName string,
	startedAt, firstItemAt, completedAt time.Time,
	promptTokens, cachedTokens, outputTokens int64,
	gatewayMs float64,
	contextWindow uint64,
) {
	if t == nil {
		return
	}
	now := t.now()
	if completedAt.IsZero() {
		completedAt = now
	}
	if startedAt.IsZero() || startedAt.After(completedAt) {
		startedAt = completedAt
	}
	if client == "" {
		client = "Local Agent"
	}
	if modelID == "" {
		modelID = "local-model"
	}
	if modelName == "" {
		modelName = modelID
	}
	if gatewayMs < 0 {
		gatewayMs = 0
	}
	inTok := uint64(max(promptTokens, 0))
	cacheTok := min(uint64(max(cachedTokens, 0)), inTok)
	outTok := uint64(max(outputTokens, 0))

	totalMs := float64(max(completedAt.Sub(startedAt).Milliseconds(), 0))
	var ttftMs *float64
	prefillMs := 0.0
	var decodeMs float64
	if !firstItemAt.IsZero() && !firstItemAt.Before(startedAt) && !firstItemAt.After(completedAt) {
		v := round1(float64(firstItemAt.Sub(startedAt).Milliseconds()))
		ttftMs = &v
		prefillMs = round1(max(v-gatewayMs, 0))
		decodeMs = round1(max(float64(completedAt.Sub(firstItemAt).Milliseconds()), 0))
	} else {
		decodeMs = round1(max(totalMs-gatewayMs, 0))
	}
	var decodeTokS *float64
	if outTok > 0 && decodeMs > 0 {
		rate := round1(float64(outTok) / (decodeMs / 1000.0))
		decodeTokS = &rate
	}
	var ctxPct *float64
	if contextWindow > 0 && (inTok+outTok) > 0 {
		pct := round1(clampFloat((float64(inTok+outTok)/float64(contextWindow))*100, 0, 100))
		ctxPct = &pct
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	if existing, ok := t.inFlight[id]; ok {
		delete(t.inFlight, id)
		if gatewayMs == 0 {
			gatewayMs = existing.gatewayMs
		}
		if ttftMs == nil && existing.ttftMs != nil {
			ttftMs = existing.ttftMs
			prefillMs = existing.prefillMs
			decodeMs = round1(max(totalMs-*ttftMs, 0))
			if outTok > 0 && decodeMs > 0 {
				rate := round1(float64(outTok) / (decodeMs / 1000.0))
				decodeTokS = &rate
			}
		}
	}
	if ttftMs != nil {
		t.recordTTFTLocked(*ttftMs)
	}
	t.totalTokensSession += inTok + outTok
	t.lastModelActivity[modelID] = completedAt

	doneAt := completedAt
	entry := &trackedRequest{
		id:                 clipTelemetryString(id, 128),
		client:             clipTelemetryString(client, 120),
		modelID:            clipTelemetryString(modelID, 160),
		modelName:          clipTelemetryString(modelName, 200),
		stage:              "completed",
		promptTokens:       inTok,
		promptProcessed:    inTok,
		cachedPromptTokens: cacheTok,
		decodedTokens:      outTok,
		ttftMs:             ttftMs,
		gatewayMs:          round1(gatewayMs),
		prefillMs:          prefillMs,
		decodeMs:           decodeMs,
		liveDecodeTokS:     decodeTokS,
		contextUsedPct:     ctxPct,
		startedAt:          startedAt,
		completedAt:        &doneAt,
	}
	t.completed = append([]*trackedRequest{entry}, t.completed...)
	if len(t.completed) > recentRequestsCapacity {
		t.completed = t.completed[:recentRequestsCapacity]
	}
}

// FinishRequest removes an in-flight call that ended without emitting a model response.
func (t *Tracker) FinishRequest(id string) {
	if t == nil || id == "" {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.inFlight, id)
}

// AddSessionTokens adds externally measured tokens (e.g. llama-server /metrics
// counter deltas from requests bypassing the Daemon's model-response hook).
func (t *Tracker) AddSessionTokens(tokens uint64) {
	if t == nil || tokens == 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.totalTokensSession += tokens
}

// TrackerSummary summarizes current tracker state without mutating history.
type TrackerSummary struct {
	TTFTLiveMs         *float64
	TTFTP50Ms          *float64
	TTFTP95Ms          *float64
	TotalTokensSession uint64
	ActiveCount        uint64
	Requests           []wire.SystemTelemetryRequest
	LastModelActivity  map[string]time.Time
}

// Summary returns a point-in-time view of tracked requests and TTFT percentiles.
func (t *Tracker) Summary() TrackerSummary {
	if t == nil {
		return TrackerSummary{
			Requests:          []wire.SystemTelemetryRequest{},
			LastModelActivity: map[string]time.Time{},
		}
	}
	now := t.now()
	t.mu.Lock()
	defer t.mu.Unlock()

	p50, p95 := ttftPercentiles(t.ttftRing)
	var liveCopy *float64
	if t.ttftLiveMs != nil {
		v := *t.ttftLiveMs
		liveCopy = &v
	}

	inFlightList := make([]*trackedRequest, 0, len(t.inFlight))
	for _, req := range t.inFlight {
		inFlightList = append(inFlightList, req)
	}
	slices.SortFunc(inFlightList, func(a, b *trackedRequest) int {
		if a.startedAt.After(b.startedAt) {
			return -1
		}
		if a.startedAt.Before(b.startedAt) {
			return 1
		}
		return strings.Compare(a.id, b.id)
	})

	requests := make([]wire.SystemTelemetryRequest, 0, min(len(inFlightList)+len(t.completed), recentRequestsCapacity))
	for _, req := range inFlightList {
		elapsedMs := float64(max(now.Sub(req.startedAt).Milliseconds(), 0))
		prefillMs := req.prefillMs
		decodeMs := req.decodeMs
		if req.stage == "prefilling" {
			prefillMs = round1(max(elapsedMs-req.gatewayMs, 0))
		} else if req.stage == "decoding" && !req.firstTokenAt.IsZero() {
			decodeMs = round1(float64(max(now.Sub(req.firstTokenAt).Milliseconds(), 0)))
		}
		requests = append(requests, wire.SystemTelemetryRequest{
			ID:                 req.id,
			Client:             req.client,
			ModelID:            req.modelID,
			ModelName:          req.modelName,
			Stage:              req.stage,
			SlotID:             req.slotID,
			PromptTokens:       req.promptTokens,
			PromptProcessed:    req.promptProcessed,
			CachedPromptTokens: req.cachedPromptTokens,
			DecodedTokens:      req.decodedTokens,
			TtftMs:             cloneFloatPtr(req.ttftMs),
			GatewayMs:          req.gatewayMs,
			PrefillMs:          prefillMs,
			DecodeMs:           decodeMs,
			LiveDecodeTokS:     cloneFloatPtr(req.liveDecodeTokS),
			ContextUsedPct:     cloneFloatPtr(req.contextUsedPct),
			StartedAtMs:        uint64(max(req.startedAt.UnixMilli(), 0)),
		})
		if len(requests) >= recentRequestsCapacity {
			break
		}
	}
	for _, req := range t.completed {
		if len(requests) >= recentRequestsCapacity {
			break
		}
		var completedMs *uint64
		if req.completedAt != nil {
			ms := uint64(max(req.completedAt.UnixMilli(), 0))
			completedMs = &ms
		}
		requests = append(requests, wire.SystemTelemetryRequest{
			ID:                 req.id,
			Client:             req.client,
			ModelID:            req.modelID,
			ModelName:          req.modelName,
			Stage:              req.stage,
			SlotID:             req.slotID,
			PromptTokens:       req.promptTokens,
			PromptProcessed:    req.promptProcessed,
			CachedPromptTokens: req.cachedPromptTokens,
			DecodedTokens:      req.decodedTokens,
			TtftMs:             cloneFloatPtr(req.ttftMs),
			GatewayMs:          req.gatewayMs,
			PrefillMs:          req.prefillMs,
			DecodeMs:           req.decodeMs,
			LiveDecodeTokS:     cloneFloatPtr(req.liveDecodeTokS),
			ContextUsedPct:     cloneFloatPtr(req.contextUsedPct),
			StartedAtMs:        uint64(max(req.startedAt.UnixMilli(), 0)),
			CompletedAtMs:      completedMs,
		})
	}

	activity := make(map[string]time.Time, len(t.lastModelActivity))
	for k, v := range t.lastModelActivity {
		activity[k] = v
	}

	return TrackerSummary{
		TTFTLiveMs:         liveCopy,
		TTFTP50Ms:          p50,
		TTFTP95Ms:          p95,
		TotalTokensSession: t.totalTokensSession,
		ActiveCount:        uint64(len(t.inFlight)),
		Requests:           requests,
		LastModelActivity:  activity,
	}
}

func (t *Tracker) recordTTFTLocked(ms float64) {
	if math.IsNaN(ms) || math.IsInf(ms, 0) || ms < 0 {
		return
	}
	v := round1(ms)
	t.ttftLiveMs = &v
	if len(t.ttftRing) < ttftRingCapacity {
		t.ttftRing = append(t.ttftRing, v)
	} else {
		t.ttftRing[t.ttftNext] = v
		t.ttftNext = (t.ttftNext + 1) % ttftRingCapacity
	}
}

func ttftPercentiles(samples []float64) (p50, p95 *float64) {
	if len(samples) == 0 {
		return nil, nil
	}
	sorted := append([]float64(nil), samples...)
	slices.Sort(sorted)
	v50 := round1(percentile(sorted, 0.50))
	v95 := round1(percentile(sorted, 0.95))
	return &v50, &v95
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 1 {
		return sorted[0]
	}
	idx := p * float64(len(sorted)-1)
	low := int(math.Floor(idx))
	high := int(math.Ceil(idx))
	if low == high {
		return sorted[low]
	}
	frac := idx - float64(low)
	return sorted[low] + frac*(sorted[high]-sorted[low])
}

func cloneFloatPtr(v *float64) *float64 {
	if v == nil {
		return nil
	}
	copied := *v
	return &copied
}

func clipTelemetryString(s string, maxLen int) string {
	trimmed := strings.TrimSpace(s)
	if len(trimmed) <= maxLen {
		return trimmed
	}
	return trimmed[:maxLen]
}
