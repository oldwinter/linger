package voice_test

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/voice"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

func boolPtr(v bool) *bool { return &v }

func generateSineFrame(freqHz float64, amp float32) []float32 {
	out := make([]float32, voice.FrameSamples)
	for i := range out {
		t := float64(i) / float64(voice.SampleRate)
		out[i] = amp * float32(math.Sin(2*math.Pi*freqHz*t))
	}
	return out
}

func waitUntil(t *testing.T, timeout time.Duration, desc string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", desc)
}

func newTestClient(t *testing.T, srv *testutil.FakeServer) *api.Client {
	t.Helper()
	cl, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          srv.ValidToken,
		TLSFingerprint: srv.Fingerprint,
	})
	if err != nil {
		t.Fatalf("api.NewClient: %v", err)
	}
	return cl
}

// --- Deterministic test doubles for headless -race integration tests ---

type fakePermissionProvider struct {
	mu                 sync.Mutex
	checkStatus        voice.PermissionStatus
	checkErr           error
	requestStatus      voice.PermissionStatus
	requestErr         error
	checkCalls         int
	requestCalls       int
	openSettingsCalls  int
	openSettingsReturn error
}

func (f *fakePermissionProvider) Check(_ context.Context) (voice.PermissionStatus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.checkCalls++
	return f.checkStatus, f.checkErr
}

func (f *fakePermissionProvider) Request(_ context.Context) (voice.PermissionStatus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requestCalls++
	if f.requestErr == nil {
		f.checkStatus = f.requestStatus
	}
	return f.requestStatus, f.requestErr
}

func (f *fakePermissionProvider) OpenSettings() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.openSettingsCalls++
	return f.openSettingsReturn
}

type fakeCapture struct {
	mu       sync.Mutex
	closed   bool
	framesCh chan voice.AudioFrame
	errCh    chan error
	done     chan struct{}
	once     sync.Once
}

func newFakeCapture() *fakeCapture {
	return &fakeCapture{
		framesCh: make(chan voice.AudioFrame, 64),
		errCh:    make(chan error, 4),
		done:     make(chan struct{}),
	}
}

func (fc *fakeCapture) PushTone() {
	select {
	case fc.framesCh <- voice.AudioFrame{
		Samples:    generateSineFrame(440, 0.35),
		SampleRate: voice.SampleRate,
		Channels:   voice.Channels,
	}:
	default:
	}
}

func (fc *fakeCapture) FailWith(err error) {
	select {
	case fc.errCh <- err:
	default:
	}
}

func (fc *fakeCapture) ReadFrame(ctx context.Context) (voice.AudioFrame, error) {
	select {
	case <-ctx.Done():
		return voice.AudioFrame{}, ctx.Err()
	case <-fc.done:
		return voice.AudioFrame{}, context.Canceled
	case err := <-fc.errCh:
		return voice.AudioFrame{}, err
	case frame := <-fc.framesCh:
		return frame, nil
	}
}

func (fc *fakeCapture) Close() error {
	fc.once.Do(func() {
		fc.mu.Lock()
		fc.closed = true
		fc.mu.Unlock()
		close(fc.done)
	})
	return nil
}

func (fc *fakeCapture) IsClosed() bool {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	return fc.closed
}

type fakePlayback struct {
	mu           sync.Mutex
	muted        bool
	closed       bool
	writtenCount int
	audibleCount int
}

func (fp *fakePlayback) WriteSamples(samples []float32, _, _ int) error {
	fp.mu.Lock()
	defer fp.mu.Unlock()
	if fp.closed {
		return errors.New("playback closed")
	}
	fp.writtenCount += len(samples)
	if !fp.muted {
		fp.audibleCount += len(samples)
	}
	return nil
}

func (fp *fakePlayback) SetMuted(muted bool) {
	fp.mu.Lock()
	fp.muted = muted
	fp.mu.Unlock()
}

func (fp *fakePlayback) Close() error {
	fp.mu.Lock()
	fp.closed = true
	fp.mu.Unlock()
	return nil
}

func (fp *fakePlayback) Stats() (written, audible int, muted, closed bool) {
	fp.mu.Lock()
	defer fp.mu.Unlock()
	return fp.writtenCount, fp.audibleCount, fp.muted, fp.closed
}

type fakeAudioDevice struct {
	mu           sync.Mutex
	openCapErr   error
	lastCapture  *fakeCapture
	lastPlayback *fakePlayback
}

