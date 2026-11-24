// Package library implements Tab 4 (Library): Persistent Global Search
// (SQLite FTS5 + live TeamHub search), Documents & Document Reader (Markdown,
// Code, Image, sandboxed HTML preview WebView leaf, Versions/History, Comments,
// Link Share, Upload/Create), Personal Wiki & Knowledge Graph, and Memory /
// Voice Captures & Meetings.
package library

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/audio"
	"github.com/egoist/mygo/plugins/imagepicker"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/realtime"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// Segment indices for Tab 4.
const (
	SegmentDocs   = 0
	SegmentWiki   = 1
	SegmentMemory = 2
)

// SearchHit represents a merged global search match from offline FTS5 or live TeamHub API.
type SearchHit struct {
	ID         string
	Kind       string // "message" | "document" | "work_item" | "room" | "pocket_note" | "routine"
	Source     string // "Live" | "Offline Cache"
	RoomID     string
	Title      string
	Subtitle   string
	EntityID   string
}

// Deps supplies host services, file/media pickers, and callbacks for Library.
type Deps struct {
	Store      *state.AppStore
	Client     *api.Client
	Cache      *cache.Store
	TenantID   string
	Window     *mygo.Window
	OnOpenRoom func(roomID string)
	ShowToast  func(msg string)
	OnNotify   func()
	Share      func(mygo.ShareOptions) error
	OpenFile   func(mygo.OpenDialogOptions) ([]string, error)
	SaveCopy   func(path, name string) (string, error)
	PickImage  func(context.Context, imagepicker.Options) ([]string, error)
}

// Screen owns state and rendering for Tab 4 (Library).
type Screen struct {
	deps Deps

	mu            sync.Mutex
	closed        bool
	pending       []func()
	rooms         []api.RoomListItem
	documents     []api.Document
	myTree        api.DocumentTree
	sharedTree    api.DocumentTree
	roomDocs      []api.Document
	personalWiki  *api.PersonalWiki
	wikiPreview   map[string]string
	wikiDocs      []api.Document
	wikiGraph     *api.WikiGraphData
	memoryEntries []api.PersonalMemoryEntryC2
	activeCapture *api.VoiceCapture
	loading       bool
	syncError     string

	// Voice SSE / audio runtime handles (guarded by mu).
	voiceStreamCancel     context.CancelFunc
	audioPlayer           *audio.Player
	audioGen              uint64
	htmlPreviewGen        uint64
	previewWebViewFactory func(mygo.WebViewOptions) (*mygo.WebView, error)

	// UI-thread-only state.
	segment int
	scroll  [3]ui.ScrollState

	// Global Search UI state.
	searchQuery     string
	searchFilter    int // 0: All, 1: Messages, 2: Documents, 3: Offline Cache
	searchBusy      bool
	searchSubmitted bool
	searchErr       string
	ftsHits         []SearchHit
	liveMsgHits     []SearchHit
	liveDocHits     []SearchHit

	// Docs segment & Reader state.
	docTreeTab         int // 0: My Docs, 1: Shared, 2: Room Docs
	docRoomID          string
	docFolderID        string
	docFolderTrail     []string
	newNoteSheetOpen   bool
	newNoteTitle       string
	newNoteBusy        bool
	newNoteErr         string
	uploadErr          string
	uploadBusy         bool
	readerOpen         bool
	readerDoc          *api.Document
	readerBytes        []byte
	readerText         string
	readerContentType  string
	readerBusy         bool
	readerErr          string
	readerNotice       string
	readerVersions     []api.DocumentVersion
	readerHistory      []api.DocumentHistoryEntry
	readerThreads      []api.DocumentCommentThread
	readerLinkShare    *api.DocumentLinkShare
	readerImgSrc       ui.ImageSource
	readerImgZoom      mobile.ZoomState
	readerCodeState    *editor.State
	mdOpts             markdown.Options
	versionsSheetOpen  bool
	commentsSheetOpen  bool
	commentInput       string
	replyThreadID      string
	replyInput         string
	linkShareSheetOpen bool
	renameSheetOpen    bool
	renameDraft        string
	deleteConfirmOpen  bool
	htmlPreviewOpen    bool
	htmlPreviewURL     string
	htmlPreviewErr     string
	htmlWebView        *mygo.WebView

	// Wiki & Knowledge Graph state.
	wikiViewMode     int // 0: Graph, 1: Pages
	wikiRefreshing   bool
	wikiErr          string
	wikiCategory     string
	graphZoom        mobile.ZoomState
	graphBoxRect     ui.Rect
	graphLayoutCache []graphNodePos
	wikiPageSheet    bool
	wikiSelectedNode *api.WikiGraphNode

	// Memory & Voice Meeting state.
	memoryFilter       int // 0: All, 1: Daily, 2: Weekly, 3: Meetings
	memoryDetailOpen   bool
	memoryDetailEntry  *api.PersonalMemoryEntryC2
	voiceSheetOpen     bool
	voiceCapture       *api.VoiceCapture
	voiceSessionID     string
	voiceTranscripts   []api.VoiceTranscriptEvent
	voicePartial       string
	voiceQuestions     []api.VoiceCaptureQuestion
	voiceQuestionDraft string
	voiceBusy          bool
	voiceErr           string
	voiceAudioStatus   string
	voiceAudioPlaying  bool
	voiceAudioLoaded   bool
}

