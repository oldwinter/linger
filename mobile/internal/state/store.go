// Package state holds Linger Mobile's thread-safe reactive AppStore,
// connecting config, discovery, api, realtime SSE, SQLite cache, and UI views.
package state

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/netimage"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/discovery"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/realtime"
)

// TabIndex identifies the 5 top-level bottom-bar tabs.
const (
	TabRooms   = 0
	TabLive    = 1
	TabWork    = 2
	TabLibrary = 3
	TabMore    = 4
)

// ConnectionPhase describes the active host session lifecycle.
type ConnectionPhase string

const (
	PhaseDisconnected ConnectionPhase = "disconnected"
	PhaseConnecting   ConnectionPhase = "connecting"
	PhaseConnected    ConnectionPhase = "connected"
	PhaseReconnecting ConnectionPhase = "reconnecting"
	PhaseExpired      ConnectionPhase = "expired"
)

// Snapshot is an immutable read-only copy of AppStore state consumed by views.
type Snapshot struct {
	ActiveTab           int
	Hosts               []config.HostProfile
	ActiveHost          *config.HostProfile
	Prefs               config.AppPreferences
	Phase               ConnectionPhase
	SSEState            realtime.StreamState
	Online              bool
	Suspended           bool
	BiometricLocked     bool
	RTTMs               int
	ActiveVia           string
	LastHeartbeat       time.Time
	StatusMessage       string
	TransientError      string
	Discovered          []discovery.DiscoveredHost
	CompanionStatus     *api.CompanionStatus
	Identity            *api.CurrentIdentity
	Tenants             []api.Tenant
	TenantID            string
	Rooms               []api.RoomListItem
	ActiveRuns          []api.RoomRunStatus
	WorkItems           []api.WorkItem
	Routines            []api.Routine
	PocketNotes         []api.PocketNote
	Documents           []api.Document
	Computers           []api.LocalComputer
	LocalModels         *api.LocalModelsView
	CacheStats          cache.CacheStats
	StreamCursors       map[string]int64
	PendingPairURI      string
	ComposerReturnSends bool
	OfflineViewingCache bool
	Actors              []api.Actor
	Agents              []api.TenantAgent
	AgentAvailability   map[string]api.TenantAgentAvailabilitySnapshot
	SkillManifests      []api.SkillManifest
	AgentTemplates      []api.AgentTemplate
	ModelSource         *api.ModelSourceView
	PendingDecisions    []PendingDecisionItem
	WorkingRoomIDs      map[string]bool
}

// Options configures AppStore construction.
type Options struct {
	ConfigStore *config.Store
	DataDir     string
	OnNotify    func() // invokes Window.Update / redraw on state mutation
}

// AppStore owns all runtime services and thread-safe application state.
type AppStore struct {
	cfg               *config.Store
	dataDir           string
	onNotify          func()
	onThemeChanged    func(config.ThemePreference)
	onLanguageChanged func(config.LanguagePreference)

	// UI routers (one independent navigation stack per tab, read/mutated on UI thread).
	Routers [5]*ui.Router

	mu              sync.RWMutex
	connGen         uint64
	connectCancel   context.CancelFunc
	refreshRunning  bool
	refreshPending  bool
	uiPending       []func()
	activeTab       int
	phase           ConnectionPhase
	sseState        realtime.StreamState
	online          bool
	suspended       bool
	biometricLocked bool
	rttMs           int
	activeVia       string
	lastHB          time.Time
	statusMessage   string
	transientError  string
	pendingPairURI  string

	client              *api.Client
	stream              *realtime.StreamManager
	streamCancel        context.CancelFunc
	presentation        *realtime.RunPresentationTracker
	cacheStore          *cache.Store
	browser             *discovery.Browser
	browserCancel       context.CancelFunc
	discovered          []discovery.DiscoveredHost
	companionStatus     *api.CompanionStatus
	identity            *api.CurrentIdentity
	tenants             []api.Tenant
	tenantID            string
	rooms               []api.RoomListItem
	activeRuns          []api.RoomRunStatus
	workItems           []api.WorkItem
	routines            []api.Routine
	pocketNotes         []api.PocketNote
	documents           []api.Document
	computers           []api.LocalComputer
	localModels         *api.LocalModelsView
	cacheStats          cache.CacheStats
	composerReturnSends bool
	offlineViewingCache bool
	actors              []api.Actor
	agents              []api.TenantAgent
	agentAvailability   map[string]api.TenantAgentAvailabilitySnapshot
	skillManifests      []api.SkillManifest
	agentTemplates      []api.AgentTemplate
	modelSource         *api.ModelSourceView
	roomMessages        map[string][]api.Message
	roomHasMore         map[string]bool
	roomNextCursor      map[string]string
	roomDrafts          map[string]string
	runPresEvents       map[string][]api.RuntimePresentationEvent
	pendingDecisions    []PendingDecisionItem
	workingRoomIDs      map[string]bool
}

// NewAppStore initializes an AppStore with 5 independent per-tab routers.
func NewAppStore(opts Options) *AppStore {
	cfgStore := opts.ConfigStore
	if cfgStore == nil {
		cfgStore = config.NewStore(nil, nil)
	}
	prefs := cfgStore.Preferences()
	if prefs.Language != config.LanguageSystem {
		i18n.SetPreference(prefs.Language)
	}
	s := &AppStore{
		cfg:               cfgStore,
		dataDir:           opts.DataDir,
		onNotify:          opts.OnNotify,
		phase:             PhaseDisconnected,
		sseState:          realtime.StateDisconnected,
		online:            true,
		biometricLocked:   prefs.BiometricLock,
		agentAvailability: map[string]api.TenantAgentAvailabilitySnapshot{},
		roomMessages:      map[string][]api.Message{},
		roomHasMore:       map[string]bool{},
		roomNextCursor:    map[string]string{},
		roomDrafts:        map[string]string{},
		runPresEvents:     map[string][]api.RuntimePresentationEvent{},
		workingRoomIDs:    map[string]bool{},
		Routers: [5]*ui.Router{
			ui.NewRouter("/rooms"),
			ui.NewRouter("/live"),
			ui.NewRouter("/work"),
			ui.NewRouter("/library"),
			ui.NewRouter("/more"),
		},
	}
	if _, ok := cfgStore.ActiveHost(); !ok {
		// Guide first-time users directly to More / Connection Hub.
		s.activeTab = TabMore
		s.Routers[TabMore].Replace("/more/connect")
	}
	s.browser = discovery.NewBrowser(func(found []discovery.DiscoveredHost) {
		s.mu.Lock()
		s.discovered = found
		s.mu.Unlock()
		s.notify()
	})
	return s
}

