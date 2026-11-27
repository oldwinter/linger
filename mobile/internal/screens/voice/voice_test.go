package voice_test

import (
	"context"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	voiceScreen "github.com/oldwinter/linger/mobile/internal/screens/voice"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
	voicecore "github.com/oldwinter/linger/mobile/internal/voice"
)

func boolPtr(v bool) *bool { return &v }

type uiFakePerm struct {
	mu           sync.Mutex
	status       voicecore.PermissionStatus
	requestRes   voicecore.PermissionStatus
	settingsOpen int
}

func (p *uiFakePerm) Check(_ context.Context) (voicecore.PermissionStatus, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.status, nil
}

func (p *uiFakePerm) Request(_ context.Context) (voicecore.PermissionStatus, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status = p.requestRes
	return p.requestRes, nil
}

func (p *uiFakePerm) OpenSettings() error {
	p.mu.Lock()
	p.settingsOpen++
	p.mu.Unlock()
	return nil
}

type uiFakeCapture struct {
	ch   chan voicecore.AudioFrame
	done chan struct{}
	once sync.Once
}

func newUIFakeCapture() *uiFakeCapture {
	return &uiFakeCapture{ch: make(chan voicecore.AudioFrame, 16), done: make(chan struct{})}
}

func (c *uiFakeCapture) ReadFrame(ctx context.Context) (voicecore.AudioFrame, error) {
	select {
	case <-ctx.Done():
		return voicecore.AudioFrame{}, ctx.Err()
	case <-c.done:
		return voicecore.AudioFrame{}, context.Canceled
	case f := <-c.ch:
		return f, nil
	}
}

func (c *uiFakeCapture) Close() error {
	c.once.Do(func() { close(c.done) })
	return nil
}

type uiFakePlayback struct{}

func (uiFakePlayback) WriteSamples(_ []float32, _, _ int) error { return nil }
func (uiFakePlayback) SetMuted(_ bool)                          {}
func (uiFakePlayback) Close() error                             { return nil }

type uiFakeAudio struct {
	mu  sync.Mutex
	cap *uiFakeCapture
}

func (a *uiFakeAudio) OpenCapture(_ context.Context, _, _, _ int) (voicecore.AudioCapture, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cap = newUIFakeCapture()
	return a.cap, nil
}

func (a *uiFakeAudio) OpenPlayback(_ context.Context, _, _ int) (voicecore.AudioPlayback, error) {
	return uiFakePlayback{}, nil
}

type uiFakeRoom struct {
	mu           sync.Mutex
	cb           voicecore.RoomCallbacks
	muted        bool
	disconnected bool
}

func (r *uiFakeRoom) PublishOpusFrame(_ []byte, _ time.Duration) error { return nil }
func (r *uiFakeRoom) SetMuted(m bool) error {
	r.mu.Lock()
	r.muted = m
	r.mu.Unlock()
	return nil
}
func (r *uiFakeRoom) SendData(_ string, _ []byte, _ bool) error { return nil }
func (r *uiFakeRoom) CheckRuntimeReadiness(_ int64) (bool, bool, bool) {
	return true, true, true
}
func (r *uiFakeRoom) Disconnect() error {
	r.mu.Lock()
	r.disconnected = true
	r.mu.Unlock()
	return nil
}

type uiFakeTransport struct {
	mu   sync.Mutex
	last *uiFakeRoom
}

func (ft *uiFakeTransport) Connect(_ context.Context, _ voicecore.RoomConnectConfig, cb voicecore.RoomCallbacks) (voicecore.RoomSession, error) {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	r := &uiFakeRoom{cb: cb}
	ft.last = r
	return r, nil
}

