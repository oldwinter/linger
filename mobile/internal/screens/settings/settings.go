// Package settings implements Tab 5 (More): Desktop Host Card & Switcher,
// My Rules & Shadow Rule Review, Account/Personal Profile & Insights,
// External Connectors/Web Search/Voice Keys, and Security & App Preferences.
package settings

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/biometrics"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/state"
)

// Section indices for Tab 5.
const (
	SectionOverview     = 0
	SectionRules        = 1
	SectionProfile      = 2
	SectionIntegrations = 3
	SectionPreferences  = 4
)

// Deps supplies host services, platform checks, and shell callbacks for Settings.
type Deps struct {
	Store                   *state.AppStore
	Client                  *api.Client
	Cache                   *cache.Store
	TenantID                string
	OnOpenRoom              func(roomID string)
	OnOpenConnect           func()
	OnThemeChanged          func(config.ThemePreference)
	OnBiometricChanged      func(bool)
	OnSignOut               func()
	OnClearCache            func(ctx context.Context) error
	OnHapticsChanged        func(bool)
	OnComposerReturnChanged func(sendOnEnter bool)
	ShowToast               func(msg string)
	OnNotify                func()
	CheckBiometrics         func(ctx context.Context) (biometrics.Kind, error)
	Share                   func(mygo.ShareOptions) error
}

// Screen owns state and rendering for Tab 5 (More / Settings).
type Screen struct {
	deps Deps

	mu              sync.Mutex
	pending         []func()
	loading         bool
	syncError       string
	ruleBook        api.ProactiveRuleBookC2
	accountProfile  *api.AccountProfile
	personalProfile *api.PersonalProfileC2
	insights        []api.PersonalInsight
	externalApps    api.ExternalAppList
	connections     []api.ExternalConnectionC2
	webSearch       api.WebSearchBackendList
	voicePolicy     *api.VoiceMediaPolicyC2
	cacheStats      cache.CacheStats
	bioChecked      bool
	bioKind         biometrics.Kind
	bioSupported    bool

	// UI-thread-only state.
	section         int
	scroll          [5]ui.ScrollState
	hostBusy        bool
	hostNotice      string
	hostError       string
	unpairConfirm   bool

	// Rules UI state.
	ruleBusyID       string
	ruleError        string
	ruleEditOpen     bool
	ruleEditID       string
	ruleEditText     string
	ruleEditBusy     bool
	ruleEditErr      string
	ruleMandateSheet bool
	ruleMandateItem  *api.ProactiveRule
	ruleDeleteSheet  bool
	ruleDeleteItem   *api.ProactiveRule

	// Profile & Insights UI state.
	acctName          string
	acctBio           string
	acctOrg           string
	acctInitialized   bool
	acctSaving        bool
	acctErr           string
	acctNotice        string
	ppEditing         bool
	ppMarkdownDraft   string
	ppSaving          bool
	ppErr             string
	mdOpts            markdown.Options
	insightDelSheet   bool
	insightDelItem    *api.PersonalInsight

	// Integrations UI state.
	integBusyID       string
	integError        string
	integNotice       string
	grantsSheetOpen   bool
	grantsConn        *api.ExternalConnectionC2
	grantsAgents      []api.ExternalConnectionAgentAccess
	grantsBusy        bool
	connDisconnSheet  bool
	connDisconnItem   *api.ExternalConnectionC2
	searchKeyInputs   map[string]*string
	sonioxKeyInput    string
	xaiKeyInput       string
	voiceKeyBusy      string

	// Security & Preferences UI state.
	hapticsEnabled     bool
	composerReturnSend bool
	clearCacheConfirm  bool
	prefsNotice        string
}

// New constructs a Settings screen controller and checks biometric availability.
func New(deps Deps) *Screen {
	s := &Screen{
		deps:            deps,
		hapticsEnabled:  true,
		searchKeyInputs: map[string]*string{},
	}
	go s.probeBiometrics(context.Background())
	return s
}

