package work_test

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/golden"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/screens/work"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func waitUntil(t *testing.T, timeout time.Duration, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for condition")
}

func settle(tt *ui.Tester) {
	tt.Frame()
	tt.Advance(600 * time.Millisecond)
	tt.Frame()
}

func clickOrScroll(t *testing.T, tt *ui.Tester, name string) {
	t.Helper()
	settle(tt)
	for range 8 {
		r, ok := tt.Find(name)
		if ok && r.Y >= 0 && r.Y+r.H <= 810 {
			if err := tt.Click(name); err == nil {
				settle(tt)
				return
			}
		}
		dy := float32(240)
		if ok && r.Y < 40 {
			dy = -240
		}
		tt.Scroll(200, 260, 0, dy)
		tt.Frame()
	}
	if err := tt.Click(name); err != nil {
		t.Fatalf("click %q: %v", name, err)
	}
	settle(tt)
}

func focusField(t *testing.T, tt *ui.Tester, label string) {
	t.Helper()
	settle(tt)
	for range 8 {
		info, ok := tt.AccessByRole(ui.RoleTextField, label)
		if ok && !info.Offscreen && info.Bounds.W > 0 && info.Bounds.H > 0 && info.Bounds.Y >= 40 && info.Bounds.Y+info.Bounds.H <= 810 {
			tt.ClickAt(info.Bounds.X+info.Bounds.W/2, info.Bounds.Y+info.Bounds.H/2)
			tt.Frame()
			return
		}
		dy := float32(240)
		if ok && info.Bounds.Y < 40 {
			dy = -240
		}
		tt.Scroll(200, 260, 0, dy)
		tt.Frame()
	}
	t.Fatalf("text field %q not focusable or outside window", label)
}

func newTestWorkScreen(t *testing.T, srv *testutil.C2FakeServer, onlineFn func() bool) (*work.Screen, *cache.Store, *[]string) {
	t.Helper()
	client, err := srv.NewClient()
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	cs, err := cache.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("cache.Open: %v", err)
	}
	t.Cleanup(func() { _ = cs.Close() })

	var openedRooms []string
	scr := work.New(work.Deps{
		Client:         client,
		Cache:          cs,
		TenantID:       srv.TenantID,
		CurrentActorID: "act_human_1",
		Online:         onlineFn,
		OnOpenRoom: func(roomID string) {
			openedRooms = append(openedRooms, roomID)
		},
	})
	t.Cleanup(scr.Close)
	scr.Refresh(context.Background())
	return scr, cs, &openedRooms
}

func TestWorkViewportsInsetsThemesCJKAndIME(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	// Seed CJK work item using escaped Unicode code points (English-only gate compliant).
	srv.WorkItems = append(srv.WorkItems, api.WorkItem{
		ID:          "wi_cjk",
		TenantID:    srv.TenantID,
		Number:      99,
		Kind:        "issue",
		Title:       "\u9879\u76ee\u8fdb\u5ea6: Mobile Release \u6d4b\u8bd5\u4e0e\u9a8c\u8bc1",
		Description: "\u8bf7\u786e\u8ba4\u6240\u6709\u8bbe\u5907\u5bbd\u5ea6\u6e32\u67d3\u6b63\u5e38",
		State:       "open",
		Priority:    "medium",
		Version:     1,
		CreatedBy:   api.ActorRef{ID: "act_human_1", TenantID: srv.TenantID, Kind: "human", DisplayName: "Alex"},
		UpdatedBy:   api.ActorRef{ID: "act_human_1", TenantID: srv.TenantID, Kind: "human", DisplayName: "Alex"},
	})

	scr, _, _ := newTestWorkScreen(t, srv, nil)

	for _, vp := range testutil.StandardMobileViewports {
		for _, dark := range []bool{false, true} {
			mode := "light"
			if dark {
				mode = "dark"
			}
			t.Run(vp.Name+"_"+mode, func(t *testing.T) {
				view := func(c *ui.Context) {
					if dark {
						c.SetTheme(theme.TownDark())
					} else {
						c.SetTheme(theme.TownLight())
					}
					ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
						scr.View(c)
					})
				}

				scr.SelectSegment(work.SegmentIssues)
				tt := testutil.NewPhoneTester(view, vp)
				tt.SetInsets(59, 0, 34, 0)
				tt.Frame()
				if !tt.HasText("Ship Mobile Companion Wave C-2") {
					t.Fatal("expected synced work item")
				}
				if len(tt.AccessAll()) < 6 {
					t.Fatalf("expected rich accessibility tree, got %d nodes", len(tt.AccessAll()))
				}

				// Keyboard inset check on Pocket Notes
				scr.SelectSegment(work.SegmentPocket)
				testutil.ApplyKeyboardInset(tt, 59)
				tt.Frame()
				if !tt.HasText("Today's Pocket Note") {
					t.Fatal("expected Pocket Notes view")
				}

				// Switch to Routines
				scr.SelectSegment(work.SegmentRoutines)
				tt.Frame()
				if !tt.HasText("Morning Standup Digest") {
					t.Fatal("expected Routines view")
				}
			})
		}
	}

	// Verify IME composition Enter does not prematurely submit a comment in Work Item Detail.
	scr.SelectSegment(work.SegmentIssues)
	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()
	clickOrScroll(t, tt, "Work item #12 Ship Mobile Companion Wave C-2")
	clickOrScroll(t, tt, "Work Item Comment Input")
	beforeCount := len(srv.WorkItemComments["wi_12"])
	tt.Compose("\u4f60\u597d", 2)
	tt.Key(0, ui.KeyEnter)
	tt.Frame()
	time.Sleep(40 * time.Millisecond)
	if len(srv.WorkItemComments["wi_12"]) != beforeCount {
		t.Fatalf("IME Enter prematurely submitted comment: got %d want %d", len(srv.WorkItemComments["wi_12"]), beforeCount)
	}
	if scr.BadgeCount() < 2 {
		t.Fatalf("expected BadgeCount >= 2, got %d", scr.BadgeCount())
	}
}

