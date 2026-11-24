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
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// Hub manages local form state, modals, and sheets for the Connection Hub.
type Hub struct {
	store *state.AppStore

	mu             sync.Mutex
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
	win *mygo.Window
}

// NewHub constructs a Connection Hub bound to store.
func NewHub(store *state.AppStore) *Hub {
	return &Hub{
		store:       store,
		swipeStates: map[string]*mobile.SwipeState{},
	}
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

// View renders the Connection Hub inside the active tab's scrollable content area.
func (h *Hub) View(c *ui.Context) {
	snap := h.store.Snapshot()
	if pending := h.store.ConsumePendingPairURI(); pending != "" {
		h.PrefillPairURI(pending)
	}

	h.mu.Lock()
	seg := h.segment
	inlineErr := h.inlineError
	inlineNotice := h.inlineNotice
	busy := h.busy
	h.mu.Unlock()

	t := c.Theme()

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
			// Active transient error or status banners (cleared automatically on recovery).
			if snap.TransientError != "" {
				components.StatusBanner(c, components.ToneDanger, snap.TransientError, "Dismiss", func() {
					h.store.ClearTransientError()
				})
			} else if inlineErr != "" {
				components.StatusBanner(c, components.ToneDanger, inlineErr, "Dismiss", func() {
					h.setInlineError("")
				})
			}
			if inlineNotice != "" {
				components.StatusBanner(c, components.ToneSuccess, inlineNotice, "OK", func() {
					h.setInlineNotice("")
				})
			}

			// Active connection hero card.
			h.viewConnectionOverviewCard(c, snap)

			// Narrow-screen-safe segmented switcher.
			if components.SegmentedControl(c, &seg, "Saved Hosts", "Pair Desktop", "Direct Login") {
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
			ui.Row(c).FillWidth().Justify(ui.Center).Padding(4, 0).Children(func() {
				btn := components.SecondaryTouchButton(c, "Connection Diagnostics", false)
				btn.FillWidth()
				if btn.Clicked() {
					h.OpenDiagnostics()
				}
			})
			_ = t
		})
	})

	// Modal sheets and action sheets rendered in overlay layer.
	h.viewHostActionSheet(c)
	h.viewPINSheet(c)
	h.viewDiagnosticsSheet(c, snap)
}

func (h *Hub) viewConnectionOverviewCard(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	title := "No Active Host"
	hostName := ""
	subtitle := "Pair a Linger Desktop on LAN/Tailscale or sign in directly."
	if snap.ActiveHost != nil {
		title = snap.ActiveHost.Name
		hostName = snap.ActiveHost.Name
		subtitle = snap.ActiveHost.PrimaryURL
		if snap.ActiveVia == "fallback" && snap.ActiveHost.TailscaleURL != "" {
			subtitle = snap.ActiveHost.TailscaleURL + " (Tailscale failover)"
		}
	}

	tlsPinned := snap.ActiveHost != nil && snap.ActiveHost.TLS && snap.ActiveHost.TLSFingerprint != ""
	plainHTTP := snap.ActiveHost != nil && !snap.ActiveHost.TLS
	connected := snap.Phase == state.PhaseConnected

	components.SectionCard(c, title, subtitle, func() {
		components.ConnectionHealthChip(c, hostName, connected, tlsPinned, plainHTTP, snap.RTTMs, func() {
			h.OpenDiagnostics()
		})
	}, func() {
		if snap.ActiveHost == nil {
			ui.Text(c, "Zero desktop configuration is needed on the same Wi-Fi: open Mobile Companion in Linger Desktop's tray menu.").
				FontSize(13).TextColor(t.TextMuted)
			return
		}
		ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
			modeLabel := "Companion"
			if snap.ActiveHost.Mode == config.HostModeDirect {
				modeLabel = "Direct TeamHub"
			}
			components.StatusPill(c, modeLabel, components.ToneInfo)
			if tlsPinned {
				if sf, err := discovery.ShortFingerprint(snap.ActiveHost.TLSFingerprint); err == nil {
					components.StatusPill(c, "Pin "+sf[:9], components.ToneSuccess)
				}
			} else if plainHTTP {
				components.StatusPill(c, "Plain HTTP (opt-in)", components.ToneWarning)
			}
			components.StatusPill(c, "SSE "+string(snap.SSEState), func() components.Tone {
				if snap.SSEState == "connected" {
					return components.ToneSuccess
				}
				return components.ToneNeutral
			}())
		})
		if snap.CompanionStatus != nil {
			ui.Text(c, fmt.Sprintf("Desktop v%s · Runtime %s · %d active ops",
				snap.CompanionStatus.DesktopVersion, snap.CompanionStatus.RuntimeState, snap.CompanionStatus.ActiveOperations)).
				FontSize(12).TextColor(t.TextMuted)
		}
	})
}

