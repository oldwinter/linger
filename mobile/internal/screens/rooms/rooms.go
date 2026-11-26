// Package rooms implements Tab 1: Rooms list with filters & SwipeRow actions,
// Catch-Up Walk, New Room/DM sheet, real-time Room Chat & Threads, rich
// IME-safe Composer with attachments/@mentions//skills, Live Run Watch,
// Mail Canvas preview, and Room Inspector.
package rooms

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// NavigationHooks connects Rooms actions to other tabs without tight coupling.
type NavigationHooks struct {
	OnOpenConnect     func()
	OnOpenSettingsKey func(kind, key string)
	OnOpenCompute     func(computerID, section string)
}

// Controller manages Tab 1 Rooms state, sheets, inspector, run watch, and composer state.
type Controller struct {
	store *state.AppStore
	nav   NavigationHooks
	win   *mygo.Window

	mu          sync.Mutex
	filter      int // 0: All, 1: Unread, 2: Working, 3: Direct, 4: Rooms
	refresh     ui.RefreshState
	swipeStates map[string]*mobile.SwipeState

	// Catch-Up Walk & New Room / DM sheets
	catchUpOpen   bool
	newRoomOpen   bool
	newRoomMode   int // 0: Group Room, 1: Direct Message
	newRoomName   string
	newRoomDesc   string
	selectedPeers map[string]bool
	creatingRoom  bool
	inlineNotice  string

	// Chat & Thread state
	loadedRooms        map[string]bool
	decisionStates     map[string]*components.DecisionCardState
	pendingUploads     map[string][]api.MessageAttachmentUpload
	replyTarget        map[string]*api.Message
	sendErrors         map[string]string
	uploadingRoom      string
	sendingRoom        string
	mentionSheetOpen   bool
	skillSheetOpen     bool
	msgActionSheetOpen bool
	msgActionTarget    *api.Message
	msgActionRoomID    string
	msgActionIsThread  bool
	reactSheetOpen     bool
	reactTargetMsg     *api.Message
	forwardSheetOpen   bool
	forwardTargetMsg   *api.Message

	// Zoomable image lightbox & opt-in HTML fragment WebView preview
	zoomOpen    bool
	zoomURL     string
	zoomTitle   string
	zoomState   mobile.ZoomState
	htmlOpen    bool
	htmlTitle   string
	htmlContent string
	htmlWebView *mygo.WebView

	// Mail Canvas modal
	mailOpen  bool
	mailDocID string
	mailState *api.MailCanvasState
	mailBusy  bool
	mailError string

	// Room Inspector sheet
	inspectorOpen   bool
	inspectorTab    int // 0: Info, 1: Members, 2: Pins & Docs, 3: team.md & Shares
	inspectorRoomID string
	inspMembers     []api.RoomMember
	inspPins        []api.Message
	inspDocs        []api.Document
	inspTeamMd      *api.TeamMdDocument
	inspShares      []api.RoomHistoryShare
	inspEditName    string
	inspEditDesc    string
	inspBusy        bool

	// Live Run Watch & Background Tasks state
	watchRoomID         string
	watchRunID          string
	cancelConfirmOpen   bool
	bgTasksOpen         bool
	bgTasks             []api.RoomBackgroundTask
	bgCancelConfirmOpen bool
	bgCancelTask        api.RoomBackgroundTask
	bgCancelRoomID      string
	expandedActivities  map[string]bool

	// Per-room message timeline scroll state (UI-thread-only map entries).
	chatScrolls    map[string]*ui.ScrollState
	scrollToBottom map[string]bool

	// Last viewed room ID for seamless fold <-> unfold split-pane continuity.
	lastRoomID string
}

// SetPendingUploadsForTest seeds pending upload chips for a room in automated tests.
func (ctl *Controller) SetPendingUploadsForTest(roomID string, uploads []api.MessageAttachmentUpload) {
	ctl.mu.Lock()
	ctl.pendingUploads[roomID] = append([]api.MessageAttachmentUpload(nil), uploads...)
	ctl.mu.Unlock()
}

// NewController constructs a Tab 1 Rooms controller.
func NewController(store *state.AppStore, nav NavigationHooks) *Controller {
	return &Controller{
		store:              store,
		nav:                nav,
		swipeStates:        map[string]*mobile.SwipeState{},
		selectedPeers:      map[string]bool{},
		loadedRooms:        map[string]bool{},
		decisionStates:     map[string]*components.DecisionCardState{},
		pendingUploads:     map[string][]api.MessageAttachmentUpload{},
		replyTarget:        map[string]*api.Message{},
		sendErrors:         map[string]string{},
		expandedActivities: map[string]bool{},
		chatScrolls:        map[string]*ui.ScrollState{},
		scrollToBottom:     map[string]bool{},
	}
}