// SetNotifier sets the UI repaint callback (e.g. calling win.Update).
func (s *AppStore) SetNotifier(fn func()) {
	s.mu.Lock()
	s.onNotify = fn
	s.mu.Unlock()
}

// SetOnThemeChanged registers a runtime callback invoked whenever ThemePreference changes.
func (s *AppStore) SetOnThemeChanged(fn func(config.ThemePreference)) {
	s.mu.Lock()
	s.onThemeChanged = fn
	s.mu.Unlock()
}

// SetOnLanguageChanged registers a runtime callback invoked whenever LanguagePreference changes.
func (s *AppStore) SetOnLanguageChanged(fn func(config.LanguagePreference)) {
	s.mu.Lock()
	s.onLanguageChanged = fn
	s.mu.Unlock()
}

// SetDataDir updates the base directory used for per-host SQLite cache files.
func (s *AppStore) SetDataDir(dir string) {
	s.mu.Lock()
	s.dataDir = strings.TrimSpace(dir)
	s.mu.Unlock()
}

func (s *AppStore) notify() {
	s.mu.RLock()
	fn := s.onNotify
	s.mu.RUnlock()
	if fn != nil {
		fn()
	}
}

// Snapshot returns a thread-safe point-in-time snapshot for UI rendering.
func (s *AppStore) Snapshot() Snapshot {
	hosts := s.cfg.Hosts()
	prefs := s.cfg.Preferences()
	var activeHost *config.HostProfile
	if ah, ok := s.cfg.ActiveHost(); ok {
		cp := ah
		activeHost = &cp
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	var cursors map[string]int64
	if s.stream != nil {
		cursors = s.stream.Cursors()
	}
	var compCopy *api.CompanionStatus
	if s.companionStatus != nil {
		c := *s.companionStatus
		compCopy = &c
	}
	var idCopy *api.CurrentIdentity
	if s.identity != nil {
		id := *s.identity
		idCopy = &id
	}
	var lmCopy *api.LocalModelsView
	if s.localModels != nil {
		lm := *s.localModels
		lmCopy = &lm
	}
	var msCopy *api.ModelSourceView
	if s.modelSource != nil {
		ms := *s.modelSource
		msCopy = &ms
	}
	availCopy := make(map[string]api.TenantAgentAvailabilitySnapshot, len(s.agentAvailability))
	for k, v := range s.agentAvailability {
		availCopy[k] = v
	}
	workingCopy := make(map[string]bool, len(s.workingRoomIDs))
	for k, v := range s.workingRoomIDs {
		workingCopy[k] = v
	}

	return Snapshot{
		ActiveTab:           s.activeTab,
		Hosts:               hosts,
		ActiveHost:          activeHost,
		Prefs:               prefs,
		Phase:               s.phase,
		SSEState:            s.sseState,
		Online:              s.online,
		Suspended:           s.suspended,
		BiometricLocked:     s.biometricLocked,
		RTTMs:               s.rttMs,
		ActiveVia:           s.activeVia,
		LastHeartbeat:       s.lastHB,
		StatusMessage:       s.statusMessage,
		TransientError:      s.transientError,
		Discovered:          append([]discovery.DiscoveredHost(nil), s.discovered...),
		CompanionStatus:     compCopy,
		Identity:            idCopy,
		Tenants:             append([]api.Tenant(nil), s.tenants...),
		TenantID:            s.tenantID,
		Rooms:               append([]api.RoomListItem(nil), s.rooms...),
		ActiveRuns:          append([]api.RoomRunStatus(nil), s.activeRuns...),
		WorkItems:           append([]api.WorkItem(nil), s.workItems...),
		Routines:            append([]api.Routine(nil), s.routines...),
		PocketNotes:         append([]api.PocketNote(nil), s.pocketNotes...),
		Documents:           append([]api.Document(nil), s.documents...),
		Computers:           append([]api.LocalComputer(nil), s.computers...),
		LocalModels:         lmCopy,
		CacheStats:          s.cacheStats,
		StreamCursors:       cursors,
		PendingPairURI:      s.pendingPairURI,
		ComposerReturnSends: s.composerReturnSends,
		OfflineViewingCache: s.offlineViewingCache,
		Actors:              append([]api.Actor(nil), s.actors...),
		Agents:              append([]api.TenantAgent(nil), s.agents...),
		AgentAvailability:   availCopy,
		SkillManifests:      append([]api.SkillManifest(nil), s.skillManifests...),
		AgentTemplates:      append([]api.AgentTemplate(nil), s.agentTemplates...),
		ModelSource:         msCopy,
		PendingDecisions:    append([]PendingDecisionItem(nil), s.pendingDecisions...),
		WorkingRoomIDs:      workingCopy,
	}
}

// Client returns the active *api.Client (nil when disconnected).
func (s *AppStore) Client() *api.Client {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.client
}

// Cache returns the active host's SQLite *cache.Store (nil when disconnected or not opened).
func (s *AppStore) Cache() *cache.Store {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cacheStore
}

// ClearCache wipes cached tables in the active host's SQLite store and refreshes CacheStats.
func (s *AppStore) ClearCache(ctx context.Context) error {
	cs := s.Cache()
	if cs == nil {
		return nil
	}
	if err := cs.Clear(ctx); err != nil {
		return err
	}
	st, _ := cs.Stats(ctx)
	s.mu.Lock()
	s.cacheStats = st
	s.mu.Unlock()
	s.notify()
	return nil
}

// Notify triggers a UI repaint callback when child screen controllers mutate state.
func (s *AppStore) Notify() {
	s.notify()
}

// SetActiveTab switches the active bottom tab.
func (s *AppStore) SetActiveTab(idx int) {
	if idx < 0 || idx > 4 {
		return
	}
	s.mu.Lock()
	s.activeTab = idx
	s.mu.Unlock()
	s.notify()
}

// SetTransientError sets a user-visible inline error banner.
func (s *AppStore) SetTransientError(msg string) {
	s.mu.Lock()
	s.transientError = strings.TrimSpace(msg)
	s.mu.Unlock()
	s.notify()
}

// ClearTransientError removes any transient error banner.
func (s *AppStore) ClearTransientError() {
	s.mu.Lock()
	s.transientError = ""
	s.mu.Unlock()
	s.notify()
}

// SetStatusMessage sets an informational banner message.
func (s *AppStore) SetStatusMessage(msg string) {
	s.mu.Lock()
	s.statusMessage = strings.TrimSpace(msg)
	s.mu.Unlock()
	s.notify()
}

// SetRTTMs overrides the measured connection RTT in milliseconds (used by deterministic UI snapshots).
func (s *AppStore) SetRTTMs(ms int) {
	if ms < 0 {
		ms = 0
	}
	s.mu.Lock()
	s.rttMs = ms
	s.mu.Unlock()
	s.notify()
}

// EnqueueUI schedules fn to run on the UI thread before the next frame renders.
func (s *AppStore) EnqueueUI(fn func()) {
	if fn == nil {
		return
	}
	s.mu.Lock()
	s.uiPending = append(s.uiPending, fn)
	s.mu.Unlock()
	s.notify()
}

// DrainUI executes any queued UI-thread actions (must be called on the UI thread).
func (s *AppStore) DrainUI() {
	s.mu.Lock()
	if len(s.uiPending) == 0 {
		s.mu.Unlock()
		return
	}
	q := s.uiPending
	s.uiPending = nil
	s.mu.Unlock()
	for _, fn := range q {
		fn()
	}
}

// SetPendingPairURI records an incoming linger://pair?... deep link and routes to Connection Hub.
func (s *AppStore) SetPendingPairURI(uri string) {
	s.mu.Lock()
	s.pendingPairURI = strings.TrimSpace(uri)
	s.activeTab = TabMore
	s.uiPending = append(s.uiPending, func() {
		s.Routers[TabMore].Replace("/more/connect")
	})
	s.mu.Unlock()
	s.notify()
}

// ConsumePendingPairURI returns and clears the pending deep-link URI.
func (s *AppStore) ConsumePendingPairURI() string {
	s.mu.Lock()
	u := s.pendingPairURI
	s.pendingPairURI = ""
	s.mu.Unlock()
	return u
}

// SetBiometricLocked locks or unlocks the app overlay.
func (s *AppStore) SetBiometricLocked(locked bool) {
	s.mu.Lock()
	s.biometricLocked = locked
	s.mu.Unlock()
	s.notify()
}

// UpdatePreferences persists new AppPreferences and fires theme/language callbacks when changed.
func (s *AppStore) UpdatePreferences(prefs config.AppPreferences) error {
	prev := s.cfg.Preferences()
	prefs.Theme = config.NormalizeThemePreference(string(prefs.Theme))
	prefs.Language = config.NormalizeLanguagePreference(string(prefs.Language))
	if err := s.cfg.SetPreferences(prefs); err != nil {
		return err
	}
	if prefs.Language != prev.Language || i18n.ActivePreference() != prefs.Language {
		i18n.SetPreference(prefs.Language)
	}
	s.mu.RLock()
	onTheme := s.onThemeChanged
	onLang := s.onLanguageChanged
	s.mu.RUnlock()
	if onTheme != nil && prefs.Theme != prev.Theme {
		onTheme(prefs.Theme)
	}
	if onLang != nil && prefs.Language != prev.Language {
		onLang(prefs.Language)
	}
	s.notify()
	return nil
}

// SetThemePreference updates the Town Light/Dark/System theme preference.
func (s *AppStore) SetThemePreference(pref config.ThemePreference) error {
	p := s.cfg.Preferences()
	p.Theme = config.NormalizeThemePreference(string(pref))
	return s.UpdatePreferences(p)
}

// SetLanguagePreference updates the System/English/Simplified Chinese language preference.
func (s *AppStore) SetLanguagePreference(pref config.LanguagePreference) error {
	p := s.cfg.Preferences()
	p.Language = config.NormalizeLanguagePreference(string(pref))
	return s.UpdatePreferences(p)
}

// SetBiometricPreference toggles Biometric App Lock.
func (s *AppStore) SetBiometricPreference(enabled bool) error {
	p := s.cfg.Preferences()
	p.BiometricLock = enabled
	if !enabled {
		s.SetBiometricLocked(false)
	}
	return s.UpdatePreferences(p)
}

// SetOnline propagates OS network reachability changes to the SSE engine.
func (s *AppStore) SetOnline(online bool) {
	s.mu.Lock()
	s.online = online
	stream := s.stream
	client := s.client
	if online {
		s.transientError = ""
	}
	s.mu.Unlock()
	if stream != nil {
		stream.SetOnline(online)
	}
	if online && client != nil {
		go func() { _, _ = s.DrainMessageOutbox(context.Background()) }()
	}
	s.notify()
}

// SetSuspended propagates OS background/sleep transitions to the SSE engine and biometric lock.
func (s *AppStore) SetSuspended(suspended bool) {
	s.mu.Lock()
	s.suspended = suspended
	stream := s.stream
	if suspended && s.cfg.Preferences().BiometricLock {
		s.biometricLocked = true
	}
	s.mu.Unlock()
	if stream != nil {
		stream.SetSuspended(suspended)
	}
	s.notify()
}

// StartDiscovery begins LAN mDNS browsing for _linger._tcp.local. hosts.
func (s *AppStore) StartDiscovery(parent context.Context) {
	s.mu.Lock()
	if s.browserCancel != nil {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(parent)
	s.browserCancel = cancel
	browser := s.browser
	s.mu.Unlock()

	go func() {
		_ = browser.Run(ctx)
	}()
}

// StopDiscovery stops the background mDNS browser.
func (s *AppStore) StopDiscovery() {
	s.mu.Lock()
	cancel := s.browserCancel
	s.browserCancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// InjectDiscoveredHosts injects hosts into discovery state (used by UI tests and preview harnesses).
func (s *AppStore) InjectDiscoveredHosts(hosts []discovery.DiscoveredHost) {
	s.mu.Lock()
	s.discovered = append([]discovery.DiscoveredHost(nil), hosts...)
	s.mu.Unlock()
	s.notify()
}

// PairWithURI parses a linger://pair?... URI, connects with strict SPKI TLS
// pinning, completes POST /companion/v1/pair, saves profile & secret, and connects.
func (s *AppStore) PairWithURI(ctx context.Context, rawURI string, allowPlainHTTP bool) (config.HostProfile, error) {
	payload, err := discovery.ParsePairingURI(rawURI)
	if err != nil {
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}
	if !payload.TLS && !allowPlainHTTP {
		err := errors.New(i18n.T("state.err.plain_http_required"))
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}

	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        payload.PrimaryURL(),
		FallbackURL:    payload.TailscaleURL(),
		Mode:           api.AuthModeNone,
		TLSFingerprint: payload.TLSFingerprint,
		AllowPlainHTTP: !payload.TLS && allowPlainHTTP,
	})
	if err != nil {
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}
	defer client.CloseIdleConnections()

	pairResp, err := client.Pair(ctx, api.PairRequest{
		Code:       payload.Code,
		DeviceName: defaultDeviceName(),
		Platform:   runtime.GOOS,
		AppVersion: "0.1.0",
	})
	if err != nil {
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}

	profile := config.HostProfile{
		ID:             pairResp.HostID,
		Name:           firstNonEmpty(pairResp.HostName, payload.Name),
		Mode:           config.HostModeCompanion,
		PrimaryURL:     payload.PrimaryURL(),
		TailscaleURL:   payload.TailscaleURL(),
		TLS:            payload.TLS,
		TLSFingerprint: firstNonEmpty(payload.TLSFingerprint, pairResp.TLSFingerprint),
		AllowPlainHTTP: !payload.TLS && allowPlainHTTP,
		DeviceID:       pairResp.DeviceID,
		TenantID:       pairResp.TenantID,
		SessionMode:    pairResp.SessionMode,
		AddedAt:        time.Now().UTC(),
	}
	if err := s.saveAndActivateHost(ctx, profile, pairResp.Token); err != nil {
		return config.HostProfile{}, err
	}
	return profile, nil
}

// ProbePINHost probes a LAN/Tailscale host via TOFU so the user can visually
// verify ShortFingerprint (XXXX-XXXX-XXXX-XXXX) before submitting a 6-digit PIN.
func (s *AppStore) ProbePINHost(ctx context.Context, baseURL string, allowPlainHTTP bool) (api.TOFUProbeResult, error) {
	res, err := api.ProbeCompanionTOFU(ctx, baseURL, allowPlainHTTP)
	if err != nil {
		s.SetTransientError(err.Error())
		return api.TOFUProbeResult{}, err
	}
	s.ClearTransientError()
	return res, nil
}

// PairWithPIN completes PIN pairing after the user confirms the host fingerprint.
func (s *AppStore) PairWithPIN(ctx context.Context, baseURL, pin, confirmedFP string, allowPlainHTTP bool) (config.HostProfile, error) {
	pin = strings.TrimSpace(pin)
	if len(pin) != 6 {
		err := errors.New(i18n.T("state.err.pin_six_digits"))
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}
	isTLS := strings.HasPrefix(strings.ToLower(strings.TrimSpace(baseURL)), "https://")
	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        baseURL,
		Mode:           api.AuthModeNone,
		TLSFingerprint: confirmedFP,
		AllowPlainHTTP: !isTLS && allowPlainHTTP,
	})
	if err != nil {
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}
	defer client.CloseIdleConnections()

	pairResp, err := client.Pair(ctx, api.PairRequest{
		PIN:        pin,
		DeviceName: defaultDeviceName(),
		Platform:   runtime.GOOS,
		AppVersion: "0.1.0",
	})
	if err != nil {
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}

	var tsURL string
	if info, infoErr := client.GetCompanionInfo(ctx); infoErr == nil && len(info.Addresses.Tailscale) > 0 {
		if u, uErr := url.Parse(baseURL); uErr == nil {
			port := u.Port()
			if port == "" {
				port = fmt.Sprintf("%d", discovery.DefaultCompanionPort)
			}
			tsURL = fmt.Sprintf("%s://%s:%s", u.Scheme, info.Addresses.Tailscale[0], port)
		}
	}

	profile := config.HostProfile{
		ID:             pairResp.HostID,
		Name:           firstNonEmpty(pairResp.HostName, baseURL),
		Mode:           config.HostModeCompanion,
		PrimaryURL:     strings.TrimRight(baseURL, "/"),
		TailscaleURL:   tsURL,
		TLS:            isTLS,
		TLSFingerprint: firstNonEmpty(confirmedFP, pairResp.TLSFingerprint),
		AllowPlainHTTP: !isTLS && allowPlainHTTP,
		DeviceID:       pairResp.DeviceID,
		TenantID:       pairResp.TenantID,
		SessionMode:    pairResp.SessionMode,
		AddedAt:        time.Now().UTC(),
	}
	if err := s.saveAndActivateHost(ctx, profile, pairResp.Token); err != nil {
		return config.HostProfile{}, err
	}
	return profile, nil
}