// New constructs a Library screen controller.
func New(deps Deps) *Screen {
	s := &Screen{
		deps:      deps,
		graphZoom: mobile.ZoomState{Scale: 1},
	}
	s.hydrateOfflineCache(context.Background())
	return s
}

// Close releases active Voice SSE streams, WebViews, and audio players.
func (s *Screen) Close() {
	s.mu.Lock()
	s.closed = true
	s.audioGen++
	s.htmlPreviewGen++
	cancel := s.voiceStreamCancel
	s.voiceStreamCancel = nil
	player := s.audioPlayer
	s.audioPlayer = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if player != nil {
		player.Stop()
		player.Close()
	}
	s.destroyPreviewWebView()
}

// SelectSegment switches between Docs (0), Wiki (1), and Memory (2).
func (s *Screen) SelectSegment(idx int) {
	if idx < SegmentDocs || idx > SegmentMemory {
		return
	}
	s.enqueueUI(func() {
		s.segment = idx
	})
}

// SetSearchQuery updates the search field, executes local FTS5 search, and optionally submits live search.
func (s *Screen) SetSearchQuery(q string, submit bool) {
	s.enqueueUI(func() {
		s.searchQuery = q
		s.runLocalFTS5Search(q)
		if submit {
			s.submitLiveSearch()
		}
	})
}

// Refresh syncs Documents, Trees, Personal Wiki, Graph, Memory journals, and active Voice Capture.
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

	var firstErr error
	var rooms []api.RoomListItem
	if rp, err := client.ListRooms(ctx, tenantID, 50, ""); err == nil {
		rooms = rp.Items
	}

	var docs []api.Document
	if dp, err := client.ListLibraryDocuments(ctx, 50, ""); err == nil {
		docs = dp.Items
		if cs := s.cacheStore(); cs != nil {
			_ = cs.UpsertDocuments(ctx, docs)
		}
	} else {
		firstErr = err
	}

	myTree, _ := client.GetMyDocumentTreeTyped(ctx, tenantID)
	sharedTree, _ := client.GetMySharedDocumentTreeTyped(ctx, tenantID)

	var roomDocs []api.Document
	targetRoomID := s.selectedRoomID(rooms)
	if targetRoomID != "" {
		if rd, err := client.ListRoomDocuments(ctx, targetRoomID, 50, ""); err == nil {
			roomDocs = rd.Items
		}
	}

	var wikiPtr *api.PersonalWiki
	if pw, err := client.GetPersonalWiki(ctx, tenantID); err == nil {
		wikiPtr = &pw
	}
	var wikiDocs []api.Document
	if wd, err := client.ListPersonalWikiDocuments(ctx, tenantID); err == nil {
		wikiDocs = wd.Items
	}
	var graphPtr *api.WikiGraphData
	if wg, err := client.GetPersonalWikiGraphData(ctx, tenantID); err == nil {
		graphPtr = &wg
	}

	var memItems []api.PersonalMemoryEntryC2
	if mp, err := client.ListPersonalMemoryC2(ctx, tenantID, "", 50, ""); err == nil {
		memItems = mp.Items
	}

	var activeCapPtr *api.VoiceCapture
	for _, rm := range rooms {
		if vc, err := client.GetActiveVoiceCapture(ctx, rm.ID); err == nil && vc.ID != "" {
			activeCapPtr = &vc
			break
		}
	}

	s.mu.Lock()
	s.loading = false
	if len(rooms) > 0 {
		s.rooms = rooms
	}
	if len(docs) > 0 || firstErr == nil {
		s.documents = docs
	}
	if len(myTree.Items) > 0 {
		s.myTree = myTree
	}
	if len(sharedTree.Items) > 0 {
		s.sharedTree = sharedTree
	}
	s.roomDocs = roomDocs
	if wikiPtr != nil {
		s.personalWiki = wikiPtr
	}
	if len(wikiDocs) > 0 {
		s.wikiDocs = wikiDocs
	}
	if graphPtr != nil {
		s.wikiGraph = graphPtr
	}
	if len(memItems) > 0 || firstErr == nil {
		s.memoryEntries = memItems
	}
	if activeCapPtr != nil {
		s.activeCapture = activeCapPtr
	}
	if firstErr != nil {
		s.syncError = firstErr.Error()
	} else {
		s.syncError = ""
	}
	s.mu.Unlock()
	s.notify()
}