func (h *Hub) viewSavedHosts(c *ui.Context, snap state.Snapshot, busy bool) {
	t := c.Theme()
	if len(snap.Hosts) == 0 {
		components.EmptyState(c, theme.IconHost, "No saved hosts yet",
			"Pair with Linger Desktop via LAN radar, QR link, or 6-digit PIN.",
			"Pair a Desktop", func() {
				h.SelectSegment(1)
			})
		return
	}

	components.SectionCard(c, "Saved Desktop & Remote Hosts", "Swipe left on a host to switch or remove; tap for actions.", nil, func() {
		ui.Column(c).FillWidth().Gap(8).Children(func() {
			for _, host := range snap.Hosts {
				host := host
				isActive := snap.ActiveHost != nil && snap.ActiveHost.ID == host.ID
				sw := h.swipeStateFor(host.ID)
				mobile.SwipeRow(c.Key(host.ID), sw, mobile.SwipeOptions{
					Trailing: []mobile.SwipeAction{
						{
							Label: "Switch",
							OnTap: func() {
								h.connectAsync(host.ID)
							},
						},
						{
							Label:       "Remove",
							Destructive: true,
							OnTap: func() {
								h.unpairAsync(host.ID)
							},
						},
					},
				}, func() {
					row := ui.Row(c).FillWidth().MinHeight(56).Padding(10, 10).Gap(10).
						Radius(10).Background(t.Surface).Border(1, func() ui.Color {
						if isActive {
							return t.Accent
						}
						return t.Border
					}()).AlignItems(ui.Center).Role(ui.RoleButton).Label("Host " + host.Name)

					row.Children(func() {
						components.AvatarBadge(c, host.Name, 36)
						ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
							ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
								ui.Text(c, host.Name).FontSize(14).FontWeight(600).TextColor(t.Text).MaxLines(1)
								if isActive {
									components.StatusPill(c, "Active", components.ToneSuccess)
								}
							})
							ui.Text(c, host.PrimaryURL).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
							ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
								if host.TLS && host.TLSFingerprint != "" {
									components.StatusPill(c, "TLS Pinned", components.ToneSuccess)
								} else if !host.TLS {
									components.StatusPill(c, "Plain HTTP", components.ToneWarning)
								} else {
									components.StatusPill(c, "HTTPS", components.ToneInfo)
								}
								if host.LastRTTMs > 0 {
									components.StatusPill(c, fmt.Sprintf("%dms", host.LastRTTMs), components.ToneNeutral)
								}
							})
						})
						ui.Text(c, "›").FontSize(20).TextColor(t.TextMuted)
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
	components.SectionCard(c, "Nearby on LAN (mDNS)", "Discovers _linger._tcp.local. hosts on local Wi-Fi.", func() {
		components.StatusPill(c, fmt.Sprintf("%d found", len(snap.Discovered)), components.ToneInfo)
	}, func() {
		if len(snap.Discovered) == 0 {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(10).Padding(4, 0).Children(func() {
				theme.IconBox(c, 22, t.TextMuted, theme.IconRadar)
				ui.Text(c, "Listening for Linger Desktop on LAN. Ensure Mobile Companion is enabled in Desktop tray.").
					Grow(1).Basis(0).FontSize(13).TextColor(t.TextMuted)
			})
		} else {
			ui.Column(c).FillWidth().Gap(8).Children(func() {
				for _, dh := range snap.Discovered {
					dh := dh
					ui.Row(c.Key(dh.HostID)).FillWidth().MinHeight(56).Padding(10, 10).Gap(10).
						Radius(10).Background(theme.Extra(t).MutedBg).AlignItems(ui.Center).Children(func() {
						theme.IconBox(c, 22, t.Accent, theme.IconHost)
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, dh.Name).FontSize(14).FontWeight(600).TextColor(t.Text).MaxLines(1)
							ui.Text(c, dh.BaseURL()).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
							ui.Row(c).Wrap().Gap(4).Children(func() {
								if dh.TLS {
									components.StatusPill(c, "TLS 1.3", components.ToneSuccess)
								} else {
									components.StatusPill(c, "Plain HTTP", components.ToneWarning)
								}
								if dh.PairingOpen {
									components.StatusPill(c, "Pairing Open", components.ToneInfo)
								}
							})
						})
						pairBtn := components.PrimaryTouchButton(c, "PIN Pair", busy)
						if pairBtn.Clicked() {
							h.openPINProbe(dh.BaseURL(), dh.Name, !dh.TLS)
						}
					})
				}
			})
		}

		// Manual LAN/Tailscale IP + PIN entry
		ui.Divider(c)
		components.FormField(c, "Or probe Desktop URL manually (LAN / Tailscale)", "https://192.168.1.42:48210", &h.manualHostURL, false)
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
			ui.Text(c, "Allow plain HTTP (Tailscale/dev only)").FontSize(12).TextColor(t.TextMuted).Grow(1).Basis(0)
			mobile.Switch(c, &h.manualPlain)
		})
		probeBtn := components.SecondaryTouchButton(c, "Probe & Pair with 6-Digit PIN", busy || strings.TrimSpace(h.manualHostURL) == "")
		probeBtn.FillWidth()
		if probeBtn.Clicked() {
			h.openPINProbe(strings.TrimSpace(h.manualHostURL), strings.TrimSpace(h.manualHostURL), h.manualPlain)
		}
	})

	// 2. Scan or Paste linger://pair?... Link
	components.SectionCard(c, "Scan or Paste Pairing Link", "QR codes pin Desktop's TLS SPKI fingerprint automatically.", nil, func() {
		components.FormField(c, "Pairing URI", "linger://pair?v=1&host=...&fp=...&code=...", &h.pairURI, false)

		// Live parsed preview + ShortFingerprint display.
		if trimmed := strings.TrimSpace(h.pairURI); trimmed != "" {
			if parsed, err := discovery.ParsePairingURI(trimmed); err == nil {
				shortFP := "Plain HTTP (no TLS pin)"
				tone := components.ToneWarning
				if parsed.TLS {
					if sf, sfErr := discovery.ShortFingerprint(parsed.TLSFingerprint); sfErr == nil {
						shortFP = "TLS Pin: " + sf
						tone = components.ToneSuccess
					}
				}
				ui.Column(c).FillWidth().Padding(8, 10).Radius(8).Background(theme.Extra(t).MutedBg).Gap(4).Children(func() {
					ui.Text(c, fmt.Sprintf("Host: %s (%s)", parsed.Name, parsed.PrimaryURL())).FontSize(12).FontWeight(600).TextColor(t.Text)
					components.StatusPill(c, shortFP, tone)
				})
			} else {
				ui.Text(c, err.Error()).FontSize(12).TextColor(t.Danger)
			}
		}

		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
			ui.Text(c, "Allow plain HTTP pairing link (tls=0)").FontSize(12).TextColor(t.TextMuted).Grow(1).Basis(0)
			mobile.Switch(c, &h.pairPlainHTTP)
		})

		ui.Row(c).FillWidth().Gap(8).Children(func() {
			scanBtn := components.SecondaryTouchButton(c, "Scan QR", busy)
			scanBtn.Grow(1).Basis(0)
			if scanBtn.Clicked() {
				h.triggerCameraScan()
			}
			pairBtn := components.PrimaryTouchButton(c, "Pair Link", busy || strings.TrimSpace(h.pairURI) == "")
			pairBtn.Grow(1).Basis(0)
			if pairBtn.Clicked() {
				h.pairURIAsync(h.pairURI, h.pairPlainHTTP)
			}
		})
	})
}