// SetWindow attaches the mygo.Window for camera/WebView preview sheets.
func (ctl *Controller) SetWindow(w *mygo.Window) {
	ctl.mu.Lock()
	ctl.win = w
	ctl.mu.Unlock()
}

// Close releases any native WebViews or resources owned by the Rooms controller.
func (ctl *Controller) Close() {
	ctl.destroyHTMLWebView()
}

// SetFilter selects one of the 5 Room list filters (0=All,1=Unread,2=Working,3=Direct,4=Rooms).
func (ctl *Controller) SetFilter(idx int) {
	if idx >= 0 && idx <= 4 {
		ctl.mu.Lock()
		ctl.filter = idx
		ctl.mu.Unlock()
	}
}

// OpenRoom navigates Tab 1's router to roomID and ensures its messages are loaded.
func (ctl *Controller) OpenRoom(roomID string) {
	ctl.selectRoom(roomID, false)
}

func (ctl *Controller) selectRoom(roomID string, inSplitPane bool) {
	ctl.mu.Lock()
	ctl.lastRoomID = roomID
	ctl.mu.Unlock()
	ctl.ensureRoomLoaded(roomID)
	ctl.store.SetActiveTab(state.TabRooms)
	router := ctl.store.Routers[state.TabRooms]
	target := "/rooms/" + roomID
	cur := router.Path()
	if cur == target {
		return
	}
	if inSplitPane {
		// Keep "/rooms" at the bottom of the back stack so folding back to a cover
		// screen always preserves a working Back button, while switching rooms on an
		// unfolded display never accumulates redundant room history entries.
		for steps := 0; steps < 4 && router.CanGoBack() && !isSingleRoomPath(cur) && cur != "/rooms"; steps++ {
			router.Back()
			cur = router.Path()
		}
		if isSingleRoomPath(cur) {
			router.Replace(target)
			return
		}
		router.Push(target)
		return
	}
	router.Push(target)
}

func isSingleRoomPath(path string) bool {
	if !strings.HasPrefix(path, "/rooms/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/rooms/")
	return rest != "" && !strings.Contains(rest, "/")
}

// OpenRunWatch opens the Live Run Watch screen for (roomID, runID).
func (ctl *Controller) OpenRunWatch(roomID, runID string) {
	ctl.mu.Lock()
	ctl.lastRoomID = roomID
	ctl.watchRoomID = roomID
	ctl.watchRunID = runID
	ctl.mu.Unlock()
	go func() {
		_ = ctl.store.SyncRunPresentation(context.Background(), roomID, runID)
	}()
	ctl.store.SetActiveTab(state.TabRooms)
	ctl.store.Routers[state.TabRooms].Push("/rooms/" + roomID + "/runs/" + runID)
}

// Route renders Tab 1 routes inside Tab 1's ui.Router (single-pane mode).
func (ctl *Controller) Route(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	ctl.store.DrainUI()

	switch {
	case r.Match("/rooms/{roomId}/runs/{runId}"):
		roomID := r.Param("roomId")
		runID := r.Param("runId")
		ctl.rememberRoom(roomID)
		r.Title(i18n.T("rooms.title.live_run"))
		ctl.ViewRunWatch(c, snap, roomID, runID)
	case r.Match("/rooms/{roomId}/thread/{threadId}"):
		parentID := r.Param("roomId")
		threadID := r.Param("threadId")
		ctl.rememberRoom(parentID)
		r.Title(i18n.T("rooms.title.thread"))
		ctl.ensureRoomLoaded(threadID)
		ctl.viewChat(c, snap, threadID, parentID, true)
	case r.Match("/rooms/{roomId}"):
		roomID := r.Param("roomId")
		ctl.rememberRoom(roomID)
		r.Title(roomTitle(snap, roomID))
		ctl.ensureRoomLoaded(roomID)
		ctl.viewChat(c, snap, roomID, "", false)
	default:
		r.Title(i18n.T("tab.rooms"))
		ctl.viewRoomList(c, snap)
	}
}

