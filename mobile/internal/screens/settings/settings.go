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
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
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
	OnLanguageChanged       func(config.LanguagePreference)
	OnBiometricChanged      func(bool)
	OnSignOut               func()
	OnClearCache            func(ctx context.Context) error
	OnHapticsChanged        func(bool)
	OnComposerReturnChanged func(sendOnEnter bool)
	ShowToast               func(msg string)
	ShowErrorToast          func(msg string)
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
	section       int
	scroll        [5]ui.ScrollState
	hostBusy      bool
	hostNotice    string
	hostError     string
	unpairConfirm bool

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
	ruleDismissSheet bool
	ruleDismissItem  *api.ProactiveRule

	// Profile & Insights UI state.
	acctName        string
	acctBio         string
	acctOrg         string
	acctInitialized bool
	acctSaving      bool
	acctErr         string
	acctNotice      string
	ppEditing       bool
	ppMarkdownDraft string
	ppSaving        bool
	ppErr           string
	mdOpts          markdown.Options
	insightDelSheet bool
	insightDelItem  *api.PersonalInsight

	// Integrations UI state.
	integBusyID      string
	integError       string
	integNotice      string
	grantsSheetOpen  bool
	grantsConn       *api.ExternalConnectionC2
	grantsAgents     []api.ExternalConnectionAgentAccess
	grantsBusy       bool
	connDisconnSheet bool
	connDisconnItem  *api.ExternalConnectionC2
	searchKeyInputs  map[string]*string
	sonioxKeyInput   string
	xaiKeyInput      string
	voiceKeyBusy     string

	// Security & Preferences UI state.
	hapticsEnabled     bool
	composerReturnSend bool
	clearCacheConfirm  bool
	prefsNotice        string
	prefsError         string
}

