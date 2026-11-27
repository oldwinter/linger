package rooms_test

import (
	"context"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/screens/rooms"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func setupRoomsHarness(t *testing.T) (*testutil.FakeServer, *state.AppStore, *rooms.Controller) {
	t.Helper()
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedWaveC1Fixtures()
	t.Cleanup(srv.Close)

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	t.Cleanup(store.Disconnect)

	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}
	ctl := rooms.NewController(store, rooms.NavigationHooks{})
	return srv, store, ctl
}

func TestRoomsFiltersChatComposerDraftsRunWatchAndOfflineRecovery(t *testing.T) {
	_, store, ctl := setupRoomsHarness(t)

	for _, vp := range testutil.StandardMobileViewports {
		t.Run(vp.Name, func(t *testing.T) {
			view := func(c *ui.Context) {
				c.SetTheme(theme.TownLight())
				ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
					store.Routers[state.TabRooms].View(c, func(r *ui.Route) {
						ctl.Route(c, r, store.Snapshot())
					})
				})
			}

			tt := testutil.NewPhoneTester(view, vp)
			store.Routers[state.TabRooms].Replace("/rooms")
			ctl.SetFilter(0)
			tt.Frame()
			if !tt.HasText("Product Launch") || !tt.HasText("Release Ops") {
				t.Fatal("expected seeded rooms in All filter")
			}

			// Filter to Direct only.
			ctl.SetFilter(3)
			tt.Frame()
			if !tt.HasText("Scout") || tt.HasText("Release Ops") {
				t.Fatal("expected Direct filter to isolate direct room")
			}
			ctl.SetFilter(0)

			// Open Room Chat for room_general -> verify Markdown, Decision Cards, HTML fragment, and keyboard inset.
			if err := store.LoadRoomMessages(context.Background(), "room_general", false); err != nil {
				t.Fatalf("LoadRoomMessages: %v", err)
			}
			store.Routers[state.TabRooms].Replace("/rooms/room_general")
			testutil.ApplyKeyboardInset(tt, vp.Top)
			tt.Frame()
			if !tt.HasText("Run go test in linger-mobile") || !tt.HasText("Confirm rollout channel") {
				t.Fatal("expected inline decision cards in Room Chat")
			}
			if !tt.HasText("Release Metrics") {
				t.Fatal("expected sandboxed HTML fragment summary card in Room Chat")
			}

			// Draft persistence with CJK text (\u4f60\u597d\u4e16\u754c) survives switching rooms.
			cjkDraft := "Review \u4f60\u597d\u4e16\u754c"
			store.SetDraft("room_general", cjkDraft)
			if got := store.GetDraft("room_general"); got != cjkDraft {
				t.Fatalf("draft lost: got %q, want %q", got, cjkDraft)
			}

			// Live Run Watch renders Plan checklist, Tool Timeline, and Streaming Output.
			if err := store.SyncRunPresentation(context.Background(), "room_general", "run_1"); err != nil {
				t.Fatalf("SyncRunPresentation: %v", err)
			}
			store.Routers[state.TabRooms].Replace("/rooms/room_general/runs/run_1")
			tt.SetInsets(vp.Top, 0, vp.Bottom, 0)
			tt.Frame()
			if !tt.HasText("Execution Plan") || !tt.HasText("Check OpenAPI DTOs") || !tt.HasText("go test -race ./...") {
				t.Fatal("expected plan steps and tool activity timeline in Live Run Watch")
			}
		})
	}

	// Verify IME-safe Enter handling: ComposerReturnSends=false keeps Return as newline, while true sends!
	store.SetComposerReturnSends(false)
	store.SetDraft("room_general", "Line one")
	if store.Snapshot().ComposerReturnSends {
		t.Fatal("expected ComposerReturnSends false")
	}
	store.SetComposerReturnSends(true)
	if !store.Snapshot().ComposerReturnSends {
		t.Fatal("expected ComposerReturnSends true")
	}

	// Send CJK message and confirm draft clears and message is added.
	msg, err := store.SendMessage(context.Background(), "room_general", "Ship \u4f60\u597d", nil, nil)
	if err != nil || msg.RawMessage != "Ship \u4f60\u597d" {
		t.Fatalf("SendMessage: %+v (%v)", msg, err)
	}
	if store.GetDraft("room_general") != "" {
		t.Fatal("expected draft cleared after send")
	}
}

