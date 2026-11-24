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
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/discovery"
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
	ActiveTab       int
	Hosts           []config.HostProfile
	ActiveHost      *config.HostProfile
	Prefs           config.AppPreferences
	Phase           ConnectionPhase
	SSEState        realtime.StreamState
	Online          bool
	Suspended       bool
	BiometricLocked bool
	RTTMs           int
	ActiveVia       string
	LastHeartbeat   time.Time
	StatusMessage   string
	TransientError  string
	Discovered      []discovery.DiscoveredHost
	CompanionStatus *api.CompanionStatus
	Identity        *api.CurrentIdentity
	Tenants         []api.Tenant
	TenantID        string
	Rooms           []api.RoomListItem
	ActiveRuns      []api.RoomRunStatus
	WorkItems       []api.WorkItem
	Routines        []api.Routine
	PocketNotes     []api.PocketNote
	Documents       []api.Document
	Computers       []api.LocalComputer
	LocalModels     *api.LocalModelsView
	CacheStats      cache.CacheStats
	StreamCursors   map[string]int64
	PendingPairURI  string
}

// Options configures AppStore construction.
type Options struct {
	ConfigStore *config.Store
	DataDir     string
	OnNotify    func() // invokes Window.Update / redraw on state mutation
}

// AppStore owns all runtime services and thread-safe application state.
type AppStore struct {
	cfg      *config.Store
	dataDir  string
	onNotify func()

	// UI routers (one independent navigation stack per tab, read/mutated on UI thread).
	Routers [5]*ui.Router

	mu              sync.RWMutex
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

	client          *api.Client
	stream          *realtime.StreamManager
	streamCancel    context.CancelFunc
	presentation    *realtime.RunPresentationTracker
	cacheStore      *cache.Store
	browser         *discovery.Browser
	browserCancel   context.CancelFunc
	discovered      []discovery.DiscoveredHost
	companionStatus *api.CompanionStatus
	identity        *api.CurrentIdentity
	tenants         []api.Tenant
	tenantID        string
	rooms           []api.RoomListItem
	activeRuns      []api.RoomRunStatus
	workItems       []api.WorkItem
	routines        []api.Routine
	pocketNotes     []api.PocketNote
	documents       []api.Document
	computers       []api.LocalComputer
	localModels     *api.LocalModelsView
	cacheStats      cache.CacheStats
}