func TestWorkPocketNoteOfflineOutboxRetryRecovery(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	var online atomic.Bool
	online.Store(false)

	scr, cs, openedRooms := newTestWorkScreen(t, srv, online.Load)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])

	scr.SelectSegment(work.SegmentPocket)
	tt.Frame()

	// Edit while offline -> saved locally into SQLite outbox with explicit offline indicator.
	draft := "Offline field note: check SPKI cert rotation"
	scr.SavePocketNoteDraft(draft)
	waitUntil(t, 2*time.Second, func() bool {
		st, pending := scr.CurrentPocketState()
		return st == work.PocketStateSavedOffline && pending == 1
	})
	tt.Frame()
	if !tt.HasText("Saved offline") || !tt.HasText("Retry Sync") {
		t.Fatalf("expected offline status pill and Retry Sync button, texts=%v", tt.Texts())
	}

	// Verify SQLite outbox contains pocket_note.put
	outbox, err := cs.ListOutbox(context.Background())
	if err != nil || len(outbox) != 1 || outbox[0].Kind != "pocket_note.put" {
		t.Fatalf("unexpected SQLite outbox: %+v (%v)", outbox, err)
	}

	// Switch to Issues and back to Pocket: draft MUST NOT be dropped.
	scr.SelectSegment(work.SegmentIssues)
	tt.Frame()
	scr.SelectSegment(work.SegmentPocket)
	tt.Frame()
	if info, ok := tt.Access("Today Pocket Note"); !ok || info.Value != draft {
		t.Fatalf("expected offline draft retained across segment switch: ok=%v value=%q", ok, info.Value)
	}

	// Simulate reconnect while server temporarily fails first, then recovers on Retry Sync.
	online.Store(true)
	srv.FailPocketNotePut = true
	if err := scr.SyncPocketOutbox(context.Background()); err == nil {
		t.Fatal("expected SyncPocketOutbox to fail when server errors")
	}
	tt.Frame()
	if !tt.HasText("Couldn't save") {
		t.Fatalf("expected error banner when sync fails, texts=%v", tt.Texts())
	}

	// Now server recovers -> click Retry Sync button in UI!
	srv.FailPocketNotePut = false
	if err := tt.Click("Retry Sync"); err != nil {
		t.Fatalf("click Retry Sync: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		st, pending := scr.CurrentPocketState()
		return st == work.PocketStateSaved && pending == 0
	})
	tt.Frame()
	if tt.HasText("Couldn't save") || tt.HasText("Saved offline") {
		t.Fatalf("stale error/offline banner remained after recovery: %v", tt.Texts())
	}
	if !tt.HasText("Saved") {
		t.Fatal("expected Saved pill after recovery")
	}
	if srv.PocketNotes[0].Text != draft {
		t.Fatalf("server pocket note = %q, want %q", srv.PocketNotes[0].Text, draft)
	}

	// Test Send to Another Me quick action.
	clickOrScroll(t, tt, "Send to Another Me")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return len(*openedRooms) == 1
	})
	if (*openedRooms)[0] != "room_another_me" {
		t.Fatalf("expected room_another_me, got %v", *openedRooms)
	}
}