func (d *fakeAudioDevice) OpenCapture(_ context.Context, _, _, _ int) (voice.AudioCapture, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.openCapErr != nil {
		return nil, d.openCapErr
	}
	c := newFakeCapture()
	d.lastCapture = c
	return c, nil
}

func (d *fakeAudioDevice) OpenPlayback(_ context.Context, _, _ int) (voice.AudioPlayback, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	p := &fakePlayback{}
	d.lastPlayback = p
	return p, nil
}

type sentDataMsg struct {
	Topic    string
	Payload  []byte
	Reliable bool
}

type fakeRoomSession struct {
	mu              sync.Mutex
	cfg             voice.RoomConnectConfig
	cb              voice.RoomCallbacks
	publishedOpus   [][]byte
	muted           bool
	muteTransitions []bool
	sentData        []sentDataMsg
	disconnected    bool
	runtimeReady    bool
	providerReady   bool
}

func (r *fakeRoomSession) PublishOpusFrame(packet []byte, _ time.Duration) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.disconnected {
		return errors.New("room disconnected")
	}
	cp := make([]byte, len(packet))
	copy(cp, packet)
	r.publishedOpus = append(r.publishedOpus, cp)
	return nil
}

func (r *fakeRoomSession) SetMuted(muted bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.muted = muted
	r.muteTransitions = append(r.muteTransitions, muted)
	return nil
}

func (r *fakeRoomSession) SendData(topic string, payload []byte, reliable bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := make([]byte, len(payload))
	copy(cp, payload)
	r.sentData = append(r.sentData, sentDataMsg{Topic: topic, Payload: cp, Reliable: reliable})
	return nil
}

func (r *fakeRoomSession) CheckRuntimeReadiness(_ int64) (bool, bool, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.runtimeReady, true, r.providerReady
}

func (r *fakeRoomSession) Disconnect() error {
	r.mu.Lock()
	r.disconnected = true
	r.mu.Unlock()
	return nil
}

type fakeRoomTransport struct {
	mu         sync.Mutex
	connectErr error
	sessions   []*fakeRoomSession
}

func (ft *fakeRoomTransport) Connect(_ context.Context, cfg voice.RoomConnectConfig, cb voice.RoomCallbacks) (voice.RoomSession, error) {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	if ft.connectErr != nil {
		return nil, ft.connectErr
	}
	s := &fakeRoomSession{
		cfg:           cfg,
		cb:            cb,
		runtimeReady:  true,
		providerReady: true,
	}
	ft.sessions = append(ft.sessions, s)
	return s, nil
}

func (ft *fakeRoomTransport) LastSession() *fakeRoomSession {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	if len(ft.sessions) == 0 {
		return nil
	}
	return ft.sessions[len(ft.sessions)-1]
}

// --- Tests ---

func TestOpusCodecRoundTripPLCAndPCMConversions(t *testing.T) {
	enc, err := voice.NewOpusEncoder()
	if err != nil {
		t.Fatalf("NewOpusEncoder: %v", err)
	}
	dec, err := voice.NewOpusDecoder()
	if err != nil {
		t.Fatalf("NewOpusDecoder: %v", err)
	}

	// Prime the VoIP encoder with 5 consecutive 20 ms 440 Hz frames.
	tone := generateSineFrame(440, 0.4)
	var decoded []float32
	for range 5 {
		pkt, err := enc.EncodeFloat32(tone)
		if err != nil {
			t.Fatalf("EncodeFloat32: %v", err)
		}
		if len(pkt) == 0 {
			t.Fatal("expected non-empty Opus packet")
		}
		decoded, err = dec.DecodeFloat32(pkt)
		if err != nil {
			t.Fatalf("DecodeFloat32: %v", err)
		}
		if len(decoded) != voice.FrameSamples {
			t.Fatalf("decoded sample count = %d, want %d", len(decoded), voice.FrameSamples)
		}
	}
	if lvl := voice.ComputeRMSLevel(decoded); lvl < 0.3 {
		t.Fatalf("expected strong decoded audio RMS level >= 0.3, got %f", lvl)
	}

	// Verify PLC packet loss concealment produces a valid 20 ms frame.
	plc, err := dec.DecodePLC(voice.FrameSamples)
	if err != nil {
		t.Fatalf("DecodePLC: %v", err)
	}
	if len(plc) != voice.FrameSamples {
		t.Fatalf("PLC frame len = %d, want %d", len(plc), voice.FrameSamples)
	}

	// Verify PCM16 <-> float32 round-trip fidelity.
	raw := voice.Float32ToPCM16(tone)
	back := voice.PCM16ToFloat32(raw)
	if len(back) != len(tone) {
		t.Fatalf("PCM16 round-trip len = %d, want %d", len(back), len(tone))
	}
	for i := range tone {
		if math.Abs(float64(tone[i]-back[i])) > 0.001 {
			t.Fatalf("PCM16 round-trip drift at %d: %f vs %f", i, tone[i], back[i])
		}
	}
	if lvl := voice.ComputeRMSLevel(make([]float32, voice.FrameSamples)); lvl != 0 {
		t.Fatalf("expected silence RMS = 0, got %f", lvl)
	}
}

