// Package work implements Tab 3 (Work): Issues & Tasks, Scheduled Routines,
// and offline-resilient Pocket Notes with SQLite outbox durability.
package work

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// Segment indices for Tab 3.
const (
	SegmentIssues   = 0
	SegmentRoutines = 1
	SegmentPocket   = 2
)

// Deps supplies host services and navigation callbacks for the Work tab.
type Deps struct {
	Store          *state.AppStore
	Client         *api.Client
	Cache          *cache.Store
	TenantID       string
	CurrentActorID string
	Online         func() bool
	OnOpenRoom     func(roomID string)
	ShowToast      func(msg string)
	OnNotify       func()
}

// PocketSaveState describes the durability state of Today's Pocket Note.
type PocketSaveState string

const (
	PocketStateSaved        PocketSaveState = "saved"
	PocketStateSaving       PocketSaveState = "saving"
	PocketStateSavedOffline PocketSaveState = "saved_offline"
	PocketStateError        PocketSaveState = "error"
)

// Screen owns state and rendering for Tab 3 (Work).
type Screen struct {
	deps Deps

	mu              sync.Mutex
	closed          bool
	pending         []func()
	workItems       []api.WorkItem
	routines        []api.Routine
	pocketNotes     []api.PocketNoteRecord
	pocketToday     string
	rooms           []api.RoomListItem
	actors          []api.Actor
	loading         bool
	syncError       string
	outboxPending   int
	memOutbox       []pocketOutboxJob
	pocketMu        sync.Mutex // serializes all Pocket Note disk/network saves and outbox drains
	pocketPending   *pocketSaveReq
	pocketWake      chan struct{}
	workerCancel    context.CancelFunc
	pocketSaveSeq   uint64
	pocketSavedSeq  uint64
	pocketState     PocketSaveState
	pocketLastErr   string
	pocketServerTxt string

	// UI-thread-only state (never mutated directly from background goroutines).
	segment int
	scroll  [3]ui.ScrollState

	// Issues state & sheets.
	issueFilter        int // 0: Mine, 1: Open, 2: In Progress, 3: Resolved, 4: Archived
	createSheetOpen    bool
	createBusy         bool
	createError        string
	createKind         int // 0: Issue, 1: Task
	createPriority     int // 0: Low, 1: Medium, 2: High, 3: Urgent
	createTitle        string
	createDesc         string
	createOriginRoomID string

	detailOpen         bool
	detailItemID       string
	detailItem         *api.WorkItem
	detailComments     []api.WorkItemComment
	detailTimeline     []api.WorkItemTimelineEntry
	detailTaskExec     *api.TaskExecutionProjection
	detailTaskConv     *api.TaskConversation
	detailTaskRuns     *api.TaskRuntimePresentationRunPage
	detailBusy         bool
	detailError        string
	transitionSheet    bool
	assigneeSheet      bool
	editSheetOpen      bool
	editBusy           bool
	editError          string
	editTitle          string
	editDesc           string
	editPriority       int
	commentDraft       string
	editingCommentID   string
	editingCommentVer  int64
	editingCommentBody string

	// Routines state & sheets.
	routineRoomFilter  string // "" = All Rooms
	routineBusyID      string
	routineRunBusyID   string
	routineError       string
	routineSheetOpen   bool
	routineEditingID   string
	routineEditingRev  int64
	routineSaving      bool
	routineSaveErr     string
	routineFormRoomID  string
	routineFormName    string
	routineFormInstr   string
	routineFormKind    int // 0: daily, 1: weekly, 2: every_n_hours, 3: every_n_minutes, 4: once
	routineFormHourIdx int
	routineFormMinIdx  int
	routineFormIntvIdx int
	routineFormTZIdx   int
	routineFormTime    uiRoutineTime
	routineWeekdays    [7]bool
	routineDeleteSheet bool
	routineDeleteItem  *api.Routine

	// Pocket Notes UI state.
	pocketDraft        string
	pocketDirty        bool
	pocketExpandedDate string
	pocketDeleteSheet  bool
	pocketDeleteDate   string
	pocketActionErr    string
	pocketSendBusy     bool
}

