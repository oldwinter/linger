// Package shell implements Linger Mobile's 5-tab navigation shell
// (Rooms, Live, Work, Library, More), Biometric Lock Gate, Town Light/Dark
// theme integration, toast notifications, and full 5-tab screen routing.
package shell

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
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/screens/connect"
	"github.com/oldwinter/linger/mobile/internal/screens/library"
	"github.com/oldwinter/linger/mobile/internal/screens/live"
	"github.com/oldwinter/linger/mobile/internal/screens/rooms"
	"github.com/oldwinter/linger/mobile/internal/screens/settings"
	"github.com/oldwinter/linger/mobile/internal/screens/work"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// TabHooks lets callers or tests override Tabs 3/4/5 route views cleanly.
type TabHooks struct {
	RouteWork    func(c *ui.Context, r *ui.Route, snap state.Snapshot)
	RouteLibrary func(c *ui.Context, r *ui.Route, snap state.Snapshot)
	RouteMore    func(c *ui.Context, r *ui.Route, snap state.Snapshot) bool
}

// Shell owns the root 5-tab view, Biometric Lock Gate, toast overlay, and all 5 tab controllers.
type Shell struct {
	store       *state.AppStore
	connectHub  *connect.Hub
	roomsCtl    *rooms.Controller
	liveCtl     *live.Controller
	workScr     *work.Screen
	libraryScr  *library.Screen
	settingsScr *settings.Screen
	systemDark  func() bool

	mu                   sync.Mutex
	hooks                TabHooks
	syncedKey            string
	toastMessage         string
	toastUntil           time.Time
	unlockError          string
	unlocking            bool
	biometricUnsupported bool
	biometricAvail       biometrics.Kind
	authenticateFn       func(context.Context, string) error
}

// New constructs a Shell bound to store with all 5 tabs (Rooms, Live, Work, Library, More) wired.
func New(store *state.AppStore, systemDark func() bool) *Shell {
	if systemDark == nil {
		systemDark = func() bool { return false }
	}
	s := &Shell{
		store:      store,
		connectHub: connect.NewHub(store),
		systemDark: systemDark,
	}
	s.connectHub.SetOnOpenPreferences(func() {
		s.OpenMoreRoute("/more/settings?focus=prefs")
	})
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
	s.workScr = work.New(work.Deps{
		Store:      store,
		OnOpenRoom: s.OpenRoom,
		ShowToast:  s.ShowToast,
		OnNotify:   store.Notify,
	})
	s.libraryScr = library.New(library.Deps{
		Store:      store,
		OnOpenRoom: s.OpenRoom,
		ShowToast:  s.ShowToast,
		OnNotify:   store.Notify,
	})
	s.settingsScr = settings.New(settings.Deps{
		Store:         store,
		OnOpenRoom:    s.OpenRoom,
		OnOpenConnect: s.OpenConnect,
		OnComposerReturnChanged: func(sendOnEnter bool) {
			store.SetComposerReturnSends(sendOnEnter)
		},
		OnClearCache: func(ctx context.Context) error {
			return store.ClearCache(ctx)
		},
		OnSignOut: func() {
			store.Disconnect()
			s.OpenConnect()
		},
		ShowToast: s.ShowToast,
		OnNotify:  store.Notify,
	})
	return s
}

// Close releases background workers and native WebViews owned by child tab screens.
func (s *Shell) Close() {
	if s.roomsCtl != nil {
		s.roomsCtl.Close()
	}
	if s.workScr != nil {
		s.workScr.Close()
	}
	if s.libraryScr != nil {
		s.libraryScr.Close()
	}
}

// SetTabHooks registers optional override renderers for Tabs 3/4/5.
func (s *Shell) SetTabHooks(hooks TabHooks) {
	s.mu.Lock()
	s.hooks = hooks
	s.mu.Unlock()
}

// SetWindow passes the host mygo.Window down to platform-aware child controllers.
func (s *Shell) SetWindow(w *mygo.Window) {
	s.connectHub.SetWindow(w)
	s.roomsCtl.SetWindow(w)
	if s.libraryScr != nil {
		s.libraryScr.SetWindow(w)
	}
}

// ShowToast displays a brief non-blocking toast message at the top of the shell.
func (s *Shell) ShowToast(msg string) {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return
	}
	s.mu.Lock()
	s.toastMessage = msg
	s.toastUntil = time.Now().Add(4 * time.Second)
	s.mu.Unlock()
	s.store.Notify()
}