// LoginDirect signs in directly to a remote or self-hosted TeamHub URL with email + password.
func (s *AppStore) LoginDirect(ctx context.Context, rawURL, email, password string, allowPlainHTTP bool) (config.HostProfile, error) {
	rawURL = strings.TrimRight(strings.TrimSpace(rawURL), "/")
	isTLS := strings.HasPrefix(strings.ToLower(rawURL), "https://")
	var capturedCookie string
	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        rawURL,
		Mode:           api.AuthModeDirect,
		AllowPlainHTTP: !isTLS && allowPlainHTTP,
		OnTokenChanged: func(tok string) { capturedCookie = tok },
	})
	if err != nil {
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}
	defer client.CloseIdleConnections()

	sess, err := client.Login(ctx, strings.TrimSpace(email), password)
	if err != nil {
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}
	if capturedCookie == "" {
		err := errors.New(i18n.T("state.err.no_session_cookie"))
		s.SetTransientError(err.Error())
		return config.HostProfile{}, err
	}

	hostLabel := rawURL
	if u, err := url.Parse(rawURL); err == nil && u.Host != "" {
		hostLabel = u.Host
	}
	h := sha256.Sum256([]byte(rawURL + "|" + strings.ToLower(strings.TrimSpace(email))))
	hostID := "direct_" + hex.EncodeToString(h[:6])
	tenantID := ""
	if len(sess.Identity.Actors) > 0 {
		tenantID = sess.Identity.Actors[0].TenantID
	}

	profile := config.HostProfile{
		ID:             hostID,
		Name:           hostLabel,
		Mode:           config.HostModeDirect,
		PrimaryURL:     rawURL,
		TLS:            isTLS,
		AllowPlainHTTP: !isTLS && allowPlainHTTP,
		TenantID:       tenantID,
		SessionMode:    "direct",
		AccountEmail:   sess.Identity.Account.Email,
		AddedAt:        time.Now().UTC(),
	}
	if err := s.saveAndActivateHost(ctx, profile, capturedCookie); err != nil {
		return config.HostProfile{}, err
	}
	return profile, nil
}