// View renders Tab 4 (Library) with persistent Global Search and segment views.
func (s *Screen) View(c *ui.Context) {
	s.drainPending()
	s.syncStoreFallback()

	t := c.Theme()
	s.mu.Lock()
	loading := s.loading
	syncErr := s.syncError
	s.mu.Unlock()

	ui.Column(c).Fill().Background(t.Background).Children(func() {
		// Persistent Global Search bar + segment switcher
		ui.Column(c).FillWidth().Padding(10, 14, 8, 14).Gap(8).Shrink(0).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				sf := ui.SearchField(c, &s.searchQuery).Grow(1).Basis(0).
					Placeholder("Search messages, docs, offline cache...").
					Label("Global Library Search")
				if sf.Changed() {
					s.runLocalFTS5Search(s.searchQuery)
				}
				if sf.Submitted() {
					s.submitLiveSearch()
				}
				searchBtn := components.PrimaryTouchButton(c, "Search", s.searchBusy || strings.TrimSpace(s.searchQuery) == "")
				searchBtn.Shrink(0)
				if searchBtn.Clicked() {
					s.submitLiveSearch()
				}
			})

			if strings.TrimSpace(s.searchQuery) != "" {
				s.viewSearchFilterChips(c)
			} else {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Children(func() {
						components.SegmentedControl(c, &s.segment, "Docs", "Wiki", "Memory")
					})
					refLabel := "Sync"
					if loading {
						refLabel = "..."
					}
					refBtn := components.SecondaryTouchButton(c, refLabel, loading)
					if refBtn.Clicked() {
						go s.Refresh(context.Background())
					}
				})
			}

			if syncErr != "" {
				components.ErrorInline(c, syncErr, func() {
					go s.Refresh(context.Background())
				})
			}
		})
		ui.Divider(c)

		if strings.TrimSpace(s.searchQuery) != "" {
			s.viewGlobalSearchResults(c)
			return
		}

		switch s.segment {
		case SegmentDocs:
			s.viewDocsSegment(c)
		case SegmentWiki:
			s.viewWikiSegment(c)
		case SegmentMemory:
			s.viewMemorySegment(c)
		}
	})

	// Modal sheets & action sheets.
	s.viewNewNoteSheet(c)
	s.viewDocumentReaderSheet(c)
	s.viewVersionsSheet(c)
	s.viewDocCommentsSheet(c)
	s.viewLinkShareSheet(c)
	s.viewRenameDocSheet(c)
	s.viewDeleteDocConfirm(c)
	s.viewHTMLPreviewSheet(c)
	s.viewWikiPageDetailSheet(c)
	s.viewMemoryDetailSheet(c)
	s.viewVoiceCaptureSheet(c)
}

var searchFilterLabels = []string{"All", "Messages", "Documents", "Offline Cache"}

func (s *Screen) viewSearchFilterChips(c *ui.Context) {
	t := c.Theme()
	ui.ScrollHorizontal(c).FillWidth().Children(func() {
		ui.Row(c).Gap(6).Role(ui.RoleTabList).Children(func() {
			for i, lbl := range searchFilterLabels {
				on := s.searchFilter == i
				bg := theme.Extra(t).MutedBg
				fg := t.TextMuted
				if on {
					bg = t.Accent
					fg = t.AccentText
				}
				chip := ui.Row(c.Key(i)).MinHeight(34).PaddingX(12).Radius(999).Background(bg).
					AlignItems(ui.Center).Shrink(0).Role(ui.RoleTab).Label(lbl).Checked(on)
				chip.Children(func() {
					ui.Text(c, lbl).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
				})
				if chip.Clicked() {
					s.searchFilter = i
				}
			}
		})
	})
}