func TestWorkRoutineSlowSaveBusyStateAndErrorPreservation(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	gate := make(chan struct{})
	var closeGateOnce sync.Once
	closeGate := func() {
		closeGateOnce.Do(func() { close(gate) })
	}
	defer closeGate()
	srv.RoutineSaveGate = gate
	srv.FailNextRoutine = "revision mismatch"

	scr, _, _ := newTestWorkScreen(t, srv, nil)
	scr.SelectSegment(work.SegmentRoutines)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Open edit sheet for rt_1.
	scr.OpenRoutineEditorForTest(srv.RoutinesByRoom["room_general"][0])
	settle(tt)

	// Edit title inside form.
	focusField(t, tt, "Title")
	tt.Type(" v2")
	tt.Frame()
	if info, ok := tt.AccessByRole(ui.RoleTextField, "Title"); !ok || info.Value != "Morning Standup Digest v2" {
		t.Fatalf("routine title input did not update before save: ok=%v val=%q", ok, info.Value)
	}

	// Click Save Routine while gate blocks the HTTP response -> verify busy state & concurrent refresh safety.
	clickOrScroll(t, tt, "Save Routine")
	if !tt.HasText("Saving...") {
		t.Fatalf("expected busy Saving... button while slow save is in flight, texts=%v", tt.Texts())
	}

	// Concurrent background Refresh runs while inputs are disabled during slow save;
	// after error recovery (line 350) the edited draft must remain intact.
	scr.Refresh(context.Background())
	tt.Frame()
	if info, ok := tt.AccessByRole(ui.RoleTextField, "Title"); !ok || !info.Disabled {
		t.Fatalf("expected routine Title field disabled while saving: ok=%v disabled=%v", ok, info.Disabled)
	}

	// Release gate -> server returns error -> form stays open with error banner & preserved text!
	closeGate()
	srv.RoutineSaveGate = nil
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("revision mismatch")
	})
	if info, ok := tt.AccessByRole(ui.RoleTextField, "Title"); !ok || info.Value != "Morning Standup Digest v2" {
		t.Fatalf("routine draft lost after save error: ok=%v val=%q", ok, info.Value)
	}

	// Retry Save Routine -> succeeds, clears error, closes sheet, updates list.
	clickOrScroll(t, tt, "Save Routine")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return !tt.HasText("Save Routine") && tt.HasText("Morning Standup Digest v2")
	})
	if tt.HasText("revision mismatch") {
		t.Fatal("stale routine error remained after recovery")
	}

	// Test Run Now on routine.
	clickOrScroll(t, tt, "Run Now")
}

func TestWorkItemFullLifecycleAndTaskRuns(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	scr, _, openedRooms := newTestWorkScreen(t, srv, nil)
	scr.SelectSegment(work.SegmentIssues)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Create Work Item sheet
	clickOrScroll(t, tt, "+ New")
	focusField(t, tt, "Title")
	tt.Type("Verify Wave C2 checklist")
	tt.Frame()
	if info, ok := tt.AccessByRole(ui.RoleTextField, "Title"); !ok || info.Value != "Verify Wave C2 checklist" {
		t.Fatalf("Title input did not accept text: ok=%v info=%+v", ok, info)
	}
	clickOrScroll(t, tt, "Create Work Item")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Verify Wave C2 checklist")
	})

	// Open Task #12 detail sheet to verify Task Execution, Conversation, Runs, Comments, Timeline, Transition, Jump to Room.
	clickOrScroll(t, tt, "Work item #12 Ship Mobile Companion Wave C-2")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Task Execution & Runs") && tt.HasText("Activity Timeline (2)")
	})
	if !tt.HasText("Presentation Runs: 1 active, 1 history") {
		t.Fatalf("expected task runtime presentation runs summary, texts=%v", tt.Texts())
	}

	// Add comment via button
	focusField(t, tt, "Work Item Comment Input")
	tt.Type("Checked presentation runs")
	tt.Frame()
	clickOrScroll(t, tt, "Send Comment")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("Checked presentation runs")
	})

	// Scroll back up inside detail sheet for Transition & Jump to Work Room buttons.
	for range 4 {
		tt.Scroll(200, 260, 0, -260)
		tt.Frame()
	}

	// Transition work item
	clickOrScroll(t, tt, "Transition")
	clickOrScroll(t, tt, "Resolved (Completed)")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return strings.Contains(strings.Join(tt.Texts(), " "), "Resolved")
	})

	// Jump to Work Room
	clickOrScroll(t, tt, "Jump to Work Room")
	if len(*openedRooms) == 0 || (*openedRooms)[0] != "room_work_12" {
		t.Fatalf("expected Jump to Work Room to open room_work_12, got %v", *openedRooms)
	}
}

func TestWorkGoldenSnapshots(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	scr, _, _ := newTestWorkScreen(t, srv, nil)
	scr.SelectSegment(work.SegmentIssues)

	ttLight := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			scr.View(c)
		})
	}, testutil.StandardMobileViewports[1])
	golden.Match(t, ttLight, "testdata/work_issues_light_390x844.png")

	ttDark := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			scr.View(c)
		})
	}, testutil.StandardMobileViewports[1])
	golden.Match(t, ttDark, "testdata/work_issues_dark_390x844.png")
}