func parseSplitRoomPath(path string) (mode, roomID, subID string) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(path), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 || parts[0] != "rooms" || parts[1] == "" {
		return "list", "", ""
	}
	roomID = parts[1]
	if len(parts) >= 4 && parts[2] == "runs" && parts[3] != "" {
		return "run", roomID, parts[3]
	}
	if len(parts) >= 4 && parts[2] == "thread" && parts[3] != "" {
		return "thread", roomID, parts[3]
	}
	return "room", roomID, ""
}

// ViewSplitPane renders Tab 1's hinge-aligned two-pane Master (Rooms list) |
// Detail (Room Chat / Thread / Live Run Watch) workspace on unfolded foldables.
func (ctl *Controller) ViewSplitPane(c *ui.Context, router *ui.Router, snap state.Snapshot, m layout.Metrics) {
	ctl.store.DrainUI()
	t := c.Theme()
	ex := theme.Extra(t)

	mode, selectedRoomID, subID := parseSplitRoomPath(router.Path())
	switch mode {
	case "run":
		ctl.rememberRoom(selectedRoomID)
	case "thread":
		ctl.rememberRoom(selectedRoomID)
		ctl.ensureRoomLoaded(subID)
	case "room":
		ctl.rememberRoom(selectedRoomID)
		ctl.ensureRoomLoaded(selectedRoomID)
	default:
		mode = "room"
		selectedRoomID = ctl.resolveDefaultRoomID(snap)
		if selectedRoomID != "" {
			ctl.rememberRoom(selectedRoomID)
			ctl.ensureRoomLoaded(selectedRoomID)
		}
	}

	ui.Row(c).Fill().Children(func() {
		// Left Master Pane: clipped and aligned cleanly along the foldable crease.
		ui.Column(c.Key("rooms_master")).Width(m.MasterWidth).FillHeight().Clip().Shrink(0).
			BorderWidth(0, 0.75, 0, 0).BorderColor(ex.Divider).
			Role(ui.RoleRegion).Label(i18n.T("tab.rooms")).Children(func() {
			ctl.viewRoomListPane(c, snap, selectedRoomID, true)
		})

		// Right Detail Pane: Room Chat, Thread, or Live Run Watch.
		ui.Column(c.Key("rooms_detail")).Grow(1).Basis(0).FillHeight().Clip().
			Role(ui.RoleRegion).Label(roomTitle(snap, selectedRoomID)).Children(func() {
			switch mode {
			case "run":
				ctl.ViewRunWatch(c, snap, selectedRoomID, subID)
			case "thread":
				ctl.viewChatPane(c, snap, subID, selectedRoomID, true, true)
			default:
				if selectedRoomID != "" {
					ctl.viewChatPane(c, snap, selectedRoomID, "", false, true)
				} else {
					ui.Column(c).Fill().AlignItems(ui.Center).Justify(ui.Center).Padding(24, 24).Children(func() {
						components.EmptyState(c, theme.IconRooms, i18n.T("rooms.empty_filtered_title"),
							i18n.T("rooms.empty_filtered_body"), "", nil)
					})
				}
			}
		})
	})

	// Modal sheets render once at overlay root across both panes.
	ctl.viewCatchUpSheet(c, snap)
	ctl.viewNewRoomSheet(c, snap)
}

func (ctl *Controller) rememberRoom(roomID string) {
	if roomID == "" {
		return
	}
	ctl.mu.Lock()
	ctl.lastRoomID = roomID
	ctl.mu.Unlock()
}

func (ctl *Controller) resolveDefaultRoomID(snap state.Snapshot) string {
	ctl.mu.Lock()
	last := ctl.lastRoomID
	filter := ctl.filter
	ctl.mu.Unlock()

	if last != "" {
		for _, rm := range snap.Rooms {
			if rm.ID == last {
				return last
			}
		}
	}
	filtered := filterRooms(snap.Rooms, snap.WorkingRoomIDs, filter)
	if len(filtered) > 0 {
		return filtered[0].ID
	}
	all := filterRooms(snap.Rooms, snap.WorkingRoomIDs, 0)
	if len(all) > 0 {
		return all[0].ID
	}
	return ""
}

func (ctl *Controller) viewRoomList(c *ui.Context, snap state.Snapshot) {
	ctl.viewRoomListPane(c, snap, "", false)
	ctl.viewCatchUpSheet(c, snap)
	ctl.viewNewRoomSheet(c, snap)
}

