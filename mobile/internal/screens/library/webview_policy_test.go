package library

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestDocPreviewURLValidationAndNavigationGuard(t *testing.T) {
	host := "https://192.168.1.42:48210"

	if err := validateDocPreviewURL("https://192.168.1.42:48210/v0/document-previews/tok_1", host, false); err != nil {
		t.Fatalf("expected same-origin HTTPS preview URL allowed: %v", err)
	}
	if !allowDocPreviewNavigation("about:blank", "https://192.168.1.42:48210/v0/document-previews/tok_1", host, false) {
		t.Fatal("expected about:blank allowed")
	}

	blocked := []string{
		"",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"data:text/html,hi",
		"linger://pair?code=abc",
		"http://192.168.1.42:48210/v0/document-previews/tok_1", // plain HTTP disallowed
		"https://evil.example/v0/document-previews/tok_1",      // cross-origin
		"https://192.168.1.42:9999/v0/document-previews/tok_1", // wrong port
	}
	for _, u := range blocked {
		if err := validateDocPreviewURL(u, host, false); err == nil {
			t.Fatalf("expected %q to be rejected by validateDocPreviewURL", u)
		}
		if allowDocPreviewNavigation(u, "https://192.168.1.42:48210/v0/document-previews/tok_1", host, false) {
			t.Fatalf("expected %q to be blocked by allowDocPreviewNavigation", u)
		}
	}

	// Plain HTTP permitted ONLY when allowPlainHTTP == true and origin matches.
	if err := validateDocPreviewURL("http://100.64.0.9:48210/v0/preview/1", "http://100.64.0.9:48210", true); err != nil {
		t.Fatalf("expected opt-in same-origin HTTP preview allowed: %v", err)
	}
}

func TestVoiceCaptureWithoutAudioVersionDisablesPlayback(t *testing.T) {
	scr := New(Deps{})
	defer scr.Close()
	scr.voiceCapture = &api.VoiceCapture{
		ID:                     "vc_no_audio",
		Status:                 "recording",
		AudioDocumentVersionID: nil,
	}
	scr.voiceSheetOpen = true

	tt := testutil.NewPhoneTester(scr.viewVoiceCaptureSheet, testutil.StandardMobileViewports[1])
	tt.Frame()
	if tt.HasText("Load Audio") {
		t.Fatal("expected Load Audio button hidden when AudioDocumentVersionID is nil (no hardcoded dv_rec_1 fallback)")
	}
	if !tt.HasText("No audio recording available") {
		t.Fatal("expected explicit unavailable message when AudioDocumentVersionID is nil")
	}
}

func TestOpenHTMLPreviewMidRPCCloseAndStaleGenSkipWebViewAllocation(t *testing.T) {
	reqStarted := make(chan struct{}, 4)
	releaseRPC := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case reqStarted <- struct{}{}:
		default:
		}
		<-releaseRPC
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"preview_url":"/v0/document-previews/tok_1"}`))
	}))
	defer srv.Close()

	cl, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          "tok_test",
		AllowPlainHTTP: true,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var allocCalls atomic.Int32
	var lastOpts mygo.WebViewOptions
	scr := New(Deps{Client: cl})
	scr.previewWebViewFactory = func(opts mygo.WebViewOptions) (*mygo.WebView, error) {
		allocCalls.Add(1)
		lastOpts = opts
		return nil, nil
	}
	defer scr.Close()

	waitPending := func() {
		t.Helper()
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			scr.mu.Lock()
			n := len(scr.pending)
			scr.mu.Unlock()
			if n > 0 {
				scr.drainPending()
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Fatal("timed out waiting for enqueueUI callback")
	}

	// 1. Sheet dismissed before RPC completes -> skip WebView allocation.
	scr.openHTMLPreview("ver_1")
	<-reqStarted
	scr.closeHTMLPreview()
	releaseRPC <- struct{}{}
	waitPending()
	if allocCalls.Load() != 0 || scr.htmlPreviewURL != "" || scr.htmlWebView != nil {
		t.Fatalf("expected mid-RPC sheet close to skip WebView allocation, alloc=%d url=%q", allocCalls.Load(), scr.htmlPreviewURL)
	}

	// 2. Generation superseded while sheet remains open -> skip stale RPC WebView allocation.
	scr.openHTMLPreview("ver_stale")
	<-reqStarted
	scr.mu.Lock()
	scr.htmlPreviewGen++
	scr.mu.Unlock()
	releaseRPC <- struct{}{}
	waitPending()
	if allocCalls.Load() != 0 || scr.htmlPreviewURL != "" {
		t.Fatalf("expected stale preview generation to skip WebView allocation, alloc=%d url=%q", allocCalls.Load(), scr.htmlPreviewURL)
	}

	// 3. Normal open while active and matching generation allocates with Untrusted: true.
	scr.openHTMLPreview("ver_ok")
	<-reqStarted
	releaseRPC <- struct{}{}
	waitPending()
	if allocCalls.Load() != 1 || !lastOpts.Page.Untrusted || lastOpts.URL != srv.URL+"/v0/document-previews/tok_1" {
		t.Fatalf("expected 1 untrusted WebView allocation, got alloc=%d opts=%+v", allocCalls.Load(), lastOpts)
	}

	// 4. Screen.Close() mid-RPC -> skip WebView allocation.
	scr.openHTMLPreview("ver_closed")
	<-reqStarted
	scr.Close()
	releaseRPC <- struct{}{}
	waitPending()
	if allocCalls.Load() != 1 {
		t.Fatalf("expected Screen.Close() mid-RPC to skip WebView allocation, alloc=%d", allocCalls.Load())
	}
}

func TestOpenHTMLPreviewPinnedTLSFetchesInlineHTML(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()
	srv.SeedAllFixtures()

	cl, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          srv.ValidToken,
		TLSFingerprint: srv.Fingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var allocCalls atomic.Int32
	var lastOpts mygo.WebViewOptions
	scr := New(Deps{Client: cl})
	scr.previewWebViewFactory = func(opts mygo.WebViewOptions) (*mygo.WebView, error) {
		allocCalls.Add(1)
		lastOpts = opts
		return nil, nil
	}
	defer scr.Close()

	scr.openHTMLPreview("dv_3")
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		scr.mu.Lock()
		n := len(scr.pending)
		scr.mu.Unlock()
		if n > 0 {
			scr.drainPending()
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	if allocCalls.Load() != 1 {
		t.Fatalf("expected 1 inline WebView allocation for SPKI-pinned preview, got %d (err=%q)", allocCalls.Load(), scr.htmlPreviewErr)
	}
	if !lastOpts.Page.Untrusted {
		t.Fatal("expected SPKI-pinned inline HTML preview WebView to keep Untrusted=true")
	}
	if lastOpts.URL != "" {
		t.Fatalf("expected SPKI-pinned HTML preview to load fetched HTML inline instead of direct URL %q (which OS WebViews reject with -1202)", lastOpts.URL)
	}
}