// ConfigurePreviewHost connects directly with CLI preview flags (--host-url, --token).
func (s *AppStore) ConfigurePreviewHost(ctx context.Context, hostURL, token, tlsFP string, allowPlainHTTP bool) error {
	hostURL = strings.TrimRight(strings.TrimSpace(hostURL), "/")
	isTLS := strings.HasPrefix(strings.ToLower(hostURL), "https://")
	profile := config.HostProfile{
		ID:             "preview_host",
		Name:           "Preview Desktop",
		Mode:           config.HostModeCompanion,
		PrimaryURL:     hostURL,
		TLS:            isTLS,
		TLSFingerprint: tlsFP,
		AllowPlainHTTP: !isTLS && allowPlainHTTP,
		SessionMode:    "dedicated",
		AddedAt:        time.Now().UTC(),
	}
	return s.saveAndActivateHost(ctx, profile, token)
}

func (s *AppStore) saveAndActivateHost(ctx context.Context, profile config.HostProfile, secret string) error {
	if err := s.cfg.UpsertHost(profile); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	if err := s.cfg.SaveSecret(profile.ID, secret); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	if err := s.cfg.SetActiveHost(profile.ID); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	s.ClearTransientError()
	s.SetStatusMessage(i18n.Tf("state.toast.connected_to", map[string]any{"name": profile.Name}))
	return s.ConnectHost(ctx, profile.ID)
}

