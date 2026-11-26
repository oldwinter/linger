// Package live implements Tab 2: Live Ops (Active Runs across rooms, Pending
// Approvals Inbox with all 12 Decision Cards, Agents & Skills Manager, and
// Compute / Local Computers / Local Models / BYOK control center).
package live

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/egoist/mygo/ui/netimage"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// Segment indices for Tab 2 Live Ops.
const (
	SegmentRuns      = 0
	SegmentApprovals = 1
	SegmentAgents    = 2
	SegmentCompute   = 3
)

// NavigationHooks connects Tab 2 Live actions cleanly to Rooms, Terminals, and Settings.
type NavigationHooks struct {
	OnOpenConnect     func()
	OnOpenRoom        func(roomID string)
	OnWatchRun        func(roomID, runID string)
	OnOpenSettingsKey func(kind, key string)
	OnOpenTerminals   func(computerID string)
}

// Controller manages Tab 2 Live Ops state, sheets, busy locks, and sub-segments.
type Controller struct {
	store *state.AppStore
	nav   NavigationHooks

	mu             sync.Mutex
	segment        int
	refresh        ui.RefreshState
	decisionStates map[string]*components.DecisionCardState
	swipeStates    map[string]*mobile.SwipeState
	inlineNotice   string

	// Zoom lightbox for decision screenshots
	zoomOpen  bool
	zoomURL   string
	zoomTitle string
	zoomState mobile.ZoomState

	// Agents & Skills sheets
	selectedAgent    *api.TenantAgent
	agentSheetOpen   bool
	agentEditName    string
	agentEditDesc    string
	agentEditInstr   string
	agentEditModel   string
	agentBindings    []api.AgentSkillBinding
	agentBusy        bool
	deleteAgentOpen  bool
	createAgentOpen  bool
	newAgentName     string
	newAgentDesc     string
	newAgentInstr    string
	newAgentModel    string
	newAgentTemplate string

	// Confirmation ActionSheets for destructive/disruptive Live Ops actions
	stopRunConfirmOpen  bool
	stopRunTarget       api.RoomRunStatus
	stopRunRoomName     string
	makeRoomConfirmOpen bool
	makeRoomComputerID  string
	makeRoomModelID     string
	makeRoomModelName   string
	makeRoomUnloadIDs   []string
	makeRoomUnloadNames []string

	// Compute / Local Models / Permissions / Browser / BYOK state
	selectedComputerID string
	modelBusy          map[string]string // modelID -> action in flight
	removeModelOpen    bool
	removeModelID      string
	removeModelName    string
	recheckBusy        bool
	permSheetOpen      bool
	permStatus         *api.ComputerPermissionStatus
	browserSheetOpen   bool
	browserStatus      *api.BrowserConnectionStatus
	browserProfile     string
	scanResult         string

	// Model Source & BYOK form state
	subRuntime    string
	byokSheetOpen bool
	byokMode      string
	byokRuntime   string
	byokBaseURL   string
	byokPath      string
	byokEndpoint  string
	byokProtocol  string
	byokModelID   string
	byokAPIKey    string
	byokBusy      bool
	byokTestMsg   string
	byokModels    []api.ByokModel
}

// NewController constructs a Tab 2 Live Ops controller.
func NewController(store *state.AppStore, nav NavigationHooks) *Controller {
	return &Controller{
		store:          store,
		nav:            nav,
		decisionStates: map[string]*components.DecisionCardState{},
		swipeStates:    map[string]*mobile.SwipeState{},
		modelBusy:      map[string]string{},
		byokMode:       "local",
		byokRuntime:    "pi",
		byokProtocol:   "openai-chat",
		byokPath:       "/v1",
		byokEndpoint:   "/chat/completions",
	}
}

// SelectSegment switches between Runs (0), Approvals (1), Agents (2), and Compute (3).
func (ctl *Controller) SelectSegment(idx int) {
	if idx >= SegmentRuns && idx <= SegmentCompute {
		ctl.mu.Lock()
		ctl.segment = idx
		ctl.mu.Unlock()
	}
}