// TestPionWebRTCOpusBidirectionalLoopback verifies a real DTLS/SRTP WebRTC
// PeerConnection pair exchanging pure-Go Opus RTP frames end-to-end and closing cleanly.
func TestPionWebRTCOpusBidirectionalLoopback(t *testing.T) {
	pcSender, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("NewPeerConnection sender: %v", err)
	}
	defer func() { _ = pcSender.Close() }()

	pcReceiver, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("NewPeerConnection receiver: %v", err)
	}
	defer func() { _ = pcReceiver.Close() }()

	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2},
		"mic-audio",
		"linger-mobile-stream",
	)
	if err != nil {
		t.Fatalf("NewTrackLocalStaticSample: %v", err)
	}
	if _, err := pcSender.AddTrack(track); err != nil {
		t.Fatalf("AddTrack: %v", err)
	}

	receivedEnergy := make(chan float32, 1)
	pcReceiver.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		dec, err := voice.NewOpusDecoder()
		if err != nil {
			return
		}
		for range 12 {
			pkt, _, err := remote.ReadRTP()
			if err != nil {
				return
			}
			samples, err := dec.DecodeFloat32(pkt.Payload)
			if err != nil || len(samples) == 0 {
				continue
			}
			if lvl := voice.ComputeRMSLevel(samples); lvl > 0.25 {
				select {
				case receivedEnergy <- lvl:
				default:
				}
				return
			}
		}
	})

	offer, err := pcSender.CreateOffer(nil)
	if err != nil {
		t.Fatalf("CreateOffer: %v", err)
	}
	senderGather := webrtc.GatheringCompletePromise(pcSender)
	if err := pcSender.SetLocalDescription(offer); err != nil {
		t.Fatalf("sender SetLocalDescription: %v", err)
	}
	<-senderGather

	if err := pcReceiver.SetRemoteDescription(*pcSender.LocalDescription()); err != nil {
		t.Fatalf("receiver SetRemoteDescription: %v", err)
	}
	answer, err := pcReceiver.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("CreateAnswer: %v", err)
	}
	receiverGather := webrtc.GatheringCompletePromise(pcReceiver)
	if err := pcReceiver.SetLocalDescription(answer); err != nil {
		t.Fatalf("receiver SetLocalDescription: %v", err)
	}
	<-receiverGather

	if err := pcSender.SetRemoteDescription(*pcReceiver.LocalDescription()); err != nil {
		t.Fatalf("sender SetRemoteDescription: %v", err)
	}

	enc, err := voice.NewOpusEncoder()
	if err != nil {
		t.Fatalf("NewOpusEncoder: %v", err)
	}
	tone := generateSineFrame(440, 0.45)

	stopSend := make(chan struct{})
	defer close(stopSend)
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopSend:
				return
			case <-ticker.C:
				pkt, err := enc.EncodeFloat32(tone)
				if err != nil {
					continue
				}
				_ = track.WriteSample(media.Sample{Data: pkt, Duration: voice.FrameDuration})
			}
		}
	}()

	select {
	case lvl := <-receivedEnergy:
		if lvl <= 0.25 {
			t.Fatalf("expected strong WebRTC loopback audio energy, got %f", lvl)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("timed out waiting for Opus RTP audio over real Pion WebRTC loopback")
	}
}

