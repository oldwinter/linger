// Package rooms implements Tab 1: Rooms list with filters & SwipeRow actions,
// Catch-Up Walk, New Room/DM sheet, real-time Room Chat & Threads, rich
// IME-safe Composer with attachments/@mentions//skills, Live Run Watch,
// Mail Canvas preview, and Room Inspector.
package rooms

import (
	"context"
	"sort"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
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
	loadedRooms      map[string]bool
	decisionStates   map[string]*components.DecisionCardState
	pendingUploads   map[string][]api.MessageAttachmentUpload
	replyTarget      map[string]*api.Message
	uploadingRoom    string
	sendingRoom      string
	mentionSheetOpen bool
	skillSheetOpen   bool
	reactSheetOpen   bool
	reactTargetMsg   *api.Message
	forwardSheetOpen bool
	forwardTargetMsg *api.Message

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
	watchRoomID        string
	watchRunID         string
	cancelConfirmOpen  bool
	bgTasksOpen        bool
	bgTasks            []api.RoomBackgroundTask
	expandedActivities map[string]bool
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
		expandedActivities: map[string]bool{},
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
	ctl.ensureRoomLoaded(roomID)
	ctl.store.SetActiveTab(state.TabRooms)
	ctl.store.Routers[state.TabRooms].Push("/rooms/" + roomID)
}

// OpenRunWatch opens the Live Run Watch screen for (roomID, runID).
func (ctl *Controller) OpenRunWatch(roomID, runID string) {
	ctl.mu.Lock()
	ctl.watchRoomID = roomID
	ctl.watchRunID = runID
	ctl.mu.Unlock()
	go func() {
		_ = ctl.store.SyncRunPresentation(context.Background(), roomID, runID)
	}()
	ctl.store.SetActiveTab(state.TabRooms)
	ctl.store.Routers[state.TabRooms].Push("/rooms/" + roomID + "/runs/" + runID)
}

// Route renders Tab 1 routes inside Tab 1's ui.Router.
func (ctl *Controller) Route(c *ui.Context, r *ui.Route, snap state.Snapshot) {
	ctl.store.DrainUI()
	switch {
	case r.Match("/rooms/{roomId}/runs/{runId}"):
		roomID := r.Param("roomId")
		runID := r.Param("runId")
		r.Title(i18n.T("rooms.title.live_run"))
		ctl.ViewRunWatch(c, snap, roomID, runID)
	case r.Match("/rooms/{roomId}/thread/{threadId}"):
		parentID := r.Param("roomId")
		threadID := r.Param("threadId")
		r.Title(i18n.T("rooms.title.thread"))
		ctl.ensureRoomLoaded(threadID)
		ctl.viewChat(c, snap, threadID, parentID, true)
	case r.Match("/rooms/{roomId}"):
		roomID := r.Param("roomId")
		r.Title(roomTitle(snap, roomID))
		ctl.ensureRoomLoaded(roomID)
		ctl.viewChat(c, snap, roomID, "", false)
	default:
		r.Title(i18n.T("tab.rooms"))
		ctl.viewRoomList(c, snap)
	}
}