func (ctl *Controller) viewRoomListPane(c *ui.Context, snap state.Snapshot, selectedRoomID string, inSplitPane bool) {
	t := c.Theme()

	ctl.mu.Lock()
	filter := ctl.filter
	notice := ctl.inlineNotice
	ctl.mu.Unlock()

	scroll := ui.Scroll(c).FillWidth().Grow(1).Basis(0)
	if scroll.PullToRefresh(&ctl.refresh) {
		go func() {
			_ = ctl.store.RefreshActiveHost(context.Background())
			ctl.store.EnqueueUI(func() {
				ctl.refresh.Refreshing = false
			})
		}()
	}

	listPadH := float32(14)
	if inSplitPane {
		listPadH = 10
	}

	scroll.Children(func() {
		ui.Column(c).FillWidth().Padding(10, listPadH, 24, listPadH).Gap(10).Children(func() {
			if snap.OfflineViewingCache {
				components.StatusBanner(c, components.ToneWarning, i18n.T("rooms.offline_banner"), i18n.T("rooms.reconnect"), func() {
					if snap.ActiveHost != nil {
						go func() { _ = ctl.store.ConnectHost(context.Background(), snap.ActiveHost.ID) }()
					}
				})
			} else if snap.TransientError != "" {
				components.StatusBanner(c, components.ToneDanger, snap.TransientError, i18n.T("nav.connect"), func() {
					if ctl.nav.OnOpenConnect != nil {
						ctl.nav.OnOpenConnect()
					}
				})
			}
			if notice != "" {
				components.StatusBanner(c, components.ToneSuccess, notice, i18n.T("common.ok"), func() {
					ctl.mu.Lock()
					ctl.inlineNotice = ""
					ctl.mu.Unlock()
				})
			}

			if snap.ActiveHost == nil && len(snap.Rooms) == 0 {
				components.EmptyState(c, theme.IconRooms, i18n.T("rooms.connect_host_title"),
					i18n.T("rooms.connect_host_body"),
					i18n.T("rooms.open_hub"), func() {
						if ctl.nav.OnOpenConnect != nil {
							ctl.nav.OnOpenConnect()
						}
					})
				return
			}

			// Editorial action strip: warm Catch-Up highlight + sleek New Room pill.
			unreadCount := countUnreadRooms(snap.Rooms)
			ex := theme.Extra(t)
			actionGap := float32(8)
			catchPadH := float32(13)
			catchGap := float32(7)
			catchFont := float32(13)
			if inSplitPane {
				actionGap = 6
				catchPadH = 9
				catchGap = 5
				catchFont = 12
			}
			ui.Row(c).FillWidth().Gap(actionGap).AlignItems(ui.Center).Children(func() {
				catchLabel := i18n.T("rooms.catch_up")
				if unreadCount > 0 {
					catchLabel = i18n.Tf("rooms.catch_up_count", map[string]any{"count": unreadCount})
				}
				catchBg := t.Surface
				catchFg := t.Text
				catchIconCol := t.TextMuted
				catchBorder := ex.SubtleBorder
				if unreadCount > 0 {
					catchBg = ex.BrandTint
					catchFg = ex.BrandText
					catchIconCol = ex.Brand
					catchBorder = ex.Brand.Alpha(0.28)
				}
				catchBtn := ui.Row(c).Grow(1).Basis(0).MinHeight(38).Padding(7, catchPadH).Radius(12).
					Background(catchBg).Border(0.75, catchBorder).
					AlignItems(ui.Center).Justify(ui.Start).Gap(catchGap).
					Role(ui.RoleButton).Label(catchLabel)
				if inSplitPane {
					catchBtn.Clip()
				}
				if unreadCount == 0 {
					components.ApplyCardElevation(catchBtn, t)
				}
				if catchBtn.Pressed() {
					catchBtn.Scale(0.985, 0.985)
				}
				catchBtn.Children(func() {
					theme.IconBox(c, 15, catchIconCol, theme.IconSparkle)
					txt := ui.Text(c, catchLabel).FontSize(catchFont).FontWeight(600).TextColor(catchFg).NoWrap().MaxLines(1)
					if inSplitPane {
						txt.Grow(1).Basis(0)
					}
				})
				if catchBtn.Clicked() {
					ctl.mu.Lock()
					ctl.catchUpOpen = true
					ctl.mu.Unlock()
				}

				newBtn := components.CompactPrimaryButton(c, i18n.T("rooms.new_room"), theme.IconPlus, snap.ActiveHost == nil)
				newBtn.MinHeight(38)
				if inSplitPane {
					newBtn.Padding(6, 10)
				}
				if newBtn.Clicked() {
					ctl.mu.Lock()
					ctl.newRoomOpen = true
					ctl.mu.Unlock()
				}
			})

			// Narrow-screen-safe (320px+) horizontal filter pill strip.
			if components.SegmentedControl(c, &filter,
				i18n.T("rooms.filter.all"),
				i18n.T("rooms.filter.unread"),
				i18n.T("rooms.filter.working"),
				i18n.T("rooms.filter.direct"),
				i18n.T("rooms.filter.rooms"),
			) {
				ctl.SetFilter(filter)
			}

			filtered := filterRooms(snap.Rooms, snap.WorkingRoomIDs, filter)
			if len(filtered) == 0 {
				components.EmptyState(c, theme.IconRooms, i18n.T("rooms.empty_filtered_title"),
					i18n.T("rooms.empty_filtered_body"), i18n.T("rooms.show_all"), func() {
						ctl.SetFilter(0)
					})
				return
			}

			components.GroupedCard(c, func() {
				ui.Box(c).FillWidth().Height(4)
				for idx, rm := range filtered {
					rm := rm
					if idx > 0 {
						components.InsetDivider(c, 72)
					}
					working := snap.WorkingRoomIDs[rm.ID]
					pinned := rm.PinnedAt != nil
					left := rm.Participation != nil && *rm.Participation == "left"
					pinLabel := i18n.T("rooms.action.pin")
					if pinned {
						pinLabel = i18n.T("rooms.action.unpin")
					}
					muteLabel := i18n.T("rooms.action.snooze")
					if left {
						muteLabel = i18n.T("rooms.action.rejoin")
					}

					mobile.SwipeRow(c.Key(rm.ID), ctl.swipeStateFor(rm.ID), mobile.SwipeOptions{
						Leading: []mobile.SwipeAction{
							{
								Label: pinLabel,
								OnTap: func() {
									components.HapticLight()
									go func() { _ = ctl.store.ToggleRoomPin(context.Background(), rm.ID, !pinned) }()
								},
							},
						},
						Trailing: []mobile.SwipeAction{
							{
								Label: i18n.T("rooms.action.read"),
								OnTap: func() {
									components.HapticLight()
									go func() { _ = ctl.store.MarkRoomRead(context.Background(), rm.ID) }()
								},
							},
							{
								Label:       muteLabel,
								Destructive: !left,
								OnTap: func() {
									next := "left"
									if left {
										next = "joined"
									}
									go func() { _ = ctl.store.SetRoomParticipation(context.Background(), rm.ID, next) }()
								},
							},
						},
					}, func() {
						selected := inSplitPane && selectedRoomID != "" && rm.ID == selectedRoomID
						rowBg := t.Surface
						if selected {
							rowBg = ex.BrandTint
						}
						rowPadH := float32(14)
						if inSplitPane {
							rowPadH = 11
						}
						row := ui.Row(c).FillWidth().MinHeight(72).Padding(12, rowPadH).Gap(12).
							Background(rowBg).AlignItems(ui.Center).
							Role(ui.RoleButton).Label(i18n.Tf("rooms.a11y_row", map[string]any{"name": rm.Name, "unread": rm.UnreadMessageCount}))
						if selected {
							brandAccent := ex.Brand
							row.DrawOver(func(p *ui.Painter, r ui.Rect) {
								p.Fill(ui.Rect{X: r.X, Y: r.Y + 10, W: 3, H: r.H - 20}, brandAccent, 1.5)
							})
						}
						if row.Pressed() {
							row.Background(t.SurfacePressed)
						}
						row.Children(func() {
							renderRoomAvatarMosaic(c, rm, working)
							ui.Column(c).Grow(1).Basis(0).Gap(4).Children(func() {
								ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
									ui.Row(c).Grow(1).Basis(0).AlignItems(ui.Center).Gap(5).Children(func() {
										ui.Text(c, rm.Name).FontSize(15.5).FontWeight(600).LetterSpacing(-0.15).
											TextColor(t.Text).MaxLines(1)
										if pinned {
											theme.IconBox(c, 12, ex.Brand, theme.IconPin)
										}
									})
									ts := i18n.FormatRoomTime(rm.UpdatedAt)
									if rm.LatestMessage != nil {
										ts = i18n.FormatRoomTime(rm.LatestMessage.CreatedAt)
									}
									ui.Text(c, ts).FontSize(11.5).TextColor(ex.TextSubtle).NoWrap()
								})
								ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
									preview := i18n.T("rooms.no_messages")
									if rm.LatestMessage != nil && strings.TrimSpace(rm.LatestMessage.RawMessage) != "" {
										preview = rm.LatestMessage.Author.DisplayName + ": " + rm.LatestMessage.RawMessage
									}
									ui.Text(c, preview).FontSize(13).LineHeight(1.3).TextColor(t.TextMuted).Grow(1).Basis(0).MaxLines(1)
									if rm.UnreadMessageCount > 0 {
										ui.Row(c).MinWidth(20).Height(20).Padding(0, 6).Radius(10).
											Background(t.Accent).AlignItems(ui.Center).Justify(ui.Center).Shrink(0).
											Role(ui.RoleStatus).Label(i18n.Tf("rooms.unread_count", map[string]any{"count": rm.UnreadMessageCount})).Children(func() {
											ui.Text(c, fmt.Sprintf("%d", rm.UnreadMessageCount)).FontSize(11).FontWeight(700).TextColor(t.AccentText).NoWrap()
										})
									}
								})
								if working || left {
									ui.Row(c).FillWidth().Wrap().AlignItems(ui.Center).Gap(6).Children(func() {
										if working {
											workLbl := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(i18n.T("rooms.working_dot")), "●"))
											components.StatusDotPill(c, workLbl, components.ToneBrand)
										}
										if left {
											components.StatusDotPill(c, i18n.T("rooms.snoozed"), components.ToneNeutral)
										}
									})
								}
							})
						})
						if row.Clicked() {
							ctl.selectRoom(rm.ID, inSplitPane)
						}
					})
				}
				ui.Box(c).FillWidth().Height(4)
			})
		})
	})
}