// ConnectHost activates a saved host, opens its SQLite cache, hydrates offline
// rows, probes LAN->Tailscale, fetches live data, and starts the single SSE engine.
// Concurrent ConnectHost calls are generation-guarded so superseded attempts cancel
// and close their resources cleanly without leaking streams or SQLite handles.
func (s *AppStore) ConnectHost(ctx context.Context, hostID string) error {
	profile, ok := s.cfg.Host(hostID)
	if !ok {
		return errors.New(i18n.Tf("state.err.host_not_found", map[string]any{"id": hostID}))
	}
	token, err := s.cfg.LoadSecret(hostID)
	if err != nil {
		s.SetTransientError(i18n.Tf("state.err.missing_credentials", map[string]any{"name": profile.Name}))
		return err
	}

	connCtx, connCancel := context.WithCancel(ctx)
	s.mu.Lock()
	s.connGen++
	myGen := s.connGen
	prevConnectCancel := s.connectCancel
	s.connectCancel = connCancel
	prevStreamCancel := s.streamCancel
	s.streamCancel = nil
	s.stream = nil
	s.presentation = nil
	prevClient := s.client
	s.client = nil
	prevCache := s.cacheStore
	s.cacheStore = nil
	s.phase = PhaseConnecting
	s.sseState = realtime.StateDisconnected
	s.transientError = ""
	s.mu.Unlock()

	if prevConnectCancel != nil {
		prevConnectCancel()
	}
	if prevStreamCancel != nil {
		prevStreamCancel()
	}
	if prevClient != nil {
		prevClient.CloseIdleConnections()
	}
	if prevCache != nil {
		_ = prevCache.Close()
	}

	_ = s.cfg.SetActiveHost(hostID)
	s.notify()

	isSuperseded := func() bool {
		s.mu.RLock()
		defer s.mu.RUnlock()
		return s.connGen != myGen
	}

	// Open per-host SQLite cache and hydrate offline snapshot immediately.
	cacheStore, cacheErr := s.openHostCache(connCtx, hostID)
	if cacheErr == nil {
		s.mu.Lock()
		if s.connGen != myGen {
			s.mu.Unlock()
			_ = cacheStore.Close()
			connCancel()
			return context.Canceled
		}
		s.cacheStore = cacheStore
		s.mu.Unlock()
		s.hydrateFromCache(connCtx, cacheStore, profile.TenantID)
	}

	mode := api.AuthModeCompanion
	if profile.Mode == config.HostModeDirect {
		mode = api.AuthModeDirect
	}
	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        profile.PrimaryURL,
		FallbackURL:    profile.TailscaleURL,
		Mode:           mode,
		Token:          token,
		TLSFingerprint: profile.TLSFingerprint,
		AllowPlainHTTP: profile.AllowPlainHTTP,
		OnTokenChanged: func(newToken string) {
			_ = s.cfg.SaveSecret(hostID, newToken)
		},
	})
	if err != nil {
		connCancel()
		if !isSuperseded() {
			s.mu.Lock()
			if s.connGen == myGen {
				s.phase = PhaseDisconnected
				s.transientError = err.Error()
			}
			s.mu.Unlock()
			s.notify()
		}
		return err
	}

	// Probe LAN -> Tailscale failover when fallback exists.
	if profile.TailscaleURL != "" {
		if res, probeErr := client.ProbeAndSelectEndpoint(connCtx, discovery.DefaultLANProbeTimeout); probeErr == nil {
			s.mu.Lock()
			if s.connGen == myGen {
				s.activeVia = res.Target.Via
				s.rttMs = int(res.RTT.Milliseconds())
			}
			s.mu.Unlock()
		}
	}

	s.mu.Lock()
	if s.connGen != myGen {
		s.mu.Unlock()
		client.CloseIdleConnections()
		connCancel()
		return context.Canceled
	}
	s.client = client
	s.mu.Unlock()
	netimage.SetClient(client.AuthenticatedHTTPClient())

	if err := s.RefreshActiveHost(connCtx); err != nil {
		if isSuperseded() {
			connCancel()
			return context.Canceled
		}
		if errors.Is(err, api.ErrUnauthorized) {
			connCancel()
			s.mu.Lock()
			if s.connGen == myGen {
				s.phase = PhaseExpired
				s.transientError = i18n.T("state.err.session_expired_device")
			}
			s.mu.Unlock()
			s.notify()
			return err
		}
		s.mu.Lock()
		if s.connGen == myGen {
			s.phase = PhaseReconnecting
			s.offlineViewingCache = len(s.rooms) > 0
			s.transientError = err.Error()
		}
		s.mu.Unlock()
		// Start SSE realtime engine even after transient initial refresh failure
		// so the store recovers automatically once the host comes back online.
		s.startRealtime(client, myGen)
		s.notify()
		return err
	}

	if isSuperseded() {
		connCancel()
		return context.Canceled
	}

	// Start single /v0/events SSE engine and drain any queued offline messages.
	s.startRealtime(client, myGen)
	go func() {
		_, _ = s.DrainMessageOutbox(context.Background())
	}()

	profile.LastConnectedAt = time.Now().UTC()
	profile.LastRTTMs = int(client.LastRTT().Milliseconds())
	if tid := s.Snapshot().TenantID; tid != "" {
		profile.TenantID = tid
	}
	_ = s.cfg.UpsertHost(profile)

	s.mu.Lock()
	if s.connGen == myGen {
		s.phase = PhaseConnected
		s.offlineViewingCache = false
		s.rttMs = profile.LastRTTMs
		s.activeVia = client.ActiveVia()
		s.transientError = ""
	}
	s.mu.Unlock()
	s.notify()
	return nil
}

