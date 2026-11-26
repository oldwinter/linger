package library_test

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/imagepicker"
	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/screens/library"
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

func makeTestPNG(t *testing.T) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.RGBA{R: 9, G: 118, B: 206, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode: %v", err)
	}
	p := filepath.Join(t.TempDir(), "diagram.png")
	if err := os.WriteFile(p, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return p
}

func newTestLibraryScreen(t *testing.T, srv *testutil.C2FakeServer) (*library.Screen, *cache.Store, *[]string, *[]mygo.ShareOptions) {
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
	var shared []mygo.ShareOptions
	pngPath := makeTestPNG(t)

	scr := library.New(library.Deps{
		Client:   client,
		Cache:    cs,
		TenantID: srv.TenantID,
		OnOpenRoom: func(roomID string) {
			openedRooms = append(openedRooms, roomID)
		},
		Share: func(o mygo.ShareOptions) error {
			shared = append(shared, o)
			return nil
		},
		PickImage: func(_ context.Context, _ imagepicker.Options) ([]string, error) {
			return []string{pngPath}, nil
		},
		OpenFile: func(_ mygo.OpenDialogOptions) ([]string, error) {
			return []string{pngPath}, nil
		},
		SaveCopy: func(_, name string) (string, error) {
			return "/tmp/" + name, nil
		},
	})
	t.Cleanup(scr.Close)
	scr.Refresh(context.Background())
	return scr, cs, &openedRooms, &shared
}

func TestLibraryViewportsInsetsThemesCJKAndIME(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	srv.Documents = append(srv.Documents, api.Document{
		ID: "doc_cjk", TenantID: srv.TenantID, Title: "\u6587\u6863\u68c0\u7d22_Spec.md",
		Format: "markdown", RepresentationFormat: "markdown", Status: "active",
	})
	srv.DocContents["doc_cjk"] = []byte("# \u6587\u6863\u6807\u9898\n\n\u652f\u6301\u79bb\u7ebf\u5168\u6587\u641c\u7d22\u3002")

	scr, _, _, _ := newTestLibraryScreen(t, srv)

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

				scr.SelectSegment(library.SegmentDocs)
				tt := testutil.NewPhoneTester(view, vp)
				tt.SetInsets(59, 0, 34, 0)
				tt.Frame()
				if !tt.HasText("main.go") {
					t.Fatal("expected synced documents")
				}
				if len(tt.AccessAll()) < 5 {
					t.Fatalf("expected rich accessibility tree, got %d nodes", len(tt.AccessAll()))
				}

				scr.SelectSegment(library.SegmentWiki)
				testutil.ApplyKeyboardInset(tt, 59)
				tt.Frame()
				if !tt.HasText("Personal Knowledge Wiki") {
					t.Fatal("expected Wiki section")
				}

				scr.SelectSegment(library.SegmentMemory)
				tt.Frame()
				if !tt.HasText("Daily Journal 2026-11-24") {
					t.Fatal("expected Memory section")
				}
			})
		}
	}

	// IME composition Enter inside Global Search bar must NOT prematurely submit live search.
	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()
	if err := tt.Click("Global Library Search"); err != nil {
		t.Fatalf("focus global search: %v", err)
	}
	beforeReqs := len(srv.Requested)
	tt.Compose("\u4f60\u597d", 2)
	tt.Key(0, ui.KeyEnter)
	tt.Frame()
	time.Sleep(40 * time.Millisecond)
	if len(srv.Requested) != beforeReqs {
		t.Fatalf("IME Enter triggered live search prematurely")
	}
}

func TestLibraryGlobalSearchFTS5LiveMergeAndEmptyState(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	scr, cs, openedRooms, _ := newTestLibraryScreen(t, srv)

	// Seed an offline cached message and document in SQLite FTS5.
	seq := int64(5)
	_ = cs.UpsertMessages(context.Background(), []api.Message{
		{
			ID: "msg_offline_1", TenantID: srv.TenantID, RoomID: "room_general", RoomSeq: &seq,
			Author:     api.ActorRef{ID: "act_human_1", TenantID: srv.TenantID, Kind: "human", DisplayName: "Alex Rivera"},
			RawMessage: "Offline cached TLS certificate verification note",
		},
	})
	_ = cs.UpsertDocuments(context.Background(), srv.Documents)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Instant FTS5 document match by title without live submit
	scr.SetSearchQuery("Architecture", false)
	tt.Frame()
	if !tt.HasText("Offline Cache") || !tt.HasText("Mobile Architecture.md") {
		t.Fatalf("expected instant SQLite FTS5 doc match, texts=%v", tt.Texts())
	}

	// Instant FTS5 message match + live search merge
	scr.SetSearchQuery("TLS", false)
	tt.Frame()
	if !tt.HasText("Offline Cache") {
		t.Fatalf("expected instant SQLite FTS5 message match, texts=%v", tt.Texts())
	}

	scr.SetSearchQuery("TLS", true)
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("Live") && tt.HasText("Product Launch")
	})

	// Tapping a message hit navigates to its Room via OnOpenRoom.
	clickOrScroll(t, tt, "message Product Launch · Scout")
	if len(*openedRooms) == 0 || (*openedRooms)[0] != "room_general" {
		t.Fatalf("expected room_general navigation, got %v", *openedRooms)
	}

	// Explicit searched-no-match empty state
	scr.SetSearchQuery("zzz_unmatched_query_999", true)
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText(`No matches for "zzz_unmatched_query_999"`)
	})

	// Clear Search restores normal tabs.
	clickOrScroll(t, tt, "Clear Search")
	if tt.HasText(`No matches for`) {
		t.Fatal("expected search cleared")
	}
}