func renderRoomAvatarMosaic(c *ui.Context, rm api.RoomListItem, working bool) {
	t := c.Theme()
	ex := theme.Extra(t)
	wrap := ui.Box(c).Size(46, 46).Shrink(0)
	if working {
		wrap.DrawOver(func(p *ui.Painter, r ui.Rect) {
			dot := float32(10)
			cx := r.X + r.W - 4
			cy := r.Y + r.H - 4
			p.Fill(ui.Rect{X: cx - dot/2 - 2, Y: cy - dot/2 - 2, W: dot + 4, H: dot + 4}, t.Surface, (dot+4)/2)
			p.Fill(ui.Rect{X: cx - dot/2, Y: cy - dot/2, W: dot, H: dot}, ex.Brand, dot/2)
		})
	}
	wrap.Children(func() {
		switch len(rm.MemberPreview) {
		case 0, 1:
			components.AvatarBadge(c, rm.Name, 46)
		case 2:
			ui.Row(c).Size(46, 46).Radius(14).Background(ex.MutedBg).Padding(3, 3).Justify(ui.SpaceBetween).Children(func() {
				ui.Column(c).FillHeight().Justify(ui.Start).Children(func() {
					components.AvatarBadge(c, rm.MemberPreview[0].DisplayName, 21)
				})
				ui.Column(c).FillHeight().Justify(ui.End).Children(func() {
					components.AvatarBadge(c, rm.MemberPreview[1].DisplayName, 21)
				})
			})
		case 3:
			ui.Column(c).Size(46, 46).Radius(14).Background(ex.MutedBg).Padding(2, 2).Gap(2).AlignItems(ui.Center).Justify(ui.Center).Children(func() {
				components.AvatarBadge(c, rm.MemberPreview[0].DisplayName, 20)
				ui.Row(c).Gap(2).Justify(ui.Center).Children(func() {
					components.AvatarBadge(c, rm.MemberPreview[1].DisplayName, 20)
					components.AvatarBadge(c, rm.MemberPreview[2].DisplayName, 20)
				})
			})
		default:
			ui.Column(c).Size(46, 46).Radius(14).Background(ex.MutedBg).Padding(2, 2).Gap(2).Children(func() {
				ui.Row(c).Gap(2).Children(func() {
					components.AvatarBadge(c, rm.MemberPreview[0].DisplayName, 20)
					components.AvatarBadge(c, rm.MemberPreview[1].DisplayName, 20)
				})
				ui.Row(c).Gap(2).Children(func() {
					components.AvatarBadge(c, rm.MemberPreview[2].DisplayName, 20)
					components.AvatarBadge(c, rm.MemberPreview[3].DisplayName, 20)
				})
			})
		}
	})
}

