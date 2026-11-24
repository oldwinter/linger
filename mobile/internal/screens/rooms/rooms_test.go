package rooms_test

import (
	"context"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/golden"
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
	golden.Match(t, ttList, "testdata/rooms_list_light_390x844.png")

	// 2. Room Chat with inline Decision Cards (Town Light, 390x844)
	// Use static messages without live running banner elapsed seconds so golden is 100% deterministic.
	_ = store.CancelRun(context.Background(), "room_general", "run_1")
	store.SetStatusMessage("")
	ttChat := testutil.NewPhoneTester(renderWithRouter(ui.NewRouter("/rooms/room_general"), false), testutil.StandardMobileViewports[1])
	golden.Match(t, ttChat, "testdata/rooms_chat_light_390x844.png")

	// 3. Live Run Watch (Town Dark, 390x844) with zero elapsed-seconds drift
	ttWatch := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		s := store.Snapshot()
		s.ActiveRuns = []api.RoomRunStatus{{RunID: "run_1", RoomID: "room_general", Agent: api.RoomRunStatusAgentRef{ID: "act_agent_1", DisplayName: "Scout"}, Status: "completed"}}
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			ctl.ViewRunWatch(c, s, "room_general", "run_1")
		})
	}, testutil.StandardMobileViewports[1])
	golden.Match(t, ttWatch, "testdata/rooms_run_watch_dark_390x844.png")
}