func setupVoiceScreenHarness(t *testing.T) (*testutil.FakeServer, *state.AppStore, *voiceScreen.Screen, *uiFakePerm, *uiFakeAudio, *uiFakeTransport) {
	t.Helper()
	i18n.SetPreference(config.LanguageEN)

	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	t.Cleanup(srv.Close)

	srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, _ *testutil.VoiceServerState) {
		pol.VoiceAvailable = boolPtr(true)
		pol.VoiceMediaSupported = true
		pol.LiveSupported = boolPtr(true)
		pol.LiveEnabled = boolPtr(true)
	})

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	t.Cleanup(store.Disconnect)

	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}

	perms := &uiFakePerm{status: voicecore.PermissionGranted, requestRes: voicecore.PermissionGranted}
	audio := &uiFakeAudio{}
	transport := &uiFakeTransport{}

	ctl := voicecore.NewController(voicecore.Dependencies{
		Client:                func() *api.Client { return store.Client() },
		TenantID:              func() string { return store.Snapshot().TenantID },
		Permissions:           perms,
		Audio:                 audio,
		Transport:             transport,
		ReadinessPollInterval: 20 * time.Millisecond,
	})
	scr := voiceScreen.New(voiceScreen.Deps{
		Store:      store,
		Controller: ctl,
	})
	t.Cleanup(scr.Close)

	return srv, store, scr, perms, audio, transport
}

func waitUI(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatal("timed out waiting for voice UI state transition")
}

func TestVoiceScreenFlowsAcrossMobileViewports(t *testing.T) {
	for _, vp := range testutil.StandardMobileViewports {
		t.Run(vp.Name, func(t *testing.T) {
			srv, store, scr, perms, _, transport := setupVoiceScreenHarness(t)
			scr.Open("room_general", "Product Launch")
			waitUI(t, func() bool {
				return scr.Controller().Snapshot().Policy != nil
			})

			view := func(c *ui.Context) {
				c.SetTheme(theme.TownLight())
				ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
					scr.ViewBody(c)
				})
			}
			tt := testutil.NewPhoneTester(view, vp)
			tt.Frame()
			if !tt.HasText("Live Voice") || !tt.HasText("Product Launch") {
				t.Fatalf("expected Voice header and room name, texts=%v", tt.Texts())
			}

			// 1. Policy blocked state renders guidance + dictation fallback button.
			srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, _ *testutil.VoiceServerState) {
				pol.LiveEnabled = boolPtr(false)
			})
			_ = scr.Controller().Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive)
			tt.Frame()
			if !tt.HasText("Blocked by Voice Media Policy") || !tt.HasText("Switch to Dictation") {
				t.Fatalf("expected policy blocked card with fallback, texts=%v", tt.Texts())
			}

			// 2. Permission denied recovery card renders Open System Settings + Check Again.
			srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, _ *testutil.VoiceServerState) {
				pol.LiveEnabled = boolPtr(true)
			})
			perms.mu.Lock()
			perms.status = voicecore.PermissionDenied
			perms.mu.Unlock()
			_ = scr.Controller().Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive)
			tt.Frame()
			if !tt.HasText("Microphone Permission Denied") || !tt.HasText("Open System Settings") {
				t.Fatalf("expected mic permission denied recovery card, texts=%v", tt.Texts())
			}
			if err := tt.Click("Open System Settings"); err != nil {
				t.Fatalf("click Open System Settings: %v", err)
			}
			tt.Frame()
			perms.mu.Lock()
			opened := perms.settingsOpen
			perms.status = voicecore.PermissionGranted
			perms.mu.Unlock()
			if opened != 1 {
				t.Fatalf("expected OpenSettings called once, got %d", opened)
			}

			// 3. Connect -> verify live controls, Mute/Unmute, Speaker toggle, subtitles, and Suspend teardown.
			if err := scr.Controller().Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive); err != nil {
				t.Fatalf("Connect: %v", err)
			}
			transport.mu.Lock()
			rm := transport.last
			transport.mu.Unlock()
			rm.cb.OnDataPacket(api.VoiceLiveDataTopic, "voice-runtime", []byte(`{"type":"user_turn","turn_id":"u1","text":"Summarize today's builds"}`))
			rm.cb.OnDataPacket(api.VoiceLiveDataTopic, "voice-runtime", []byte(`{"type":"reply_delta","turn_id":"u1","text":"All mobile checks pass."}`))
			tt.Frame()
			if !tt.HasText("Mute") || !tt.HasText("Speaker On") || !tt.HasText("End Call") {
				t.Fatalf("expected live call controls, texts=%v", tt.Texts())
			}
			if !tt.HasText("Summarize today's builds") || !tt.HasText("All mobile checks pass.") {
				t.Fatalf("expected live transcript & subtitle, texts=%v", tt.Texts())
			}

			if err := tt.Click("Mute"); err != nil {
				t.Fatalf("click Mute: %v", err)
			}
			tt.Frame()
			if !scr.Controller().Snapshot().Muted || !tt.HasText("Unmute") {
				t.Fatalf("expected muted state & Unmute label, texts=%v", tt.Texts())
			}

			// Trigger background/suspend via ViewSheet snapshot propagation.
			store.SetSuspended(true)
			scr.SetSuspended(true)
			tt.Frame()
			if scr.Controller().Snapshot().Phase != voicecore.PhaseIdle || !tt.HasText("background") {
				t.Fatalf("expected suspend clean disconnect banner, texts=%v", tt.Texts())
			}
			store.SetSuspended(false)
			scr.SetSuspended(false)
		})
	}

	// Verify zh-Hans localization parity.
	_, _, scr, _, _, _ := setupVoiceScreenHarness(t)
	i18n.SetPreference(config.LanguageZhHans)
	t.Cleanup(func() { i18n.SetPreference(config.LanguageEN) })
	scr.Open("room_general", "Product Launch")
	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			scr.ViewBody(c)
		})
	}, testutil.StandardMobileViewports[1])
	tt.Frame()
	if !tt.HasText(i18n.T("voice.title")) || !tt.HasText(i18n.T("voice.btn.connect")) {
		t.Fatalf("expected zh-Hans voice labels, texts=%v", tt.Texts())
	}
}

