// Package connect implements Linger Mobile's Connection Hub & Pairing screens:
// Saved Desktop Hosts (SwipeRow + ActionSheet), LAN mDNS Radar, 6-digit PIN +
// TOFU short-fingerprint verification Sheet, linger://pair?... QR/paste pairing,
// Direct Remote/Self-Hosted Login, and Connection Diagnostics with Share.
package connect

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/camera"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/discovery"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// Hub manages local form state, modals, and sheets for the Connection Hub.
type Hub struct {
	store *state.AppStore

	mu             sync.Mutex
	pending        []func()
	segment        int // 0: Hosts, 1: Pair, 2: Direct
	pairURI        string
	pairPlainHTTP  bool
	manualHostURL  string
	manualPlain    bool
	directURL      string
	directEmail    string
	directPassword string
	directPlain    bool
	busy           bool
	inlineError    string
	inlineNotice   string

	// Host ActionSheet state
	actionSheetOpen bool
	actionHost      config.HostProfile

	// PIN + TOFU verification Sheet state
	pinSheetOpen bool
	pinTargetURL string
	pinPlainHTTP bool
	pinHostName  string
	pinCode      string
	pinTOFU      *api.TOFUProbeResult
	pinProbing   bool
	pinError     string

	// Diagnostics Sheet state
	diagOpen    bool
	diagNotice  string
	swipeStates map[string]*mobile.SwipeState

	// Optional window reference for mobile camera QR scan trigger.
	win         *mygo.Window
	onOpenPrefs func()
	onConnected func(toastMsg string)
}

// NewHub constructs a Connection Hub bound to store.
func NewHub(store *state.AppStore) *Hub {
	return &Hub{
		store:       store,
		swipeStates: map[string]*mobile.SwipeState{},
	}
}

// SetOnOpenPreferences registers a navigation callback from the offline quick-switch card to Preferences.
func (h *Hub) SetOnOpenPreferences(fn func()) {
	h.mu.Lock()
	h.onOpenPrefs = fn
	h.mu.Unlock()
}

// SetOnConnected registers a navigation callback invoked after pairing or direct login succeeds.
func (h *Hub) SetOnConnected(fn func(toastMsg string)) {
	h.mu.Lock()
	h.onConnected = fn
	h.mu.Unlock()
}

// SetWindow attaches the host mygo.Window used when launching camera preview on mobile.
func (h *Hub) SetWindow(w *mygo.Window) {
	h.mu.Lock()
	h.win = w
	h.mu.Unlock()
}

// OpenDiagnostics opens the Connection Diagnostics bottom sheet.
func (h *Hub) OpenDiagnostics() {
	h.mu.Lock()
	h.diagOpen = true
	h.diagNotice = ""
	h.mu.Unlock()
}

// SelectSegment switches between Saved Hosts (0), Pair Desktop (1), and Direct Login (2).
func (h *Hub) SelectSegment(idx int) {
	if idx >= 0 && idx <= 2 {
		h.mu.Lock()
		h.segment = idx
		h.mu.Unlock()
	}
}

// PrefillPairURI fills the linger://pair?... input and focuses the Pair segment.
func (h *Hub) PrefillPairURI(raw string) {
	h.mu.Lock()
	h.pairURI = strings.TrimSpace(raw)
	h.segment = 1
	h.inlineError = ""
	h.mu.Unlock()
}

func (h *Hub) enqueueUI(fn func()) {
	h.mu.Lock()
	h.pending = append(h.pending, fn)
	h.mu.Unlock()
	h.store.Notify()
}

func (h *Hub) drainPending() {
	h.mu.Lock()
	if len(h.pending) == 0 {
		h.mu.Unlock()
		return
	}
	q := h.pending
	h.pending = nil
	h.mu.Unlock()
	for _, fn := range q {
		fn()
	}
}

