// Package shell implements Linger Mobile's 5-tab navigation shell
// (Rooms, Live, Work, Library, More), Biometric Lock Gate, Town Light/Dark
// theme integration, and Connection Hub hosting.
package shell

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/biometrics"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/screens/connect"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// Shell owns the root 5-tab view, Biometric Lock Gate, and child screen controllers.
type Shell struct {
	store      *state.AppStore
	connectHub *connect.Hub
	systemDark func() bool

	mu             sync.Mutex
	unlockError    string
	unlocking      bool
	biometricAvail biometrics.Kind
}

// New constructs a Shell bound to store.
func New(store *state.AppStore, systemDark func() bool) *Shell {
	if systemDark == nil {
		systemDark = func() bool { return false }
	}
	return &Shell{
		store:      store,
		connectHub: connect.NewHub(store),
		systemDark: systemDark,
	}
}

// SetWindow passes the host mygo.Window down to platform-aware child controllers.
func (s *Shell) SetWindow(w *mygo.Window) {
	s.connectHub.SetWindow(w)
}

// ConnectHub returns the embedded Connection Hub controller.
func (s *Shell) ConnectHub() *connect.Hub {
	return s.connectHub
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
					s.routeRooms(c, r, snap)
				case state.TabLive:
					s.routeLive(c, r, snap)
				case state.TabWork:
					s.routeWork(c, r, snap)
				case state.TabLibrary:
					s.routeLibrary(c, r, snap)
				case state.TabMore:
					s.routeMore(c, r, snap)
				}
			})
		})

		// 5-destination mobile bottom tab bar.
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
		liveBadge := ""
		if len(snap.ActiveRuns) > 0 {
			liveBadge = fmt.Sprintf("%d", len(snap.ActiveRuns))
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
		components.ConnectionHealthChip(c, hostName, connected, tlsPinned, plainHTTP, snap.RTTMs, func() {
			s.store.SetActiveTab(state.TabMore)
			s.store.Routers[state.TabMore].Push("/more/connect")
		})
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

func (s *Shell) routeRooms(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	switch {
	case r.Match("/rooms/{id}"):
		roomID := r.Param("id")
		r.Title("Room")
		s.viewRoomPlaceholderDetail(c, snap, roomID)
	default:
		r.Title("Rooms")
		s.viewRoomsOverview(c, snap)
	}
}

func (s *Shell) routeLive(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	r.Title("Live Control")
	s.viewLiveOverview(c, snap)
}

func (s *Shell) routeWork(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	r.Title("Work")
	s.viewWorkOverview(c, snap)
}

func (s *Shell) routeLibrary(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	r.Title("Library")
	s.viewLibraryOverview(c, snap)
}

func (s *Shell) routeMore(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	switch {
	case r.Match("/more/connect"):
		r.Title("Connect")
		s.connectHub.View(c)
	default:
		r.Title("More")
		s.viewMoreSettings(c, snap, r)
	}
}

func (s *Shell) viewRoomsOverview(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
			if snap.TransientError != "" {
				components.StatusBanner(c, components.ToneDanger, snap.TransientError, "Connect", func() {
					s.openConnectHub()
				})
			}
			if snap.ActiveHost == nil {
				components.EmptyState(c, theme.IconRooms, "Connect a Linger Host",
					"Pair your Linger Desktop over LAN or Tailscale to watch live Rooms and respond to Agents.",
					"Open Connection Hub", s.openConnectHub)
				return
			}
			if len(snap.Rooms) == 0 {
				components.EmptyState(c, theme.IconRooms, "No Rooms loaded yet",
					"Pull refresh to sync Rooms from "+snap.ActiveHost.Name+".",
					"Refresh", s.refreshAsync)
				return
			}
			for _, rm := range snap.Rooms {
				rm := rm
				row := ui.Row(c.Key(rm.ID)).FillWidth().MinHeight(60).Padding(12, 12).Gap(10).
					Radius(12).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
					Role(ui.RoleButton).Label("Room " + rm.Name)
				row.Children(func() {
					components.AvatarBadge(c, rm.Name, 40)
					ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
						ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
							ui.Text(c, rm.Name).FontSize(15).FontWeight(600).TextColor(t.Text).MaxLines(1)
							if rm.UnreadMessageCount > 0 {
								components.StatusPill(c, fmt.Sprintf("%d new", rm.UnreadMessageCount), components.ToneInfo)
							}
						})
						preview := "No messages yet"
						if rm.LatestMessage != nil && strings.TrimSpace(rm.LatestMessage.RawMessage) != "" {
							preview = rm.LatestMessage.Author.DisplayName + ": " + rm.LatestMessage.RawMessage
						}
						ui.Text(c, preview).FontSize(13).TextColor(t.TextMuted).MaxLines(1)
					})
				})
				if row.Clicked() {
					s.store.Routers[state.TabRooms].Push("/rooms/" + rm.ID)
				}
			}
		})
	})
}