func (ctl *Controller) viewRoomList(c *ui.Context, snap state.Snapshot) {
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

	scroll.Children(func() {
		ui.Column(c).FillWidth().Padding(10, 14, 24, 14).Gap(10).Children(func() {
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

			// Action bar: Catch-Up Walk + New Room / DM
			unreadCount := countUnreadRooms(snap.Rooms)
			ui.Row(c).FillWidth().Gap(8).Children(func() {
				catchLabel := i18n.T("rooms.catch_up")
				if unreadCount > 0 {
					catchLabel = i18n.Tf("rooms.catch_up_count", map[string]any{"count": unreadCount})
				}
				catchBtn := components.SecondaryTouchButton(c, catchLabel, false)
				catchBtn.Grow(1).Basis(0)
				if catchBtn.Clicked() {
					ctl.mu.Lock()
					ctl.catchUpOpen = true
					ctl.mu.Unlock()
				}
				newBtn := components.PrimaryTouchButton(c, i18n.T("rooms.new_room"), snap.ActiveHost == nil)
				newBtn.Grow(1).Basis(0)
				if newBtn.Clicked() {
					ctl.mu.Lock()
					ctl.newRoomOpen = true
					ctl.mu.Unlock()
				}
			})

			// Narrow-screen-safe (320px+) horizontal segmented filter pills.
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

			for _, rm := range filtered {
				rm := rm
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
								mygo.Haptics.Light()
								go func() { _ = ctl.store.ToggleRoomPin(context.Background(), rm.ID, !pinned) }()
							},
						},
					},
					Trailing: []mobile.SwipeAction{
						{
							Label: i18n.T("rooms.action.read"),
							OnTap: func() {
								mygo.Haptics.Light()
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
					row := ui.Row(c).FillWidth().MinHeight(68).Padding(10, 12).Gap(10).
						Radius(12).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
						Role(ui.RoleButton).Label(i18n.Tf("rooms.a11y_row", map[string]any{"name": rm.Name, "unread": rm.UnreadMessageCount}))
					row.Children(func() {
						// Avatar or member mosaic
						renderRoomAvatarMosaic(c, rm)
						ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
							ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
								title := rm.Name
								if pinned {
									title = "★ " + title
								}
								ui.Text(c, title).FontSize(15).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
								ts := i18n.FormatRoomTime(rm.UpdatedAt)
								if rm.LatestMessage != nil {
									ts = i18n.FormatRoomTime(rm.LatestMessage.CreatedAt)
								}
								ui.Text(c, ts).FontSize(11).TextColor(t.TextMuted).NoWrap()
							})
							preview := i18n.T("rooms.no_messages")
							if rm.LatestMessage != nil && strings.TrimSpace(rm.LatestMessage.RawMessage) != "" {
								preview = rm.LatestMessage.Author.DisplayName + ": " + rm.LatestMessage.RawMessage
							}
							ui.Text(c, preview).FontSize(13).TextColor(t.TextMuted).MaxLines(1)
							ui.Row(c).FillWidth().Wrap().AlignItems(ui.Center).Gap(6).Children(func() {
								if working {
									components.StatusPill(c, i18n.T("rooms.working_dot"), components.ToneInfo)
								}
								if rm.UnreadMessageCount > 0 {
									components.StatusPill(c, i18n.Tf("rooms.unread_count", map[string]any{"count": rm.UnreadMessageCount}), components.ToneWarning)
								}
								if left {
									components.StatusPill(c, i18n.T("rooms.snoozed"), components.ToneNeutral)
								}
							})
						})
					})
					if row.Clicked() {
						ctl.OpenRoom(rm.ID)
					}
				})
			}
		})
	})

	ctl.viewCatchUpSheet(c, snap)
	ctl.viewNewRoomSheet(c, snap)
}

func renderRoomAvatarMosaic(c *ui.Context, rm api.RoomListItem) {
	if len(rm.MemberPreview) <= 1 {
		components.AvatarBadge(c, rm.Name, 42)
		return
	}
	// Compact 2x2 avatar mosaic for multi-member Rooms.
	ui.Column(c).Size(42, 42).Gap(2).Shrink(0).Children(func() {
		ui.Row(c).Gap(2).Children(func() {
			components.AvatarBadge(c, rm.MemberPreview[0].DisplayName, 20)
			if len(rm.MemberPreview) > 1 {
				components.AvatarBadge(c, rm.MemberPreview[1].DisplayName, 20)
			}
		})
		if len(rm.MemberPreview) > 2 {
			ui.Row(c).Gap(2).Children(func() {
				components.AvatarBadge(c, rm.MemberPreview[2].DisplayName, 20)
				if len(rm.MemberPreview) > 3 {
					components.AvatarBadge(c, rm.MemberPreview[3].DisplayName, 20)
				}
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
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Text(c, i18n.T("rooms.catch_up")).FontSize(18).Bold().TextColor(t.Text)
					if len(unread) > 0 {
						markBtn := components.SecondaryTouchButton(c, i18n.T("rooms.catchup_mark_all"), false)
						if markBtn.Clicked() {
							mygo.Haptics.Success()
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
						btn := components.PrimaryTouchButton(c, i18n.T("rooms.catchup_jump"), false)
						if btn.Clicked() {
							ctl.catchUpOpen = false
							ctl.OpenRoom(rm.ID)
						}
					}, func() {
						if preview != "" {
							ui.Text(c, preview).FontSize(13).TextColor(t.TextMuted).MaxLines(2)
						}
					})
				}
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
					for _, act := range snap.Actors {
						act := act
						row := ui.Row(c.Key("dm_"+act.ID)).FillWidth().MinHeight(52).Padding(8, 10).Gap(10).
							Radius(10).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
							Role(ui.RoleButton).Label(i18n.Tf("rooms.dm_a11y", map[string]any{"name": act.DisplayName}))
						row.Children(func() {
							components.AvatarBadge(c, act.DisplayName, 34)
							ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
								ui.Text(c, act.DisplayName).FontSize(14).FontWeight(600).TextColor(t.Text)
								ui.Text(c, i18n.ActorRoleLabel(act.Kind)).FontSize(12).TextColor(t.TextMuted)
							})
							ui.Text(c, i18n.T("common.open")+" ›").FontSize(13).TextColor(t.Accent)
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
				}
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