// View renders the Connection Hub inside the active tab's scrollable content area.
func (h *Hub) View(c *ui.Context) {
	h.drainPending()
	snap := h.store.Snapshot()
	if pending := h.store.ConsumePendingPairURI(); pending != "" {
		h.PrefillPairURI(pending)
	}

	h.mu.Lock()
	seg := h.segment
	inlineErr := h.inlineError
	inlineNotice := h.inlineNotice
	busy := h.busy
	openPrefs := h.onOpenPrefs
	h.mu.Unlock()

	t := c.Theme()
	m := layout.Of(c)

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		layout.ReadableWrap(c, m.ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
				// Active transient error or status banners (cleared automatically on recovery).
				if snap.TransientError != "" {
					components.StatusBanner(c, components.ToneDanger, snap.TransientError, i18n.T("common.dismiss"), func() {
						h.store.ClearTransientError()
					})
				} else if inlineErr != "" {
					components.StatusBanner(c, components.ToneDanger, inlineErr, i18n.T("common.dismiss"), func() {
						h.setInlineError("")
					})
				}
				if inlineNotice != "" {
					components.StatusBanner(c, components.ToneSuccess, inlineNotice, i18n.T("common.ok"), func() {
						h.setInlineNotice("")
					})
				}

				// Active connection hero card + Offline-ready Theme & Language card (side-by-side when unfolded).
				layout.TwoPaneRow(c, m.GridColumns >= 2, 12, func() {
					h.viewConnectionOverviewCard(c, snap)
				}, func() {
					components.AppearanceQuickCard(c, snap.Prefs,
						func(pref config.ThemePreference) {
							_ = h.store.SetThemePreference(pref)
						},
						func(pref config.LanguagePreference) {
							_ = h.store.SetLanguagePreference(pref)
						},
						openPrefs,
					)
				})

				// Narrow-screen-safe segmented switcher.
				if components.SegmentedControl(c, &seg, i18n.T("connect.tab.saved"), i18n.T("connect.tab.pair"), i18n.T("connect.tab.direct")) {
					h.mu.Lock()
					h.segment = seg
					h.inlineError = ""
					h.mu.Unlock()
				}

				switch seg {
				case 0:
					h.viewSavedHosts(c, snap, busy)
				case 1:
					h.viewPairDesktop(c, snap, busy)
				case 2:
					h.viewDirectLogin(c, busy)
				}

				// Footer link to diagnostics.
				ui.Row(c).FillWidth().Justify(ui.Center).Padding(2, 0).Children(func() {
					btn := components.SecondaryTouchButton(c, i18n.T("connect.diagnostics_title"), false)
					btn.FillWidth().MinHeight(40)
					if btn.Clicked() {
						h.OpenDiagnostics()
					}
				})
				_ = t
			})
		})
	})

	// Modal sheets and action sheets rendered in overlay layer.
	h.viewHostActionSheet(c)
	h.viewPINSheet(c)
	h.viewDiagnosticsSheet(c, snap)
}