// OpenComputeSection jumps directly to Compute (and optionally opens permissions or browser sheet).
func (ctl *Controller) OpenComputeSection(computerID, section string) {
	ctl.mu.Lock()
	ctl.segment = SegmentCompute
	if computerID != "" {
		ctl.selectedComputerID = computerID
	}
	ctl.mu.Unlock()
	switch section {
	case "permissions":
		ctl.openPermissionsSheet(computerID)
	case "browser":
		ctl.openBrowserSheet(computerID)
	}
}

// Route renders Tab 2 inside Tab 2's ui.Router.
func (ctl *Controller) Route(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	r.Title(i18n.T("live.title"))
	ctl.View(c, snap)
}

// View renders the segmented Tab 2 Live Control view.
func (ctl *Controller) View(c *ui.Context, snap state.Snapshot) {
	ctl.store.DrainUI()
	ctl.mu.Lock()
	seg := ctl.segment
	notice := ctl.inlineNotice
	ctl.mu.Unlock()

	activeCount := 0
	for _, run := range snap.ActiveRuns {
		if run.Status == "active" {
			activeCount++
		}
	}
	runsLbl := i18n.T("live.tab.runs")
	if activeCount > 0 {
		runsLbl = i18n.Tf("live.tab.runs_count", map[string]any{"count": activeCount})
	}
	appLbl := i18n.T("live.tab.approvals")
	if len(snap.PendingDecisions) > 0 {
		appLbl = i18n.Tf("live.tab.approvals_count", map[string]any{"count": len(snap.PendingDecisions)})
	}

	m := layout.Of(c)

	ui.Column(c).Fill().Children(func() {
		layout.ReadableWrap(c, m.ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(8, 12, 6, 12).Gap(8).Children(func() {
				if snap.OfflineViewingCache {
					components.StatusBanner(c, components.ToneWarning, i18n.T("live.offline_banner"), "", nil)
				} else if snap.TransientError != "" {
					components.StatusBanner(c, components.ToneDanger, snap.TransientError, i18n.T("common.dismiss"), func() {
						ctl.store.ClearTransientError()
					})
				}
				if notice != "" {
					components.StatusBanner(c, components.ToneSuccess, notice, i18n.T("common.ok"), func() {
						ctl.mu.Lock()
						ctl.inlineNotice = ""
						ctl.mu.Unlock()
					})
				}

				if components.SegmentedControl(c, &seg, runsLbl, appLbl, i18n.T("live.tab.agents"), i18n.T("live.tab.compute")) {
					ctl.SelectSegment(seg)
				}
			})
		})

		if snap.ActiveHost == nil && len(snap.ActiveRuns) == 0 && len(snap.PendingDecisions) == 0 && len(snap.Agents) == 0 {
			components.EmptyState(c, theme.IconLive, i18n.T("live.empty_title"),
				i18n.T("live.empty_body"),
				i18n.T("rooms.open_hub"), func() {
					if ctl.nav.OnOpenConnect != nil {
						ctl.nav.OnOpenConnect()
					}
				})
			return
		}

		// Per-segment keyed scroll container preserves independent scroll state!
		scroll := ui.Scroll(c.Key(fmt.Sprintf("live_seg_%d", seg))).FillWidth().Grow(1).Basis(0)
		if scroll.PullToRefresh(&ctl.refresh) {
			go func() {
				_ = ctl.store.RefreshActiveHost(context.Background())
				ctl.store.EnqueueUI(func() {
					ctl.refresh.Refreshing = false
				})
			}()
		}
		scroll.Children(func() {
			layout.ReadableWrap(c, m.ReadableMaxWidth, func() {
				ui.Column(c).FillWidth().Padding(8, 14, 24, 14).Gap(12).Children(func() {
					switch seg {
					case SegmentRuns:
						ctl.viewActiveRuns(c, snap)
					case SegmentApprovals:
						ctl.viewApprovalsInbox(c, snap)
					case SegmentAgents:
						ctl.viewAgents(c, snap)
					case SegmentCompute:
						ctl.viewCompute(c, snap)
					}
				})
			})
		})
	})

	// Modal sheets across Live segments.
	ctl.viewZoomLightbox(c)
	ctl.viewStopRunConfirm(c)
	ctl.viewMakeRoomConfirm(c)
	ctl.viewAgentDetailSheet(c, snap)
	ctl.viewCreateAgentSheet(c, snap)
	ctl.viewDeleteAgentConfirm(c)
	ctl.viewRemoveModelConfirm(c, snap)
	ctl.viewPermissionsSheet(c, snap)
	ctl.viewBrowserSheet(c, snap)
	ctl.viewBYOKSheet(c, snap)
}