func TestValidateLiveKitEndpoint(t *testing.T) {
	if err := voice.ValidateLiveKitEndpoint("ws://127.0.0.1:7880", "https://192.168.1.42:8788"); !errors.Is(err, voice.ErrLoopbackLiveKitEndpoint) {
		t.Fatalf("expected ErrLoopbackLiveKitEndpoint from LAN host, got %v", err)
	}
	if err := voice.ValidateLiveKitEndpoint("ws://127.0.0.1:7880", "https://127.0.0.1:8788"); err != nil {
		t.Fatalf("expected loopback LiveKit allowed when host is also localhost, got %v", err)
	}
	if err := voice.ValidateLiveKitEndpoint("wss://livekit.example.com", "https://192.168.1.42:8788"); err != nil {
		t.Fatalf("expected public wss endpoint valid, got %v", err)
	}
	if err := voice.ValidateLiveKitEndpoint("ftp://livekit.example.com", "https://192.168.1.42:8788"); err == nil {
		t.Fatal("expected unsupported scheme rejected")
	}
}

func TestPolicyEvaluationMatrix(t *testing.T) {
	dec := voice.EvaluatePolicy(nil, api.VoicePurposeChatLive)
	if dec.Allowed || dec.Reason != voice.PolicyBlockUnavailable {
		t.Fatalf("nil policy = %+v, want unavailable", dec)
	}

	polDisabled := &api.VoiceMediaPolicyC2{VoiceAvailable: boolPtr(false)}
	dec = voice.EvaluatePolicy(polDisabled, api.VoicePurposeChatLive)
	if dec.Allowed || dec.Reason != voice.PolicyBlockUnavailable {
		t.Fatalf("disabled voice = %+v", dec)
	}

	polLiveDisabled := &api.VoiceMediaPolicyC2{
		VoiceAvailable:      boolPtr(true),
		VoiceMediaSupported: true,
		LiveSupported:       boolPtr(true),
		LiveEnabled:         boolPtr(false),
	}
	dec = voice.EvaluatePolicy(polLiveDisabled, api.VoicePurposeChatLive)
	if dec.Allowed || dec.Reason != voice.PolicyBlockLiveDisabled || dec.FallbackPurpose != api.VoicePurposeChatDictation {
		t.Fatalf("live disabled = %+v", dec)
	}
	purpose, defaultDec := voice.SelectDefaultPurpose(polLiveDisabled)
	if purpose != api.VoicePurposeChatDictation || !defaultDec.Allowed {
		t.Fatalf("SelectDefaultPurpose = (%s, %+v), want chat_dictation allowed", purpose, defaultDec)
	}

	polNoXai := &api.VoiceMediaPolicyC2{
		VoiceAvailable:      boolPtr(true),
		VoiceMediaSupported: false,
		LiveSupported:       boolPtr(false),
		LiveEnabled:         boolPtr(true),
	}
	dec = voice.EvaluatePolicy(polNoXai, api.VoicePurposeChatLive)
	if dec.Allowed || dec.Reason != voice.PolicyBlockXAIKeyMissing {
		t.Fatalf("missing xai = %+v", dec)
	}
	dec = voice.EvaluatePolicy(polNoXai, api.VoicePurposeChatDictation)
	if dec.Allowed || dec.Reason != voice.PolicyBlockSonioxKeyMissing {
		t.Fatalf("missing soniox = %+v", dec)
	}

	polBoth := &api.VoiceMediaPolicyC2{
		VoiceAvailable:      boolPtr(true),
		VoiceMediaSupported: true,
		LiveSupported:       boolPtr(true),
		LiveEnabled:         boolPtr(true),
	}
	purpose, defaultDec = voice.SelectDefaultPurpose(polBoth)
	if purpose != api.VoicePurposeChatLive || !defaultDec.Allowed {
		t.Fatalf("both enabled = (%s, %+v), want chat_live allowed", purpose, defaultDec)
	}
}