func (h *Hub) viewConnectionOverviewCard(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ex := theme.Extra(t)
	title := i18n.T("connect.no_active_host")
	hostName := ""
	subtitle := i18n.T("connect.no_active_subtitle")
	if snap.ActiveHost != nil {
		title = snap.ActiveHost.Name
		hostName = snap.ActiveHost.Name
		subtitle = snap.ActiveHost.PrimaryURL
		if snap.ActiveVia == "fallback" && snap.ActiveHost.TailscaleURL != "" {
			subtitle = snap.ActiveHost.TailscaleURL + i18n.T("connect.tailscale_failover")
		}
	}

	tlsPinned := snap.ActiveHost != nil && snap.ActiveHost.TLS && snap.ActiveHost.TLSFingerprint != ""
	plainHTTP := snap.ActiveHost != nil && !snap.ActiveHost.TLS
	connected := snap.Phase == state.PhaseConnected

	hero := ui.Column(c).FillWidth().Gradient(ex.HeroGradFrom, ex.HeroGradTo, 180).Radius(18).Padding(16, 16).Gap(12)
	components.ApplyCardElevation(hero, t)
	hero.Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(12).Children(func() {
			if snap.ActiveHost == nil {
				theme.IconBox(c, 44, t.Accent, theme.IconBrandMark)
			} else {
				components.AvatarBadge(c, hostName, 44)
			}
			ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
				ui.Text(c, title).FontSize(17).FontWeight(700).LetterSpacing(-0.25).TextColor(t.Text).MaxLines(1)
				ui.Text(c, subtitle).FontSize(12.5).LineHeight(1.35).TextColor(t.TextMuted).MaxLines(2)
			})
			if snap.ActiveHost != nil && layout.Of(c).GridColumns < 2 {
				components.ConnectionHealthChip(c, hostName, connected, tlsPinned, plainHTTP, snap.RTTMs, func() {
					h.OpenDiagnostics()
				})
			}
		})

		if snap.ActiveHost == nil {
			components.InsetDivider(c, 0)
			ui.Text(c, i18n.T("connect.zero_config_hint")).
				FontSize(12.5).LineHeight(1.4).TextColor(t.TextMuted)
			return
		}

		ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
			modeLabel := i18n.T("connect.mode.companion")
			if snap.ActiveHost.Mode == config.HostModeDirect {
				modeLabel = i18n.T("connect.mode.direct")
			}
			components.StatusPill(c, modeLabel, components.ToneInfo)
			if tlsPinned {
				if sf, err := discovery.ShortFingerprint(snap.ActiveHost.TLSFingerprint); err == nil {
					components.StatusDotPill(c, i18n.Tf("connect.pin_short", map[string]any{"pin": sf[:9]}), components.ToneSuccess)
				}
			} else if plainHTTP {
				components.StatusDotPill(c, i18n.T("connect.plain_http_opt_in"), components.ToneWarning)
			}
			sseLabel := i18n.Tf("conn.badge.sse_status", map[string]any{"status": i18n.SSEStatusLabel(string(snap.SSEState))})
			components.StatusDotPill(c, sseLabel, func() components.Tone {
				if snap.SSEState == "connected" {
					return components.ToneSuccess
				}
				return components.ToneNeutral
			}())
		})
		if snap.CompanionStatus != nil {
			ver := snap.CompanionStatus.DesktopVersion
			if ver != "" && ver[0] >= '0' && ver[0] <= '9' {
				ver = "v" + ver
			}
			ui.Text(c, i18n.Tf("connect.desktop_summary", map[string]any{
				"version":  ver,
				"runtime":  i18n.StatusLabel(snap.CompanionStatus.RuntimeState),
				"opsCount": snap.CompanionStatus.ActiveOperations,
			})).FontSize(12).TextColor(t.TextMuted)
		}
	})
}

func (h *Hub) viewSavedHosts(c *ui.Context, snap state.Snapshot, busy bool) {
	t := c.Theme()
	if len(snap.Hosts) == 0 {
		components.EmptyState(c, theme.IconHost, i18n.T("connect.no_saved_hosts"),
			i18n.T("connect.no_saved_subtitle"),
			i18n.T("connect.pair_a_desktop"), func() {
				h.SelectSegment(1)
			})
		return
	}

	components.SectionCard(c, i18n.T("connect.saved_title"), i18n.T("connect.saved_subtitle"), nil, func() {
		ui.Column(c).FillWidth().Gap(8).Children(func() {
			for _, host := range snap.Hosts {
				host := host
				isActive := snap.ActiveHost != nil && snap.ActiveHost.ID == host.ID
				sw := h.swipeStateFor(host.ID)
				mobile.SwipeRow(c.Key(host.ID), sw, mobile.SwipeOptions{
					Trailing: []mobile.SwipeAction{
						{
							Label: i18n.T("common.switch"),
							OnTap: func() {
								h.connectAsync(host.ID)
							},
						},
						{
							Label:       i18n.T("common.remove"),
							Destructive: true,
							OnTap: func() {
								h.unpairAsync(host.ID)
							},
						},
					},
				}, func() {
					ex := theme.Extra(t)
					borderCol := ex.SubtleBorder
					borderW := float32(0.75)
					if isActive {
						borderCol = t.Accent
						borderW = 1.25
					}
					row := ui.Row(c).FillWidth().MinHeight(62).Padding(12, 12).Gap(11).
						Radius(14).Background(ex.MutedBg).Border(borderW, borderCol).
						AlignItems(ui.Center).Role(ui.RoleButton).Label(i18n.Tf("connect.host_a11y", map[string]any{"name": host.Name}))

					row.Children(func() {
						components.AvatarBadge(c, host.Name, 38)
						ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
							ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
								ui.Text(c, host.Name).FontSize(14.5).FontWeight(600).TextColor(t.Text).MaxLines(1)
								if isActive {
									components.StatusDotPill(c, i18n.T("common.active"), components.ToneSuccess)
								}
							})
							ui.Text(c, host.PrimaryURL).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
							ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
								if host.TLS && host.TLSFingerprint != "" {
									components.StatusDotPill(c, i18n.T("conn.badge.tls_pinned"), components.ToneSuccess)
								} else if !host.TLS {
									components.StatusDotPill(c, i18n.T("conn.badge.plain_http"), components.ToneWarning)
								} else {
									components.StatusDotPill(c, i18n.T("conn.badge.https"), components.ToneInfo)
								}
								if host.LastRTTMs > 0 {
									components.StatusPill(c, i18n.Tf("connect.ms", map[string]any{"ms": fmt.Sprintf("%d", host.LastRTTMs)}), components.ToneNeutral)
								}
							})
						})
						theme.IconBox(c, 16, ex.TextSubtle, theme.IconChevronRight)
					})
					if row.Clicked() && !busy {
						h.mu.Lock()
						h.actionHost = host
						h.actionSheetOpen = true
						h.mu.Unlock()
					}
				})
			}
		})
	})
}