// New constructs a Settings screen controller and checks biometric availability.
func New(deps Deps) *Screen {
	s := &Screen{
		deps:            deps,
		hapticsEnabled:  true,
		searchKeyInputs: map[string]*string{},
	}
	if deps.CheckBiometrics != nil {
		go s.probeBiometrics(context.Background())
	} else {
		// Native mobile plugins panic if called before App.Run initializes the backend.
		mygo.App.WhenReady(func() {
			go s.probeBiometrics(context.Background())
		})
	}
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
		s.syncError = api.PresentError(firstErr)
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
		// On Overview, the grouped directory rows serve as single primary navigation;
		// sub-sections display a clean Town Atelier "< More · Section" back header.
		if s.section != SectionOverview || syncErr != "" {
			layout.ReadableWrap(c, layout.Of(c).ReadableMaxWidth, func() {
				ui.Column(c).FillWidth().Padding(8, 14, 6, 14).Gap(8).Shrink(0).Children(func() {
					if s.section != SectionOverview {
						secTitles := []string{
							i18n.T("tab.more"),
							i18n.T("settings.tab.rules"),
							i18n.T("settings.tab.profile"),
							i18n.T("settings.tab.connectors"),
							i18n.T("settings.tab.prefs"),
						}
						secTitle := secTitles[s.section%len(secTitles)]
						ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(10).Children(func() {
							backBtn := ui.Row(c).MinHeight(44).Padding(6, 12).Radius(999).Background(t.Surface).
								AlignItems(ui.Center).Gap(5).Shrink(0).
								Role(ui.RoleButton).Label(i18n.T("tab.more"))
							components.ApplyCardElevation(backBtn, t)
							if backBtn.Pressed() {
								backBtn.Background(t.SurfacePressed)
							}
							backBtn.Children(func() {
								theme.IconBox(c, 16, t.Text, theme.IconBack)
								ui.Text(c, i18n.T("tab.more")).FontSize(13).FontWeight(600).TextColor(t.Text).NoWrap()
							})
							if backBtn.Clicked() {
								s.section = SectionOverview
							}
							ui.Text(c, secTitle).FontSize(16).FontWeight(600).LetterSpacing(-0.2).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
						})
					}
					if syncErr != "" {
						components.ErrorInline(c, syncErr, func() {
							go s.Refresh(context.Background())
						})
					}
				})
			})
		}

		switch s.section {
		case SectionOverview:
			s.viewOverviewSection(c, loading)
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
	s.viewRuleDismissSheet(c)
	s.viewInsightDeleteSheet(c)
	s.viewAgentGrantsSheet(c)
	s.viewDisconnectConfirmSheet(c)
	s.viewClearCacheConfirmSheet(c)
}

func (s *Screen) viewOverviewSection(c *ui.Context, loading bool) {
	t := c.Theme()
	var snap state.Snapshot
	if s.deps.Store != nil {
		snap = s.deps.Store.Snapshot()
	}

	s.mu.Lock()
	activeRuleCount := 0
	shadowCount := 0
	for _, r := range s.ruleBook.Rules {
		if r.Status == "shadow" {
			shadowCount++
		} else {
			activeRuleCount++
		}
	}
	connCount := len(s.connections)
	insightCount := len(s.insights)
	s.mu.Unlock()

	m := layout.Of(c)

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SectionOverview]).Children(func() {
		layout.ReadableWrap(c, m.ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				if s.hostError != "" {
					components.StatusBanner(c, components.ToneDanger, s.hostError, i18n.T("common.dismiss"), func() {
						s.hostError = ""
					})
				}
				if s.hostNotice != "" {
					components.StatusBanner(c, components.ToneSuccess, s.hostNotice, i18n.T("common.ok"), func() {
						s.hostNotice = ""
					})
				}

				// Desktop Host Card & Switcher
				hostName := i18n.T("settings.host.none_title")
				hostSub := i18n.T("settings.host.none_subtitle")
				transportLabel := i18n.T("settings.host.disconnected")
				transportTone := components.ToneWarning
				if snap.ActiveHost != nil {
					hostName = snap.ActiveHost.Name
					hostSub = snap.ActiveHost.PrimaryURL
					switch {
					case snap.ActiveVia == "fallback" && snap.ActiveHost.TailscaleURL != "":
						transportLabel = i18n.T("settings.host.tailscale")
						transportTone = components.ToneInfo
						hostSub = snap.ActiveHost.TailscaleURL
					case snap.ActiveHost.TLS && snap.ActiveHost.TLSFingerprint != "":
						transportLabel = i18n.T("settings.host.lan_tls")
						transportTone = components.ToneSuccess
					case snap.ActiveHost.TLS:
						transportLabel = i18n.T("settings.host.direct_https")
						transportTone = components.ToneInfo
					default:
						transportLabel = i18n.T("settings.host.plain_http")
						transportTone = components.ToneWarning
					}
				} else if s.client() != nil {
					hostName = i18n.T("settings.host.connected_fallback")
					hostSub = s.client().BaseURL()
					transportLabel = i18n.T("settings.host.connected")
					transportTone = components.ToneSuccess
				}

				ex := theme.Extra(t)
				renderHostCard := func() {
					hostCard := ui.Column(c).FillWidth().Gradient(ex.HeroGradFrom, ex.HeroGradTo, 180).Radius(18).Padding(16, 16).Gap(12)
					components.ApplyCardElevation(hostCard, t)
					hostCard.Children(func() {
						ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(12).Children(func() {
							if snap.ActiveHost == nil && s.client() == nil {
								theme.IconBox(c, 44, t.Accent, theme.IconBrandMark)
							} else {
								components.AvatarBadge(c, hostName, 44)
							}
							ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
								ui.Text(c, hostName).FontSize(16.5).FontWeight(600).LetterSpacing(-0.2).TextColor(t.Text).MaxLines(1)
								ui.Text(c, hostSub).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
							})
						})

						// Suppress duplicate disconnected/SSE pills when unpaired (TopBar already shows Disconnected).
						if snap.ActiveHost != nil || s.client() != nil {
							ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
								components.StatusDotPill(c, transportLabel, transportTone)
								if snap.RTTMs > 0 {
									components.StatusPill(c, i18n.Tf("settings.host.rtt", map[string]any{"ms": fmt.Sprintf("%d", snap.RTTMs)}), components.ToneNeutral)
								}
								if snap.SSEState != "" {
									sseTone := components.ToneNeutral
									if snap.SSEState == "connected" {
										sseTone = components.ToneSuccess
									}
									components.StatusDotPill(c, i18n.Tf("conn.badge.sse_status", map[string]any{"status": i18n.SSEStatusLabel(string(snap.SSEState))}), sseTone)
								}
							})
						}

						manageBtn := components.PrimaryTouchButton(c, i18n.T("settings.host.manage_hosts"), false)
						manageBtn.FillWidth()
						if manageBtn.Clicked() && s.deps.OnOpenConnect != nil {
							s.deps.OnOpenConnect()
						}

						ui.Row(c).FillWidth().Gap(8).Children(func() {
							isCompanion := snap.ActiveHost == nil || snap.ActiveHost.Mode == config.HostModeCompanion
							if isCompanion && s.client() != nil {
								rotLbl := i18n.T("settings.host.rotate_token")
								if s.hostBusy {
									rotLbl = i18n.T("settings.host.rotating")
								}
								rotBtn := components.SecondaryTouchButton(c, rotLbl, s.hostBusy)
								rotBtn.Grow(1).Basis(0).MinHeight(38)
								if rotBtn.Clicked() {
									s.rotateTokenAsync()
								}
							}

							expBtn := components.SecondaryTouchButton(c, i18n.T("settings.host.export_diag"), false)
							expBtn.Grow(1).Basis(0).MinHeight(38)
							if expBtn.Clicked() {
								s.exportDiagnostics()
							}
						})

						if snap.ActiveHost != nil || s.client() != nil {
							components.InsetDivider(c, 0)
							signOutBtn := ui.Row(c).FillWidth().MinHeight(38).Padding(8, 12).Radius(10).
								Background(ex.DangerTint).Border(0.75, t.Danger.Alpha(0.24)).
								AlignItems(ui.Center).Justify(ui.Center).
								Role(ui.RoleButton).Label(i18n.T("settings.host.unpair_signout")).Disabled(s.hostBusy)
							if !s.hostBusy && signOutBtn.Pressed() {
								signOutBtn.Background(t.Danger.Alpha(0.18)).Scale(0.985, 0.985)
							}
							signOutBtn.Children(func() {
								ui.Text(c, i18n.T("settings.host.unpair_signout")).FontSize(13).FontWeight(600).TextColor(t.Danger).NoWrap()
							})
							if signOutBtn.Clicked() {
								s.unpairConfirm = true
							}
						}
					})
				}

				renderAppearanceCard := func() {
					// Quick-access Appearance & Language card (works offline & before pairing).
					components.SectionCard(c, i18n.T("appearance.title"), i18n.T("appearance.quick_subtitle"), nil, func() {
						components.ThemeSegmentedSelector(c, snap.Prefs.Theme, func(next config.ThemePreference) {
							if s.deps.Store != nil {
								_ = s.deps.Store.SetThemePreference(next)
							}
							if s.deps.OnThemeChanged != nil {
								s.deps.OnThemeChanged(next)
							}
						})
						components.LanguageSegmentedSelector(c, snap.Prefs.Language, func(next config.LanguagePreference) {
							if s.deps.Store != nil {
								_ = s.deps.Store.SetLanguagePreference(next)
							}
							if s.deps.OnLanguageChanged != nil {
								s.deps.OnLanguageChanged(next)
							}
						})
					})
				}

				layout.TwoPaneRow(c, m.GridColumns >= 2, 12, renderHostCard, renderAppearanceCard)

				// Editorial Quick Hub Directory with sculpted icon tiles
				components.SectionEyebrow(c, i18n.T("settings.nav.title"), func() {
					refLbl := i18n.T("common.sync")
					if loading {
						refLbl = i18n.T("common.syncing")
					}
					refBtn := components.CompactSecondaryButton(c, refLbl, theme.IconRefresh, loading)
					refBtn.MinHeight(30)
					if refBtn.Clicked() {
						go s.Refresh(context.Background())
					}
				})
				components.GroupedCard(c, func() {
					s.hubRow(c, theme.IconRule, theme.Nature.Acorn,
						i18n.T("settings.nav.rules_title"),
						i18n.Tf("settings.nav.rules_sub", map[string]any{"active": activeRuleCount, "shadow": shadowCount}), func() {
							s.section = SectionRules
						})
					components.InsetDivider(c, 60)
					s.hubRow(c, theme.IconUser, theme.Nature.Lake,
						i18n.T("settings.nav.profile_title"),
						i18n.Tf("settings.nav.profile_sub", map[string]any{"count": insightCount}), func() {
							s.section = SectionProfile
						})
					components.InsetDivider(c, 60)
					s.hubRow(c, theme.IconPlug, theme.Nature.Bluebell,
						i18n.T("settings.nav.connectors_title"),
						i18n.Tf("settings.nav.connectors_sub", map[string]any{"count": connCount}), func() {
							s.section = SectionIntegrations
						})
					components.InsetDivider(c, 60)
					s.hubRow(c, theme.IconSliders, theme.Nature.Lavender,
						i18n.T("settings.nav.prefs_title"),
						i18n.T("settings.nav.prefs_sub"), func() {
							s.section = SectionPreferences
						})
				})
			})
		})
	})
}