// ConnectHub returns the embedded Connection Hub controller.
func (s *Shell) ConnectHub() *connect.Hub { return s.connectHub }

// Rooms returns Tab 1's Rooms controller.
func (s *Shell) Rooms() *rooms.Controller { return s.roomsCtl }

// Live returns Tab 2's Live Control controller.
func (s *Shell) Live() *live.Controller { return s.liveCtl }

// Work returns Tab 3's Work screen controller.
func (s *Shell) Work() *work.Screen { return s.workScr }

// Library returns Tab 4's Library screen controller.
func (s *Shell) Library() *library.Screen { return s.libraryScr }

// Settings returns Tab 5's More/Settings screen controller.
func (s *Shell) Settings() *settings.Screen { return s.settingsScr }

// RefreshAllTabs triggers background sync for Work, Library, and Settings screens.
func (s *Shell) RefreshAllTabs(ctx context.Context) {
	if s.workScr != nil {
		go s.workScr.Refresh(ctx)
	}
	if s.libraryScr != nil {
		go s.libraryScr.Refresh(ctx)
	}
	if s.settingsScr != nil {
		go s.settingsScr.Refresh(ctx)
	}
}

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
	if s.store.Routers[state.TabMore].Path() != "/more/connect" {
		s.store.Routers[state.TabMore].Push("/more/connect")
	}
}

// OpenMoreRoute switches to Tab 5 More and navigates to a target section or sub-route.
func (s *Shell) OpenMoreRoute(target string) {
	s.store.SetActiveTab(state.TabMore)
	if strings.HasPrefix(target, "/more/connect") {
		if s.store.Routers[state.TabMore].Path() != "/more/connect" {
			s.store.Routers[state.TabMore].Push("/more/connect")
		}
		return
	}
	s.applySettingsDeepLink(target)
	if s.store.Routers[state.TabMore].Path() != "/more" {
		s.store.Routers[state.TabMore].Replace("/more")
	}
}

// OpenLiveCompute switches to Tab 2 Compute segment and optionally opens permissions or browser sheet.
func (s *Shell) OpenLiveCompute(computerID, section string) {
	s.store.SetActiveTab(state.TabLive)
	s.liveCtl.OpenComputeSection(computerID, section)
}

func (s *Shell) applySettingsDeepLink(target string) {
	if s.settingsScr == nil {
		return
	}
	low := strings.ToLower(target)
	switch {
	case strings.Contains(low, "focus=provider_key"), strings.Contains(low, "focus=search_key"),
		strings.Contains(low, "focus=connection_auth"), strings.Contains(low, "integrations"), strings.Contains(low, "connectors"):
		s.settingsScr.SelectSection(settings.SectionIntegrations)
	case strings.Contains(low, "rules"):
		s.settingsScr.SelectSection(settings.SectionRules)
	case strings.Contains(low, "profile"):
		s.settingsScr.SelectSection(settings.SectionProfile)
	case strings.Contains(low, "prefs"), strings.Contains(low, "preferences"), strings.Contains(low, "security"):
		s.settingsScr.SelectSection(settings.SectionPreferences)
	}
}

func (s *Shell) maybeSyncTabsForConnection(snap state.Snapshot) {
	if snap.Phase != state.PhaseConnected || snap.TenantID == "" {
		return
	}
	hostID := ""
	if snap.ActiveHost != nil {
		hostID = snap.ActiveHost.ID
	}
	key := hostID + "|" + snap.TenantID
	s.mu.Lock()
	if s.syncedKey == key {
		s.mu.Unlock()
		return
	}
	s.syncedKey = key
	s.mu.Unlock()
	s.RefreshAllTabs(context.Background())
}