func (h *Hub) viewPairDesktop(c *ui.Context, snap state.Snapshot, busy bool) {
	t := c.Theme()

	// 1. LAN Discovery Radar (mDNS _linger._tcp.local.)
	ex := theme.Extra(t)
	foundTone := components.ToneNeutral
	if len(snap.Discovered) > 0 {
		foundTone = components.ToneBrand
	}
	components.SectionCard(c, i18n.T("connect.mdns_title"), i18n.T("connect.mdns_subtitle"), func() {
		components.StatusDotPill(c, i18n.Tf("connect.mdns_found", map[string]any{"count": len(snap.Discovered)}), foundTone)
	}, func() {
		if len(snap.Discovered) == 0 {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(10).Padding(4, 0).Children(func() {
				theme.IconBox(c, 22, t.TextMuted, theme.IconRadar)
				ui.Text(c, i18n.T("connect.mdns_empty")).
					Grow(1).Basis(0).FontSize(13).LineHeight(1.35).TextColor(t.TextMuted)
			})
		} else {
			ui.Column(c).FillWidth().Gap(8).Children(func() {
				for _, dh := range snap.Discovered {
					dh := dh
					ui.Row(c.Key(dh.HostID)).FillWidth().MinHeight(64).Padding(12, 12).Gap(11).
						Radius(14).Background(ex.MutedBg).Border(0.75, ex.SubtleBorder).AlignItems(ui.Center).Children(func() {
						ui.Row(c).Size(38, 38).Radius(11).Background(t.Surface).Border(0.75, ex.SubtleBorder).
							AlignItems(ui.Center).Justify(ui.Center).Shrink(0).Children(func() {
							theme.IconBox(c, 19, t.Text, theme.IconHost)
						})
						ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
							ui.Text(c, dh.Name).FontSize(14.5).FontWeight(600).TextColor(t.Text).MaxLines(1)
							ui.Text(c, dh.BaseURL()).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
							ui.Row(c).Wrap().Gap(5).Children(func() {
								if dh.TLS {
									components.StatusDotPill(c, i18n.T("connect.tls13"), components.ToneSuccess)
								} else {
									components.StatusDotPill(c, i18n.T("conn.badge.plain_http"), components.ToneWarning)
								}
								if dh.PairingOpen {
									components.StatusDotPill(c, i18n.T("connect.pairing_open"), components.ToneInfo)
								}
							})
						})
						pairBtn := components.CompactPrimaryButton(c, i18n.T("connect.pin_pair"), nil, busy)
						if pairBtn.Clicked() {
							// Never auto-opt-in to plain HTTP from mDNS TXT tls=0;
							// require explicit user confirmation inside the PIN sheet.
							h.openPINProbe(dh.BaseURL(), dh.Name, false)
						}
					})
				}
			})
		}

		// Manual LAN/Tailscale IP + PIN entry
		components.InsetDivider(c, 0)
		components.FormField(c, i18n.T("connect.manual_url_label"), i18n.T("connect.manual_url_placeholder"), &h.manualHostURL, false)
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
			ui.Text(c, i18n.T("connect.allow_plain_http_probe")).FontSize(12).TextColor(t.TextMuted).Grow(1).Basis(0)
			mobile.Switch(c, &h.manualPlain)
		})
		probeBtn := components.SecondaryTouchButton(c, i18n.T("connect.probe_pin_button"), busy || strings.TrimSpace(h.manualHostURL) == "")
		probeBtn.FillWidth()
		if probeBtn.Clicked() {
			h.openPINProbe(strings.TrimSpace(h.manualHostURL), strings.TrimSpace(h.manualHostURL), h.manualPlain)
		}
	})

	// 2. Scan or Paste linger://pair?... Link
	components.SectionCard(c, i18n.T("connect.qr_title"), i18n.T("connect.qr_subtitle"), nil, func() {
		components.FormField(c, i18n.T("connect.pairing_uri_label"), i18n.T("connect.pairing_uri_placeholder"), &h.pairURI, false)

		// Live parsed preview + ShortFingerprint display.
		if trimmed := strings.TrimSpace(h.pairURI); trimmed != "" {
			if parsed, err := discovery.ParsePairingURI(trimmed); err == nil {
				shortFP := i18n.T("connect.plain_http_no_pin")
				tone := components.ToneWarning
				if parsed.TLS {
					if sf, sfErr := discovery.ShortFingerprint(parsed.TLSFingerprint); sfErr == nil {
						shortFP = i18n.Tf("connect.tls_pin_value", map[string]any{"pin": sf})
						tone = components.ToneSuccess
					}
				}
				ui.Column(c).FillWidth().Padding(8, 10).Radius(8).Background(theme.Extra(t).MutedBg).Gap(4).Children(func() {
					ui.Text(c, i18n.Tf("connect.parsed_host", map[string]any{"name": parsed.Name, "url": parsed.PrimaryURL()})).FontSize(12).FontWeight(600).TextColor(t.Text)
					components.StatusPill(c, shortFP, tone)
				})
			} else {
				ui.Text(c, err.Error()).FontSize(12).TextColor(t.Danger)
			}
		}

		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
			ui.Text(c, i18n.T("connect.allow_plain_http_uri")).FontSize(12).TextColor(t.TextMuted).Grow(1).Basis(0)
			mobile.Switch(c, &h.pairPlainHTTP)
		})

		ui.Row(c).FillWidth().Gap(8).Children(func() {
			scanBtn := components.SecondaryTouchButton(c, i18n.T("connect.scan_qr"), busy)
			scanBtn.Grow(1).Basis(0)
			if scanBtn.Clicked() {
				h.triggerCameraScan()
			}
			pairBtn := components.PrimaryTouchButton(c, i18n.T("connect.pair_link"), busy || strings.TrimSpace(h.pairURI) == "")
			pairBtn.Grow(1).Basis(0)
			if pairBtn.Clicked() {
				h.pairURIAsync(h.pairURI, h.pairPlainHTTP)
			}
		})
	})
}

