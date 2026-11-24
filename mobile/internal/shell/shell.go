// Package shell implements Linger Mobile's 5-tab navigation shell
// (Rooms, Live, Work, Library, More), Biometric Lock Gate, Town Light/Dark
// theme integration, and pluggable Wave C screen routing.
package shell

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/biometrics"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/screens/connect"
	"github.com/oldwinter/linger/mobile/internal/screens/live"
	"github.com/oldwinter/linger/mobile/internal/screens/rooms"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// TabHooks lets Wave C-2 plug full Tabs 3/4/5 route views into Shell in ~10 lines
// without editing Shell's core navigation or Tab 1/Tab 2 wiring.
type TabHooks struct {
	RouteWork    func(c *ui.Context, r *ui.Route, snap state.Snapshot)
	RouteLibrary func(c *ui.Context, r *ui.Route, snap state.Snapshot)
	RouteMore    func(c *ui.Context, r *ui.Route, snap state.Snapshot) bool
}

// Shell owns the root 5-tab view, Biometric Lock Gate, and tab screen controllers.
type Shell struct {
	store      *state.AppStore
	connectHub *connect.Hub
	roomsCtl   *rooms.Controller
	liveCtl    *live.Controller
	systemDark func() bool

	mu             sync.Mutex
	hooks          TabHooks
	unlockError    string
	unlocking      bool
	biometricAvail biometrics.Kind
}

// New constructs a Shell bound to store with full Tab 1 (Rooms) and Tab 2 (Live) wired.
func New(store *state.AppStore, systemDark func() bool) *Shell {
	if systemDark == nil {
		systemDark = func() bool { return false }
	}
	s := &Shell{
		store:      store,
		connectHub: connect.NewHub(store),
		systemDark: systemDark,
	}
	s.roomsCtl = rooms.NewController(store, rooms.NavigationHooks{
		OnOpenConnect: s.OpenConnect,
		OnOpenSettingsKey: func(kind, key string) {
			s.OpenMoreRoute("/more/settings?focus=" + kind + "&key=" + key)
		},
		OnOpenCompute: func(computerID, section string) {
			s.OpenLiveCompute(computerID, section)
		},
	})
	s.liveCtl = live.NewController(store, live.NavigationHooks{
		OnOpenConnect: s.OpenConnect,
		OnOpenRoom:    s.OpenRoom,
		OnWatchRun:    s.OpenRunWatch,
		OnOpenSettingsKey: func(kind, key string) {
			s.OpenMoreRoute("/more/settings?focus=" + kind + "&key=" + key)
		},
	})
	return s
}

// SetTabHooks registers optional Wave C-2 route renderers for Tabs 3/4/5.
func (s *Shell) SetTabHooks(hooks TabHooks) {
	s.mu.Lock()
	s.hooks = hooks
	s.mu.Unlock()
}

// SetWindow passes the host mygo.Window down to platform-aware child controllers.
func (s *Shell) SetWindow(w *mygo.Window) {
	s.connectHub.SetWindow(w)
	s.roomsCtl.SetWindow(w)
}

// ConnectHub returns the embedded Connection Hub controller.
func (s *Shell) ConnectHub() *connect.Hub { return s.connectHub }

// Rooms returns Tab 1's Rooms controller.
func (s *Shell) Rooms() *rooms.Controller { return s.roomsCtl }

// Live returns Tab 2's Live Control controller.
func (s *Shell) Live() *live.Controller { return s.liveCtl }

// OpenRoom switches to Tab 1 and opens roomID.
func (s *Shell) OpenRoom(roomID string) {
	s.roomsCtl.OpenRoom(roomID)
}

// OpenRunWatch switches to Tab 1 and opens the Live Run Watch view for (roomID, runID).
func (s *Shell) OpenRunWatch(roomID, runID string) {
	s.roomsCtl.OpenRunWatch(roomID, runID)
}

// OpenConnect switches to Tab 5 More and pushes the Connection Hub.
func (s *Shell) OpenConnect() {
	s.store.SetActiveTab(state.TabMore)
	s.store.Routers[state.TabMore].Push("/more/connect")
}

// OpenMoreRoute switches to Tab 5 More and pushes target path (for Wave C-2 Settings deep links).
func (s *Shell) OpenMoreRoute(target string) {
	s.store.SetActiveTab(state.TabMore)
	s.store.Routers[state.TabMore].Push(target)
}

// OpenLiveCompute switches to Tab 2 Compute segment and optionally opens permissions or browser sheet.
func (s *Shell) OpenLiveCompute(computerID, section string) {
	s.store.SetActiveTab(state.TabLive)
	s.liveCtl.OpenComputeSection(computerID, section)
}