// New constructs a Work screen controller and starts its serialized Pocket Note worker.
func New(deps Deps) *Screen {
	workerCtx, cancel := context.WithCancel(context.Background())
	s := &Screen{
		deps:               deps,
		pocketWake:         make(chan struct{}, 1),
		workerCancel:       cancel,
		pocketState:        PocketStateSaved,
		createPriority:     1,
		routineFormIntvIdx: 1,
	}
	s.initRoutineDefaults()
	s.hydrateOfflineCache(context.Background())
	go s.runPocketWorker(workerCtx)
	return s
}

// Close stops background workers owned by the Work screen.
func (s *Screen) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	cancel := s.workerCancel
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// SelectSegment switches between Issues (0), Routines (1), and Pocket (2).
func (s *Screen) SelectSegment(idx int) {
	if idx < SegmentIssues || idx > SegmentPocket {
		return
	}
	s.enqueueUI(func() {
		s.segment = idx
	})
}

// ActiveSegment returns the currently selected segment index (for UI tests).
func (s *Screen) ActiveSegment() int {
	s.drainPending()
	return s.segment
}

// BadgeCount returns active open/in-progress work items plus pending offline pocket note writes.
func (s *Screen) BadgeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := s.outboxPending + len(s.memOutbox)
	for _, wi := range s.workItems {
		if wi.ArchivedAt == nil && (wi.State == "open" || wi.State == "in_progress") {
			n++
		}
	}
	return n
}

// Refresh syncs Work Items, Routines, Pocket Notes, Rooms, and Actors from TeamHub
// and drains any pending offline Pocket Note outbox mutations.
func (s *Screen) Refresh(ctx context.Context) {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" {
		s.hydrateOfflineCache(ctx)
		return
	}

	s.mu.Lock()
	s.loading = true
	s.syncError = ""
	s.mu.Unlock()
	s.notify()

	// Sync offline Pocket Note outbox first so server catches up before reading.
	if s.isOnline() {
		_ = s.SyncPocketOutbox(ctx)
	}

	var firstErr error
	var rooms []api.RoomListItem
	if rp, err := client.ListRooms(ctx, tenantID, 50, ""); err == nil {
		rooms = rp.Items
		if cs := s.cacheStore(); cs != nil {
			_ = cs.UpsertRooms(ctx, rooms)
		}
	} else {
		firstErr = err
	}

	if ap, err := client.ListActors(ctx, tenantID, 50, ""); err == nil {
		s.mu.Lock()
		s.actors = ap.Items
		s.mu.Unlock()
		if cs := s.cacheStore(); cs != nil {
			_ = cs.UpsertActors(ctx, ap.Items)
		}
	}

	var workItems []api.WorkItem
	if wp, err := client.ListWorkItemsFiltered(ctx, tenantID, api.WorkItemListOptions{Limit: 100}); err == nil {
		workItems = wp.Items
		if archPage, aErr := client.ListWorkItemsFiltered(ctx, tenantID, api.WorkItemListOptions{
			Archived: boolPtr(true),
			Limit:    50,
		}); aErr == nil {
			workItems = mergeWorkItems(workItems, archPage.Items)
		}
		if cs := s.cacheStore(); cs != nil {
			_ = cs.UpsertWorkItems(ctx, workItems)
		}
	} else if firstErr == nil {
		firstErr = err
	}

	// Collect routines across all known rooms (or store rooms).
	roomPool := rooms
	if len(roomPool) == 0 && s.deps.Store != nil {
		roomPool = s.deps.Store.Snapshot().Rooms
	}
	var allRoutines []api.Routine
	for _, rm := range roomPool {
		if rts, err := client.ListRoomRoutines(ctx, rm.ID); err == nil {
			allRoutines = append(allRoutines, rts...)
		}
	}
	if cs := s.cacheStore(); cs != nil && len(allRoutines) > 0 {
		_ = cs.UpsertRoutines(ctx, allRoutines)
	}

	var pocketPage api.PocketNoteRecordPage
	var pocketOK bool
	if np, err := client.ListPocketNotesC2(ctx, tenantID, 30, ""); err == nil {
		pocketPage = np
		pocketOK = true
		if cs := s.cacheStore(); cs != nil {
			conv := make([]api.PocketNote, 0, len(np.Items))
			for _, it := range np.Items {
				conv = append(conv, it.ToPocketNote())
			}
			_ = cs.UpsertPocketNotes(ctx, tenantID, conv)
		}
	}

	s.mu.Lock()
	s.loading = false
	if len(rooms) > 0 {
		s.rooms = rooms
	}
	if len(workItems) > 0 || firstErr == nil {
		s.workItems = workItems
	}
	if len(allRoutines) > 0 || len(roomPool) > 0 {
		s.routines = allRoutines
	}
	if pocketOK {
		s.pocketNotes = pocketPage.Items
		if pocketPage.Today != "" {
			s.pocketToday = pocketPage.Today
		}
		for _, it := range pocketPage.Items {
			if it.Date == s.pocketToday || (s.pocketToday == "" && it.Date != "") {
				s.pocketServerTxt = it.Text
				break
			}
		}
	}
	if firstErr != nil {
		s.syncError = firstErr.Error()
	} else {
		s.syncError = ""
	}
	s.mu.Unlock()

	s.enqueueUI(func() {
		if !s.pocketDirty && pocketOK {
			todayText := s.todayPocketTextFromList(pocketPage.Items, pocketPage.Today)
			s.pocketDraft = todayText
		}
		if s.detailOpen && s.detailItemID != "" {
			s.syncDetailItemFromSlice()
		}
	})
	s.notify()
}