func (h *Hub) viewDirectLogin(c *ui.Context, busy bool) {
	t := c.Theme()
	components.SectionCard(c, i18n.T("connect.direct_title"), i18n.T("connect.direct_subtitle"), nil, func() {
		components.FormField(c, i18n.T("connect.server_url"), i18n.T("connect.server_url_placeholder"), &h.directURL, false)
		components.FormField(c, i18n.T("connect.email"), i18n.T("connect.email_placeholder"), &h.directEmail, false)
		components.FormField(c, i18n.T("connect.password"), i18n.T("connect.password_placeholder"), &h.directPassword, true)
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
			ui.Text(c, i18n.T("connect.allow_plain_http_direct")).FontSize(12).TextColor(t.TextMuted).Grow(1).Basis(0)
			mobile.Switch(c, &h.directPlain)
		})
		canSubmit := !busy && strings.TrimSpace(h.directURL) != "" && strings.TrimSpace(h.directEmail) != "" && h.directPassword != ""
		signInBtn := components.PrimaryTouchButton(c, i18n.T("connect.sign_in"), !canSubmit)
		signInBtn.FillWidth()
		if signInBtn.Clicked() {
			h.directLoginAsync(h.directURL, h.directEmail, h.directPassword, h.directPlain)
		}
	})
}