func (s *Screen) runLocalFTS5Search(q string) {
	q = strings.TrimSpace(q)
	s.searchErr = ""
	if q == "" {
		s.ftsHits = nil
		s.liveMsgHits = nil
		s.liveDocHits = nil
		s.searchSubmitted = false
		return
	}
	cs := s.cacheStore()
	if cs == nil {
		s.ftsHits = nil
		return
	}
	res, err := cs.Search(context.Background(), q, 30)
	if err != nil {
		return
	}
	hits := make([]SearchHit, 0, len(res))
	for _, r := range res {
		hits = append(hits, SearchHit{
			ID:       "fts:" + r.EntityType + ":" + r.EntityID,
			Kind:     r.EntityType,
			Source:   "Offline Cache",
			RoomID:   r.RoomID,
			EntityID: r.EntityID,
			Title:    r.Title,
			Subtitle: r.Snippet,
		})
	}
	s.ftsHits = hits
}

func (s *Screen) submitLiveSearch() {
	q := strings.TrimSpace(s.searchQuery)
	if q == "" {
		return
	}
	s.runLocalFTS5Search(q)
	s.searchSubmitted = true
	s.searchErr = ""

	client := s.client()
	tenantID := s.tenantID()
	if client == nil {
		return
	}
	s.searchBusy = true
	go func() {
		ctx := context.Background()
		var msgHits []SearchHit
		var docHits []SearchHit
		var errMsgs []string

		var wg sync.WaitGroup
		var resMu sync.Mutex

		if tenantID != "" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				mp, err := client.SearchTenantMessages(ctx, tenantID, q, 25)
				resMu.Lock()
				defer resMu.Unlock()
				if err != nil {
					errMsgs = append(errMsgs, err.Error())
					return
				}
				for _, hit := range mp.Items {
					msgHits = append(msgHits, SearchHit{
						ID:       "msg:" + hit.Message.ID,
						Kind:     "message",
						Source:   "Live",
						RoomID:   hit.Room.ID,
						EntityID: hit.Message.ID,
						Title:    hit.Room.Name + " · " + hit.Message.Author.DisplayName,
						Subtitle: hit.Message.RawMessage,
					})
				}
			}()
		}

		wg.Add(1)
		go func() {
			defer wg.Done()
			dp, err := client.SearchLibraryDocuments(ctx, q, 25)
			resMu.Lock()
			defer resMu.Unlock()
			if err != nil {
				errMsgs = append(errMsgs, err.Error())
				return
			}
			for _, doc := range dp.Items {
				docHits = append(docHits, SearchHit{
					ID:       "doc:" + doc.ID,
					Kind:     "document",
					Source:   "Live",
					EntityID: doc.ID,
					Title:    doc.Title,
					Subtitle: doc.Format + " · " + doc.Status,
				})
			}
		}()

		wg.Wait()
		s.enqueueUI(func() {
			s.searchBusy = false
			s.liveMsgHits = msgHits
			s.liveDocHits = docHits
			if len(errMsgs) > 0 && len(msgHits) == 0 && len(docHits) == 0 {
				s.searchErr = strings.Join(errMsgs, "; ")
			} else {
				s.searchErr = ""
			}
		})
	}()
}

func (s *Screen) mergedSearchHits() []SearchHit {
	seen := map[string]struct{}{}
	var out []SearchHit

	appendUnique := func(h SearchHit) {
		if !s.matchSearchFilter(h) {
			return
		}
		key := h.Kind + ":" + h.EntityID
		if h.EntityID != "" {
			if _, ok := seen[key]; ok {
				return
			}
			seen[key] = struct{}{}
		}
		out = append(out, h)
	}

	for _, h := range s.liveMsgHits {
		appendUnique(h)
	}
	for _, h := range s.liveDocHits {
		appendUnique(h)
	}
	for _, h := range s.ftsHits {
		appendUnique(h)
	}
	return out
}

func (s *Screen) matchSearchFilter(h SearchHit) bool {
	switch s.searchFilter {
	case 1: // Messages
		return h.Kind == "message"
	case 2: // Documents
		return h.Kind == "document"
	case 3: // Offline Cache
		return h.Source == "Offline Cache"
	default:
		return true
	}
}