// View renders the entire Linger Mobile application inside a MyGo window or ui.Tester.
func (s *Shell) View(c *ui.Context) {
	snap := s.store.Snapshot()
	resolvedTheme := theme.Resolve(snap.Prefs.Theme, s.systemDark())
	c.SetTheme(resolvedTheme)
	t := c.Theme()

	top, right, bottom, left := c.SafeArea()

	root := ui.Column(c).Fill().Background(t.Background).Padding(top, right, bottom, left)
	root.Children(func() {
		if snap.BiometricLocked {
			s.viewBiometricLockGate(c)
			return
		}

		activeTab := snap.ActiveTab
		router := s.store.Routers[activeTab]

		// Tab top navigation bar with live connection health chip.
		s.viewTopBar(c, snap, activeTab, router)

		// Active tab router stack (each tab preserves independent navigation history).
		ui.Column(c.Key(activeTab)).FillWidth().Grow(1).Basis(0).Children(func() {
			router.View(c, func(r *ui.Route) {
				switch activeTab {
				case state.TabRooms:
					s.roomsCtl.Route(c, r, snap)
				case state.TabLive:
					s.liveCtl.Route(c, r, snap)
				case state.TabWork:
					s.routeWork(c, r, snap)
				case state.TabLibrary:
					s.routeLibrary(c, r, snap)
				case state.TabMore:
					s.routeMore(c, r, snap)
				}
			})
		})

		// 5-destination mobile bottom tab bar with live Unread & Pending Approvals badges.
		var unreadTotal int64
		for _, rm := range snap.Rooms {
			unreadTotal += rm.UnreadMessageCount
		}
		roomsBadge := ""
		if unreadTotal > 0 {
			roomsBadge = fmt.Sprintf("%d", unreadTotal)
			if unreadTotal > 99 {
				roomsBadge = "99+"
			}
		}

		liveAttention := len(snap.PendingDecisions)
		if liveAttention == 0 {
			for _, run := range snap.ActiveRuns {
				if run.Status == "active" {
					liveAttention++
				}
			}
		}
		liveBadge := ""
		if liveAttention > 0 {
			liveBadge = fmt.Sprintf("%d", liveAttention)
		}

		selected := activeTab
		bar := mobile.BottomBar(c, &selected,
			mobile.BarButton{Label: "Rooms", Icon: theme.IconRooms, Badge: roomsBadge},
			mobile.BarButton{Label: "Live", Icon: theme.IconLive, Badge: liveBadge},
			mobile.BarButton{Label: "Work", Icon: theme.IconWork},
			mobile.BarButton{Label: "Library", Icon: theme.IconLibrary},
			mobile.BarButton{Label: "More", Icon: theme.IconMore},
		)
		if bar.Changed() {
			mygo.Haptics.Light()
			s.store.SetActiveTab(selected)
		}
	})
}

func (s *Shell) viewTopBar(c *ui.Context, snap state.Snapshot, tab int, router *ui.Router) {
	t := c.Theme()
	title := s.topBarTitle(tab, router)

	var leading func()
	if router.CanGoBack() {
		leading = func() {
			if components.TopBarIconButton(c, "Back", theme.IconBack, t.Accent).Clicked() {
				router.Back()
			}
		}
	}

	tlsPinned := snap.ActiveHost != nil && snap.ActiveHost.TLS && snap.ActiveHost.TLSFingerprint != ""
	plainHTTP := snap.ActiveHost != nil && !snap.ActiveHost.TLS
	connected := snap.Phase == state.PhaseConnected
	hostName := ""
	if snap.ActiveHost != nil {
		hostName = snap.ActiveHost.Name
	}

	trailing := func() {
		components.ConnectionHealthChip(c, hostName, connected, tlsPinned, plainHTTP, snap.RTTMs, s.OpenConnect)
	}

	mobile.TopBar(c, mobile.TopBarOptions{
		Title:    title,
		Leading:  leading,
		Trailing: trailing,
	})
	ui.Divider(c)
}

func (s *Shell) topBarTitle(tab int, router *ui.Router) string {
	if title := router.Title(); title != "" {
		return title
	}
	switch tab {
	case state.TabRooms:
		return "Rooms"
	case state.TabLive:
		return "Live"
	case state.TabWork:
		return "Work"
	case state.TabLibrary:
		return "Library"
	default:
		return "More"
	}
}

func (s *Shell) routeWork(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	s.mu.Lock()
	hook := s.hooks.RouteWork
	s.mu.Unlock()
	if hook != nil {
		hook(c, r, snap)
		return
	}
	r.Title("Work")
	s.viewWorkOverview(c, snap)
}