func (s *Shell) viewRoomPlaceholderDetail(c *ui.Context, snap state.Snapshot, roomID string) {
	t := c.Theme()
	roomName := roomID
	for _, rm := range snap.Rooms {
		if rm.ID == roomID {
			roomName = rm.Name
			break
		}
	}
	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(16, 16, 24, 16).Gap(12).Children(func() {
			components.SectionCard(c, roomName, "Live Room stream active", nil, func() {
				ui.Text(c, fmt.Sprintf("Tracking room cursor for %s over unified SSE stream.", roomID)).
					FontSize(13).TextColor(t.TextMuted)
			})
		})
	})
}

func (s *Shell) viewLiveOverview(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
			if snap.ActiveHost == nil {
				components.EmptyState(c, theme.IconLive, "Live Control Room",
					"Connect to Linger Desktop to monitor live Agent runs, approval decisions, and Local Models.",
					"Open Connection Hub", s.openConnectHub)
				return
			}
			components.SectionCard(c, "Desktop Runtime", snap.ActiveHost.Name, func() {
				if snap.CompanionStatus != nil {
					components.StatusPill(c, snap.CompanionStatus.RuntimeState, components.ToneSuccess)
				}
			}, func() {
				if snap.CompanionStatus != nil {
					ui.Text(c, fmt.Sprintf("Daemon: %s · Active ops: %d · Local server: %s",
						snap.CompanionStatus.DaemonConnection, snap.CompanionStatus.ActiveOperations, snap.CompanionStatus.LocalServerPhase)).
						FontSize(13).TextColor(t.TextMuted)
				} else {
					ui.Text(c, fmt.Sprintf("Connected in %s mode · %d local computers observed.", snap.ActiveHost.Mode, len(snap.Computers))).
						FontSize(13).TextColor(t.TextMuted)
				}
			})

			components.SectionCard(c, fmt.Sprintf("Active Agent Runs (%d)", len(snap.ActiveRuns)), "Real-time status across Rooms", nil, func() {
				if len(snap.ActiveRuns) == 0 {
					ui.Text(c, "All Agents are currently idle.").FontSize(13).TextColor(t.TextMuted)
				} else {
					ui.Column(c).FillWidth().Gap(8).Children(func() {
						for _, run := range snap.ActiveRuns {
							ui.Row(c.Key(run.RunID)).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
								ui.Text(c, run.Agent.DisplayName).FontSize(14).FontWeight(600).TextColor(t.Text)
								components.StatusPill(c, run.Status, components.ToneInfo)
							})
						}
					})
				}
			})

			if snap.LocalModels != nil {
				components.SectionCard(c, "Local Models", snap.LocalModels.Computer.DisplayName, func() {
					components.StatusPill(c, fmt.Sprintf("%d models", len(snap.LocalModels.Models)), components.ToneInfo)
				}, func() {
					for _, mv := range snap.LocalModels.Models {
						ui.Row(c.Key(mv.Model.ID)).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
							ui.Text(c, mv.Model.Name).FontSize(13).TextColor(t.Text).MaxLines(1)
							components.StatusPill(c, mv.Model.State, components.ToneNeutral)
						})
					}
				})
			}
		})
	})
}

func (s *Shell) viewWorkOverview(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
			if snap.ActiveHost == nil {
				components.EmptyState(c, theme.IconWork, "Work & Routines",
					"Connect to a host to manage Work Items, scheduled Routines, and Pocket Notes.",
					"Open Connection Hub", s.openConnectHub)
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
					"Open Connection Hub", s.openConnectHub)
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

func (s *Shell) viewMoreSettings(c *ui.Context, snap state.Snapshot, r *ui.Route) {
	t := c.Theme()
	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
			// Account / Host card
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

			// Appearance selector (System / Town Light / Town Dark)
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

			// Security & Privacy
			components.SectionCard(c, "Security", "Protect paired desktop tokens on this device", nil, func() {
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
				if snap.Prefs.BiometricLock {
					lockBtn := components.SecondaryTouchButton(c, "Lock Now", false)
					lockBtn.FillWidth()
					if lockBtn.Clicked() {
						s.store.SetBiometricLocked(true)
					}
				}
			})

			// Session controls
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
			// On desktop preview where biometric hardware is unsupported, allow unlocking cleanly.
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

func (s *Shell) openConnectHub() {
	s.store.SetActiveTab(state.TabMore)
	s.store.Routers[state.TabMore].Push("/more/connect")
}

func (s *Shell) refreshAsync() {
	go func() {
		_ = s.store.RefreshActiveHost(context.Background())
	}()
}