// SelectSection switches between Overview (0), My Rules (1), Profile (2), Connectors (3), and Prefs (4).
func (s *Screen) SelectSection(idx int) {
	if idx < SectionOverview || idx > SectionPreferences {
		return
	}
	s.enqueueUI(func() {
		s.section = idx
	})
}

// Refresh fetches Proactive Rules, Profiles, Insights, External Connections,
// Web Search backends, Voice Media Policy, and SQLite Cache stats.
func (s *Screen) Refresh(ctx context.Context) {
	go s.probeBiometrics(ctx)
	s.refreshCacheStats(ctx)

	client := s.client()
	tenantID := s.tenantID()
	if client == nil {
		return
	}

	s.mu.Lock()
	s.loading = true
	s.syncError = ""
	s.mu.Unlock()
	s.notify()

	var firstErr error
	var book api.ProactiveRuleBookC2
	var acct api.AccountProfile
	var hasAcct bool
	var pp api.PersonalProfileC2
	var hasPP bool
	var insights []api.PersonalInsight
	var vp api.VoiceMediaPolicyC2
	var hasVP bool

	if tenantID != "" {
		if b, err := client.ListProactiveRulesC2(ctx, tenantID); err == nil {
			book = b
		} else {
			firstErr = err
		}
		if ap, err := client.GetAccountProfile(ctx, tenantID); err == nil {
			acct = ap
			hasAcct = true
		}
		if p, err := client.GetPersonalProfileC2(ctx, tenantID); err == nil {
			pp = p
			hasPP = true
		}
		if ins, err := client.ListPersonalInsights(ctx, tenantID); err == nil {
			insights = ins
		}
		if pol, err := client.GetVoiceMediaPolicyC2(ctx, tenantID); err == nil {
			vp = pol
			hasVP = true
		}
	}

	extApps, _ := client.ListExternalApps(ctx)
	conns, _ := client.ListExternalConnectionsC2(ctx)
	ws, _ := client.ListWebSearchBackends(ctx)

	s.mu.Lock()
	s.loading = false
	if len(book.Rules) > 0 || book.Version > 0 {
		s.ruleBook = book
	}
	if hasAcct {
		cp := acct
		s.accountProfile = &cp
	}
	if hasPP {
		cp := pp
		s.personalProfile = &cp
	}
	if insights != nil {
		s.insights = insights
	}
	s.externalApps = extApps
	if conns != nil {
		s.connections = conns
	}
	s.webSearch = ws
	if hasVP {
		cp := vp
		s.voicePolicy = &cp
	}
	if firstErr != nil {
		s.syncError = firstErr.Error()
	}
	s.mu.Unlock()

	if hasAcct {
		s.enqueueUI(func() {
			if !s.acctInitialized {
				s.acctName = acct.Name
				s.acctBio = acct.Bio
				s.acctOrg = acct.Organization
				s.acctInitialized = true
			}
		})
	}
	if hasPP && pp.Current != nil {
		md := pp.Current.Markdown
		s.enqueueUI(func() {
			if !s.ppEditing {
				s.ppMarkdownDraft = md
			}
		})
	}
	s.notify()
}

// View renders Tab 5 (More / Settings).
func (s *Screen) View(c *ui.Context) {
	s.drainPending()
	t := c.Theme()

	s.mu.Lock()
	loading := s.loading
	syncErr := s.syncError
	s.mu.Unlock()

	ui.Column(c).Fill().Background(t.Background).Children(func() {
		ui.Column(c).FillWidth().Padding(10, 14, 8, 14).Gap(8).Shrink(0).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				ui.Column(c).Grow(1).Basis(0).Children(func() {
					components.SegmentedControl(c, &s.section, "Overview", "My Rules", "Profile", "Connectors", "Prefs")
				})
				refLbl := "Sync"
				if loading {
					refLbl = "..."
				}
				refBtn := components.SecondaryTouchButton(c, refLbl, loading)
				if refBtn.Clicked() {
					go s.Refresh(context.Background())
				}
			})
			if syncErr != "" {
				components.ErrorInline(c, syncErr, func() {
					go s.Refresh(context.Background())
				})
			}
		})
		ui.Divider(c)

		switch s.section {
		case SectionOverview:
			s.viewOverviewSection(c)
		case SectionRules:
			s.viewRulesSection(c)
		case SectionProfile:
			s.viewProfileSection(c)
		case SectionIntegrations:
			s.viewIntegrationsSection(c)
		case SectionPreferences:
			s.viewPreferencesSection(c)
		}
	})

	// Modal sheets & confirmation action sheets.
	s.viewUnpairConfirm(c)
	s.viewRuleEditSheet(c)
	s.viewRuleMandateSheet(c)
	s.viewRuleDeleteSheet(c)
	s.viewInsightDeleteSheet(c)
	s.viewAgentGrantsSheet(c)
	s.viewDisconnectConfirmSheet(c)
	s.viewClearCacheConfirmSheet(c)
}