func (h *Hub) viewHostActionSheet(c *ui.Context) {
	h.mu.Lock()
	host := h.actionHost
	h.mu.Unlock()

	actions := []mobile.Action{
		{
			Label: i18n.T("connect.action.connect_switch"),
			OnTap: func() {
				h.connectAsync(host.ID)
			},
		},
		{
			Label: i18n.T("connect.action.diagnostics"),
			OnTap: func() {
				h.OpenDiagnostics()
			},
		},
	}
	if host.Mode == config.HostModeCompanion {
		actions = append(actions, mobile.Action{
			Label: i18n.T("connect.action.rotate_token"),
			OnTap: func() {
				h.rotateTokenAsync()
			},
		})
	}
	actions = append(actions, mobile.Action{
		Label:       i18n.T("connect.action.unpair_remove"),
		Destructive: true,
		OnTap: func() {
			h.unpairAsync(host.ID)
		},
	})

	mobile.ActionSheet(c, &h.actionSheetOpen, mobile.ActionSheetOptions{
		Title:   host.Name,
		Message: host.PrimaryURL,
		Cancel:  i18n.T("common.cancel"),
	}, actions...)
}

func (h *Hub) viewPINSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &h.pinSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.68, 0.90},
		Label:   i18n.T("connect.pin_sheet_a11y"),
	}, func() {
		h.mu.Lock()
		targetURL := h.pinTargetURL
		hostName := h.pinHostName
		probing := h.pinProbing
		tofu := h.pinTOFU
		pinErr := h.pinError
		plain := h.pinPlainHTTP
		busy := h.busy
		h.mu.Unlock()

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, i18n.T("connect.pin_sheet_title")).FontSize(18).Bold().TextColor(t.Text)
				ui.Text(c, fmt.Sprintf("%s (%s)", hostName, targetURL)).FontSize(13).TextColor(t.TextMuted)

				if pinErr != "" {
					components.ErrorInline(c, pinErr, func() {
						h.openPINProbe(targetURL, hostName, plain)
					})
				}

				if probing {
					components.LoadingSkeleton(c, 2)
					return
				}

				isHTTPS := strings.HasPrefix(strings.ToLower(strings.TrimSpace(targetURL)), "https://")
				if !isHTTPS && !plain {
					components.StatusBanner(c, components.ToneWarning,
						i18n.T("connect.pin_plain_http_warn"), "", nil)
					optIn := false
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Text(c, i18n.T("connect.allow_plain_http_pairing")).FontSize(12).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0)
						sw := mobile.Switch(c, &optIn)
						if sw.Changed() && optIn {
							h.openPINProbe(targetURL, hostName, true)
						}
					})
				} else if tofu != nil && tofu.ShortCode != "" {
					ui.Column(c).FillWidth().Padding(12, 12).Radius(10).Background(theme.Extra(t).OKTint).
						Border(1, t.Success.Alpha(0.35)).Gap(4).Children(func() {
						ui.Text(c, i18n.T("connect.verify_tls_title")).FontSize(12).FontWeight(600).TextColor(t.Success)
						ui.Text(c, tofu.ShortCode).FontSize(18).Bold().TextColor(t.Text)
						ui.Text(c, i18n.T("connect.verify_tls_hint")).
							FontSize(12).TextColor(t.TextMuted)
					})
				} else if plain {
					components.StatusBanner(c, components.ToneWarning,
						i18n.T("connect.plain_http_mode_hint"), "", nil)
				}

				components.FormField(c, i18n.T("connect.pin_input_label"), "123456", &h.pinCode, false)

				confirmedFP := ""
				tofuReady := false
				if isHTTPS {
					if tofu != nil && tofu.ObservedFingerprint != "" && tofu.ShortCode != "" {
						confirmedFP = tofu.ObservedFingerprint
						tofuReady = true
					}
				} else {
					tofuReady = plain && tofu != nil
				}
				canPair := !busy && tofuReady && len(strings.TrimSpace(h.pinCode)) == 6
				btn := components.PrimaryTouchButton(c, i18n.T("connect.confirm_pair"), !canPair)
				btn.FillWidth()
				if btn.Clicked() {
					h.pairPINAsync(targetURL, h.pinCode, confirmedFP, plain)
				}
			})
		})
	})
}