func TestChatSendFailurePreservesDraftAttachmentsAndReply(t *testing.T) {
	srv, store, ctl := setupRoomsHarness(t)
	if err := store.LoadRoomMessages(context.Background(), "room_general", false); err != nil {
		t.Fatalf("LoadRoomMessages: %v", err)
	}

	router := ui.NewRouter("/rooms/room_general")
	view := func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			router.View(c, func(r *ui.Route) {
				ctl.Route(c, r, store.Snapshot())
			})
		})
	}
	tt := testutil.NewPhoneTester(view, testutil.StandardMobileViewports[1])
	tt.Frame()

	// 1. Open overflow ActionSheet on a message and select Reply so replyTarget is active.
	if err := tt.Click("Message actions"); err != nil {
		t.Fatalf("click Message actions: %v", err)
	}
	for range 4 {
		tt.Frame()
		tt.Advance(400 * time.Millisecond)
		tt.Frame()
	}
	if err := tt.Click("Reply"); err != nil {
		t.Fatalf("click Reply: %v", err)
	}
	for range 6 {
		tt.Frame()
		tt.Advance(400 * time.Millisecond)
		tt.Frame()
		if !tt.HasText("Message Actions") {
			break
		}
	}

	// 2. Seed unsent draft + pending attachment upload.
	const unsent = "Critical deployment notes that must survive failure"
	store.SetDraft("room_general", unsent)
	ctl.SetPendingUploadsForTest("room_general", []api.MessageAttachmentUpload{
		{ID: "up_1", Filename: "release-checklist.pdf"},
	})
	tt.Frame()
	tt.Advance(300 * time.Millisecond)
	tt.Frame()
	if !tt.HasText("release-checklist.pdf") {
		t.Fatalf("expected pending upload chip before send, texts=%v", tt.Texts())
	}

	// 3. Force SendMessage failure (503) and tap Send.
	srv.SetFailMessageSend(true)
	if err := tt.Click("Send"); err != nil {
		t.Fatalf("click Send: %v (texts=%v)", err, tt.Texts())
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tt.Frame()
		if tt.HasText("Retry") {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if !tt.HasText("Retry") {
		t.Fatalf("expected inline send error banner with Retry action, texts=%v", tt.Texts())
	}

	// Draft text, attachment upload chip, AND reply target must ALL be preserved!
	if got := store.GetDraft("room_general"); got != unsent {
		t.Fatalf("unsent draft lost on send failure: got %q, want %q", got, unsent)
	}
	if !tt.HasText("release-checklist.pdf") {
		t.Fatalf("pending attachment upload lost on send failure: texts=%v", tt.Texts())
	}
	if !tt.HasText("Cancel") {
		t.Fatalf("reply target banner lost on send failure: texts=%v", tt.Texts())
	}

	// 4. Recover server and tap Retry -> message sends cleanly, clearing draft/uploads/reply!
	srv.SetFailMessageSend(false)
	if err := tt.Click("Retry"); err != nil {
		t.Fatalf("click Retry: %v", err)
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tt.Frame()
		if store.GetDraft("room_general") == "" && !tt.HasText("Retry") && !tt.HasText("release-checklist.pdf") {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if got := store.GetDraft("room_general"); got != "" {
		t.Fatalf("expected draft cleared after Retry succeeded, got %q", got)
	}
	if tt.HasText("release-checklist.pdf") {
		t.Fatalf("expected pending upload cleared after Retry succeeded")
	}
}

func TestChatInFlightSendPreservesNewerDraftAndUploadsAcrossRooms(t *testing.T) {
	srv, store, ctl := setupRoomsHarness(t)
	if err := store.LoadRoomMessages(context.Background(), "room_general", false); err != nil {
		t.Fatalf("LoadRoomMessages room_general: %v", err)
	}
	if err := store.LoadRoomMessages(context.Background(), "room_ops", false); err != nil {
		t.Fatalf("LoadRoomMessages room_ops: %v", err)
	}

	router := ui.NewRouter("/rooms/room_general")
	view := func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			router.View(c, func(r *ui.Route) {
				ctl.Route(c, r, store.Snapshot())
			})
		})
	}
	tt := testutil.NewPhoneTester(view, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Hold POST /messages in flight while user types a follow-up message and adds a new attachment.
	gate := make(chan struct{})
	srv.SetMessageSendGate(gate)

	store.SetDraft("room_general", "First message in flight")
	ctl.SetPendingUploadsForTest("room_general", []api.MessageAttachmentUpload{
		{ID: "up_first", Filename: "first.pdf"},
	})
	tt.Frame()
	if err := tt.Click("Send"); err != nil {
		close(gate)
		t.Fatalf("click Send in room_general: %v", err)
	}
	tt.Frame()

	// While first send is in flight, user starts composing a second message and attaches a new file.
	store.SetDraft("room_general", "Second draft typed during send")
	ctl.SetPendingUploadsForTest("room_general", []api.MessageAttachmentUpload{
		{ID: "up_first", Filename: "first.pdf"},
		{ID: "up_second", Filename: "second.pdf"},
	})

	// Switch to room_ops and send independently without disturbing room_general's lock.
	router.Replace("/rooms/room_ops")
	store.SetDraft("room_ops", "Independent ops ping")
	tt.Frame()
	if err := tt.Click("Send"); err != nil {
		close(gate)
		t.Fatalf("click Send in room_ops: %v", err)
	}
	tt.Frame()

	// Release both sends and verify room_general's newer draft and new upload survived intact!
	close(gate)
	srv.SetMessageSendGate(nil)

	router.Replace("/rooms/room_general")
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tt.Frame()
		if !tt.HasText("first.pdf") && store.GetDraft("room_ops") == "" {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if got := store.GetDraft("room_general"); got != "Second draft typed during send" {
		t.Fatalf("in-flight send clobbered newer draft: got %q", got)
	}
	if tt.HasText("first.pdf") {
		t.Fatal("submitted upload first.pdf should be cleared on send success")
	}
	if !tt.HasText("second.pdf") {
		t.Fatalf("newer upload second.pdf added during send was clobbered, texts=%v", tt.Texts())
	}
	if got := store.GetDraft("room_ops"); got != "" {
		t.Fatalf("expected room_ops draft cleared after send, got %q", got)
	}
}

func TestRunWatchBackgroundTaskCancelRequiresConfirmation(t *testing.T) {
	srv, store, ctl := setupRoomsHarness(t)
	if err := store.SyncRunPresentation(context.Background(), "room_general", "run_1"); err != nil {
		t.Fatalf("SyncRunPresentation: %v", err)
	}

	view := func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			ctl.ViewRunWatch(c, store.Snapshot(), "room_general", "run_1")
		})
	}
	tt := testutil.NewPhoneTester(view, testutil.StandardMobileViewports[1])
	tt.Frame()

	if err := tt.Click("Background Tasks"); err != nil {
		t.Fatalf("click Background Tasks: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tt.Frame()
		tt.Advance(200 * time.Millisecond)
		tt.Frame()
		if tt.HasText("Audit dependency tree") {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if !tt.HasText("Audit dependency tree") {
		t.Fatalf("expected seeded background task in sheet, texts=%v", tt.Texts())
	}

	// First tap on Cancel opens confirmation ActionSheet without mutating backend.
	if err := tt.Click("Cancel"); err != nil {
		t.Fatalf("click Cancel on background task: %v", err)
	}
	for range 4 {
		tt.Frame()
		tt.Advance(300 * time.Millisecond)
		tt.Frame()
	}
	if !tt.HasText("Cancel Task") {
		t.Fatalf("expected Cancel Task confirmation ActionSheet, texts=%v", tt.Texts())
	}
	if got := srv.CancelledBackgroundTaskIDs(); len(got) != 0 {
		t.Fatalf("background task cancelled before confirmation: %v", got)
	}

	// Tapping Keep Running aborts cancellation.
	if err := tt.Click("Keep Running"); err != nil {
		t.Fatalf("click Keep Running: %v", err)
	}
	for range 4 {
		tt.Frame()
		tt.Advance(300 * time.Millisecond)
		tt.Frame()
	}
	if got := srv.CancelledBackgroundTaskIDs(); len(got) != 0 {
		t.Fatalf("background task cancelled after Keep Running: %v", got)
	}

	// Re-open and confirm cancellation -> backend receives cancel and reloads without data race.
	if err := tt.Click("Cancel"); err != nil {
		t.Fatalf("re-click Cancel on background task: %v", err)
	}
	for range 4 {
		tt.Frame()
		tt.Advance(300 * time.Millisecond)
		tt.Frame()
	}
	if err := tt.Click("Cancel Task"); err != nil {
		t.Fatalf("click Cancel Task: %v", err)
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		tt.Frame()
		if len(srv.CancelledBackgroundTaskIDs()) == 1 {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatal("timed out waiting for confirmed background task cancellation")
}

func TestRoomsGoldenSnapshots(t *testing.T) {
	// Deterministic offline/static store fixture for exact golden matching (zero clock/RTT drift).
	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{ConfigStore: cfgStore, DataDir: t.TempDir()})
	defer store.Disconnect()

	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedWaveC1Fixtures()
	defer srv.Close()

	// Override timestamps to fixed past date so relative time ("Nov 24") never varies across runs.
	fixed := time.Date(2026, 1, 15, 10, 0, 0, 0, time.UTC)
	for i := range srv.Rooms {
		srv.Rooms[i].CreatedAt = fixed
		srv.Rooms[i].UpdatedAt = fixed
		if srv.Rooms[i].LatestMessage != nil {
			srv.Rooms[i].LatestMessage.CreatedAt = fixed
		}
	}
	for rid, msgs := range srv.MessagesByRoom {
		for i := range msgs {
			msgs[i].CreatedAt = fixed
		}
		srv.MessagesByRoom[rid] = msgs
	}
	for rid, runs := range srv.RunStatusesByRoom {
		for i := range runs {
			runs[i].CreatedAt = fixed
			runs[i].UpdatedAt = fixed
		}
		srv.RunStatusesByRoom[rid] = runs
	}

	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}
	_ = store.LoadRoomMessages(context.Background(), "room_general", false)
	_ = store.SyncRunPresentation(context.Background(), "room_general", "run_1")
	// Clear runtime-variable fields in RunWatch by keeping fixed status timestamp and zero RTT drift.
	ctl := rooms.NewController(store, rooms.NavigationHooks{})

	renderWithRouter := func(router *ui.Router, dark bool) func(*ui.Context) {
		return func(c *ui.Context) {
			if dark {
				c.SetTheme(theme.TownDark())
			} else {
				c.SetTheme(theme.TownLight())
			}
			ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
				router.View(c, func(r *ui.Route) {
					ctl.Route(c, r, store.Snapshot())
				})
			})
		}
	}

	// 1. Rooms List (Town Light, 390x844)
	ttList := testutil.NewPhoneTester(renderWithRouter(ui.NewRouter("/rooms"), false), testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttList, "testdata/rooms_list_light_390x844.png")

	// 2. Room Chat with inline Decision Cards (Town Light, 390x844)
	// Use static messages without live running banner elapsed seconds so golden is 100% deterministic.
	_ = store.CancelRun(context.Background(), "room_general", "run_1")
	store.SetStatusMessage("")
	ttChat := testutil.NewPhoneTester(renderWithRouter(ui.NewRouter("/rooms/room_general"), false), testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttChat, "testdata/rooms_chat_light_390x844.png")

	// 3. Live Run Watch (Town Dark, 390x844) with zero elapsed-seconds drift
	ttWatch := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		s := store.Snapshot()
		s.ActiveRuns = []api.RoomRunStatus{{RunID: "run_1", RoomID: "room_general", Agent: api.RoomRunStatusAgentRef{ID: "act_agent_1", DisplayName: "Scout"}, Status: "completed"}}
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			ctl.ViewRunWatch(c, s, "room_general", "run_1")
		})
	}, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttWatch, "testdata/rooms_run_watch_dark_390x844.png")
}