func (s *Screen) viewOverviewSection(c *ui.Context) {
	t := c.Theme()
	var snap state.Snapshot
	if s.deps.Store != nil {
		snap = s.deps.Store.Snapshot()
	}

	s.mu.Lock()
	ruleCount := len(s.ruleBook.Rules)
	shadowCount := 0
	for _, r := range s.ruleBook.Rules {
		if r.Status == "shadow" {
			shadowCount++
		}
	}
	connCount := len(s.connections)
	insightCount := len(s.insights)
	s.mu.Unlock()

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SectionOverview]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
			if s.hostError != "" {
				components.StatusBanner(c, components.ToneDanger, s.hostError, "Dismiss", func() {
					s.hostError = ""
				})
			}
			if s.hostNotice != "" {
				components.StatusBanner(c, components.ToneSuccess, s.hostNotice, "OK", func() {
					s.hostNotice = ""
				})
			}

			// Desktop Host Card & Switcher
			hostName := "No Desktop Host Connected"
			hostSub := "Pair Linger Desktop or sign in to TeamHub"
			transportLabel := "Disconnected"
			transportTone := components.ToneWarning
			if snap.ActiveHost != nil {
				hostName = snap.ActiveHost.Name
				hostSub = snap.ActiveHost.PrimaryURL
				switch {
				case snap.ActiveVia == "fallback" && snap.ActiveHost.TailscaleURL != "":
					transportLabel = "Tailscale"
					transportTone = components.ToneInfo
					hostSub = snap.ActiveHost.TailscaleURL
				case snap.ActiveHost.TLS && snap.ActiveHost.TLSFingerprint != "":
					transportLabel = "LAN TLS Pinned"
					transportTone = components.ToneSuccess
				case snap.ActiveHost.TLS:
					transportLabel = "Direct HTTPS"
					transportTone = components.ToneInfo
				default:
					transportLabel = "Plaintext HTTP"
					transportTone = components.ToneWarning
				}
			} else if s.client() != nil {
				hostName = "Connected Host"
				hostSub = s.client().BaseURL()
				transportLabel = "Connected"
				transportTone = components.ToneSuccess
			}

			components.SectionCard(c, hostName, hostSub, func() {
				components.AvatarBadge(c, hostName, 40)
			}, func() {
				ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
					components.StatusPill(c, transportLabel, transportTone)
					if snap.RTTMs > 0 {
						components.StatusPill(c, fmt.Sprintf("RTT %dms", snap.RTTMs), components.ToneNeutral)
					}
					if snap.SSEState != "" {
						sseTone := components.ToneNeutral
						if snap.SSEState == "connected" {
							sseTone = components.ToneSuccess
						}
						components.StatusPill(c, "SSE "+string(snap.SSEState), sseTone)
					}
				})

				manageBtn := components.PrimaryTouchButton(c, "Manage Hosts / Pair New Desktop", false)
				manageBtn.FillWidth()
				if manageBtn.Clicked() && s.deps.OnOpenConnect != nil {
					s.deps.OnOpenConnect()
				}

				ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
					isCompanion := snap.ActiveHost == nil || snap.ActiveHost.Mode == config.HostModeCompanion
					if isCompanion && s.client() != nil {
						rotLbl := "Rotate Token"
						if s.hostBusy {
							rotLbl = "Rotating..."
						}
						rotBtn := components.SecondaryTouchButton(c, rotLbl, s.hostBusy)
						rotBtn.Grow(1).Basis(0)
						if rotBtn.Clicked() {
							s.rotateTokenAsync()
						}
					}

					expBtn := components.SecondaryTouchButton(c, "Export Diagnostics", false)
					expBtn.Grow(1).Basis(0)
					if expBtn.Clicked() {
						s.exportDiagnostics()
					}
				})

				if snap.ActiveHost != nil || s.client() != nil {
					signOutBtn := components.DangerTouchButton(c, "Unpair / Sign Out", s.hostBusy)
					signOutBtn.FillWidth()
					if signOutBtn.Clicked() {
						s.unpairConfirm = true
					}
				}
			})

			// Quick Hub Directory
			components.SectionCard(c, "Workspace & Device Settings", "Jump directly to any section", nil, func() {
				s.hubRow(c, "My Rules & Shadow Review", fmt.Sprintf("%d active/total · %d shadow", ruleCount, shadowCount), func() {
					s.section = SectionRules
				})
				ui.Divider(c)
				s.hubRow(c, "Profile & Personal Insights", components.PluralInt(insightCount, "insight", "insights")+" recorded", func() {
					s.section = SectionProfile
				})
				ui.Divider(c)
				s.hubRow(c, "Connectors, Search & Voice Keys", components.PluralInt(connCount, "external connection", "external connections"), func() {
					s.section = SectionIntegrations
				})
				ui.Divider(c)
				s.hubRow(c, "Security, Theme & Offline Cache", "Biometrics, Town theme, SQLite stats", func() {
					s.section = SectionPreferences
				})
			})
			_ = t
		})
	})
}