// Disconnect stops SSE, cancels in-flight connects, closes the SQLite cache, and clears active runtime handles.
func (s *AppStore) Disconnect() {
	s.mu.Lock()
	s.connGen++
	connectCancel := s.connectCancel
	s.connectCancel = nil
	cancel := s.streamCancel
	s.streamCancel = nil
	s.stream = nil
	s.presentation = nil
	client := s.client
	s.client = nil
	cs := s.cacheStore
	s.cacheStore = nil
	s.phase = PhaseDisconnected
	s.sseState = realtime.StateDisconnected
	s.mu.Unlock()

	if connectCancel != nil {
		connectCancel()
	}
	if cancel != nil {
		cancel()
	}
	if client != nil {
		client.CloseIdleConnections()
	}
	if cs != nil {
		_ = cs.Close()
	}
	s.notify()
}

// RefreshActiveHost fetches identity, companion status, rooms, work items,
// routines, pocket notes, documents, computers, and updates SQLite cache.
func (s *AppStore) RefreshActiveHost(ctx context.Context) error {
	client := s.Client()
	if client == nil {
		return errors.New(i18n.T("state.err.not_connected"))
	}

	me, err := client.GetMe(ctx)
	if err != nil {
		return err
	}

	tenants, _ := client.ListTenants(ctx)
	tenantID := ""
	if len(tenants) > 0 {
		tenantID = tenants[0].ID
	} else if len(me.Actors) > 0 {
		tenantID = me.Actors[0].TenantID
	}

	var compStatus *api.CompanionStatus
	if client.Mode() == api.AuthModeCompanion {
		if st, stErr := client.GetCompanionStatus(ctx); stErr == nil {
			compStatus = &st
		}
	}

	var rooms []api.RoomListItem
	var activeRuns []api.RoomRunStatus
	runningRoomSet := map[string]bool{}
	var workItems []api.WorkItem
	var routines []api.Routine
	var notes []api.PocketNote
	var docs []api.Document
	var computers []api.LocalComputer
	var localModels *api.LocalModelsView
	var modelSource *api.ModelSourceView
	var actors []api.Actor
	var agents []api.TenantAgent
	var avail []api.TenantAgentAvailabilitySnapshot
	var skills []api.SkillManifest
	var templates []api.AgentTemplate

	if tenantID != "" {
		if rp, rErr := client.ListRooms(ctx, tenantID, 50, ""); rErr == nil {
			rooms = rp.Items
		}
		if act, aErr := client.GetRoomActivity(ctx, tenantID); aErr == nil {
			for _, rid := range act.RunningRoomIDs {
				if rid == "" {
					continue
				}
				runningRoomSet[rid] = true
				if runs, rsErr := client.ListRoomRunStatuses(ctx, rid); rsErr == nil {
					activeRuns = append(activeRuns, runs...)
				}
			}
		}
		if ap, aErr := client.ListActors(ctx, tenantID, 100, ""); aErr == nil {
			actors = ap.Items
		}
		if ag, aErr := client.ListTenantAgents(ctx, tenantID); aErr == nil {
			agents = ag.Items
		}
		if av, aErr := client.ListTenantAgentAvailability(ctx, tenantID); aErr == nil {
			avail = av
		}
		if sk, sErr := client.ListSkillManifests(ctx, tenantID); sErr == nil {
			skills = sk.Items
		}
		if tp, tErr := client.ListAgentTemplates(ctx, tenantID); tErr == nil {
			templates = tp
		}
		if wp, wErr := client.ListWorkItems(ctx, tenantID, "", 50, ""); wErr == nil {
			workItems = wp.Items
		}
		if np, nErr := client.ListPocketNotes(ctx, tenantID, 14, ""); nErr == nil {
			notes = np.Items
		}
		if cs, cErr := client.ListLocalComputers(ctx, tenantID); cErr == nil {
			computers = cs
			if len(cs) > 0 {
				if lm, lmErr := client.GetLocalComputerModels(ctx, tenantID, cs[0].ComputerID); lmErr == nil {
					localModels = &lm
				}
				if ms, msErr := client.GetLocalComputerModelSource(ctx, tenantID, cs[0].ComputerID); msErr == nil {
					modelSource = &ms
				}
			}
		}
		if len(rooms) > 0 {
			if rts, rtErr := client.ListRoomRoutines(ctx, rooms[0].ID); rtErr == nil {
				routines = rts
			}
		}
	}
	if dp, dErr := client.ListLibraryDocuments(ctx, 50, ""); dErr == nil {
		docs = dp.Items
	}

	// Scan latest messages for active rooms so Pending Decisions Inbox has live unresolved cards immediately.
	scannedMsgs := map[string][]api.Message{}
	for i, rm := range rooms {
		if i >= 12 {
			break
		}
		if mp, mErr := client.ListMessages(ctx, rm.ID, 30, ""); mErr == nil {
			scannedMsgs[rm.ID] = mp.Items
		}
	}

	s.mu.Lock()
	s.identity = &me
	s.tenants = tenants
	s.tenantID = tenantID
	s.companionStatus = compStatus
	s.rooms = rooms
	s.activeRuns = activeRuns
	s.actors = actors
	s.agents = agents
	s.agentAvailability = make(map[string]api.TenantAgentAvailabilitySnapshot, len(avail))
	for _, av := range avail {
		s.agentAvailability[av.ActorID] = av
	}
	s.skillManifests = skills
	s.agentTemplates = templates
	s.workItems = workItems
	s.routines = routines
	s.pocketNotes = notes
	s.documents = docs
	s.computers = computers
	s.localModels = localModels
	s.modelSource = modelSource
	s.workingRoomIDs = make(map[string]bool)
	for rid := range runningRoomSet {
		s.workingRoomIDs[rid] = true
	}
	for _, run := range activeRuns {
		if run.Status == "active" && !run.Replied {
			s.workingRoomIDs[run.RoomID] = true
		}
	}
	for roomID, msgs := range scannedMsgs {
		s.roomMessages[roomID] = msgs
	}
	s.rebuildPendingDecisionsLocked()
	s.rttMs = int(client.LastRTT().Milliseconds())
	s.offlineViewingCache = false
	s.transientError = ""
	cs := s.cacheStore
	stream := s.stream
	s.mu.Unlock()

	if stream != nil {
		for _, r := range rooms {
			stream.SetRoomCursor(r.ID, r.LatestRoomSeq)
		}
	}
	if cs != nil {
		_ = cs.UpsertRooms(ctx, rooms)
		_ = cs.UpsertWorkItems(ctx, workItems)
		_ = cs.UpsertRoutines(ctx, routines)
		if tenantID != "" {
			_ = cs.UpsertPocketNotes(ctx, tenantID, notes)
		}
		_ = cs.UpsertDocuments(ctx, docs)
		if localModels != nil {
			_ = cs.SaveLocalModelsSnapshot(ctx, localModels.Computer.ComputerID, *localModels)
		}
		if st, err := cs.Stats(ctx); err == nil {
			s.mu.Lock()
			s.cacheStats = st
			s.mu.Unlock()
		}
	}
	s.notify()
	return nil
}