func (h *Hub) viewDirectLogin(c *ui.Context, busy bool) {
	t := c.Theme()
	components.SectionCard(c, "Direct TeamHub Login", "Connect directly to a remote or self-hosted TeamHub URL over HTTPS.", nil, func() {
		components.FormField(c, "Server URL", "https://linger.example.com", &h.directURL, false)
		components.FormField(c, "Email", "you@example.com", &h.directEmail, false)
		components.FormField(c, "Password", "Account password", &h.directPassword, true)
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
			ui.Text(c, "Allow plain HTTP (local dev / Tailscale only)").FontSize(12).TextColor(t.TextMuted).Grow(1).Basis(0)
			mobile.Switch(c, &h.directPlain)
		})
		canSubmit := !busy && strings.TrimSpace(h.directURL) != "" && strings.TrimSpace(h.directEmail) != "" && h.directPassword != ""
		signInBtn := components.PrimaryTouchButton(c, "Sign In", !canSubmit)
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
			Label: "Connect / Switch",
			OnTap: func() {
				h.connectAsync(host.ID)
			},
		},
		{
			Label: "Diagnostics",
			OnTap: func() {
				h.OpenDiagnostics()
			},
		},
	}
	if host.Mode == config.HostModeCompanion {
		actions = append(actions, mobile.Action{
			Label: "Rotate Device Token",
			OnTap: func() {
				h.rotateTokenAsync()
			},
		})
	}
	actions = append(actions, mobile.Action{
		Label:       "Unpair & Remove Host",
		Destructive: true,
		OnTap: func() {
			h.unpairAsync(host.ID)
		},
	})

	mobile.ActionSheet(c, &h.actionSheetOpen, mobile.ActionSheetOptions{
		Title:   host.Name,
		Message: host.PrimaryURL,
		Cancel:  "Cancel",
	}, actions...)
}