func TestVoiceScreenGoldenTownLightAndDark(t *testing.T) {
	_, _, scr, _, audio, transport := setupVoiceScreenHarness(t)
	if err := scr.Controller().Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	// Seed deterministic acoustic levels and transcript entries for stable snapshots.
	tone := make([]float32, voicecore.FrameSamples)
	for i := range tone {
		tone[i] = 0.28 * float32(math.Sin(2*math.Pi*440*float64(i)/float64(voicecore.SampleRate)))
	}
	audio.mu.Lock()
	capRef := audio.cap
	audio.mu.Unlock()
	capRef.ch <- voicecore.AudioFrame{Samples: tone, SampleRate: voicecore.SampleRate, Channels: voicecore.Channels}
	waitUI(t, func() bool {
		return scr.Controller().Snapshot().FramesPublished >= 1 && scr.Controller().Snapshot().RuntimeReady
	})

	transport.mu.Lock()
	rm := transport.last
	transport.mu.Unlock()
	rm.cb.OnRemoteAudioPCM(tone, voicecore.SampleRate, voicecore.Channels)
	rm.cb.OnDataPacket(api.VoiceLiveDataTopic, "voice-runtime", []byte(`{"type":"user_turn","turn_id":"g1","text":"Can we ship the mobile voice update today?"}`))
	rm.cb.OnDataPacket(api.VoiceLiveDataTopic, "voice-runtime", []byte(`{"type":"reply_delta","turn_id":"g1","text":"LiveKit WebRTC audio and race checks are green."}`))

	// Town Light (390x844)
	ttLight := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			scr.ViewBody(c)
		})
	}, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttLight, "testdata/voice_connected_light_390x844.png")

	// Town Dark (390x844)
	ttDark := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			scr.ViewBody(c)
		})
	}, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttDark, "testdata/voice_connected_dark_390x844.png")
}