// View renders the entire Linger Mobile application inside a MyGo window or ui.Tester.
func (s *Shell) View(c *ui.Context) {
	s.store.DrainUI()
	snap := s.store.Snapshot()
	s.maybeSyncTabsForConnection(snap)
	resolvedTheme := theme.Resolve(snap.Prefs.Theme, s.systemDark())
	c.SetTheme(resolvedTheme)
	t := c.Theme()

	// MyGo's window root already keeps content inside SafeArea insets; do not add
	// SafeArea padding a second time so TopBar and BottomBar sit flush with system bars.
	root := ui.Column(c).Fill().Background(t.Background)
	root.Children(func() {
		if snap.BiometricLocked {
			s.viewBiometricLockGate(c)
			return
		}

		activeTab := snap.ActiveTab
		router := s.store.Routers[activeTab]

		// Editorial top navigation bar with live connection health beacon.
		s.viewTopBar(c, snap, activeTab, router)

		// Optional transient toast banner.
		s.mu.Lock()
		toastMsg := s.toastMessage
		if toastMsg != "" && !s.toastUntil.IsZero() && time.Now().After(s.toastUntil) {
			s.toastMessage = ""
			toastMsg = ""
		}
		s.mu.Unlock()
		if toastMsg != "" {
			ui.Box(c).FillWidth().Padding(4, 14, 4, 14).Shrink(0).Children(func() {
				components.StatusBanner(c, components.ToneSuccess, toastMsg, i18n.T("common.ok"), func() {
					s.mu.Lock()
					s.toastMessage = ""
					s.mu.Unlock()
				})
			})
		}

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

		// Refined 5-destination elevated dock bar with duotone active icons and haloed badges.
		s.viewBottomBar(c, snap, activeTab)
	})
}

type navTabSpec struct {
	Index      int
	Label      string
	Icon       theme.IconFunc
	ActiveIcon theme.IconFunc
	Badge      string
	BadgeColor ui.Color
	BadgeText  ui.Color
}

func (s *Shell) viewBottomBar(c *ui.Context, snap state.Snapshot, activeTab int) {
	t := c.Theme()
	ex := theme.Extra(t)

	var unreadTotal int64
	for _, rm := range snap.Rooms {
		unreadTotal += rm.UnreadMessageCount
	}
	roomsBadge := formatBadge(int(unreadTotal))

	liveAttention := len(snap.PendingDecisions)
	if liveAttention == 0 {
		for _, run := range snap.ActiveRuns {
			if run.Status == "active" {
				liveAttention++
			}
		}
	}
	liveBadge := formatBadge(liveAttention)

	workBadge := ""
	if s.workScr != nil {
		workBadge = formatBadge(s.workScr.BadgeCount())
	}

	tabs := []navTabSpec{
		{
			Index:      state.TabRooms,
			Label:      i18n.T("tab.rooms"),
			Icon:       theme.IconRooms,
			ActiveIcon: theme.IconRoomsActive,
			Badge:      roomsBadge,
			BadgeColor: t.Danger,
			BadgeText:  ui.Hex("#FFFFFF"),
		},
		{
			Index:      state.TabLive,
			Label:      i18n.T("tab.live"),
			Icon:       theme.IconLive,
			ActiveIcon: theme.IconLiveActive,
			Badge:      liveBadge,
			BadgeColor: ex.Brand,
			BadgeText:  ui.Hex("#171714"),
		},
		{
			Index:      state.TabWork,
			Label:      i18n.T("tab.work"),
			Icon:       theme.IconWork,
			ActiveIcon: theme.IconWorkActive,
			Badge:      workBadge,
			BadgeColor: t.Accent,
			BadgeText:  t.AccentText,
		},
		{
			Index:      state.TabLibrary,
			Label:      i18n.T("tab.library"),
			Icon:       theme.IconLibrary,
			ActiveIcon: theme.IconLibraryActive,
		},
		{
			Index:      state.TabMore,
			Label:      i18n.T("tab.more"),
			Icon:       theme.IconMore,
			ActiveIcon: theme.IconMoreActive,
		},
	}

	dock := ui.Row(c).FillWidth().Background(t.Surface).Padding(6, 6, 6, 6).Gap(2).Shrink(0).
		BorderWidth(0.75, 0, 0, 0).BorderColor(ex.SubtleBorder).
		Role(ui.RoleTabList).Label("Navigation")
	if !t.Dark {
		dock.Shadow(0, -2, 12, 0, ex.CardShadow)
	}
	dock.Children(func() {
		for _, item := range tabs {
			item := item
			active := item.Index == activeTab
			iconCol := ex.TextSubtle
			lblCol := ex.TextSubtle
			iconFn := item.Icon
			pillBg := ui.Transparent
			if active {
				iconCol = t.Text
				lblCol = t.Text
				iconFn = item.ActiveIcon
				pillBg = ex.MutedBg
			}

			tabBtn := ui.Column(c.Key(item.Index)).Grow(1).Basis(0).MinHeight(48).Padding(2, 2).Gap(3).
				Radius(12).AlignItems(ui.Center).Justify(ui.Center).
				Role(ui.RoleTab).Label(item.Label).Checked(active)
			if tabBtn.Pressed() {
				tabBtn.Scale(0.95, 0.95)
			}
			tabBtn.Children(func() {
				pill := ui.Row(c).Size(46, 27).Radius(13.5).Background(pillBg).
					AlignItems(ui.Center).Justify(ui.Center)
				if item.Badge != "" {
					badgeTxt := item.Badge
					badgeBg := item.BadgeColor
					badgeFg := item.BadgeText
					surf := t.Surface
					pill.DrawOver(func(p *ui.Painter, r ui.Rect) {
						bw := float32(16)
						if len(badgeTxt) >= 2 {
							bw = 21
						}
						if len(badgeTxt) >= 3 {
							bw = 26
						}
						bh := float32(16)
						bx := r.X + r.W - bw + 3
						by := r.Y - 3
						outer := ui.Rect{X: bx - 1.5, Y: by - 1.5, W: bw + 3, H: bh + 3}
						p.Fill(outer, surf, (bh+3)/2)
						p.Fill(ui.Rect{X: bx, Y: by, W: bw, H: bh}, badgeBg, bh/2)
						tw, th := p.MeasureText(0, ui.Span{Text: badgeTxt, Size: 9.5})
						tx := bx + (bw-tw)/2
						if tx < bx+2 {
							tx = bx + 2
						}
						ty := by + (bh-th)/2
						p.Text(tx, ty, badgeTxt, 9.5, badgeFg)
					})
				}
				pill.Children(func() {
					theme.IconBox(c, 20, iconCol, iconFn)
				})
				txt := ui.Text(c, item.Label).FontSize(10.5).TextColor(lblCol).NoWrap().MaxLines(1)
				if active {
					txt.FontWeight(600)
				} else {
					txt.FontWeight(500)
				}
			})
			if tabBtn.Clicked() && !active {
				mygo.Haptics.Light()
				s.store.SetActiveTab(item.Index)
			}
		}
	})
}