func (h *Hub) viewPINSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &h.pinSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.68, 0.90},
		Label:   "PIN Pairing",
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
				ui.Text(c, "Pair with 6-Digit PIN").FontSize(18).Bold().TextColor(t.Text)
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

				if tofu != nil && tofu.ShortCode != "" {
					ui.Column(c).FillWidth().Padding(12, 12).Radius(10).Background(theme.Extra(t).OKTint).
						Border(1, t.Success.Alpha(0.35)).Gap(4).Children(func() {
						ui.Text(c, "Verify Desktop TLS Fingerprint").FontSize(12).FontWeight(600).TextColor(t.Success)
						ui.Text(c, tofu.ShortCode).FontSize(18).Bold().TextColor(t.Text)
						ui.Text(c, "Confirm this code matches Linger Desktop before entering the PIN.").
							FontSize(12).TextColor(t.TextMuted)
					})
				} else if plain {
					components.StatusBanner(c, components.ToneWarning,
						"Plain HTTP mode (no TLS fingerprint). Use only on trusted Tailscale or local dev.", "", nil)
				}

				components.FormField(c, "6-Digit PIN from Desktop", "123456", &h.pinCode, false)

				confirmedFP := ""
				if tofu != nil {
					confirmedFP = tofu.ObservedFingerprint
				}
				canPair := !busy && len(strings.TrimSpace(h.pinCode)) == 6
				btn := components.PrimaryTouchButton(c, "Confirm & Pair", !canPair)
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
		Label:   "Connection Diagnostics",
	}, func() {
		diagText := h.store.DiagnosticsText()
		h.mu.Lock()
		notice := h.diagNotice
		h.mu.Unlock()

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
					ui.Text(c, "Connection Diagnostics").FontSize(18).Bold().TextColor(t.Text)
					components.StatusPill(c, string(snap.Phase), func() components.Tone {
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
					shareBtn := components.PrimaryTouchButton(c, "Share Diagnostics", false)
					shareBtn.Grow(1).Basis(0)
					if shareBtn.Clicked() {
						go func() {
							err := mygo.Share(mygo.ShareOptions{Text: diagText})
							h.mu.Lock()
							if errors.Is(err, errors.ErrUnsupported) {
								h.diagNotice = "System share sheet is unavailable in desktop preview; diagnostics are shown above."
							} else if err != nil {
								h.diagNotice = "Share failed: " + err.Error()
							} else {
								h.diagNotice = "Diagnostics shared."
							}
							h.mu.Unlock()
						}()
					}
					closeBtn := components.SecondaryTouchButton(c, "Close", false)
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
		h.setInlineError("QR camera scan is available on iOS and Android devices; paste a linger://pair link here.")
		return
	}
	cam, err := camera.New(win, camera.Options{Front: false})
	if err != nil {
		if errors.Is(err, errors.ErrUnsupported) {
			h.setInlineError("Camera scanning is unavailable on desktop preview; paste a linger://pair link above.")
		} else {
			h.setInlineError("Camera unavailable: " + err.Error())
		}
		return
	}
	// Release immediately until full live QR frame decoder overlay is wired on physical mobile builds.
	cam.Destroy()
	h.setInlineNotice("Camera ready; paste or scan linger://pair URI.")
}

func (h *Hub) openPINProbe(targetURL, hostName string, allowPlain bool) {
	h.mu.Lock()
	h.pinSheetOpen = true
	h.pinTargetURL = targetURL
	h.pinHostName = hostName
	h.pinPlainHTTP = allowPlain
	h.pinCode = ""
	h.pinTOFU = nil
	h.pinError = ""
	h.pinProbing = true
	h.mu.Unlock()

	go func() {
		res, err := h.store.ProbePINHost(context.Background(), targetURL, allowPlain)
		h.mu.Lock()
		h.pinProbing = false
		if err != nil {
			h.pinError = err.Error()
		} else {
			h.pinTOFU = &res
			if res.Info.HostName != "" {
				h.pinHostName = res.Info.HostName
			}
		}
		h.mu.Unlock()
	}()
}

func (h *Hub) pairPINAsync(targetURL, pin, confirmedFP string, allowPlain bool) {
	h.mu.Lock()
	h.busy = true
	h.pinError = ""
	h.mu.Unlock()

	go func() {
		prof, err := h.store.PairWithPIN(context.Background(), targetURL, pin, confirmedFP, allowPlain)
		h.mu.Lock()
		h.busy = false
		if err != nil {
			h.pinError = err.Error()
		} else {
			h.pinSheetOpen = false
			h.pinCode = ""
			h.segment = 0
			h.inlineError = ""
			h.inlineNotice = "Paired with " + prof.Name
		}
		h.mu.Unlock()
	}()
}

func (h *Hub) pairURIAsync(rawURI string, allowPlain bool) {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		prof, err := h.store.PairWithURI(context.Background(), rawURI, allowPlain)
		h.mu.Lock()
		h.busy = false
		if err != nil {
			h.inlineError = err.Error()
		} else {
			h.pairURI = ""
			h.segment = 0
			h.inlineError = ""
			h.inlineNotice = "Paired with " + prof.Name
		}
		h.mu.Unlock()
	}()
}