func TestControllerPolicyBlockedAndNoRoomAgent(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	// Disable Live voice in policy while keeping dictation allowed.
	srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, _ *testutil.VoiceServerState) {
		pol.VoiceAvailable = boolPtr(true)
		pol.VoiceMediaSupported = true
		pol.LiveSupported = boolPtr(true)
		pol.LiveEnabled = boolPtr(false)
	})

	cl := newTestClient(t, srv)
	perms := &fakePermissionProvider{checkStatus: voice.PermissionGranted}
	audio := &fakeAudioDevice{}
	transport := &fakeRoomTransport{}

	ctl := voice.NewController(voice.Dependencies{
		Client:      func() *api.Client { return cl },
		TenantID:    func() string { return srv.TenantID },
		Permissions: perms,
		Audio:       audio,
		Transport:   transport,
	})
	defer ctl.Close()

	err = ctl.Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive)
	if !errors.Is(err, voice.ErrPolicyBlocked) {
		t.Fatalf("expected ErrPolicyBlocked, got %v", err)
	}
	snap := ctl.Snapshot()
	if snap.Phase != voice.PhasePolicyBlocked || snap.PolicyDecision.Reason != voice.PolicyBlockLiveDisabled {
		t.Fatalf("unexpected blocked snapshot: %+v", snap)
	}
	if srv.IssuedVoiceCredentialsCount() != 0 || transport.LastSession() != nil {
		t.Fatal("policy-blocked join must not issue LiveKit credentials or open WebRTC")
	}

	// Now allow Live in policy, but simulate 409 LIVE_UNAVAILABLE (room has no active Agent).
	srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, st *testutil.VoiceServerState) {
		pol.LiveEnabled = boolPtr(true)
		st.FailCreateCode = "LIVE_UNAVAILABLE"
		st.FailCreateStatus = 409
		st.FailCreateMessage = "room has no active agent"
	})
	err = ctl.Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive)
	if err == nil {
		t.Fatal("expected LIVE_UNAVAILABLE error")
	}
	snap = ctl.Snapshot()
	if snap.Phase != voice.PhasePolicyBlocked || snap.PolicyDecision.Reason != voice.PolicyBlockNoRoomAgent || snap.PolicyDecision.FallbackPurpose != api.VoicePurposeChatDictation {
		t.Fatalf("expected no_room_agent block with dictation fallback, got %+v", snap)
	}
}

func TestControllerPermissionFlowsAndRevocation(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, _ *testutil.VoiceServerState) {
		pol.VoiceAvailable = boolPtr(true)
		pol.VoiceMediaSupported = true
		pol.LiveSupported = boolPtr(true)
		pol.LiveEnabled = boolPtr(true)
	})

	cl := newTestClient(t, srv)
	perms := &fakePermissionProvider{
		checkStatus:   voice.PermissionNotDetermined,
		requestStatus: voice.PermissionDenied,
	}
	audio := &fakeAudioDevice{}
	transport := &fakeRoomTransport{}

	ctl := voice.NewController(voice.Dependencies{
		Client:      func() *api.Client { return cl },
		TenantID:    func() string { return srv.TenantID },
		Permissions: perms,
		Audio:       audio,
		Transport:   transport,
	})
	defer ctl.Close()

	// 1. User denies OS mic prompt -> blocked cleanly without opening LiveKit session.
	err = ctl.Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive)
	if !errors.Is(err, voice.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
	if snap := ctl.Snapshot(); snap.Phase != voice.PhasePermissionDenied || snap.Permission != voice.PermissionDenied {
		t.Fatalf("expected PhasePermissionDenied, got %+v", snap)
	}
	if err := ctl.OpenPermissionSettings(); err != nil || perms.openSettingsCalls != 1 {
		t.Fatalf("OpenPermissionSettings failed: err=%v calls=%d", err, perms.openSettingsCalls)
	}
	if srv.IssuedVoiceCredentialsCount() != 0 {
		t.Fatal("denied permission must not provision LiveKit credentials")
	}

	// 2. User enables permission -> Connect succeeds; then OS revokes mic mid-call -> clean teardown.
	perms.mu.Lock()
	perms.checkStatus = voice.PermissionNotDetermined
	perms.requestStatus = voice.PermissionGranted
	perms.mu.Unlock()

	if err := ctl.Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive); err != nil {
		t.Fatalf("Connect after grant: %v", err)
	}
	sess := transport.LastSession()
	if sess == nil || ctl.Snapshot().Phase != voice.PhaseConnected {
		t.Fatalf("expected connected phase, got %+v", ctl.Snapshot())
	}

	// Simulate mid-call OS permission revocation / audio session interruption.
	audio.lastCapture.FailWith(voice.ErrPermissionRevoked)
	waitUntil(t, 3*time.Second, "permission revoked teardown", func() bool {
		return ctl.Snapshot().Phase == voice.PhasePermissionDenied
	})
	if !audio.lastCapture.IsClosed() {
		t.Fatal("expected audio capture closed after revocation")
	}
	_, _, _, pbClosed := audio.lastPlayback.Stats()
	if !pbClosed {
		t.Fatal("expected audio playback closed after revocation")
	}
	if len(srv.ClosedVoiceSessionIDs()) != 1 {
		t.Fatalf("expected TeamHub session closed on revocation, got %v", srv.ClosedVoiceSessionIDs())
	}
}