// NewAppStore initializes an AppStore with 5 independent per-tab routers.
func NewAppStore(opts Options) *AppStore {
	cfgStore := opts.ConfigStore
	if cfgStore == nil {
		cfgStore = config.NewStore(nil, nil)
	}
	prefs := cfgStore.Preferences()
	s := &AppStore{
		cfg:             cfgStore,
		dataDir:         opts.DataDir,
		onNotify:        opts.OnNotify,
		phase:           PhaseDisconnected,
		sseState:        realtime.StateDisconnected,
		online:          true,
		biometricLocked: prefs.BiometricLock,
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

	return Snapshot{
		ActiveTab:       s.activeTab,
		Hosts:           hosts,
		ActiveHost:      activeHost,
		Prefs:           prefs,
		Phase:           s.phase,
		SSEState:        s.sseState,
		Online:          s.online,
		Suspended:       s.suspended,
		BiometricLocked: s.biometricLocked,
		RTTMs:           s.rttMs,
		ActiveVia:       s.activeVia,
		LastHeartbeat:   s.lastHB,
		StatusMessage:   s.statusMessage,
		TransientError:  s.transientError,
		Discovered:      append([]discovery.DiscoveredHost(nil), s.discovered...),
		CompanionStatus: compCopy,
		Identity:        idCopy,
		Tenants:         append([]api.Tenant(nil), s.tenants...),
		TenantID:        s.tenantID,
		Rooms:           append([]api.RoomListItem(nil), s.rooms...),
		ActiveRuns:      append([]api.RoomRunStatus(nil), s.activeRuns...),
		WorkItems:       append([]api.WorkItem(nil), s.workItems...),
		Routines:        append([]api.Routine(nil), s.routines...),
		PocketNotes:     append([]api.PocketNote(nil), s.pocketNotes...),
		Documents:       append([]api.Document(nil), s.documents...),
		Computers:       append([]api.LocalComputer(nil), s.computers...),
		LocalModels:     lmCopy,
		CacheStats:      s.cacheStats,
		StreamCursors:   cursors,
		PendingPairURI:  s.pendingPairURI,
	}
}

// Client returns the active *api.Client (nil when disconnected).
func (s *AppStore) Client() *api.Client {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.client
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

// SetPendingPairURI records an incoming linger://pair?... deep link and routes to Connection Hub.
func (s *AppStore) SetPendingPairURI(uri string) {
	s.mu.Lock()
	s.pendingPairURI = strings.TrimSpace(uri)
	s.activeTab = TabMore
	s.mu.Unlock()
	s.Routers[TabMore].Replace("/more/connect")
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

// UpdatePreferences persists new AppPreferences.
func (s *AppStore) UpdatePreferences(prefs config.AppPreferences) error {
	if err := s.cfg.SetPreferences(prefs); err != nil {
		return err
	}
	s.notify()
	return nil
}

// SetThemePreference updates the Town Light/Dark/System theme preference.
func (s *AppStore) SetThemePreference(pref config.ThemePreference) error {
	p := s.cfg.Preferences()
	p.Theme = pref
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
	if online {
		s.transientError = ""
	}
	s.mu.Unlock()
	if stream != nil {
		stream.SetOnline(online)
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
		err := errors.New("plain HTTP pairing requires explicit opt-in")
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
		err := errors.New("pairing PIN must be 6 digits")
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
		err := errors.New("server did not return a teamhub_session cookie")
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
	s.SetStatusMessage("Connected to " + profile.Name)
	return s.ConnectHost(ctx, profile.ID)
}

// ConnectHost activates a saved host, opens its SQLite cache, hydrates offline
// rows, probes LAN->Tailscale, fetches live data, and starts the single SSE engine.
func (s *AppStore) ConnectHost(ctx context.Context, hostID string) error {
	profile, ok := s.cfg.Host(hostID)
	if !ok {
		return fmt.Errorf("state: host %q not found", hostID)
	}
	token, err := s.cfg.LoadSecret(hostID)
	if err != nil {
		s.SetTransientError("Missing credentials for " + profile.Name + "; pair or sign in again.")
		return err
	}

	s.Disconnect()
	_ = s.cfg.SetActiveHost(hostID)

	s.mu.Lock()
	s.phase = PhaseConnecting
	s.transientError = ""
	s.mu.Unlock()
	s.notify()

	// Open per-host SQLite cache and hydrate offline snapshot immediately.
	cacheStore, cacheErr := s.openHostCache(ctx, hostID)
	if cacheErr == nil {
		s.mu.Lock()
		s.cacheStore = cacheStore
		s.mu.Unlock()
		s.hydrateFromCache(ctx, cacheStore, profile.TenantID)
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
		s.mu.Lock()
		s.phase = PhaseDisconnected
		s.transientError = err.Error()
		s.mu.Unlock()
		s.notify()
		return err
	}

	// Probe LAN -> Tailscale failover when fallback exists.
	if profile.TailscaleURL != "" {
		if res, probeErr := client.ProbeAndSelectEndpoint(ctx, discovery.DefaultLANProbeTimeout); probeErr == nil {
			s.mu.Lock()
			s.activeVia = res.Target.Via
			s.rttMs = int(res.RTT.Milliseconds())
			s.mu.Unlock()
		}
	}

	s.mu.Lock()
	s.client = client
	s.mu.Unlock()

	if err := s.RefreshActiveHost(ctx); err != nil {
		if errors.Is(err, api.ErrUnauthorized) {
			s.mu.Lock()
			s.phase = PhaseExpired
			s.transientError = "Session expired or device revoked. Pair or sign in again."
			s.mu.Unlock()
			s.notify()
			return err
		}
		s.mu.Lock()
		s.phase = PhaseReconnecting
		s.transientError = err.Error()
		s.mu.Unlock()
		s.notify()
		return err
	}

	// Start single /v0/events SSE engine.
	s.startRealtime(client)

	profile.LastConnectedAt = time.Now().UTC()
	profile.LastRTTMs = int(client.LastRTT().Milliseconds())
	if tid := s.Snapshot().TenantID; tid != "" {
		profile.TenantID = tid
	}
	_ = s.cfg.UpsertHost(profile)

	s.mu.Lock()
	s.phase = PhaseConnected
	s.rttMs = profile.LastRTTMs
	s.activeVia = client.ActiveVia()
	s.transientError = ""
	s.mu.Unlock()
	s.notify()
	return nil
}

// Disconnect stops SSE, closes the SQLite cache, and clears active runtime handles.
func (s *AppStore) Disconnect() {
	s.mu.Lock()
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
		return errors.New("state: not connected")
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
	var workItems []api.WorkItem
	var routines []api.Routine
	var notes []api.PocketNote
	var docs []api.Document
	var computers []api.LocalComputer
	var localModels *api.LocalModelsView

	if tenantID != "" {
		if rp, rErr := client.ListRooms(ctx, tenantID, 50, ""); rErr == nil {
			rooms = rp.Items
		}
		if act, aErr := client.GetRoomActivity(ctx, tenantID); aErr == nil {
			for _, item := range act.Items {
				activeRuns = append(activeRuns, item.ActiveRuns...)
			}
			for _, item := range act.Rooms {
				activeRuns = append(activeRuns, item.ActiveRuns...)
			}
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

	s.mu.Lock()
	s.identity = &me
	s.tenants = tenants
	s.tenantID = tenantID
	s.companionStatus = compStatus
	s.rooms = rooms
	s.activeRuns = activeRuns
	s.workItems = workItems
	s.routines = routines
	s.pocketNotes = notes
	s.documents = docs
	s.computers = computers
	s.localModels = localModels
	s.rttMs = int(client.LastRTT().Milliseconds())
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
		return errors.New("token rotation requires an active Companion connection")
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
	s.SetStatusMessage("Device token rotated")
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
	s.SetStatusMessage("Removed " + host.Name)
	return nil
}

// DiagnosticsText builds a sanitized, shareable diagnostics summary (zero secrets).
func (s *AppStore) DiagnosticsText() string {
	snap := s.Snapshot()
	var b strings.Builder
	b.WriteString("Linger Mobile Companion Diagnostics\n")
	b.WriteString("===================================\n")
	b.WriteString(fmt.Sprintf("Platform: %s/%s\n", runtime.GOOS, runtime.GOARCH))
	b.WriteString(fmt.Sprintf("Phase: %s | SSE: %s | Online: %v\n", snap.Phase, snap.SSEState, snap.Online))
	if snap.ActiveHost != nil {
		shortFP := "none"
		if snap.ActiveHost.TLSFingerprint != "" {
			if sf, err := discovery.ShortFingerprint(snap.ActiveHost.TLSFingerprint); err == nil {
				shortFP = sf
			}
		}
		b.WriteString(fmt.Sprintf("Active Host: %s (%s)\n", snap.ActiveHost.Name, snap.ActiveHost.Mode))
		b.WriteString(fmt.Sprintf("Primary URL: %s\n", snap.ActiveHost.PrimaryURL))
		if snap.ActiveHost.TailscaleURL != "" {
			b.WriteString(fmt.Sprintf("Tailscale URL: %s\n", snap.ActiveHost.TailscaleURL))
		}
		b.WriteString(fmt.Sprintf("Transport: TLS=%v PlainHTTP=%v Pin=%s Via=%s RTT=%dms\n",
			snap.ActiveHost.TLS, snap.ActiveHost.AllowPlainHTTP, shortFP, snap.ActiveVia, snap.RTTMs))
	} else {
		b.WriteString("Active Host: none\n")
	}
	if snap.CompanionStatus != nil {
		b.WriteString(fmt.Sprintf("Desktop: v%s runtime=%s daemon=%s ops=%d devices=%d\n",
			snap.CompanionStatus.DesktopVersion, snap.CompanionStatus.RuntimeState,
			snap.CompanionStatus.DaemonConnection, snap.CompanionStatus.ActiveOperations,
			snap.CompanionStatus.PairedDevicesCount))
	}
	b.WriteString(fmt.Sprintf("SSE Cursors: %d tracked rooms\n", len(snap.StreamCursors)))
	b.WriteString(fmt.Sprintf("SQLite Cache: rooms=%d messages=%d work_items=%d docs=%d outbox=%d\n",
		snap.CacheStats.Rooms, snap.CacheStats.Messages, snap.CacheStats.WorkItems,
		snap.CacheStats.Documents, snap.CacheStats.Outbox))
	return b.String()
}

func (s *AppStore) startRealtime(client *api.Client) {
	ctx, cancel := context.WithCancel(context.Background())
	tracker := realtime.NewRunPresentationTracker(client, func(_, _ string, _ api.RuntimePresentationEvent) {
		s.notify()
	})
	mgr := realtime.NewStreamManager(client, realtime.StreamCallbacks{
		OnState: func(st realtime.StreamState, err error) {
			s.mu.Lock()
			s.sseState = st
			switch st {
			case realtime.StateConnected:
				s.phase = PhaseConnected
				s.transientError = ""
			case realtime.StateReconnecting:
				s.phase = PhaseReconnecting
				if err != nil {
					s.transientError = "Reconnecting live stream: " + err.Error()
				}
			case realtime.StateExpired:
				s.phase = PhaseExpired
				s.transientError = "Session expired. Please reconnect."
			}
			s.mu.Unlock()
			s.notify()
		},
		OnRoomEvent: func(ev api.RoomEventEnvelope) {
			_ = tracker.HandleRoomEvent(ctx, ev)
			s.notify()
		},
		OnInvalidated: func(_ realtime.ResourceInvalidation) {
			go func() { _ = s.RefreshActiveHost(ctx) }()
		},
		OnResync: func(_ string) {
			go func() { _ = s.RefreshActiveHost(ctx) }()
		},
		OnHeartbeat: func(at time.Time) {
			s.mu.Lock()
			s.lastHB = at
			s.mu.Unlock()
		},
		OnSessionExpired: func(_, message string) {
			s.mu.Lock()
			s.phase = PhaseExpired
			s.sseState = realtime.StateExpired
			s.transientError = "Session expired: " + message
			s.mu.Unlock()
			s.notify()
		},
	}, realtime.StreamOptions{})

	s.mu.Lock()
	for _, r := range s.rooms {
		mgr.SetRoomCursor(r.ID, r.LatestRoomSeq)
	}
	online := s.online
	suspended := s.suspended
	s.stream = mgr
	s.streamCancel = cancel
	s.presentation = tracker
	s.mu.Unlock()

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
		return "Linger Mobile (" + strings.TrimSpace(host) + ")"
	}
	return "Linger Mobile"
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