func (ctl *Controller) viewActiveRuns(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	if len(snap.ActiveRuns) == 0 {
		components.EmptyState(c, theme.IconLive, i18n.T("live.runs_idle_title"),
			i18n.T("live.runs_idle_body"),
			i18n.T("common.refresh"), func() {
				go func() { _ = ctl.store.RefreshActiveHost(context.Background()) }()
			})
		return
	}

	roomNames := map[string]string{}
	for _, rm := range snap.Rooms {
		roomNames[rm.ID] = rm.Name
	}

	cols := 1
	if layout.Of(c).Class == layout.ClassExpanded {
		cols = 2
	}
	layout.TwoColumnCards(c, cols, 10, len(snap.ActiveRuns), func(i int) {
		run := snap.ActiveRuns[i]
		rName := roomNames[run.RoomID]
		if rName == "" {
			rName = run.RoomID
		}
		tone := components.ToneInfo
		switch run.Status {
		case "completed":
			tone = components.ToneSuccess
		case "aborted":
			tone = components.ToneDanger
		}
		elapsed := formatElapsedSince(run.CreatedAt)

		card := ui.Column(c.Key(run.RunID)).FillWidth().Background(t.Surface).Radius(16).Padding(14, 15).Gap(10)
		components.ApplyCardElevation(card, t)
		card.Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(11).Children(func() {
				components.AvatarBadge(c, run.Agent.DisplayName, 40)
				ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
					ui.Text(c, run.Agent.DisplayName).FontSize(15.5).FontWeight(600).LetterSpacing(-0.15).TextColor(t.Text).MaxLines(1)
					ui.Text(c, i18n.Tf("live.run_meta", map[string]any{"room": rName, "elapsed": elapsed})).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
				})
				components.StatusDotPill(c, i18n.StatusLabel(run.Status), tone)
			})
			ui.Text(c, i18n.Tf("live.run_ordinal", map[string]any{"ordinal": run.EventOrdinal, "id": run.RunID})).FontSize(12).TextColor(theme.Extra(t).TextSubtle)
			ui.Row(c).FillWidth().Gap(8).Children(func() {
				watchLabel := i18n.T("chat.view_run")
				if run.Status == "active" {
					watchLabel = i18n.T("chat.watch_live")
				}
				watchBtn := components.PrimaryTouchButton(c, watchLabel, false)
				watchBtn.Grow(1).Basis(0)
				if watchBtn.Clicked() && ctl.nav.OnWatchRun != nil {
					ctl.nav.OnWatchRun(run.RoomID, run.RunID)
				}
				if run.Status == "active" {
					stopBtn := components.DangerTouchButton(c, i18n.T("live.stop_btn"), false)
					if stopBtn.Clicked() {
						ctl.mu.Lock()
						ctl.stopRunTarget = run
						ctl.stopRunRoomName = rName
						ctl.stopRunConfirmOpen = true
						ctl.mu.Unlock()
					}
				}
			})
		})
	})
}

func (ctl *Controller) viewStopRunConfirm(c *ui.Context) {
	ctl.mu.Lock()
	run := ctl.stopRunTarget
	roomName := ctl.stopRunRoomName
	ctl.mu.Unlock()
	if run.RunID == "" {
		ctl.stopRunConfirmOpen = false
		return
	}
	mobile.ActionSheet(c, &ctl.stopRunConfirmOpen, mobile.ActionSheetOptions{
		Title:   i18n.T("run.stop_dialog_title"),
		Message: i18n.Tf("live.stop_confirm_body", map[string]any{"agent": run.Agent.DisplayName, "room": roomName}),
		Cancel:  i18n.T("run.keep_running"),
	}, mobile.Action{
		Label:       i18n.T("run.stop_now"),
		Destructive: true,
		OnTap: func() {
			components.HapticWarning()
			go func() { _ = ctl.store.CancelRun(context.Background(), run.RoomID, run.RunID) }()
		},
	})
}