func (s *Screen) viewGlobalSearchResults(c *ui.Context) {
	t := c.Theme()
	hits := s.mergedSearchHits()
	q := strings.TrimSpace(s.searchQuery)

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
			if s.searchErr != "" {
				components.StatusBanner(c, components.ToneWarning, s.searchErr, "Retry", s.submitLiveSearch)
			}
			if s.searchBusy && len(hits) == 0 {
				components.LoadingSkeleton(c, 3)
				return
			}
			if len(hits) == 0 {
				title := fmt.Sprintf("No matches for %q", q)
				sub := "Try another keyword or clear filters to search all sources."
				if !s.searchSubmitted {
					sub = "No offline SQLite matches found. Tap Search to query TeamHub live."
				}
				components.EmptyState(c, theme.IconLibrary, title, sub, "Clear Search", func() {
					s.searchQuery = ""
					s.runLocalFTS5Search("")
				})
				return
			}

			ui.Text(c, fmt.Sprintf("%d results for %q", len(hits), q)).
				FontSize(12).FontWeight(600).TextColor(t.TextMuted)

			for _, hit := range hits {
				hit := hit
				row := ui.Column(c.Key(hit.ID)).FillWidth().Padding(12, 12).Gap(5).
					Radius(12).Background(t.Surface).Border(1, t.Border).
					Role(ui.RoleButton).Label(hit.Kind + " " + hit.Title)
				row.Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Text(c, hit.Title).FontSize(14).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
						ui.Row(c).Gap(4).Shrink(0).Children(func() {
							components.StatusPill(c, hit.Kind, components.ToneInfo)
							srcTone := components.ToneNeutral
							if hit.Source == "Live" {
								srcTone = components.ToneSuccess
							}
							components.StatusPill(c, hit.Source, srcTone)
						})
					})
					if strings.TrimSpace(hit.Subtitle) != "" {
						ui.Text(c, hit.Subtitle).FontSize(12).TextColor(t.TextMuted).MaxLines(2)
					}
				})
				if row.Clicked() {
					switch hit.Kind {
					case "message", "room":
						if hit.RoomID != "" && s.deps.OnOpenRoom != nil {
							s.deps.OnOpenRoom(hit.RoomID)
						}
					case "document":
						if hit.EntityID != "" {
							s.openDocumentByID(hit.EntityID)
						}
					}
				}
			}
		})
	})
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
	if len(s.rooms) == 0 && len(snap.Rooms) > 0 {
		s.rooms = append([]api.RoomListItem(nil), snap.Rooms...)
	}
	if len(s.documents) == 0 && len(snap.Documents) > 0 {
		s.documents = append([]api.Document(nil), snap.Documents...)
	}
	s.mu.Unlock()
}

func (s *Screen) hydrateOfflineCache(ctx context.Context) {
	cs := s.cacheStore()
	if cs == nil {
		return
	}
	tid := s.tenantID()
	docs, _ := cs.ListDocuments(ctx, tid)
	rooms, _ := cs.ListRooms(ctx, tid)
	s.mu.Lock()
	if len(docs) > 0 && len(s.documents) == 0 {
		s.documents = docs
	}
	if len(rooms) > 0 && len(s.rooms) == 0 {
		s.rooms = rooms
	}
	s.mu.Unlock()
}

func (s *Screen) selectedRoomID(rooms []api.RoomListItem) string {
	s.mu.Lock()
	rid := s.docRoomID
	s.mu.Unlock()
	if rid != "" {
		return rid
	}
	if len(rooms) > 0 {
		return rooms[0].ID
	}
	return ""
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

// SetWindow attaches the host mygo.Window so Document Reader can open WebView previews.
func (s *Screen) SetWindow(w *mygo.Window) {
	s.mu.Lock()
	s.deps.Window = w
	s.mu.Unlock()
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

func (s *Screen) share(opts mygo.ShareOptions) error {
	if s.deps.Share != nil {
		return s.deps.Share(opts)
	}
	return mygo.Share(opts)
}

func (s *Screen) openFile(opts mygo.OpenDialogOptions) ([]string, error) {
	if s.deps.OpenFile != nil {
		return s.deps.OpenFile(opts)
	}
	return mygo.Dialog.Open(opts)
}

func (s *Screen) saveCopy(srcPath, name string) (string, error) {
	if s.deps.SaveCopy != nil {
		return s.deps.SaveCopy(srcPath, name)
	}
	return mygo.Dialog.SaveCopy(srcPath, name)
}

func (s *Screen) pickImage(ctx context.Context, opts imagepicker.Options) ([]string, error) {
	if s.deps.PickImage != nil {
		return s.deps.PickImage(ctx, opts)
	}
	return imagepicker.Pick(ctx, opts)
}

var _ = realtime.NewVoiceSessionStream