func (s *Shell) routeLibrary(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	s.mu.Lock()
	hook := s.hooks.RouteLibrary
	s.mu.Unlock()
	if hook != nil {
		hook(c, r, snap)
		return
	}
	r.Title("Library")
	s.viewLibraryOverview(c, snap)
}

func (s *Shell) routeMore(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	if r.Match("/more/connect") {
		r.Title("Connect")
		s.connectHub.View(c)
		return
	}
	s.mu.Lock()
	hook := s.hooks.RouteMore
	s.mu.Unlock()
	if hook != nil && hook(c, r, snap) {
		return
	}
	r.Title("More")
	s.viewMoreSettings(c, snap)
}

func (s *Shell) viewWorkOverview(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
			if snap.ActiveHost == nil {
				components.EmptyState(c, theme.IconWork, "Work & Routines",
					"Connect to a host to manage Work Items, scheduled Routines, and Pocket Notes.",
					"Open Connection Hub", s.OpenConnect)
				return
			}
			components.SectionCard(c, fmt.Sprintf("Work Items (%d)", len(snap.WorkItems)), "Synced with offline SQLite cache", nil, func() {
				if len(snap.WorkItems) == 0 {
					ui.Text(c, "No open Work Items.").FontSize(13).TextColor(t.TextMuted)
				} else {
					for _, wi := range snap.WorkItems {
						ui.Row(c.Key(wi.ID)).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
							ui.Text(c, fmt.Sprintf("#%d %s", wi.Number, wi.Title)).FontSize(13).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
							components.StatusPill(c, wi.State, components.ToneInfo)
						})
					}
				}
			})
			components.SectionCard(c, fmt.Sprintf("Routines (%d) & Pocket Notes (%d)", len(snap.Routines), len(snap.PocketNotes)), "", nil, func() {
				for _, rt := range snap.Routines {
					ui.Row(c.Key(rt.ID)).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Text(c, rt.Name).FontSize(13).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
						stateLabel := "Paused"
						tone := components.ToneNeutral
						if rt.Enabled {
							stateLabel = "Enabled"
							tone = components.ToneSuccess
						}
						components.StatusPill(c, stateLabel, tone)
					})
				}
			})
		})
	})
}

func (s *Shell) viewLibraryOverview(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
			if snap.ActiveHost == nil {
				components.EmptyState(c, theme.IconLibrary, "Library & Knowledge",
					"Connect to browse Documents, Personal Wiki, Memory, and FTS5 offline search.",
					"Open Connection Hub", s.OpenConnect)
				return
			}
			components.SectionCard(c, fmt.Sprintf("Documents (%d)", len(snap.Documents)),
				fmt.Sprintf("SQLite FTS5 indexed: %d rooms, %d docs, %d work items", snap.CacheStats.Rooms, snap.CacheStats.Documents, snap.CacheStats.WorkItems),
				nil, func() {
					if len(snap.Documents) == 0 {
						ui.Text(c, "No documents synced yet.").FontSize(13).TextColor(t.TextMuted)
					} else {
						for _, d := range snap.Documents {
							ui.Row(c.Key(d.ID)).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
								ui.Text(c, d.Title).FontSize(13).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
								components.StatusPill(c, d.Format, components.ToneNeutral)
							})
						}
					}
				})
		})
	})
}