func (s *Screen) hubRow(c *ui.Context, title, sub string, onTap func()) {
	row := mobile.ListRow(c, mobile.RowOptions{
		Title:      title,
		Subtitle:   sub,
		Disclosure: true,
	}).Label(title)
	if row.Clicked() && onTap != nil {
		onTap()
	}
}

func (s *Screen) rotateTokenAsync() {
	if s.hostBusy {
		return
	}
	s.hostBusy = true
	s.hostError = ""
	s.hostNotice = ""
	go func() {
		var err error
		if s.deps.Store != nil && s.deps.Store.Client() != nil {
			err = s.deps.Store.RotateActiveToken(context.Background())
		} else if client := s.client(); client != nil {
			_, err = client.RotateCompanionToken(context.Background())
		} else {
			err = errors.New("no active host connection")
		}
		s.enqueueUI(func() {
			s.hostBusy = false
			if err != nil {
				s.hostError = err.Error()
				return
			}
			s.hostNotice = "Device bearer token rotated"
			s.toast("Token rotated")
		})
	}()
}

func (s *Screen) exportDiagnostics() {
	diag := "Linger Mobile Diagnostics\n"
	if s.deps.Store != nil {
		diag = s.deps.Store.DiagnosticsText()
	} else if c := s.client(); c != nil {
		diag += fmt.Sprintf("Endpoint: %s | RTT: %dms\n", c.BaseURL(), c.LastRTT().Milliseconds())
	}
	go func() {
		err := s.share(mygo.ShareOptions{Text: diag})
		s.enqueueUI(func() {
			if errors.Is(err, errors.ErrUnsupported) {
				s.hostNotice = "Diagnostics ready; system share sheet is unavailable in desktop preview."
			} else if err != nil && !errors.Is(err, mygo.ErrCanceled) {
				s.hostError = err.Error()
			} else if err == nil {
				s.hostNotice = "Diagnostics exported"
			}
		})
	}()
}