func TestControllerLiveBidirectionalAudioMuteDataChannelAndTeardown(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, _ *testutil.VoiceServerState) {
		pol.VoiceAvailable = boolPtr(true)
		pol.VoiceMediaSupported = true
		pol.LiveSupported = boolPtr(true)
		pol.LiveEnabled = boolPtr(true)
	})

	cl := newTestClient(t, srv)
	perms := &fakePermissionProvider{checkStatus: voice.PermissionGranted}
	audio := &fakeAudioDevice{}
	transport := &fakeRoomTransport{}

	ctl := voice.NewController(voice.Dependencies{
		Client:                func() *api.Client { return cl },
		TenantID:              func() string { return srv.TenantID },
		Permissions:           perms,
		Audio:                 audio,
		Transport:             transport,
		ReadinessPollInterval: 20 * time.Millisecond,
	})
	defer ctl.Close()

	if err := ctl.Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	room := transport.LastSession()
	if room == nil || room.cfg.Endpoint != "wss://livekit.test.local" || !room.cfg.SubscribeRemoteAudio {
		t.Fatalf("unexpected room config: %+v", room)
	}

	// 1. Mic capture encodes & publishes Opus packets while unmuted.
	for range 4 {
		audio.lastCapture.PushTone()
	}
	waitUntil(t, 2*time.Second, "published opus frames", func() bool {
		return ctl.Snapshot().FramesPublished >= 4
	})

	// 2. Muting suppresses outbound Opus publishing & signals LiveKit track mute.
	if err := ctl.SetMuted(true); err != nil {
		t.Fatalf("SetMuted(true): %v", err)
	}
	beforeMuted := ctl.Snapshot().FramesPublished
	for range 3 {
		audio.lastCapture.PushTone()
	}
	time.Sleep(120 * time.Millisecond)
	if got := ctl.Snapshot().FramesPublished; got != beforeMuted {
		t.Fatalf("expected zero published frames while muted (before=%d after=%d)", beforeMuted, got)
	}
	if err := ctl.ToggleMute(); err != nil {
		t.Fatalf("ToggleMute(false): %v", err)
	}
	audio.lastCapture.PushTone()
	waitUntil(t, 2*time.Second, "published frame after unmute", func() bool {
		return ctl.Snapshot().FramesPublished > beforeMuted
	})

	room.mu.Lock()
	muteSeq := append([]bool(nil), room.muteTransitions...)
	room.mu.Unlock()
	if len(muteSeq) != 2 || !muteSeq[0] || muteSeq[1] {
		t.Fatalf("expected mute transitions [true, false], got %v", muteSeq)
	}

	// 3. Remote audio playback & speaker mute isolation.
	remoteTone := generateSineFrame(660, 0.35)
	room.cb.OnRemoteAudioPCM(remoteTone, voice.SampleRate, voice.Channels)
	written1, audible1, _, _ := audio.lastPlayback.Stats()
	if written1 != voice.FrameSamples || audible1 != voice.FrameSamples {
		t.Fatalf("expected audible remote playback, got written=%d audible=%d", written1, audible1)
	}
	if !ctl.Snapshot().RemoteSpeaking {
		t.Fatal("expected RemoteSpeaking=true after loud remote PCM frame")
	}

	ctl.SetSpeakerMuted(true)
	room.cb.OnRemoteAudioPCM(remoteTone, voice.SampleRate, voice.Channels)
	_, audible2, spkMuted, _ := audio.lastPlayback.Stats()
	if !spkMuted || audible2 != audible1 {
		t.Fatalf("expected speaker mute to silence remote audio (audible1=%d audible2=%d)", audible1, audible2)
	}

	// 4. LiveKit data channel events: partial -> user turn -> reply delta/done -> desktop page tool -> end_voice_mode.
	sendRuntimeEvent := func(ev api.VoiceLiveRuntimeEvent) {
		raw, _ := json.Marshal(ev)
		room.cb.OnDataPacket(api.VoiceLiveDataTopic, "voice-runtime-agent", raw)
	}
	sendRuntimeEvent(api.VoiceLiveRuntimeEvent{Type: "user_partial", Text: "Check release"})
	if got := ctl.Snapshot().PartialTranscript; got != "Check release" {
		t.Fatalf("PartialTranscript = %q", got)
	}
	sendRuntimeEvent(api.VoiceLiveRuntimeEvent{Type: "user_turn", TurnID: "t1", Text: "Check release status"})
	sendRuntimeEvent(api.VoiceLiveRuntimeEvent{Type: "reply_delta", TurnID: "t1", Text: "All mobile checks "})
	sendRuntimeEvent(api.VoiceLiveRuntimeEvent{Type: "reply_delta", TurnID: "t1", Text: "are green."})
	sendRuntimeEvent(api.VoiceLiveRuntimeEvent{Type: "reply_done", TurnID: "t1"})

	snap := ctl.Snapshot()
	if len(snap.Entries) != 2 || snap.Entries[0].Role != "user" || snap.Entries[1].Role != "assistant" || snap.Entries[1].Text != "All mobile checks are green." {
		t.Fatalf("unexpected transcript entries: %+v", snap.Entries)
	}

	// Unsupported desktop page tool returns structured no_effect reply cleanly.
	sendRuntimeEvent(api.VoiceLiveRuntimeEvent{Type: "tool_request", CallID: "call_page_1", Tool: "open_document"})
	// end_voice_mode acknowledges and triggers clean call teardown.
	sendRuntimeEvent(api.VoiceLiveRuntimeEvent{Type: "tool_request", CallID: "call_end_1", Tool: "end_voice_mode"})

	waitUntil(t, 3*time.Second, "end_voice_mode clean disconnect", func() bool {
		return ctl.Snapshot().Phase == voice.PhaseIdle
	})
	room.mu.Lock()
	sentCount := len(room.sentData)
	disconnected := room.disconnected
	room.mu.Unlock()
	if sentCount != 2 || !disconnected {
		t.Fatalf("expected 2 tool replies & room disconnect, sent=%d disconnected=%v", sentCount, disconnected)
	}
	if len(srv.ClosedVoiceSessionIDs()) != 1 {
		t.Fatalf("expected TeamHub DELETE /v0/voice-sessions/:id, got %v", srv.ClosedVoiceSessionIDs())
	}
}