func (ctl *Controller) viewCatchUpSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.catchUpOpen, mobile.SheetOptions{
		Detents: []float32{0.65, 0.92},
		Label:   i18n.T("rooms.catch_up"),
	}, func() {
		var unread []api.RoomListItem
		for _, rm := range snap.Rooms {
			if rm.UnreadMessageCount > 0 {
				unread = append(unread, rm)
			}
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			layout.ReadableWrap(c, layout.Of(c).SheetMaxWidth, func() {
				ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Text(c, i18n.T("rooms.catch_up")).FontSize(18).Bold().TextColor(t.Text)
						if len(unread) > 0 {
							markBtn := components.CompactSecondaryButton(c, i18n.T("rooms.catchup_mark_all"), theme.IconCheck, false)
							if markBtn.Clicked() {
								components.HapticSuccess()
								go func() { _ = ctl.store.MarkAllRoomsRead(context.Background()) }()
								ctl.catchUpOpen = false
							}
						}
					})
					if len(unread) == 0 {
						components.EmptyState(c, theme.IconCheck, i18n.T("rooms.catchup_done_title"),
							i18n.T("rooms.catchup_done_body"), i18n.T("common.done"), func() {
								ctl.catchUpOpen = false
							})
						return
					}
					for _, rm := range unread {
						rm := rm
						preview := ""
						if rm.LatestMessage != nil {
							preview = rm.LatestMessage.Author.DisplayName + ": " + rm.LatestMessage.RawMessage
						}
						components.SectionCard(c, rm.Name, i18n.Tf("rooms.catchup_unread_msg", map[string]any{"count": rm.UnreadMessageCount}), func() {
							btn := components.CompactPrimaryButton(c, i18n.T("rooms.catchup_jump"), nil, false)
							if btn.Clicked() {
								ctl.catchUpOpen = false
								ctl.OpenRoom(rm.ID)
							}
						}, func() {
							if preview != "" {
								ui.Text(c, preview).FontSize(13).LineHeight(1.35).TextColor(t.TextMuted).MaxLines(2)
							}
						})
					}
				})
			})
		})
	})
}