func (h *Hub) viewDiagnosticsSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &h.diagOpen, mobile.SheetOptions{
		Detents: []float32{0.65, 0.92},
		Label:   i18n.T("connect.diagnostics_title"),
	}, func() {
		diagText := h.store.DiagnosticsText()
		h.mu.Lock()
		notice := h.diagNotice
		h.mu.Unlock()

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
					ui.Text(c, i18n.T("connect.diagnostics_title")).FontSize(18).Bold().TextColor(t.Text)
					components.StatusPill(c, i18n.SSEStatusLabel(string(snap.Phase)), func() components.Tone {
						if snap.Phase == state.PhaseConnected {
							return components.ToneSuccess
						}
						return components.ToneWarning
					}())
				})

				if notice != "" {
					components.StatusBanner(c, components.ToneInfo, notice, "", nil)
				}

				ui.Column(c).FillWidth().Padding(12, 12).Radius(10).Background(theme.Extra(t).MutedBg).
					Border(1, t.Border).Children(func() {
					ui.Text(c, diagText).FontSize(12).TextColor(t.Text)
				})

				ui.Row(c).FillWidth().Gap(8).Children(func() {
					shareBtn := components.PrimaryTouchButton(c, i18n.T("connect.share_diagnostics"), false)
					shareBtn.Grow(1).Basis(0)
					if shareBtn.Clicked() {
						go func() {
							err := mygo.Share(mygo.ShareOptions{Text: diagText})
							var msg string
							if errors.Is(err, errors.ErrUnsupported) {
								msg = i18n.T("connect.share_unavailable")
							} else if err != nil {
								msg = i18n.Tf("connect.share_failed", map[string]any{"err": err.Error()})
							} else {
								msg = i18n.T("connect.diagnostics_shared")
							}
							h.enqueueUI(func() {
								h.mu.Lock()
								h.diagNotice = msg
								h.mu.Unlock()
							})
						}()
					}
					closeBtn := components.SecondaryTouchButton(c, i18n.T("common.close"), false)
					closeBtn.Grow(1).Basis(0)
					if closeBtn.Clicked() {
						h.diagOpen = false
					}
				})
			})
		})
	})
}

func (h *Hub) swipeStateFor(hostID string) *mobile.SwipeState {
	h.mu.Lock()
	defer h.mu.Unlock()
	st, ok := h.swipeStates[hostID]
	if !ok {
		st = &mobile.SwipeState{}
		h.swipeStates[hostID] = st
	}
	return st
}

func (h *Hub) setInlineError(msg string) {
	h.mu.Lock()
	h.inlineError = msg
	h.mu.Unlock()
}

func (h *Hub) setInlineNotice(msg string) {
	h.mu.Lock()
	h.inlineNotice = msg
	h.mu.Unlock()
}

func (h *Hub) triggerCameraScan() {
	h.mu.Lock()
	win := h.win
	h.mu.Unlock()
	if win == nil {
		h.setInlineError(i18n.T("connect.qr_unavailable_mobile"))
		return
	}
	cam, err := camera.New(win, camera.Options{Front: false})
	if err != nil {
		if errors.Is(err, errors.ErrUnsupported) {
			h.setInlineError(i18n.T("connect.qr_unavailable_preview"))
		} else {
			h.setInlineError(i18n.Tf("connect.camera_unavailable", map[string]any{"err": err.Error()}))
		}
		return
	}
	// Release immediately until full live QR frame decoder overlay is wired on physical mobile builds.
	cam.Destroy()
	h.setInlineNotice(i18n.T("connect.camera_ready"))
}

func (h *Hub) openPINProbe(targetURL, hostName string, allowPlain bool) {
	isPlainHTTP := strings.HasPrefix(strings.ToLower(strings.TrimSpace(targetURL)), "http://")
	shouldProbe := !isPlainHTTP || allowPlain

	h.mu.Lock()
	h.pinSheetOpen = true
	h.pinTargetURL = targetURL
	h.pinHostName = hostName
	h.pinPlainHTTP = allowPlain
	h.pinCode = ""
	h.pinTOFU = nil
	h.pinError = ""
	h.pinProbing = shouldProbe
	h.mu.Unlock()

	if !shouldProbe {
		return
	}

	go func() {
		res, err := h.store.ProbePINHost(context.Background(), targetURL, allowPlain)
		h.enqueueUI(func() {
			h.mu.Lock()
			h.pinProbing = false
			if err != nil {
				h.pinError = err.Error()
			} else {
				cp := res
				h.pinTOFU = &cp
				if res.Info.HostName != "" {
					h.pinHostName = res.Info.HostName
				}
			}
			h.mu.Unlock()
		})
	}()
}