func (s *Shell) viewMoreSettings(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
			title := "Not Connected"
			sub := "Tap Connection Hub to pair Linger Desktop"
			if snap.Identity != nil {
				title = snap.Identity.Account.DisplayName
				sub = snap.Identity.Account.Email
			} else if snap.ActiveHost != nil {
				title = snap.ActiveHost.Name
				sub = snap.ActiveHost.PrimaryURL
			}
			components.SectionCard(c, title, sub, func() {
				components.AvatarBadge(c, title, 40)
			}, func() {
				ui.Row(c).FillWidth().Gap(8).Children(func() {
					hubBtn := components.PrimaryTouchButton(c, "Connection Hub", false)
					hubBtn.Grow(1).Basis(0)
					if hubBtn.Clicked() {
						s.store.Routers[state.TabMore].Push("/more/connect")
					}
					if snap.ActiveHost != nil {
						refBtn := components.SecondaryTouchButton(c, "Refresh", false)
						refBtn.Grow(1).Basis(0)
						if refBtn.Clicked() {
							s.refreshAsync()
						}
					}
				})
			})

			components.SectionCard(c, "Appearance", "Linger Town Light & Town Dark", nil, func() {
				themeIdx := 0
				switch snap.Prefs.Theme {
				case config.ThemeLight:
					themeIdx = 1
				case config.ThemeDark:
					themeIdx = 2
				}
				if components.SegmentedControl(c, &themeIdx, "System", "Town Light", "Town Dark") {
					pref := config.ThemeSystem
					if themeIdx == 1 {
						pref = config.ThemeLight
					} else if themeIdx == 2 {
						pref = config.ThemeDark
					}
					_ = s.store.SetThemePreference(pref)
				}
			})

			components.SectionCard(c, "Security & Composer", "Protect paired desktop tokens and customize chat input", nil, func() {
				bioOn := snap.Prefs.BiometricLock
				ui.Row(c).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, "Biometric App Lock").FontSize(14).FontWeight(500).TextColor(t.Text)
						ui.Text(c, "Require Face ID / Touch ID on resume").FontSize(12).TextColor(t.TextMuted)
					})
					sw := mobile.Switch(c, &bioOn)
					if sw.Changed() {
						_ = s.store.SetBiometricPreference(bioOn)
					}
				})
				retSends := snap.ComposerReturnSends
				ui.Row(c).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, "Return Key Sends Message").FontSize(14).FontWeight(500).TextColor(t.Text)
						ui.Text(c, "Cmd/Ctrl+Enter always sends on hardware keyboards").FontSize(12).TextColor(t.TextMuted)
					})
					sw := mobile.Switch(c, &retSends)
					if sw.Changed() {
						s.store.SetComposerReturnSends(retSends)
					}
				})
				if snap.Prefs.BiometricLock {
					lockBtn := components.SecondaryTouchButton(c, "Lock Now", false)
					lockBtn.FillWidth()
					if lockBtn.Clicked() {
						s.store.SetBiometricLocked(true)
					}
				}
			})

			if snap.ActiveHost != nil {
				components.SectionCard(c, "Active Connection", snap.ActiveHost.PrimaryURL, nil, func() {
					diagBtn := components.SecondaryTouchButton(c, "View Diagnostics", false)
					diagBtn.FillWidth()
					if diagBtn.Clicked() {
						s.connectHub.OpenDiagnostics()
						s.store.Routers[state.TabMore].Push("/more/connect")
					}
					discBtn := components.DangerTouchButton(c, "Disconnect", false)
					discBtn.FillWidth()
					if discBtn.Clicked() {
						s.store.Disconnect()
					}
				})
			}
		})
	})
}

func (s *Shell) viewBiometricLockGate(c *ui.Context) {
	t := c.Theme()
	ex := theme.Extra(t)
	s.mu.Lock()
	unlockErr := s.unlockError
	unlocking := s.unlocking
	s.mu.Unlock()

	ui.Column(c).Fill().AlignItems(ui.Center).Justify(ui.Center).Padding(24, 24).Gap(16).
		Role(ui.RoleDialog).Label("Biometric App Lock").Children(func() {
		ui.Row(c).Size(64, 64).Radius(32).Background(ex.InfoTint).AlignItems(ui.Center).Justify(ui.Center).Children(func() {
			theme.IconBox(c, 32, t.Accent, theme.IconLock)
		})
		ui.Text(c, "Linger Mobile is Locked").FontSize(20).Bold().TextColor(t.Text).TextAlign(ui.Center)
		ui.Text(c, "Authenticate to access your paired Linger Desktop hosts.").
			FontSize(13).TextColor(t.TextMuted).TextAlign(ui.Center)
		if unlockErr != "" {
			components.StatusBanner(c, components.ToneWarning, unlockErr, "", nil)
		}
		unlockBtn := components.PrimaryTouchButton(c, "Unlock", unlocking)
		unlockBtn.FillWidth()
		if unlockBtn.Clicked() {
			s.triggerBiometricUnlock()
		}
	})
}

func (s *Shell) triggerBiometricUnlock() {
	s.mu.Lock()
	if s.unlocking {
		s.mu.Unlock()
		return
	}
	s.unlocking = true
	s.unlockError = ""
	s.mu.Unlock()

	go func() {
		err := biometrics.Authenticate(context.Background(), "Unlock Linger Mobile")
		s.mu.Lock()
		s.unlocking = false
		switch {
		case err == nil || errors.Is(err, errors.ErrUnsupported):
			s.unlockError = ""
			s.mu.Unlock()
			s.store.SetBiometricLocked(false)
			return
		case errors.Is(err, biometrics.ErrCanceled):
			s.unlockError = "Authentication canceled. Tap Unlock to try again."
		default:
			s.unlockError = "Authentication failed: " + err.Error()
		}
		s.mu.Unlock()
	}()
}

func (s *Shell) refreshAsync() {
	go func() {
		_ = s.store.RefreshActiveHost(context.Background())
	}()
}