func formatBadge(n int) string {
	if n <= 0 {
		return ""
	}
	if n > 99 {
		return "99+"
	}
	return fmt.Sprintf("%d", n)
}

func (s *Shell) viewTopBar(c *ui.Context, snap state.Snapshot, tab int, router *ui.Router) {
	t := c.Theme()
	ex := theme.Extra(t)
	title := s.topBarTitle(tab, router)

	tlsPinned := snap.ActiveHost != nil && snap.ActiveHost.TLS && snap.ActiveHost.TLSFingerprint != ""
	plainHTTP := snap.ActiveHost != nil && !snap.ActiveHost.TLS
	connected := snap.Phase == state.PhaseConnected
	hostName := ""
	if snap.ActiveHost != nil {
		hostName = snap.ActiveHost.Name
	}

	if router.CanGoBack() {
		// Compact pushed sub-screen bar with back chevron and hairline separator.
		ui.Row(c).FillWidth().MinHeight(48).Padding(4, 14, 6, 6).Gap(6).Background(t.Background).
			AlignItems(ui.Center).BorderWidth(0, 0, 0.75, 0).BorderColor(ex.Divider).Shrink(0).Children(func() {
			if components.TopBarIconButton(c, i18n.T("nav.back"), theme.IconBack, t.Text).Clicked() {
				router.Back()
			}
			ui.Text(c, title).FontSize(16.5).FontWeight(600).LetterSpacing(-0.2).TextColor(t.Text).
				Grow(1).Basis(0).MaxLines(1)
			components.ConnectionHealthChip(c, hostName, connected, tlsPinned, plainHTTP, snap.RTTMs, s.OpenConnect)
		})
		return
	}

	// Editorial root-tab header: bold left-aligned display title flowing seamlessly onto canvas.
	ui.Row(c).FillWidth().MinHeight(50).Padding(8, 16, 6, 16).Gap(10).Background(t.Background).
		AlignItems(ui.Center).Justify(ui.SpaceBetween).Shrink(0).Children(func() {
		ui.Text(c, title).FontSize(24).FontWeight(700).LetterSpacing(-0.5).TextColor(t.Text).
			Grow(1).Basis(0).MaxLines(1)
		components.ConnectionHealthChip(c, hostName, connected, tlsPinned, plainHTTP, snap.RTTMs, s.OpenConnect)
	})
}