// RotateActiveToken calls POST /companion/v1/token/rotate and persists the new secret.
func (s *AppStore) RotateActiveToken(ctx context.Context) error {
	client := s.Client()
	ah, ok := s.cfg.ActiveHost()
	if client == nil || !ok || ah.Mode != config.HostModeCompanion {
		return errors.New(i18n.T("state.err.token_rotation_companion"))
	}
	resp, err := client.RotateCompanionToken(ctx)
	if err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	if err := s.cfg.SaveSecret(ah.ID, resp.Token); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	s.ClearTransientError()
	s.SetStatusMessage(i18n.T("state.toast.token_rotated"))
	return nil
}

// UnpairHost revokes the remote Companion device (best-effort) and deletes the saved profile.
func (s *AppStore) UnpairHost(ctx context.Context, hostID string) error {
	host, ok := s.cfg.Host(hostID)
	if !ok {
		return nil
	}
	if ah, hasActive := s.cfg.ActiveHost(); hasActive && ah.ID == hostID {
		if client := s.Client(); client != nil {
			if host.Mode == config.HostModeCompanion {
				_, _ = client.UnpairCompanion(ctx)
			} else {
				_ = client.Logout(ctx)
			}
		}
		s.Disconnect()
	}
	if err := s.cfg.RemoveHost(hostID); err != nil {
		s.SetTransientError(err.Error())
		return err
	}
	s.ClearTransientError()
	s.SetStatusMessage(i18n.Tf("state.toast.removed_host", map[string]any{"name": host.Name}))
	return nil
}

// DiagnosticsText builds a sanitized, shareable diagnostics summary (zero secrets).
func (s *AppStore) DiagnosticsText() string {
	snap := s.Snapshot()
	var b strings.Builder
	b.WriteString(i18n.T("state.diag.title") + "\n")
	b.WriteString("===================================\n")
	b.WriteString(i18n.Tf("state.diag.platform", map[string]any{"goos": runtime.GOOS, "goarch": runtime.GOARCH}) + "\n")
	b.WriteString(i18n.Tf("state.diag.phase", map[string]any{"phase": string(snap.Phase), "sse": string(snap.SSEState), "online": fmt.Sprintf("%v", snap.Online)}) + "\n")
	if snap.ActiveHost != nil {
		shortFP := i18n.T("common.none")
		if snap.ActiveHost.TLSFingerprint != "" {
			if sf, err := discovery.ShortFingerprint(snap.ActiveHost.TLSFingerprint); err == nil {
				shortFP = sf
			}
		}
		b.WriteString(i18n.Tf("state.diag.active_host", map[string]any{"name": snap.ActiveHost.Name, "mode": string(snap.ActiveHost.Mode)}) + "\n")
		b.WriteString(i18n.Tf("state.diag.primary_url", map[string]any{"url": snap.ActiveHost.PrimaryURL}) + "\n")
		if snap.ActiveHost.TailscaleURL != "" {
			b.WriteString(i18n.Tf("state.diag.tailscale_url", map[string]any{"url": snap.ActiveHost.TailscaleURL}) + "\n")
		}
		b.WriteString(i18n.Tf("state.diag.transport", map[string]any{
			"tls":   fmt.Sprintf("%v", snap.ActiveHost.TLS),
			"plain": fmt.Sprintf("%v", snap.ActiveHost.AllowPlainHTTP),
			"pin":   shortFP,
			"via":   snap.ActiveVia,
			"rtt":   snap.RTTMs,
		}) + "\n")
	} else {
		b.WriteString(i18n.T("state.diag.active_host_none") + "\n")
	}
	if snap.CompanionStatus != nil {
		b.WriteString(i18n.Tf("state.diag.desktop", map[string]any{
			"version": snap.CompanionStatus.DesktopVersion,
			"runtime": snap.CompanionStatus.RuntimeState,
			"daemon":  snap.CompanionStatus.DaemonConnection,
			"ops":     snap.CompanionStatus.ActiveOperations,
			"devices": snap.CompanionStatus.PairedDevicesCount,
		}) + "\n")
	}
	b.WriteString(i18n.Tf("state.diag.sse_cursors", map[string]any{"count": len(snap.StreamCursors)}) + "\n")
	b.WriteString(i18n.Tf("state.diag.sqlite_cache", map[string]any{
		"rooms":    snap.CacheStats.Rooms,
		"messages": snap.CacheStats.Messages,
		"work":     snap.CacheStats.WorkItems,
		"docs":     snap.CacheStats.Documents,
		"outbox":   snap.CacheStats.Outbox,
	}) + "\n")
	return b.String()
}

