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
	"github.com/egoist/mygo/ui/mobile"
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

		// Tab top navigation bar with live connection health chip.
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
			ui.Box(c).FillWidth().Padding(6, 12, 0, 12).Shrink(0).Children(func() {
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

		// 5-destination mobile bottom tab bar with live Unread, Approvals, and Work badges.
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

		selected := activeTab
		bar := mobile.BottomBar(c, &selected,
			mobile.BarButton{Label: i18n.T("tab.rooms"), Icon: theme.IconRooms, Badge: roomsBadge},
			mobile.BarButton{Label: i18n.T("tab.live"), Icon: theme.IconLive, Badge: liveBadge},
			mobile.BarButton{Label: i18n.T("tab.work"), Icon: theme.IconWork, Badge: workBadge},
			mobile.BarButton{Label: i18n.T("tab.library"), Icon: theme.IconLibrary},
			mobile.BarButton{Label: i18n.T("tab.more"), Icon: theme.IconMore},
		)
		if bar.Changed() {
			mygo.Haptics.Light()
			s.store.SetActiveTab(selected)
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
	title := s.topBarTitle(tab, router)

	var leading func()
	if router.CanGoBack() {
		leading = func() {
			if components.TopBarIconButton(c, i18n.T("nav.back"), theme.IconBack, t.Accent).Clicked() {
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
	ex := theme.Extra(t)
	s.mu.Lock()
	unlockErr := s.unlockError
	unlocking := s.unlocking
	unsupported := s.biometricUnsupported
	s.mu.Unlock()

	ui.Column(c).Fill().AlignItems(ui.Center).Justify(ui.Center).Padding(24, 24).Gap(16).
		Role(ui.RoleDialog).Label(i18n.T("auth.biometric_title")).Children(func() {
		ui.Row(c).Size(64, 64).Radius(32).Background(ex.InfoTint).AlignItems(ui.Center).Justify(ui.Center).Children(func() {
			theme.IconBox(c, 32, t.Accent, theme.IconLock)
		})
		ui.Text(c, i18n.T("auth.locked_title")).FontSize(20).Bold().TextColor(t.Text).TextAlign(ui.Center)
		ui.Text(c, i18n.T("auth.locked_subtitle")).
			FontSize(13).TextColor(t.TextMuted).TextAlign(ui.Center)
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