func TestLibraryDocsReaderFormatsCommentsShareUploadAndHTMLPreview(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	scr, _, _, shared := newTestLibraryScreen(t, srv)
	scr.SelectSegment(library.SegmentDocs)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// 1. Open Code Document (main.go) -> renders read-only syntax-highlighted editor.View
	clickOrScroll(t, tt, "Document main.go")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Save Copy") && tt.HasText("Versions (1)")
	})
	clickOrScroll(t, tt, "Save Copy")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("Saved copy to /tmp/main.go")
	})

	// 2. Open HTML document -> HTML Preview session
	scr.OpenDocumentForTest("doc_3")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Open HTML Preview")
	})
	clickOrScroll(t, tt, "Open HTML Preview")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("/v0/document-previews/prev_tok_dv_3/index.html")
	})
	clickOrScroll(t, tt, "Close")

	// 3. Open Markdown doc -> Comments & Link Share
	scr.OpenDocumentForTest("doc_1")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Comments (1)")
	})
	clickOrScroll(t, tt, "Comments (1)")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Should we add offline FTS5 notes here?")
	})
	clickOrScroll(t, tt, "Resolve")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("Resolved")
	})
	tt.Key(0, ui.KeyEscape)
	settle(tt)

	// Link Share enable & Share
	clickOrScroll(t, tt, "Share Link")
	clickOrScroll(t, tt, "Enable Viewer Link")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Share URL")
	})
	clickOrScroll(t, tt, "Share URL")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return len(*shared) == 1
	})

	// 4. Upload Photo (PNG) and open inside Zoomable image preview
	scr2, _, _, _ := newTestLibraryScreen(t, srv)
	scr2.SelectSegment(library.SegmentDocs)
	tt2 := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr2.View(c)
	}, testutil.StandardMobileViewports[1])
	tt2.Frame()
	clickOrScroll(t, tt2, "Upload Photo")
	waitUntil(t, 2*time.Second, func() bool {
		tt2.Frame()
		return tt2.HasText("Document diagram.png")
	})
	clickOrScroll(t, tt2, "Document diagram.png")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt2)
		return tt2.HasText("diagram.png")
	})
}

func TestLibraryWikiKnowledgeGraphZoomableAndNodeTap(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	scr, _, _, _ := newTestLibraryScreen(t, srv)
	scr.SelectSegment(library.SegmentWiki)

	// Degenerate zero-size tester frame must not panic or produce NaN.
	zeroTT := ui.NewTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, 0, 0)
	zeroTT.Frame()

	// Narrow 320px and standard 390px viewports render graph inside Zoomable cleanly.
	for _, vp := range testutil.StandardMobileViewports {
		tt := testutil.NewPhoneTester(func(c *ui.Context) {
			c.SetTheme(theme.TownLight())
			scr.View(c)
		}, vp)
		tt.Frame()
		if !tt.HasText("4 nodes · 3 links") {
			t.Fatalf("viewport %s missing graph stats: %v", vp.Name, tt.Texts())
		}
	}

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Tap node to open Wiki Page Detail Sheet + navigate linked page!
	clickOrScroll(t, tt, "Open wiki node Linger Mobile")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Connected Pages") && tt.HasText("Built on MyGo UI.")
	})
	clickOrScroll(t, tt, "Jump to TLS SPKI Pinning")
	if !tt.HasText("SHA-256 SPKI pin.") {
		t.Fatal("expected navigated wiki node content")
	}
}

func TestLibraryMemoryAndVoiceCaptureLiveSSEAndQA(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	scr, _, _, _ := newTestLibraryScreen(t, srv)
	scr.SelectSegment(library.SegmentMemory)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Open active Voice Capture sheet
	clickOrScroll(t, tt, "Open Live Transcript & Q&A")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Let us review the offline cache checklist.")
	})

	// Push live voice SSE transcript frame
	srv.PushVoiceSSE(testutil.SSEFrame{
		Event: "voice.events",
		ID:    "ve_2",
		Data:  `{"items":[{"kind":"transcript","transcript":{"id":"vt_2","event_id":"ve_2","voice_session_id":"vs_1","kind":"final","lane":"mic","text":"Live streamed follow-up turn","start_offset_ms":4300,"end_offset_ms":6000}}],"has_more":false,"next_cursor":"ve_2"}`,
	})
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("Live streamed follow-up turn")
	})

	// Test graceful unsupported audio fallback
	clickOrScroll(t, tt, "Load Audio")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("Unsupported recording audio format")
	})

	// Ask Meeting Q&A
	clickOrScroll(t, tt, "Meeting Question Input")
	tt.Type("Any blockers?")
	tt.Frame()
	clickOrScroll(t, tt, "Ask Question")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("Confirmed in transcript at 00:01: Any blockers?")
	})

	// Scroll back up to top of capture sheet for action buttons.
	for range 4 {
		tt.Scroll(200, 260, 0, -260)
		tt.Frame()
	}

	// Retry transcript recovery & stop capture
	clickOrScroll(t, tt, "Retry Transcript Recovery")
	clickOrScroll(t, tt, "Stop Capture")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("completed")
	})
}

func TestLibraryGoldenSnapshots(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	scr, _, _, _ := newTestLibraryScreen(t, srv)
	scr.SelectSegment(library.SegmentWiki)

	ttLight := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			scr.View(c)
		})
	}, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttLight, "testdata/library_wiki_light_390x844.png")

	ttDark := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			scr.View(c)
		})
	}, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttDark, "testdata/library_wiki_dark_390x844.png")
}
