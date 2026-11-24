package library

import (
	"testing"

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