// View renders Tab 3 (Work) inside a scrollable container and sheet overlays.
func (s *Screen) View(c *ui.Context) {
	s.drainPending()
	s.syncStoreFallback()

	t := c.Theme()
	s.mu.Lock()
	loading := s.loading
	syncErr := s.syncError
	s.mu.Unlock()

	ui.Column(c).Fill().Background(t.Background).Children(func() {
		// Top segmented control header.
		ui.Column(c).FillWidth().Padding(10, 14, 8, 14).Gap(8).Shrink(0).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				segWrap := ui.Column(c).Grow(1).Basis(0)
				segWrap.Children(func() {
					components.SegmentedControl(c, &s.segment,
						i18n.T("work.tab.issues"),
						i18n.T("work.tab.routines"),
						i18n.T("work.tab.pocket"))
				})
				refreshLabel := i18n.T("common.sync")
				if loading {
					refreshLabel = i18n.T("common.syncing")
				}
				refBtn := components.SecondaryTouchButton(c, refreshLabel, loading)
				refBtn.MinWidth(60)
				if refBtn.Clicked() {
					go s.Refresh(context.Background())
				}
			})
			if syncErr != "" {
				components.ErrorInline(c, syncErr, func() {
					go s.Refresh(context.Background())
				})
			}
		})
		ui.Divider(c)

		// Each segment keeps its own ScrollState across switches.
		switch s.segment {
		case SegmentIssues:
			s.viewIssuesSegment(c)
		case SegmentRoutines:
			s.viewRoutinesSegment(c)
		case SegmentPocket:
			s.viewPocketSegment(c)
		}
	})

	// Modal bottom sheets & action sheets.
	s.viewCreateWorkItemSheet(c)
	s.viewWorkItemDetailSheet(c)
	s.viewWorkItemEditSheet(c)
	s.viewTransitionActionSheet(c)
	s.viewAssigneeSheet(c)
	s.viewRoutineFormSheet(c)
	s.viewRoutineDeleteActionSheet(c)
	s.viewPocketDeleteActionSheet(c)
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

func (s *Screen) syncStoreFallback() {
	if s.deps.Store == nil {
		return
	}
	snap := s.deps.Store.Snapshot()
	s.mu.Lock()
	if len(s.workItems) == 0 && len(snap.WorkItems) > 0 {
		s.workItems = append([]api.WorkItem(nil), snap.WorkItems...)
	}
	if len(s.routines) == 0 && len(snap.Routines) > 0 {
		s.routines = append([]api.Routine(nil), snap.Routines...)
	}
	if len(s.rooms) == 0 && len(snap.Rooms) > 0 {
		s.rooms = append([]api.RoomListItem(nil), snap.Rooms...)
	}
	if len(s.pocketNotes) == 0 && len(snap.PocketNotes) > 0 {
		for _, pn := range snap.PocketNotes {
			s.pocketNotes = append(s.pocketNotes, api.PocketNoteRecord{
				Date:      pn.NoteDate,
				Text:      pn.Body,
				UpdatedAt: pn.UpdatedAt,
			})
		}
	}
	s.mu.Unlock()
}