func (ctl *Controller) viewNewRoomSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.newRoomOpen, mobile.SheetOptions{
		Detents: []float32{0.72, 0.92},
		Label:   i18n.T("rooms.new_modal_a11y"),
	}, func() {
		ctl.mu.Lock()
		mode := ctl.newRoomMode
		creating := ctl.creatingRoom
		ctl.mu.Unlock()

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			layout.ReadableWrap(c, layout.Of(c).SheetMaxWidth, func() {
				ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
					ui.Text(c, i18n.T("rooms.new_modal_title")).FontSize(18).Bold().TextColor(t.Text)
					if components.SegmentedControl(c, &mode, i18n.T("rooms.new_kind_group"), i18n.T("rooms.new_kind_dm")) {
						ctl.mu.Lock()
						ctl.newRoomMode = mode
						ctl.mu.Unlock()
					}

					if mode == 0 {
						components.FormField(c, i18n.T("rooms.new_name_label"), i18n.T("rooms.new_name_placeholder"), &ctl.newRoomName, false)
						components.FormField(c, i18n.T("rooms.new_desc_label"), i18n.T("rooms.new_desc_placeholder"), &ctl.newRoomDesc, false)
						if len(snap.Actors) > 0 {
							ui.Text(c, i18n.T("rooms.invite_members")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
							for _, act := range snap.Actors {
								act := act
								checked := ctl.selectedPeers[act.ID]
								chk := ui.Checkbox(c.Key(act.ID), &checked, act.DisplayName+" ("+i18n.ActorRoleLabel(act.Kind)+")").MinHeight(38)
								if chk.Changed() {
									ctl.selectedPeers[act.ID] = checked
								}
							}
						}
						btn := components.PrimaryTouchButton(c, i18n.T("rooms.create_room_btn"), creating || strings.TrimSpace(ctl.newRoomName) == "")
						btn.FillWidth()
						if btn.Clicked() {
							name := strings.TrimSpace(ctl.newRoomName)
							desc := strings.TrimSpace(ctl.newRoomDesc)
							var memberIDs []string
							for id, on := range ctl.selectedPeers {
								if on {
									memberIDs = append(memberIDs, id)
								}
							}
							ctl.mu.Lock()
							ctl.creatingRoom = true
							ctl.mu.Unlock()
							go func() {
								rm, err := ctl.store.CreateRoom(context.Background(), name, desc, memberIDs)
								ctl.store.EnqueueUI(func() {
									ctl.mu.Lock()
									ctl.creatingRoom = false
									if err == nil {
										ctl.newRoomName = ""
										ctl.newRoomDesc = ""
										ctl.selectedPeers = map[string]bool{}
										ctl.newRoomOpen = false
										ctl.inlineNotice = i18n.Tf("rooms.toast.created", map[string]any{"name": rm.Name})
									}
									ctl.mu.Unlock()
									if err == nil {
										ctl.OpenRoom(rm.ID)
									}
								})
							}()
						}
					} else {
						ui.Text(c, i18n.T("rooms.dm_select_hint")).FontSize(13).TextColor(t.TextMuted)
						components.GroupedCard(c, func() {
							for idx, act := range snap.Actors {
								act := act
								if idx > 0 {
									components.InsetDivider(c, 58)
								}
								row := ui.Row(c.Key("dm_"+act.ID)).FillWidth().MinHeight(56).Padding(10, 14).Gap(10).
									Background(t.Surface).AlignItems(ui.Center).
									Role(ui.RoleButton).Label(i18n.Tf("rooms.dm_a11y", map[string]any{"name": act.DisplayName}))
								if row.Pressed() {
									row.Background(t.SurfacePressed)
								}
								row.Children(func() {
									components.AvatarBadge(c, act.DisplayName, 36)
									ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
										ui.Text(c, act.DisplayName).FontSize(14.5).FontWeight(600).TextColor(t.Text)
										ui.Text(c, i18n.ActorRoleLabel(act.Kind)).FontSize(12).TextColor(t.TextMuted)
									})
									theme.IconBox(c, 16, theme.Extra(t).TextSubtle, theme.IconChevronRight)
								})
								if row.Clicked() && !creating {
									ctl.mu.Lock()
									ctl.creatingRoom = true
									ctl.mu.Unlock()
									go func() {
										rm, err := ctl.store.OpenDirectRoom(context.Background(), act.ID)
										ctl.store.EnqueueUI(func() {
											ctl.mu.Lock()
											ctl.creatingRoom = false
											if err == nil {
												ctl.newRoomOpen = false
											}
											ctl.mu.Unlock()
											if err == nil {
												ctl.OpenRoom(rm.ID)
											}
										})
									}()
								}
							}
						})
					}
				})
			})
		})
	})
}