func TestControllerDictationSSECommitAndCredentialRefresh(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, st *testutil.VoiceServerState) {
		pol.VoiceAvailable = boolPtr(true)
		pol.VoiceMediaSupported = true
		pol.LiveSupported = boolPtr(false)
		pol.LiveEnabled = boolPtr(false)
		// Short TTL so the refresher triggers once during the test.
		st.CredentialTTL = 1400 * time.Millisecond
	})

	cl := newTestClient(t, srv)
	perms := &fakePermissionProvider{checkStatus: voice.PermissionGranted}
	audio := &fakeAudioDevice{}
	transport := &fakeRoomTransport{}

	var draftMu sync.Mutex
	var insertedDrafts []string
	ctl := voice.NewController(voice.Dependencies{
		Client:                func() *api.Client { return cl },
		TenantID:              func() string { return srv.TenantID },
		Permissions:           perms,
		Audio:                 audio,
		Transport:             transport,
		CredentialRefreshLead: 200 * time.Millisecond,
		ReadinessPollInterval: 20 * time.Millisecond,
		OnInsertDraft: func(roomID, text string) {
			draftMu.Lock()
			insertedDrafts = append(insertedDrafts, roomID+":"+text)
			draftMu.Unlock()
		},
	})
	defer ctl.Close()

	if err := ctl.Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatDictation); err != nil {
		t.Fatalf("Connect dictation: %v", err)
	}

	// Push partial + finalized dictation_turn over SSE.
	time.Sleep(120 * time.Millisecond)
	srv.PushVoiceSSE(testutil.SSEFrame{
		Event: "voice.partial",
		Data:  `{"voice_session_id":"vs_live_1","partial_transcript":"Ship mobile voice"}`,
	})
	waitUntil(t, 2*time.Second, "partial dictation SSE", func() bool {
		return ctl.Snapshot().PartialTranscript == "Ship mobile voice"
	})

	if err := ctl.CommitDictationTurn(context.Background()); err != nil {
		t.Fatalf("CommitDictationTurn: %v", err)
	}
	srv.PushVoiceSSE(testutil.SSEFrame{
		Event: "voice.events",
		Data:  `{"voice_session_id":"vs_live_1","items":[{"cursor":"1","type":"transcript","transcript":{"id":"tr_1","kind":"dictation_turn","text":"Ship mobile voice cleanly","accepted_at":"2026-11-27T12:00:00Z"}}],"next_cursor":"1"}`,
	})
	waitUntil(t, 2*time.Second, "dictation draft insertion", func() bool {
		draftMu.Lock()
		defer draftMu.Unlock()
		return len(insertedDrafts) == 1
	})
	draftMu.Lock()
	gotDraft := insertedDrafts[0]
	draftMu.Unlock()
	if gotDraft != "room_general:Ship mobile voice cleanly" {
		t.Fatalf("inserted draft = %q", gotDraft)
	}

	// Verify credential refresh automatically re-issued credential generation 2.
	waitUntil(t, 4*time.Second, "credential refresh", func() bool {
		return srv.IssuedVoiceCredentialsCount() >= 2 && ctl.Snapshot().Generation >= 2
	})
}