func (s *Screen) hydrateOfflineCache(ctx context.Context) {
	cs := s.cacheStore()
	if cs == nil {
		return
	}
	tenantID := s.tenantID()
	wis, _ := cs.ListWorkItems(ctx, tenantID)
	notes, _ := cs.ListPocketNotes(ctx, tenantID)
	rooms, _ := cs.ListRooms(ctx, tenantID)
	outbox, _ := cs.ListOutbox(ctx)

	var pocketPending int
	var latestOutboxText string
	for _, item := range outbox {
		if item.Kind == "pocket_note.put" {
			pocketPending++
			var pl pocketOutboxPayload
			if json.Unmarshal([]byte(item.PayloadJSON), &pl) == nil {
				latestOutboxText = pl.Text
			}
		}
	}

	s.mu.Lock()
	if len(wis) > 0 && len(s.workItems) == 0 {
		s.workItems = wis
	}
	if len(rooms) > 0 && len(s.rooms) == 0 {
		s.rooms = rooms
	}
	if len(notes) > 0 && len(s.pocketNotes) == 0 {
		for _, n := range notes {
			s.pocketNotes = append(s.pocketNotes, api.PocketNoteRecord{
				Date: n.NoteDate, Text: n.Body, UpdatedAt: n.UpdatedAt,
			})
		}
	}
	s.outboxPending = pocketPending
	if pocketPending > 0 {
		s.pocketState = PocketStateSavedOffline
	}
	s.mu.Unlock()

	if latestOutboxText != "" || len(notes) > 0 {
		s.enqueueUI(func() {
			if !s.pocketDirty {
				if latestOutboxText != "" {
					s.pocketDraft = latestOutboxText
				} else if len(notes) > 0 {
					s.pocketDraft = notes[0].Body
				}
			}
		})
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

func (s *Screen) cacheStore() *cache.Store {
	if s.deps.Cache != nil {
		return s.deps.Cache
	}
	if s.deps.Store != nil {
		return s.deps.Store.Cache()
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

func (s *Screen) currentActorID() string {
	if strings.TrimSpace(s.deps.CurrentActorID) != "" {
		return s.deps.CurrentActorID
	}
	if s.deps.Store != nil {
		snap := s.deps.Store.Snapshot()
		if snap.Identity != nil && len(snap.Identity.Actors) > 0 {
			return snap.Identity.Actors[0].ID
		}
	}
	return ""
}

func (s *Screen) isOnline() bool {
	if s.deps.Online != nil {
		return s.deps.Online()
	}
	if s.deps.Store != nil {
		return s.deps.Store.Snapshot().Online
	}
	return true
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

func (s *Screen) roomName(roomID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, rm := range s.rooms {
		if rm.ID == roomID {
			return rm.Name
		}
	}
	if roomID == "" {
		return i18n.T("work.workspace_fallback")
	}
	return roomID
}

func boolPtr(b bool) *bool { return &b }

func mergeWorkItems(primary, extra []api.WorkItem) []api.WorkItem {
	seen := make(map[string]struct{}, len(primary))
	out := make([]api.WorkItem, 0, len(primary)+len(extra))
	for _, wi := range primary {
		seen[wi.ID] = struct{}{}
		out = append(out, wi)
	}
	for _, wi := range extra {
		if _, ok := seen[wi.ID]; !ok {
			out = append(out, wi)
		}
	}
	return out
}

func priorityTone(p string) components.Tone {
	switch p {
	case "urgent":
		return components.ToneDanger
	case "high":
		return components.ToneWarning
	case "medium":
		return components.ToneInfo
	default:
		return components.ToneNeutral
	}
}

func stateTone(st string) components.Tone {
	switch st {
	case "resolved":
		return components.ToneSuccess
	case "in_progress":
		return components.ToneInfo
	case "open":
		return components.ToneWarning
	default:
		return components.ToneNeutral
	}
}

func formatWorkItemState(st string) string {
	if st == "" {
		return i18n.WorkStateLabel("open")
	}
	return i18n.WorkStateLabel(st)
}

func unusedThemeRef(t *ui.Theme) ui.Color {
	return theme.Extra(t).MutedBg
}