func (s *Shell) topBarTitle(tab int, router *ui.Router) string {
	if title := router.Title(); title != "" {
		return title
	}
	switch tab {
	case state.TabRooms:
		return i18n.T("tab.rooms")
	case state.TabLive:
		return i18n.T("tab.live")
	case state.TabWork:
		return i18n.T("tab.work")
	case state.TabLibrary:
		return i18n.T("tab.library")
	default:
		return i18n.T("tab.more")
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
	r.Title(i18n.T("tab.work"))
	if s.workScr != nil {
		s.workScr.View(c)
		return
	}
}

func (s *Shell) routeLibrary(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	s.mu.Lock()
	hook := s.hooks.RouteLibrary
	s.mu.Unlock()
	if hook != nil {
		hook(c, r, snap)
		return
	}
	r.Title(i18n.T("tab.library"))
	if s.libraryScr != nil {
		s.libraryScr.View(c)
		return
	}
}

func (s *Shell) routeMore(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	if r.Match("/more/connect") {
		r.Title(i18n.T("nav.connect"))
		s.connectHub.View(c)
		return
	}
	s.mu.Lock()
	hook := s.hooks.RouteMore
	s.mu.Unlock()
	if hook != nil && hook(c, r, snap) {
		return
	}
	r.Title(i18n.T("tab.more"))
	if s.settingsScr != nil {
		s.settingsScr.View(c)
		return
	}
}

func (s *Shell) viewBiometricLockGate(c *ui.Context) {
	t := c.Theme()
	s.mu.Lock()
	unlockErr := s.unlockError
	unlocking := s.unlocking
	unsupported := s.biometricUnsupported
	s.mu.Unlock()

	ui.Column(c).Fill().AlignItems(ui.Center).Justify(ui.Center).Padding(24, 24).Gap(18).
		Role(ui.RoleDialog).Label(i18n.T("auth.biometric_title")).Children(func() {
		card := ui.Column(c).FillWidth().Background(t.Surface).Radius(22).Padding(28, 22).
			AlignItems(ui.Center).Gap(16)
		components.ApplyCardElevation(card, t)
		card.Children(func() {
			theme.IconBox(c, 58, t.Text, theme.IconBrandMark)
			ui.Column(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
				ui.Text(c, i18n.T("auth.locked_title")).FontSize(20).FontWeight(700).LetterSpacing(-0.3).
					TextColor(t.Text).TextAlign(ui.Center)
				ui.Text(c, i18n.T("auth.locked_subtitle")).
					FontSize(13.5).LineHeight(1.4).TextColor(t.TextMuted).TextAlign(ui.Center)
			})
			if unlockErr != "" {
				components.StatusBanner(c, components.ToneWarning, unlockErr, "", nil)
			}
			unlockBtn := components.PrimaryTouchButton(c, i18n.T("auth.unlock"), unlocking)
			unlockBtn.FillWidth()
			if unlockBtn.Clicked() {
				s.triggerBiometricUnlock()
			}
			if unsupported {
				disableBtn := components.DangerTouchButton(c, i18n.T("auth.disable_biometric"), false)
				disableBtn.FillWidth()
				if disableBtn.Clicked() {
					s.mu.Lock()
					s.biometricUnsupported = false
					s.unlockError = ""
					s.mu.Unlock()
					_ = s.store.SetBiometricPreference(false)
				}
			}
		})
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
		s.mu.Lock()
		authFn := s.authenticateFn
		s.mu.Unlock()
		if authFn == nil {
			authFn = biometrics.Authenticate
		}
		err := authFn(context.Background(), i18n.T("auth.unlock_prompt"))
		s.mu.Lock()
		s.unlocking = false
		switch {
		case err == nil:
			s.unlockError = ""
			s.biometricUnsupported = false
			s.mu.Unlock()
			s.store.SetBiometricLocked(false)
			return
		case errors.Is(err, errors.ErrUnsupported):
			// Fail closed: never auto-unlock when biometric hardware is unavailable.
			s.biometricUnsupported = true
			s.unlockError = i18n.T("auth.biometrics_unavailable")
		case errors.Is(err, biometrics.ErrCanceled):
			s.unlockError = i18n.T("auth.canceled")
		default:
			s.unlockError = i18n.Tf("auth.failed", map[string]any{"err": err.Error()})
		}
		s.mu.Unlock()
		s.store.Notify()
	}()
}