func (h *Hub) pairPINAsync(targetURL, pin, confirmedFP string, allowPlain bool) {
	h.mu.Lock()
	h.busy = true
	h.pinError = ""
	h.mu.Unlock()

	go func() {
		prof, err := h.store.PairWithPIN(context.Background(), targetURL, pin, confirmedFP, allowPlain)
		h.enqueueUI(func() {
			var onConn func(string)
			var toastMsg string
			h.mu.Lock()
			h.busy = false
			if err != nil {
				h.pinError = err.Error()
			} else {
				h.pinSheetOpen = false
				h.pinCode = ""
				h.segment = 0
				h.inlineError = ""
				toastMsg = i18n.Tf("connect.toast.paired", map[string]any{"name": prof.Name})
				h.inlineNotice = toastMsg
				onConn = h.onConnected
			}
			h.mu.Unlock()
			if onConn != nil {
				onConn(toastMsg)
			}
		})
	}()
}

func (h *Hub) pairURIAsync(rawURI string, allowPlain bool) {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		prof, err := h.store.PairWithURI(context.Background(), rawURI, allowPlain)
		h.enqueueUI(func() {
			var onConn func(string)
			var toastMsg string
			h.mu.Lock()
			h.busy = false
			if err != nil {
				h.inlineError = err.Error()
			} else {
				h.pairURI = ""
				h.segment = 0
				h.inlineError = ""
				toastMsg = i18n.Tf("connect.toast.paired", map[string]any{"name": prof.Name})
				h.inlineNotice = toastMsg
				onConn = h.onConnected
			}
			h.mu.Unlock()
			if onConn != nil {
				onConn(toastMsg)
			}
		})
	}()
}

func (h *Hub) directLoginAsync(rawURL, email, password string, allowPlain bool) {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		prof, err := h.store.LoginDirect(context.Background(), rawURL, email, password, allowPlain)
		h.enqueueUI(func() {
			var onConn func(string)
			var toastMsg string
			h.mu.Lock()
			h.busy = false
			if err != nil {
				h.inlineError = err.Error()
			} else {
				h.directPassword = ""
				h.segment = 0
				h.inlineError = ""
				toastMsg = i18n.Tf("connect.toast.signed_in", map[string]any{"name": prof.Name})
				h.inlineNotice = toastMsg
				onConn = h.onConnected
			}
			h.mu.Unlock()
			if onConn != nil {
				onConn(toastMsg)
			}
		})
	}()
}

func (h *Hub) connectAsync(hostID string) {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		err := h.store.ConnectHost(context.Background(), hostID)
		h.enqueueUI(func() {
			h.mu.Lock()
			h.busy = false
			if err != nil {
				h.inlineError = err.Error()
			} else {
				h.inlineError = ""
				h.inlineNotice = i18n.T("connect.toast.connected")
			}
			h.mu.Unlock()
		})
	}()
}

func (h *Hub) rotateTokenAsync() {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		err := h.store.RotateActiveToken(context.Background())
		h.enqueueUI(func() {
			h.mu.Lock()
			h.busy = false
			if err != nil {
				h.inlineError = err.Error()
			} else {
				h.inlineNotice = i18n.T("connect.toast.token_rotated")
			}
			h.mu.Unlock()
		})
	}()
}

func (h *Hub) unpairAsync(hostID string) {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		err := h.store.UnpairHost(context.Background(), hostID)
		h.enqueueUI(func() {
			h.mu.Lock()
			h.busy = false
			if err != nil {
				h.inlineError = err.Error()
			} else {
				h.inlineNotice = i18n.T("connect.toast.host_removed")
			}
			h.mu.Unlock()
		})
	}()
}