func (s *AppStore) scheduleCoalescedRefresh(ctx context.Context, gen uint64) {
	s.mu.Lock()
	if s.connGen != gen {
		s.mu.Unlock()
		return
	}
	if s.refreshRunning {
		s.refreshPending = true
		s.mu.Unlock()
		return
	}
	s.refreshRunning = true
	s.refreshPending = false
	s.mu.Unlock()

	go func() {
		for {
			if ctx.Err() != nil {
				s.mu.Lock()
				s.refreshRunning = false
				s.refreshPending = false
				s.mu.Unlock()
				return
			}
			_ = s.RefreshActiveHost(ctx)
			s.mu.Lock()
			if !s.refreshPending || s.connGen != gen {
				s.refreshRunning = false
				s.refreshPending = false
				s.mu.Unlock()
				return
			}
			s.refreshPending = false
			s.mu.Unlock()
		}
	}()
}

func (s *AppStore) startRealtime(client *api.Client, gen uint64) {
	ctx, cancel := context.WithCancel(context.Background())
	tracker := realtime.NewRunPresentationTracker(client, func(_, runID string, ev api.RuntimePresentationEvent) {
		s.appendRunPresentationEvent(runID, ev)
		s.notify()
	})
	mgr := realtime.NewStreamManager(client, realtime.StreamCallbacks{
		OnState: func(st realtime.StreamState, err error) {
			s.mu.Lock()
			if s.connGen != gen {
				s.mu.Unlock()
				return
			}
			s.sseState = st
			needHydrate := false
			switch st {
			case realtime.StateConnected:
				needHydrate = s.identity == nil || s.phase != PhaseConnected
				s.phase = PhaseConnected
				s.offlineViewingCache = false
				s.transientError = ""
			case realtime.StateReconnecting:
				s.phase = PhaseReconnecting
				if err != nil {
					s.transientError = i18n.Tf("state.toast.reconnecting_stream", map[string]any{"err": err.Error()})
				}
			case realtime.StateExpired:
				s.phase = PhaseExpired
				s.transientError = i18n.T("state.toast.session_expired")
			}
			s.mu.Unlock()
			if st == realtime.StateConnected {
				if needHydrate {
					s.scheduleCoalescedRefresh(ctx, gen)
				}
				go func() { _, _ = s.DrainMessageOutbox(ctx) }()
			}
			s.notify()
		},
		OnRoomEvent: func(ev api.RoomEventEnvelope) {
			s.handleLiveRoomEvent(ctx, ev)
			_ = tracker.HandleRoomEvent(ctx, ev)
			s.notify()
		},
		OnInvalidated: func(_ realtime.ResourceInvalidation) {
			s.scheduleCoalescedRefresh(ctx, gen)
		},
		OnResync: func(_ string) {
			s.scheduleCoalescedRefresh(ctx, gen)
		},
		OnHeartbeat: func(at time.Time) {
			s.mu.Lock()
			if s.connGen == gen {
				s.lastHB = at
			}
			s.mu.Unlock()
		},
		OnSessionExpired: func(_, message string) {
			s.mu.Lock()
			if s.connGen != gen {
				s.mu.Unlock()
				return
			}
			s.phase = PhaseExpired
			s.sseState = realtime.StateExpired
			s.transientError = i18n.Tf("state.toast.session_expired_err", map[string]any{"err": message})
			s.mu.Unlock()
			s.notify()
		},
	}, realtime.StreamOptions{})

	s.mu.Lock()
	if s.connGen != gen {
		s.mu.Unlock()
		cancel()
		return
	}
	prevCancel := s.streamCancel
	for _, r := range s.rooms {
		mgr.SetRoomCursor(r.ID, r.LatestRoomSeq)
	}
	online := s.online
	suspended := s.suspended
	s.stream = mgr
	s.streamCancel = cancel
	s.presentation = tracker
	s.mu.Unlock()
	if prevCancel != nil {
		prevCancel()
	}

	mgr.SetOnline(online)
	mgr.SetSuspended(suspended)
	go func() {
		_ = mgr.Run(ctx)
	}()
}

func (s *AppStore) openHostCache(ctx context.Context, hostID string) (*cache.Store, error) {
	s.mu.RLock()
	dataDir := s.dataDir
	s.mu.RUnlock()
	if dataDir == "" {
		return cache.Open(ctx, ":memory:")
	}
	safeName := strings.NewReplacer("/", "_", "\\", "_", ":", "_").Replace(hostID)
	dbPath := filepath.Join(dataDir, "cache", safeName+".sqlite")
	return cache.Open(ctx, dbPath)
}

func (s *AppStore) hydrateFromCache(ctx context.Context, cs *cache.Store, tenantID string) {
	rooms, _ := cs.ListRooms(ctx, tenantID)
	wis, _ := cs.ListWorkItems(ctx, tenantID)
	docs, _ := cs.ListDocuments(ctx, tenantID)
	var notes []api.PocketNote
	if tenantID != "" {
		notes, _ = cs.ListPocketNotes(ctx, tenantID)
	}
	stats, _ := cs.Stats(ctx)

	s.mu.Lock()
	if len(rooms) > 0 && len(s.rooms) == 0 {
		s.rooms = rooms
	}
	if len(wis) > 0 && len(s.workItems) == 0 {
		s.workItems = wis
	}
	if len(docs) > 0 && len(s.documents) == 0 {
		s.documents = docs
	}
	if len(notes) > 0 && len(s.pocketNotes) == 0 {
		s.pocketNotes = notes
	}
	s.cacheStats = stats
	s.mu.Unlock()
	s.notify()
}

func defaultDeviceName() string {
	host, err := os.Hostname()
	if err == nil && strings.TrimSpace(host) != "" {
		return i18n.WindowTitle(strings.TrimSpace(host))
	}
	return i18n.T("app.title")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