func (ctl *Controller) ensureRoomLoaded(roomID string) {
	if roomID == "" {
		return
	}
	ctl.mu.Lock()
	already := ctl.loadedRooms[roomID]
	ctl.loadedRooms[roomID] = true
	ctl.mu.Unlock()
	if !already {
		go func() {
			_ = ctl.store.LoadRoomMessages(context.Background(), roomID, false)
			_ = ctl.store.MarkRoomRead(context.Background(), roomID)
		}()
	}
}

func (ctl *Controller) swipeStateFor(roomID string) *mobile.SwipeState {
	ctl.mu.Lock()
	defer ctl.mu.Unlock()
	st, ok := ctl.swipeStates[roomID]
	if !ok {
		st = &mobile.SwipeState{}
		ctl.swipeStates[roomID] = st
	}
	return st
}

func (ctl *Controller) decisionStateFor(decisionID string) *components.DecisionCardState {
	ctl.mu.Lock()
	defer ctl.mu.Unlock()
	st, ok := ctl.decisionStates[decisionID]
	if !ok {
		st = &components.DecisionCardState{}
		ctl.decisionStates[decisionID] = st
	}
	return st
}

func filterRooms(rooms []api.RoomListItem, working map[string]bool, filter int) []api.RoomListItem {
	out := make([]api.RoomListItem, 0, len(rooms))
	for _, rm := range rooms {
		if rm.Kind == "thread" {
			continue
		}
		switch filter {
		case 1:
			if rm.UnreadMessageCount <= 0 {
				continue
			}
		case 2:
			if !working[rm.ID] {
				continue
			}
		case 3:
			if rm.Kind != "direct" {
				continue
			}
		case 4:
			if rm.Kind == "direct" {
				continue
			}
		}
		out = append(out, rm)
	}
	// Pinned rooms first, then updated_at descending.
	sort.SliceStable(out, func(i, j int) bool {
		pi, pj := out[i].PinnedAt != nil, out[j].PinnedAt != nil
		if pi != pj {
			return pi
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	return out
}

func countUnreadRooms(rooms []api.RoomListItem) int {
	n := 0
	for _, rm := range rooms {
		if rm.UnreadMessageCount > 0 {
			n++
		}
	}
	return n
}

func roomTitle(snap state.Snapshot, roomID string) string {
	for _, rm := range snap.Rooms {
		if rm.ID == roomID {
			return rm.Name
		}
	}
	return i18n.T("rooms.title.room_fallback")
}