func TestControllerSuspendAndDisconnectZeroGoroutineLeak(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	srv.ConfigureVoiceMedia(func(pol *api.VoiceMediaPolicy, _ *testutil.VoiceServerState) {
		pol.VoiceAvailable = boolPtr(true)
		pol.VoiceMediaSupported = true
		pol.LiveSupported = boolPtr(true)
		pol.LiveEnabled = boolPtr(true)
	})

	cl := newTestClient(t, srv)
	perms := &fakePermissionProvider{checkStatus: voice.PermissionGranted}
	audio := &fakeAudioDevice{}
	transport := &fakeRoomTransport{}

	ctl := voice.NewController(voice.Dependencies{
		Client:                func() *api.Client { return cl },
		TenantID:              func() string { return srv.TenantID },
		Permissions:           perms,
		Audio:                 audio,
		Transport:             transport,
		ReadinessPollInterval: 20 * time.Millisecond,
	})
	defer ctl.Close()

	// Warm up HTTP client pool once before measuring baseline goroutines.
	ctl.PrepareRoom(context.Background(), "room_general", "Product Launch")
	time.Sleep(100 * time.Millisecond)
	runtime.GC()
	baseline := runtime.NumGoroutine()

	// Cycle 1: Live session -> background/suspend teardown.
	if err := ctl.Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive); err != nil {
		t.Fatalf("Connect #1: %v", err)
	}
	audio.lastCapture.PushTone()
	waitUntil(t, 2*time.Second, "frame published before suspend", func() bool {
		return ctl.Snapshot().FramesPublished >= 1
	})
	cap1 := audio.lastCapture
	pb1 := audio.lastPlayback
	room1 := transport.LastSession()

	ctl.SetSuspended(true)
	snap := ctl.Snapshot()
	if snap.Phase != voice.PhaseIdle || !snap.SuspendedDisconnected {
		t.Fatalf("expected clean suspend disconnect, got %+v", snap)
	}
	if !cap1.IsClosed() {
		t.Fatal("capture not closed on suspend")
	}
	if _, _, _, closed := pb1.Stats(); !closed {
		t.Fatal("playback not closed on suspend")
	}
	room1.mu.Lock()
	r1Disc := room1.disconnected
	room1.mu.Unlock()
	if !r1Disc {
		t.Fatal("LiveKit room not disconnected on suspend")
	}

	// Calling Connect while still suspended is rejected cleanly.
	if err := ctl.Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive); err == nil {
		t.Fatal("expected Connect rejected while app is suspended")
	}

	// Cycle 2: Resume -> connect -> explicit Disconnect -> Close.
	ctl.SetSuspended(false)
	if err := ctl.Connect(context.Background(), "room_general", "Product Launch", api.VoicePurposeChatLive); err != nil {
		t.Fatalf("Connect #2 after resume: %v", err)
	}
	ctl.Disconnect(context.Background())
	ctl.Close()

	if closed := srv.ClosedVoiceSessionIDs(); len(closed) != 2 {
		t.Fatalf("expected 2 closed TeamHub voice sessions, got %v", closed)
	}

	// Verify zero leaked goroutines (allowing modest tolerance of +3 for Go stdlib HTTP keep-alive transport).
	waitUntil(t, 3*time.Second, "goroutine count back to baseline", func() bool {
		runtime.GC()
		return runtime.NumGoroutine() <= baseline+3
	})
}