func (s *Screen) hubRow(c *ui.Context, icon theme.IconFunc, accent ui.Color, title, sub string, onTap func()) {
	t := c.Theme()
	ex := theme.Extra(t)
	row := ui.Row(c).FillWidth().MinHeight(58).Padding(11, 14).Gap(12).
		Background(t.Surface).AlignItems(ui.Center).
		Role(ui.RoleButton).Label(title)
	if row.Pressed() {
		row.Background(t.SurfacePressed)
	}
	row.Children(func() {
		ui.Row(c).Size(34, 34).Radius(10).Background(accent.Alpha(0.14)).
			AlignItems(ui.Center).Justify(ui.Center).Shrink(0).Children(func() {
			theme.IconBox(c, 17, accent, icon)
		})
		ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
			ui.Text(c, title).FontSize(14.5).FontWeight(600).TextColor(t.Text).MaxLines(1)
			if sub != "" {
				ui.Text(c, sub).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
			}
		})
		theme.IconBox(c, 16, ex.TextSubtle, theme.IconChevronRight)
	})
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
			err = errors.New(i18n.T("settings.err.no_active_host"))
		}
		s.enqueueUI(func() {
			s.hostBusy = false
			if err != nil {
				s.hostError = api.PresentError(err)
				return
			}
			s.hostNotice = i18n.T("state.toast.token_rotated")
			s.toast(i18n.T("settings.toast.token_rotated"))
		})
	}()
}

