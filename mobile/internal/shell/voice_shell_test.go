package shell_test

import (
	"context"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/shell"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestShellOpensVoiceSheetFromRoomChatAndHandlesSuspend(t *testing.T) {
	i18n.SetPreference(config.LanguageEN)

	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedWaveC1Fixtures()
	enabled := true
	srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, _ *testutil.VoiceServerState) {
		pol.VoiceAvailable = &enabled
		pol.VoiceMediaSupported = true
		pol.LiveSupported = &enabled
		pol.LiveEnabled = &enabled
	})
	defer srv.Close()

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()

	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}
	if err := store.LoadRoomMessages(context.Background(), "room_general", false); err != nil {
		t.Fatalf("LoadRoomMessages: %v", err)
	}

	sh := shell.New(store, func() bool { return false })
	defer sh.Close()
	sh.OpenRoom("room_general")

	tt := testutil.NewPhoneTester(sh.View, testutil.StandardMobileViewports[1])
	tt.Frame()

	if !tt.HasText("Voice") {
		t.Fatalf("expected Voice launcher chip in Room Chat composer, texts=%v", tt.Texts())
	}
	if err := tt.Click("Voice"); err != nil {
		t.Fatalf("click Voice chip: %v", err)
	}
	for range 4 {
		tt.Frame()
		tt.Advance(250 * time.Millisecond)
		tt.Frame()
	}
	if !sh.Voice().IsOpen() {
		t.Fatal("expected Voice sheet opened from Room Chat composer")
	}
	if !tt.HasText("Live Voice") || !tt.HasText("Product Launch") {
		t.Fatalf("expected Live Voice sheet rendered for room, texts=%v", tt.Texts())
	}

	// Simulate app suspend & resume propagation through Shell without panics or leaks.
	sh.SetSuspended(true)
	store.SetSuspended(true)
	tt.Frame()
	store.SetSuspended(false)
	sh.SetSuspended(false)
	tt.Frame()
}