func (s *Screen) viewUnpairConfirm(c *ui.Context) {
	mobile.ActionSheet(c, &s.unpairConfirm, mobile.ActionSheetOptions{
		Title:   "Unpair or Sign Out?",
		Message: "Revokes credentials for this host on this device.",
		Cancel:  "Cancel",
	}, mobile.Action{
		Label:       "Unpair & Sign Out",
		Destructive: true,
		OnTap:       s.performSignOut,
	})
}

func (s *Screen) performSignOut() {
	s.hostBusy = true
	go func() {
		ctx := context.Background()
		if s.deps.Store != nil {
			if ah := s.deps.Store.Snapshot().ActiveHost; ah != nil {
				_ = s.deps.Store.UnpairHost(ctx, ah.ID)
			} else {
				s.deps.Store.Disconnect()
			}
		} else if c := s.client(); c != nil {
			if c.Mode() == api.AuthModeCompanion {
				_, _ = c.UnpairCompanion(ctx)
			} else {
				_ = c.Logout(ctx)
			}
		}
		s.enqueueUI(func() {
			s.hostBusy = false
			s.hostNotice = "Signed out"
			if s.deps.OnSignOut != nil {
				s.deps.OnSignOut()
			}
		})
	}()
}

func (s *Screen) enqueueUI(fn func()) {
	if fn == nil {
		return
	}
	s.mu.Lock()
	s.pending = append(s.pending, fn)
	s.mu.Unlock()
	s.notify()
}

func (s *Screen) drainPending() {
	s.mu.Lock()
	if len(s.pending) == 0 {
		s.mu.Unlock()
		return
	}
	jobs := s.pending
	s.pending = nil
	s.mu.Unlock()
	for _, fn := range jobs {
		fn()
	}
}

func (s *Screen) client() *api.Client {
	if s.deps.Client != nil {
		return s.deps.Client
	}
	if s.deps.Store != nil {
		return s.deps.Store.Client()
	}
	return nil
}

func (s *Screen) tenantID() string {
	if strings.TrimSpace(s.deps.TenantID) != "" {
		return s.deps.TenantID
	}
	if s.deps.Store != nil {
		return s.deps.Store.Snapshot().TenantID
	}
	return ""
}

func (s *Screen) notify() {
	if s.deps.OnNotify != nil {
		s.deps.OnNotify()
	}
}

func (s *Screen) toast(msg string) {
	if s.deps.ShowToast != nil && strings.TrimSpace(msg) != "" {
		s.deps.ShowToast(msg)
	}
}

func (s *Screen) share(opts mygo.ShareOptions) error {
	if s.deps.Share != nil {
		return s.deps.Share(opts)
	}
	return mygo.Share(opts)
}

func (s *Screen) checkBiometrics(ctx context.Context) (biometrics.Kind, error) {
	if s.deps.CheckBiometrics != nil {
		return s.deps.CheckBiometrics(ctx)
	}
	probeCtx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	defer cancel()
	return biometrics.Available(probeCtx)
}

func (s *Screen) probeBiometrics(ctx context.Context) {
	s.mu.Lock()
	already := s.bioChecked && s.deps.CheckBiometrics == nil
	s.mu.Unlock()
	if already {
		return
	}
	kind, err := s.checkBiometrics(ctx)
	s.mu.Lock()
	s.bioChecked = true
	if err == nil && kind != biometrics.None {
		s.bioKind = kind
		s.bioSupported = true
	} else {
		s.bioKind = biometrics.None
		s.bioSupported = false
	}
	s.mu.Unlock()
	s.notify()
}

func (s *Screen) refreshCacheStats(ctx context.Context) {
	cs := s.deps.Cache
	if cs == nil && s.deps.Store != nil {
		cs = s.deps.Store.Cache()
	}
	if cs != nil {
		if st, err := cs.Stats(ctx); err == nil {
			s.mu.Lock()
			s.cacheStats = st
			s.mu.Unlock()
		}
		return
	}
	if s.deps.Store != nil {
		st := s.deps.Store.Snapshot().CacheStats
		s.mu.Lock()
		s.cacheStats = st
		s.mu.Unlock()
	}
}