func (ctl *Controller) viewApprovalsInbox(c *ui.Context, snap state.Snapshot) {
	if len(snap.PendingDecisions) == 0 {
		components.EmptyState(c, theme.IconCheck, i18n.T("live.approvals_empty_title"),
			i18n.T("live.approvals_empty_body"),
			i18n.T("common.refresh"), func() {
				go func() { _ = ctl.store.RefreshActiveHost(context.Background()) }()
			})
		return
	}

	cb := components.DecisionCardCallbacks{
		ShowSourceRoomChip: true,
		ResolveURL: func(path string) string {
			if cl := ctl.store.Client(); cl != nil {
				return cl.ResolveEndpointURL(path)
			}
			return path
		},
		OnDecide: func(roomID, decisionID string, req api.DecisionRequest) {
			st := ctl.decisionStateFor(decisionID)
			go func() {
				_, _ = ctl.store.DecideCard(context.Background(), roomID, decisionID, req)
				st.SetBusy("")
			}()
		},
		OnOpenSettingsKey: ctl.nav.OnOpenSettingsKey,
		OnOpenCompute:     ctl.OpenComputeSection,
		OnZoomImage:       ctl.openZoom,
		OnJumpToRoom:      ctl.nav.OnOpenRoom,
	}

	for _, item := range snap.PendingDecisions {
		item := item
		components.DecisionCardView(c, item.RoomID, item.RoomName, item.Card, ctl.decisionStateFor(item.Card.DecisionID), cb)
	}
}

func (ctl *Controller) decisionStateFor(id string) *components.DecisionCardState {
	ctl.mu.Lock()
	defer ctl.mu.Unlock()
	st, ok := ctl.decisionStates[id]
	if !ok {
		st = &components.DecisionCardState{}
		ctl.decisionStates[id] = st
	}
	return st
}

func (ctl *Controller) swipeStateFor(id string) *mobile.SwipeState {
	ctl.mu.Lock()
	defer ctl.mu.Unlock()
	st, ok := ctl.swipeStates[id]
	if !ok {
		st = &mobile.SwipeState{}
		ctl.swipeStates[id] = st
	}
	return st
}

func (ctl *Controller) openZoom(url, title string) {
	ctl.mu.Lock()
	ctl.zoomURL = url
	ctl.zoomTitle = title
	ctl.zoomState.Reset()
	ctl.zoomOpen = true
	ctl.mu.Unlock()
}

func (ctl *Controller) viewZoomLightbox(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.zoomOpen, mobile.SheetOptions{Detents: []float32{0.88}, Label: i18n.T("live.screenshot_title")}, func() {
		ctl.mu.Lock()
		u := ctl.zoomURL
		title := ctl.zoomTitle
		ctl.mu.Unlock()
		ui.Column(c).Fill().Padding(10, 12, 16, 12).Gap(8).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
				ui.Text(c, title).FontSize(15).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
				if components.SecondaryTouchButton(c, i18n.T("common.close"), false).Clicked() {
					ctl.zoomOpen = false
				}
			})
			mobile.Zoomable(c, &ctl.zoomState, mobile.ZoomOptions{Min: 1, Max: 4, DoubleTap: 2}, func() {
				netimage.Image(c, u, netimage.Options{Fit: ui.Contain, MaxSide: 2048, NoFade: true}).Fill()
			}).FillWidth().Grow(1).Basis(0)
		})
	})
}

func (ctl *Controller) setNotice(msg string) {
	ctl.mu.Lock()
	ctl.inlineNotice = msg
	ctl.mu.Unlock()
}

func formatElapsedSince(ts time.Time) string {
	if ts.IsZero() {
		return i18n.FormatElapsed(0)
	}
	return i18n.FormatElapsed(int64(time.Since(ts).Seconds()))
}

func formatBytesGB(b int64) string {
	return i18n.FormatMemorySize(b)
}

func nonEmptyOr(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}