func (s *Screen) exportDiagnostics() {
	diag := i18n.T("settings.diag.header") + "\n"
	if s.deps.Store != nil {
		diag = s.deps.Store.DiagnosticsText()
	} else if c := s.client(); c != nil {
		diag += i18n.Tf("settings.diag.endpoint", map[string]any{"url": c.BaseURL(), "ms": fmt.Sprintf("%d", c.LastRTT().Milliseconds())}) + "\n"
	}
	go func() {
		err := s.share(mygo.ShareOptions{Text: diag})
		s.enqueueUI(func() {
			if errors.Is(err, errors.ErrUnsupported) {
				s.hostNotice = i18n.T("settings.diag.preview_ready")
			} else if err != nil && !errors.Is(err, mygo.ErrCanceled) {
				s.hostError = api.PresentError(err)
			} else if err == nil {
				s.hostNotice = i18n.T("settings.toast.diag_exported")
			}
		})
	}()
}

func (s *Screen) viewUnpairConfirm(c *ui.Context) {
	components.ActionSheet(c, &s.unpairConfirm, mobile.ActionSheetOptions{
		Title:   i18n.T("settings.signout.title"),
		Message: i18n.T("settings.signout.body"),
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("settings.signout.confirm"),
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
			s.hostNotice = i18n.T("settings.toast.signed_out")
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

func (s *Screen) errorToast(msg string) {
	if strings.TrimSpace(msg) == "" {
		return
	}
	if s.deps.ShowErrorToast != nil {
		s.deps.ShowErrorToast(msg)
		return
	}
	s.toast(msg)
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