func (h *Hub) directLoginAsync(rawURL, email, password string, allowPlain bool) {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		prof, err := h.store.LoginDirect(context.Background(), rawURL, email, password, allowPlain)
		h.mu.Lock()
		h.busy = false
		if err != nil {
			h.inlineError = err.Error()
		} else {
			h.directPassword = ""
			h.segment = 0
			h.inlineError = ""
			h.inlineNotice = "Signed in to " + prof.Name
		}
		h.mu.Unlock()
	}()
}

func (h *Hub) connectAsync(hostID string) {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		err := h.store.ConnectHost(context.Background(), hostID)
		h.mu.Lock()
		h.busy = false
		if err != nil {
			h.inlineError = err.Error()
		} else {
			h.inlineError = ""
			h.inlineNotice = "Connected"
		}
		h.mu.Unlock()
	}()
}

func (h *Hub) rotateTokenAsync() {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		err := h.store.RotateActiveToken(context.Background())
		h.mu.Lock()
		h.busy = false
		if err != nil {
			h.inlineError = err.Error()
		} else {
			h.inlineNotice = "Device token rotated"
		}
		h.mu.Unlock()
	}()
}

func (h *Hub) unpairAsync(hostID string) {
	h.mu.Lock()
	h.busy = true
	h.inlineError = ""
	h.mu.Unlock()

	go func() {
		err := h.store.UnpairHost(context.Background(), hostID)
		h.mu.Lock()
		h.busy = false
		if err != nil {
			h.inlineError = err.Error()
		} else {
			h.inlineNotice = "Host removed"
		}
		h.mu.Unlock()
	}()
}
