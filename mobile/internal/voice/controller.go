package voice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/realtime"
)

// SessionPhase describes the high-level lifecycle state of the Mobile voice session.
type SessionPhase string

const (
	PhaseIdle                 SessionPhase = "idle"
	PhaseCheckingPolicy       SessionPhase = "checking_policy"
	PhaseRequestingPermission SessionPhase = "requesting_permission"
	PhasePermissionDenied     SessionPhase = "permission_denied"
	PhasePolicyBlocked        SessionPhase = "policy_blocked"
	PhaseConnecting           SessionPhase = "connecting"
	PhaseConnected            SessionPhase = "connected"
	PhaseReconnecting         SessionPhase = "reconnecting"
	PhaseError                SessionPhase = "error"
)

// TranscriptEntry represents one finalized user utterance or live assistant subtitle.
type TranscriptEntry struct {
	ID          string
	Role        string // "user" | "assistant" | "system"
	Text        string
	Interrupted bool
	Timestamp   time.Time
}

// Snapshot is an immutable view of the voice session state safe for UI rendering.
type Snapshot struct {
	Phase                 SessionPhase
	RoomID                string
	RoomName              string
	SessionID             string
	Purpose               string
	Endpoint              string
	Generation            int64
	Policy                *api.VoiceMediaPolicyC2
	PolicyDecision        PolicyDecision
	Permission            PermissionStatus
	Muted                 bool
	SpeakerMuted          bool
	InputLevel            float32
	OutputLevel           float32
	LocalSpeaking         bool
	RemoteSpeaking        bool
	RuntimeReady          bool
	ProviderReady         bool
	PartialTranscript     string
	ReplySubtitle         string
	Entries               []TranscriptEntry
	ErrorCode             string
	ErrorMessage          string
	SuspendedDisconnected bool
	StartedAt             time.Time
	FramesPublished       int64
	RemoteFramesPlayed    int64
}

// Dependencies injects host API access, OS permissions, audio I/O, and LiveKit transport.
type Dependencies struct {
	Client                func() *api.Client
	TenantID              func() string
	Permissions           MicPermissionProvider
	Audio                 AudioDevice
	Transport             RoomTransport
	OnChange              func()
	OnInsertDraft         func(roomID, text string)
	CredentialRefreshLead time.Duration
	ReadinessTimeout      time.Duration
	ReadinessPollInterval time.Duration
}

type activeCall struct {
	gen             uint64
	sessionID       string
	roomID          string
	purpose         string
	generation      int64
	ctx             context.Context
	cancel          context.CancelFunc
	capture         AudioCapture
	playback        AudioPlayback
	room            RoomSession
	wg              sync.WaitGroup
	runtimeIdentity string
	closeOnce       sync.Once
}

// Controller orchestrates Linger Mobile's bidirectional LiveKit WebRTC voice sessions.
// All public methods are safe to call concurrently from UI and background goroutines.
type Controller struct {
	deps Dependencies

	mu             sync.Mutex
	opGen          uint64
	closed         bool
	suspended      bool
	snap           Snapshot
	active         *activeCall
	lastLevelEmit  time.Time
	commitSeq      uint64
	seenTurnIDs    map[string]bool
	lastReplyTurn  string
	lastSpeechText string
}

const (
	defaultCredentialRefreshLead = 90 * time.Second
	defaultReadinessTimeout      = 15 * time.Second
	defaultReadinessPollInterval = 200 * time.Millisecond
	speakingInputThreshold       = 0.08
	speakingOutputThreshold      = 0.06
	levelNotifyThrottle          = 80 * time.Millisecond
	maxTranscriptEntries         = 120
)

// NewController builds a Voice Controller with real system/LiveKit defaults for any nil dependency.
func NewController(deps Dependencies) *Controller {
	if deps.Permissions == nil {
		deps.Permissions = SystemMicPermission{}
	}
	if deps.Audio == nil {
		deps.Audio = DefaultAudioDevice()
	}
	if deps.Transport == nil {
		deps.Transport = NewLiveKitTransport()
	}
	if deps.CredentialRefreshLead <= 0 {
		deps.CredentialRefreshLead = defaultCredentialRefreshLead
	}
	if deps.ReadinessTimeout <= 0 {
		deps.ReadinessTimeout = defaultReadinessTimeout
	}
	if deps.ReadinessPollInterval <= 0 {
		deps.ReadinessPollInterval = defaultReadinessPollInterval
	}
	return &Controller{
		deps: deps,
		snap: Snapshot{
			Phase:      PhaseIdle,
			Purpose:    api.VoicePurposeChatLive,
			Permission: PermissionUnknown,
		},
		seenTurnIDs: map[string]bool{},
	}
}

// Snapshot returns a thread-safe deep copy of the current voice session state.
func (c *Controller) Snapshot() Snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	cp := c.snap
	if c.snap.Policy != nil {
		pol := *c.snap.Policy
		cp.Policy = &pol
	}
	if len(c.snap.Entries) > 0 {
		cp.Entries = append([]TranscriptEntry(nil), c.snap.Entries...)
	}
	return cp
}

func (c *Controller) notify() {
	if c.deps.OnChange != nil {
		c.deps.OnChange()
	}
}

func (c *Controller) client() *api.Client {
	if c.deps.Client == nil {
		return nil
	}
	return c.deps.Client()
}

func (c *Controller) tenantID() string {
	if c.deps.TenantID == nil {
		return ""
	}
	return strings.TrimSpace(c.deps.TenantID())
}

// PrepareRoom updates the target room context, inspects microphone permission without
// prompting, and refreshes TeamHub's Voice Media Policy asynchronously or synchronously.
func (c *Controller) PrepareRoom(ctx context.Context, roomID, roomName string) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	if c.active == nil {
		c.snap.RoomID = roomID
		c.snap.RoomName = roomName
		if c.snap.Phase == PhaseError || c.snap.Phase == PhasePolicyBlocked || c.snap.Phase == PhasePermissionDenied {
			c.snap.Phase = PhaseIdle
			c.snap.ErrorCode = ""
			c.snap.ErrorMessage = ""
		}
	}
	c.mu.Unlock()
	c.notify()

	perm, _ := c.deps.Permissions.Check(ctx)
	cl := c.client()
	tid := c.tenantID()

	var pol *api.VoiceMediaPolicyC2
	if cl != nil && tid != "" {
		if fetched, err := cl.GetVoiceMediaPolicyC2(ctx, tid); err == nil {
			pol = &fetched
		}
	}

	c.mu.Lock()
	if perm != PermissionUnknown {
		c.snap.Permission = perm
	}
	if pol != nil {
		c.snap.Policy = pol
		if c.active == nil {
			purpose, decision := SelectDefaultPurpose(pol)
			c.snap.Purpose = purpose
			c.snap.PolicyDecision = decision
		}
	}
	c.mu.Unlock()
	c.notify()
}

// SelectPurpose chooses between chat_live and chat_dictation while idle.
func (c *Controller) SelectPurpose(purpose string) {
	p := NormalizePurpose(purpose)
	c.mu.Lock()
	if c.active != nil {
		c.mu.Unlock()
		return
	}
	c.snap.Purpose = p
	if c.snap.Policy != nil {
		c.snap.PolicyDecision = EvaluatePolicy(c.snap.Policy, p)
		if c.snap.Phase == PhasePolicyBlocked {
			if c.snap.PolicyDecision.Allowed {
				c.snap.Phase = PhaseIdle
				c.snap.ErrorCode = ""
				c.snap.ErrorMessage = ""
			}
		}
	}
	c.mu.Unlock()
	c.notify()
}

// RequestPermission triggers the OS microphone authorization dialog and updates state.
func (c *Controller) RequestPermission(ctx context.Context) (PermissionStatus, error) {
	c.mu.Lock()
	c.snap.Phase = PhaseRequestingPermission
	c.snap.ErrorCode = ""
	c.snap.ErrorMessage = ""
	c.mu.Unlock()
	c.notify()

	st, err := c.deps.Permissions.Request(ctx)
	c.mu.Lock()
	c.snap.Permission = st
	if err != nil {
		c.snap.Phase = PhasePermissionDenied
		c.snap.ErrorMessage = err.Error()
	} else if st == PermissionGranted {
		c.snap.Phase = PhaseIdle
		c.snap.ErrorCode = ""
		c.snap.ErrorMessage = ""
	} else {
		c.snap.Phase = PhasePermissionDenied
	}
	c.mu.Unlock()
	c.notify()
	return st, err
}

// OpenPermissionSettings opens OS settings where the user can re-enable microphone access.
func (c *Controller) OpenPermissionSettings() error {
	return c.deps.Permissions.OpenSettings()
}

// Connect enforces Voice Media Policy and microphone permission, creates a TeamHub
// VoiceSession, exchanges a LiveKit room credential, opens native audio capture/playback,
// and starts bidirectional WebRTC streaming.
func (c *Controller) Connect(ctx context.Context, roomID, roomName, purpose string) error {
	// Ensure any previous call is torn down cleanly first.
	c.Disconnect(ctx)

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return errors.New("voice: controller closed")
	}
	if c.suspended {
		c.mu.Unlock()
		return errors.New("voice: app is suspended")
	}
	c.opGen++
	myGen := c.opGen
	if strings.TrimSpace(roomID) == "" {
		roomID = c.snap.RoomID
	}
	if strings.TrimSpace(roomName) == "" {
		roomName = c.snap.RoomName
	}
	if strings.TrimSpace(purpose) == "" {
		purpose = c.snap.Purpose
	}
	purpose = NormalizePurpose(purpose)
	c.snap.RoomID = roomID
	c.snap.RoomName = roomName
	c.snap.Purpose = purpose
	c.snap.Phase = PhaseCheckingPolicy
	c.snap.ErrorCode = ""
	c.snap.ErrorMessage = ""
	c.snap.SuspendedDisconnected = false
	c.snap.Muted = false
	c.snap.InputLevel = 0
	c.snap.OutputLevel = 0
	c.snap.LocalSpeaking = false
	c.snap.RemoteSpeaking = false
	c.snap.RuntimeReady = false
	c.snap.ProviderReady = false
	c.snap.PartialTranscript = ""
	c.snap.ReplySubtitle = ""
	c.snap.FramesPublished = 0
	c.snap.RemoteFramesPlayed = 0
	c.seenTurnIDs = map[string]bool{}
	c.mu.Unlock()
	c.notify()

	cl := c.client()
	tid := c.tenantID()
	if cl == nil || tid == "" || strings.TrimSpace(roomID) == "" {
		err := errors.New("voice: active host and room are required")
		c.failSetup(myGen, PhaseError, "NOT_CONNECTED", err.Error())
		return err
	}

	// 1. Fetch & enforce TeamHub Voice Media Policy strictly (never bypass policy).
	pol, err := cl.GetVoiceMediaPolicyC2(ctx, tid)
	if err != nil {
		c.failSetup(myGen, PhaseError, apiErrorCode(err), api.PresentError(err))
		return err
	}
	if !c.isGenCurrent(myGen) {
		return context.Canceled
	}
	decision := EvaluatePolicy(&pol, purpose)
	c.mu.Lock()
	if c.opGen == myGen {
		polCopy := pol
		c.snap.Policy = &polCopy
		c.snap.PolicyDecision = decision
	}
	c.mu.Unlock()
	if !decision.Allowed {
		c.failSetup(myGen, PhasePolicyBlocked, string(decision.Reason), "")
		return fmt.Errorf("%w: %s", ErrPolicyBlocked, decision.Reason)
	}

	// 2. Check / request OS microphone permission.
	perm, permErr := c.deps.Permissions.Check(ctx)
	if !c.isGenCurrent(myGen) {
		return context.Canceled
	}
	if permErr != nil {
		c.mu.Lock()
		if c.opGen == myGen {
			c.snap.Permission = perm
		}
		c.mu.Unlock()
		c.failSetup(myGen, PhasePermissionDenied, "PERMISSION_ERROR", permErr.Error())
		return permErr
	}
	if perm == PermissionNotDetermined || perm == PermissionUnknown {
		c.mu.Lock()
		if c.opGen == myGen {
			c.snap.Phase = PhaseRequestingPermission
		}
		c.mu.Unlock()
		c.notify()

		perm, permErr = c.deps.Permissions.Request(ctx)
		if !c.isGenCurrent(myGen) {
			return context.Canceled
		}
		if permErr != nil {
			c.mu.Lock()
			if c.opGen == myGen {
				c.snap.Permission = perm
			}
			c.mu.Unlock()
			c.failSetup(myGen, PhasePermissionDenied, "PERMISSION_ERROR", permErr.Error())
			return permErr
		}
	}
	c.mu.Lock()
	if c.opGen == myGen {
		c.snap.Permission = perm
	}
	c.mu.Unlock()
	if perm != PermissionGranted {
		c.failSetup(myGen, PhasePermissionDenied, "PERMISSION_DENIED", "")
		return ErrPermissionDenied
	}

	// 3. Provision TeamHub VoiceSession & LiveKit publisher credential.
	c.mu.Lock()
	if c.opGen == myGen {
		c.snap.Phase = PhaseConnecting
	}
	c.mu.Unlock()
	c.notify()

	sess, err := cl.CreateVoiceSession(ctx, roomID, purpose)
	if err != nil {
		code := apiErrorCode(err)
		if code == "LIVE_UNAVAILABLE" {
			// Room has no active Agent for live voice; surface policy/room block cleanly.
			fallback := ""
			if pol.VoiceMediaSupported {
				fallback = api.VoicePurposeChatDictation
			}
			c.mu.Lock()
			if c.opGen == myGen {
				c.snap.PolicyDecision = PolicyDecision{
					Allowed:         false,
					Purpose:         purpose,
					Reason:          PolicyBlockNoRoomAgent,
					FallbackPurpose: fallback,
				}
			}
			c.mu.Unlock()
			c.failSetup(myGen, PhasePolicyBlocked, code, api.PresentError(err))
			return err
		}
		c.failSetup(myGen, PhaseError, code, api.PresentError(err))
		return err
	}

	cleanupSession := func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = cl.CloseVoiceSession(closeCtx, sess.ID)
	}

	if !c.isGenCurrent(myGen) {
		cleanupSession()
		return context.Canceled
	}

	cred, err := cl.CreateVoiceSessionCredential(ctx, sess.ID)
	if err != nil {
		cleanupSession()
		c.failSetup(myGen, PhaseError, apiErrorCode(err), api.PresentError(err))
		return err
	}
	if !c.isGenCurrent(myGen) {
		cleanupSession()
		return context.Canceled
	}
	if err := ValidateLiveKitEndpoint(cred.Endpoint, cl.BaseURL()); err != nil {
		cleanupSession()
		code := "INVALID_LIVEKIT_ENDPOINT"
		if errors.Is(err, ErrLoopbackLiveKitEndpoint) {
			code = "LIVEKIT_LOOPBACK_UNREACHABLE"
		}
		c.failSetup(myGen, PhaseError, code, err.Error())
		return err
	}

	// 4. Open native microphone capture & remote audio playback.
	capture, err := c.deps.Audio.OpenCapture(ctx, SampleRate, Channels, FrameSamples)
	if err != nil {
		cleanupSession()
		if errors.Is(err, ErrPermissionDenied) || errors.Is(err, ErrPermissionRevoked) {
			c.mu.Lock()
			if c.opGen == myGen {
				c.snap.Permission = PermissionDenied
			}
			c.mu.Unlock()
			c.failSetup(myGen, PhasePermissionDenied, "PERMISSION_DENIED", err.Error())
			return err
		}
		c.failSetup(myGen, PhaseError, "AUDIO_CAPTURE_ERROR", err.Error())
		return err
	}

	var playback AudioPlayback
	if purpose == api.VoicePurposeChatLive {
		playback, err = c.deps.Audio.OpenPlayback(ctx, SampleRate, Channels)
		if err != nil {
			_ = capture.Close()
			cleanupSession()
			c.failSetup(myGen, PhaseError, "AUDIO_PLAYBACK_ERROR", err.Error())
			return err
		}
		c.mu.Lock()
		speakerMuted := c.snap.SpeakerMuted
		c.mu.Unlock()
		playback.SetMuted(speakerMuted)
	}

	if !c.isGenCurrent(myGen) {
		_ = capture.Close()
		if playback != nil {
			_ = playback.Close()
		}
		cleanupSession()
		return context.Canceled
	}

	// 5. Connect LiveKit WebRTC room and publish Opus microphone track.
	callCtx, callCancel := context.WithCancel(context.Background())
	call := &activeCall{
		gen:        myGen,
		sessionID:  sess.ID,
		roomID:     roomID,
		purpose:    purpose,
		generation: cred.Generation,
		ctx:        callCtx,
		cancel:     callCancel,
		capture:    capture,
		playback:   playback,
	}

	roomSess, err := c.deps.Transport.Connect(ctx, RoomConnectConfig{
		Endpoint:             cred.Endpoint,
		Token:                cred.Credential,
		Purpose:              purpose,
		Generation:           cred.Generation,
		SubscribeRemoteAudio: purpose == api.VoicePurposeChatLive,
		ReplyTrackName:       api.VoiceLiveReplyTrackName,
	}, RoomCallbacks{
		OnRemoteAudioPCM: func(samples []float32, sampleRate, channels int) {
			c.handleRemoteAudio(call, samples, sampleRate, channels)
		},
		OnDataPacket: func(topic, senderIdentity string, payload []byte) {
			c.handleDataPacket(call, topic, senderIdentity, payload)
		},
		OnParticipantAttributesChanged: func(identity string, isAgent bool, attrs map[string]string) {
			c.handleParticipantAttributes(call, identity, isAgent, attrs)
		},
		OnRuntimeDisconnected: func(identity string) {
			c.handleRuntimeDisconnected(call, identity)
		},
		OnReconnecting: func() {
			c.mu.Lock()
			if c.active == call && c.opGen == call.gen {
				c.snap.Phase = PhaseReconnecting
			}
			c.mu.Unlock()
			c.notify()
		},
		OnReconnected: func() {
			c.mu.Lock()
			if c.active == call && c.opGen == call.gen {
				c.snap.Phase = PhaseConnected
				c.snap.ErrorCode = ""
				c.snap.ErrorMessage = ""
			}
			c.mu.Unlock()
			c.notify()
		},
		OnDisconnected: func(reason string) {
			c.handleUnexpectedDisconnect(call, reason)
		},
	})
	if err != nil {
		callCancel()
		_ = capture.Close()
		if playback != nil {
			_ = playback.Close()
		}
		cleanupSession()
		c.failSetup(myGen, PhaseError, "LIVEKIT_CONNECT_FAILED", err.Error())
		return err
	}
	call.room = roomSess

	// Commit active call atomically if still current and not suspended/closed.
	c.mu.Lock()
	if c.closed || c.suspended || c.opGen != myGen {
		c.mu.Unlock()
		callCancel()
		_ = capture.Close()
		if playback != nil {
			_ = playback.Close()
		}
		_ = roomSess.Disconnect()
		cleanupSession()
		return context.Canceled
	}
	c.active = call
	c.snap.Phase = PhaseConnected
	c.snap.SessionID = sess.ID
	c.snap.Endpoint = cred.Endpoint
	c.snap.Generation = cred.Generation
	c.snap.StartedAt = time.Now()
	c.snap.ErrorCode = ""
	c.snap.ErrorMessage = ""
	c.mu.Unlock()
	c.notify()

	// 6. Start tracked background loops (mic Opus publish, readiness watch, credential refresh, dictation SSE).
	call.wg.Add(1)
	go c.runCapturePublishLoop(call)

	call.wg.Add(1)
	go c.runReadinessWatcher(call, cl)

	if !cred.ExpiresAt.IsZero() {
		call.wg.Add(1)
		go c.runCredentialRefresher(call, cl, cred.ExpiresAt)
	}

	if purpose == api.VoicePurposeChatDictation || purpose == api.VoicePurposeHardwareControl {
		call.wg.Add(1)
		go c.runDictationSSELoop(call, cl)
	}

	return nil
}

// SetMuted mutes or unmutes the local microphone track cleanly.
func (c *Controller) SetMuted(muted bool) error {
	c.mu.Lock()
	call := c.active
	if call == nil {
		c.snap.Muted = muted
		c.mu.Unlock()
		c.notify()
		return nil
	}
	c.snap.Muted = muted
	if muted {
		c.snap.InputLevel = 0
		c.snap.LocalSpeaking = false
	}
	c.mu.Unlock()
	c.notify()
	return call.room.SetMuted(muted)
}

// ToggleMute flips the local microphone mute state.
func (c *Controller) ToggleMute() error {
	c.mu.Lock()
	next := !c.snap.Muted
	c.mu.Unlock()
	return c.SetMuted(next)
}

// SetSpeakerMuted silences remote assistant playback without muting the microphone.
func (c *Controller) SetSpeakerMuted(muted bool) {
	c.mu.Lock()
	call := c.active
	c.snap.SpeakerMuted = muted
	if muted {
		c.snap.OutputLevel = 0
		c.snap.RemoteSpeaking = false
	}
	c.mu.Unlock()
	if call != nil && call.playback != nil {
		call.playback.SetMuted(muted)
	}
	c.notify()
}

// ToggleSpeakerMuted flips the local remote speaker silence state.
func (c *Controller) ToggleSpeakerMuted() {
	c.mu.Lock()
	next := !c.snap.SpeakerMuted
	c.mu.Unlock()
	c.SetSpeakerMuted(next)
}

// CommitDictationTurn asks TeamHub to finalize the active dictation utterance.
func (c *Controller) CommitDictationTurn(ctx context.Context) error {
	c.mu.Lock()
	call := c.active
	if call == nil || call.purpose != api.VoicePurposeChatDictation {
		c.mu.Unlock()
		return nil
	}
	c.commitSeq++
	reqID := fmt.Sprintf("mob_commit_%d_%d", time.Now().UnixMilli(), c.commitSeq)
	sessionID := call.sessionID
	c.mu.Unlock()

	cl := c.client()
	if cl == nil {
		return errors.New("voice: client unavailable")
	}
	_, err := cl.CommitVoiceDictationTurn(ctx, sessionID, reqID)
	return err
}

// Disconnect cleanly stops microphone capture, playback, LiveKit WebRTC, SSE streams,
// waits for all call goroutines to exit, and closes the TeamHub VoiceSession.
func (c *Controller) Disconnect(ctx context.Context) {
	c.teardown(ctx, PhaseIdle, "", "", false)
}

// SetSuspended handles OS background/suspend transitions. Entering background/suspend
// tears down any active voice session synchronously so mic locks and WebRTC peers never leak.
func (c *Controller) SetSuspended(suspended bool) {
	c.mu.Lock()
	prev := c.suspended
	c.suspended = suspended
	hasActive := c.active != nil || c.snap.Phase == PhaseConnecting || c.snap.Phase == PhaseReconnecting || c.snap.Phase == PhaseCheckingPolicy
	c.mu.Unlock()

	if suspended && !prev && hasActive {
		c.teardown(context.Background(), PhaseIdle, "", "", true)
	}
}

// Close permanently tears down the controller on screen/app exit.
func (c *Controller) Close() {
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
	c.teardown(context.Background(), PhaseIdle, "", "", false)
}

func (c *Controller) teardown(ctx context.Context, nextPhase SessionPhase, errCode, errMsg string, suspendedNotice bool) {
	c.mu.Lock()
	c.opGen++
	call := c.active
	c.active = nil
	c.snap.Phase = nextPhase
	c.snap.SessionID = ""
	c.snap.Endpoint = ""
	c.snap.Generation = 0
	c.snap.Muted = false
	c.snap.InputLevel = 0
	c.snap.OutputLevel = 0
	c.snap.LocalSpeaking = false
	c.snap.RemoteSpeaking = false
	c.snap.RuntimeReady = false
	c.snap.ProviderReady = false
	c.snap.PartialTranscript = ""
	c.snap.ReplySubtitle = ""
	c.snap.ErrorCode = errCode
	c.snap.ErrorMessage = errMsg
	c.snap.SuspendedDisconnected = suspendedNotice
	if nextPhase == PhasePermissionDenied {
		c.snap.Permission = PermissionDenied
	}
	c.mu.Unlock()

	if call != nil {
		c.closeCallResources(ctx, call)
	}
	c.notify()
}

func (c *Controller) closeCallResources(ctx context.Context, call *activeCall) {
	call.closeOnce.Do(func() {
		call.cancel()
		if call.capture != nil {
			_ = call.capture.Close()
		}
		if call.playback != nil {
			_ = call.playback.Close()
		}
		if call.room != nil {
			_ = call.room.Disconnect()
		}
		call.wg.Wait()

		if cl := c.client(); cl != nil && call.sessionID != "" {
			if ctx == nil || ctx.Err() != nil {
				ctx = context.Background()
			}
			closeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			_, _ = cl.CloseVoiceSession(closeCtx, call.sessionID)
		}
	})
}

func (c *Controller) isGenCurrent(gen uint64) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.closed && !c.suspended && c.opGen == gen
}

func (c *Controller) failSetup(gen uint64, phase SessionPhase, code, msg string) {
	c.mu.Lock()
	if c.opGen != gen {
		c.mu.Unlock()
		return
	}
	c.snap.Phase = phase
	c.snap.ErrorCode = code
	c.snap.ErrorMessage = msg
	c.mu.Unlock()
	c.notify()
}

func (c *Controller) runCapturePublishLoop(call *activeCall) {
	defer call.wg.Done()

	enc, err := NewOpusEncoder()
	if err != nil {
		go c.teardownIfCurrent(call, PhaseError, "OPUS_ENCODER_ERROR", err.Error())
		return
	}

	var accum []float32
	for {
		if call.ctx.Err() != nil {
			return
		}
		frame, err := call.capture.ReadFrame(call.ctx)
		if err != nil {
			if call.ctx.Err() != nil || errors.Is(err, io.EOF) || errors.Is(err, context.Canceled) {
				return
			}
			if errors.Is(err, ErrPermissionRevoked) || errors.Is(err, ErrPermissionDenied) {
				go c.teardownIfCurrent(call, PhasePermissionDenied, "PERMISSION_REVOKED", err.Error())
				return
			}
			go c.teardownIfCurrent(call, PhaseError, "CAPTURE_ERROR", err.Error())
			return
		}
		if len(frame.Samples) == 0 {
			continue
		}

		samples := frame.Samples
		if frame.SampleRate != SampleRate || frame.Channels != Channels {
			samples = adaptPCM(samples, frame.SampleRate, frame.Channels, SampleRate, Channels)
		}
		accum = append(accum, samples...)

		for len(accum) >= FrameSamples {
			chunk := accum[:FrameSamples]
			accum = accum[FrameSamples:]

			c.mu.Lock()
			muted := c.snap.Muted
			active := c.active == call
			c.mu.Unlock()
			if !active {
				return
			}

			if muted {
				c.updateInputLevel(call, 0, false)
				continue
			}

			level := ComputeRMSLevel(chunk)
			c.updateInputLevel(call, level, level >= speakingInputThreshold)

			pkt, encErr := enc.EncodeFloat32(chunk)
			if encErr != nil || len(pkt) == 0 {
				continue
			}
			if pubErr := call.room.PublishOpusFrame(pkt, FrameDuration); pubErr != nil {
				if call.ctx.Err() != nil {
					return
				}
				continue
			}
			c.mu.Lock()
			if c.active == call {
				c.snap.FramesPublished++
			}
			c.mu.Unlock()
		}
	}
}

func (c *Controller) updateInputLevel(call *activeCall, level float32, speaking bool) {
	now := time.Now()
	c.mu.Lock()
	if c.active != call {
		c.mu.Unlock()
		return
	}
	prevSpeaking := c.snap.LocalSpeaking
	c.snap.InputLevel = level
	c.snap.LocalSpeaking = speaking
	shouldNotify := prevSpeaking != speaking || now.Sub(c.lastLevelEmit) >= levelNotifyThrottle
	if shouldNotify {
		c.lastLevelEmit = now
	}
	c.mu.Unlock()
	if shouldNotify {
		c.notify()
	}
}

func (c *Controller) handleRemoteAudio(call *activeCall, samples []float32, sampleRate, channels int) {
	if call.ctx.Err() != nil || len(samples) == 0 {
		return
	}
	c.mu.Lock()
	if c.active != call {
		c.mu.Unlock()
		return
	}
	speakerMuted := c.snap.SpeakerMuted
	c.snap.RemoteFramesPlayed++
	level := float32(0)
	speaking := false
	if !speakerMuted {
		level = ComputeRMSLevel(samples)
		speaking = level >= speakingOutputThreshold
	}
	prevSpeaking := c.snap.RemoteSpeaking
	c.snap.OutputLevel = level
	c.snap.RemoteSpeaking = speaking
	now := time.Now()
	shouldNotify := prevSpeaking != speaking || now.Sub(c.lastLevelEmit) >= levelNotifyThrottle
	if shouldNotify {
		c.lastLevelEmit = now
	}
	c.mu.Unlock()

	if call.playback != nil {
		_ = call.playback.WriteSamples(samples, sampleRate, channels)
	}
	if shouldNotify {
		c.notify()
	}
}

func (c *Controller) handleDataPacket(call *activeCall, topic, senderIdentity string, payload []byte) {
	if topic != api.VoiceLiveDataTopic || strings.HasPrefix(senderIdentity, publisherIdentityPrefix) {
		return
	}
	var ev api.VoiceLiveRuntimeEvent
	if json.Unmarshal(payload, &ev) != nil || ev.Type == "" {
		return
	}

	var (
		needDisconnect bool
		failCode       string
		toolReply      *api.VoiceLiveClientEvent
		insertRoom     string
		insertText     string
	)

	c.mu.Lock()
	if c.active != call {
		c.mu.Unlock()
		return
	}
	if senderIdentity != "" {
		call.runtimeIdentity = senderIdentity
	}
	c.snap.RuntimeReady = true

	switch ev.Type {
	case "user_partial":
		c.snap.PartialTranscript = ev.Text
	case "user_turn":
		c.snap.PartialTranscript = ""
		if strings.TrimSpace(ev.Text) != "" && (ev.TurnID == "" || !c.seenTurnIDs[ev.TurnID]) {
			if ev.TurnID != "" {
				c.seenTurnIDs[ev.TurnID] = true
			}
			c.appendEntryLocked(TranscriptEntry{
				ID:        ev.TurnID,
				Role:      "user",
				Text:      strings.TrimSpace(ev.Text),
				Timestamp: time.Now(),
			})
		}
	case "speech_started":
		c.snap.ReplySubtitle = ""
	case "reply_delta":
		c.snap.ReplySubtitle += ev.Text
	case "reply_done":
		reply := strings.TrimSpace(c.snap.ReplySubtitle)
		if reply == "" {
			reply = strings.TrimSpace(ev.Text)
		}
		c.snap.ReplySubtitle = ""
		if reply != "" {
			c.appendEntryLocked(TranscriptEntry{
				ID:          ev.TurnID + ":reply",
				Role:        "assistant",
				Text:        reply,
				Interrupted: ev.Interrupted,
				Timestamp:   time.Now(),
			})
		}
	case "reply_interrupted":
		if reply := strings.TrimSpace(c.snap.ReplySubtitle); reply != "" {
			c.appendEntryLocked(TranscriptEntry{
				ID:          ev.TurnID + ":interrupted",
				Role:        "assistant",
				Text:        reply,
				Interrupted: true,
				Timestamp:   time.Now(),
			})
		}
		c.snap.ReplySubtitle = ""
		c.snap.OutputLevel = 0
		c.snap.RemoteSpeaking = false
	case "playout_done":
		c.snap.OutputLevel = 0
		c.snap.RemoteSpeaking = false
	case "session_failure":
		failCode = ev.Code
		if failCode == "" {
			failCode = "LIVE_SESSION_FAILED"
		}
		needDisconnect = true
	case "tool_request":
		if ev.CallID != "" {
			if ev.Tool == "end_voice_mode" {
				toolReply = &api.VoiceLiveClientEvent{
					Type:   "tool_result",
					CallID: ev.CallID,
					Text:   `{"status":"done"}`,
				}
				needDisconnect = true
			} else {
				toolReply = &api.VoiceLiveClientEvent{
					Type:   "tool_result",
					CallID: ev.CallID,
					Text:   `{"status":"no_effect","detail":"Mobile companion does not support desktop page tools."}`,
				}
			}
		}
	}
	c.mu.Unlock()

	if toolReply != nil {
		if raw, err := json.Marshal(toolReply); err == nil {
			_ = call.room.SendData(api.VoiceLiveDataTopic, raw, true)
		}
	}
	if insertRoom != "" && insertText != "" && c.deps.OnInsertDraft != nil {
		c.deps.OnInsertDraft(insertRoom, insertText)
	}
	if needDisconnect {
		if failCode != "" {
			go c.teardownIfCurrent(call, PhaseError, failCode, fmt.Sprintf("Live voice session stopped (%s)", failCode))
		} else {
			go c.teardownIfCurrent(call, PhaseIdle, "", "")
		}
		return
	}
	c.notify()
}

func (c *Controller) handleParticipantAttributes(call *activeCall, identity string, isAgent bool, attrs map[string]string) {
	if !isAgent {
		return
	}
	wantGen := strconv.FormatInt(call.generation, 10)
	ready := attrs[attrVoiceReadyGen] == wantGen
	dictFail := attrs[attrDictationFailure] != "" && attrs[attrDictationFailGen] == wantGen
	failCode := attrs[attrDictationFailCode]

	c.mu.Lock()
	if c.active != call {
		c.mu.Unlock()
		return
	}
	if ready || dictFail {
		call.runtimeIdentity = identity
	}
	if ready {
		c.snap.RuntimeReady = true
		if pv, ok := attrs[attrVoiceProviderReady]; ok {
			c.snap.ProviderReady = pv != "0"
		} else {
			c.snap.ProviderReady = true
		}
	}
	c.mu.Unlock()

	if dictFail {
		if failCode == "" {
			failCode = "TRANSCRIPT_UNCONFIRMED"
		}
		go c.teardownIfCurrent(call, PhaseError, failCode, fmt.Sprintf("Voice runtime failed (%s)", failCode))
		return
	}
	c.notify()
}

func (c *Controller) handleRuntimeDisconnected(call *activeCall, identity string) {
	c.mu.Lock()
	isRuntime := c.active == call && call.runtimeIdentity != "" && call.runtimeIdentity == identity
	c.mu.Unlock()
	if isRuntime {
		go c.teardownIfCurrent(call, PhaseError, "RUNTIME_DISCONNECTED", "Voice runtime disconnected")
	}
}

func (c *Controller) handleUnexpectedDisconnect(call *activeCall, reason string) {
	c.mu.Lock()
	stillActive := c.active == call
	c.mu.Unlock()
	if !stillActive {
		return
	}
	msg := "Voice connection lost"
	if strings.TrimSpace(reason) != "" {
		msg = "Voice connection closed: " + reason
	}
	go c.teardownIfCurrent(call, PhaseError, "CONNECTION_LOST", msg)
}

func (c *Controller) teardownIfCurrent(call *activeCall, nextPhase SessionPhase, code, msg string) {
	c.mu.Lock()
	if c.active != call {
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()
	c.teardown(context.Background(), nextPhase, code, msg, false)
}

func (c *Controller) runReadinessWatcher(call *activeCall, cl *api.Client) {
	defer call.wg.Done()

	deadline := time.Now().Add(c.deps.ReadinessTimeout)
	ticker := time.NewTicker(c.deps.ReadinessPollInterval)
	defer ticker.Stop()

	for {
		if ready, known, provReady := call.room.CheckRuntimeReadiness(call.generation); ready {
			c.mu.Lock()
			if c.active == call {
				c.snap.RuntimeReady = true
				if known {
					c.snap.ProviderReady = provReady
				} else {
					c.snap.ProviderReady = true
				}
			}
			c.mu.Unlock()
			c.notify()
			return
		}

		if sess, err := cl.GetVoiceSession(call.ctx, call.sessionID); err == nil {
			if sess.LastFailureCode != nil && strings.TrimSpace(*sess.LastFailureCode) != "" {
				code := strings.TrimSpace(*sess.LastFailureCode)
				go c.teardownIfCurrent(call, PhaseError, code, fmt.Sprintf("Voice runtime unavailable (%s)", code))
				return
			}
			if sess.InputReadyGeneration >= call.generation && call.generation > 0 {
				c.mu.Lock()
				if c.active == call {
					c.snap.RuntimeReady = true
					c.snap.ProviderReady = true
				}
				c.mu.Unlock()
				c.notify()
				return
			}
		}

		c.mu.Lock()
		alreadyReady := c.active != call || c.snap.RuntimeReady
		c.mu.Unlock()
		if alreadyReady || time.Now().After(deadline) {
			return
		}

		select {
		case <-call.ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (c *Controller) runCredentialRefresher(call *activeCall, cl *api.Client, expiresAt time.Time) {
	defer call.wg.Done()

	for {
		wait := time.Until(expiresAt) - c.deps.CredentialRefreshLead
		if wait < time.Second {
			wait = time.Second
		}
		timer := time.NewTimer(wait)
		select {
		case <-call.ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}

		cred, err := cl.CreateVoiceSessionCredential(call.ctx, call.sessionID)
		if err != nil {
			if call.ctx.Err() != nil {
				return
			}
			// Retry shortly on transient network errors without dropping an active call.
			expiresAt = time.Now().Add(c.deps.CredentialRefreshLead + 15*time.Second)
			continue
		}
		c.mu.Lock()
		if c.active == call {
			call.generation = cred.Generation
			c.snap.Generation = cred.Generation
		}
		c.mu.Unlock()
		if cred.ExpiresAt.IsZero() {
			return
		}
		expiresAt = cred.ExpiresAt
	}
}

func (c *Controller) runDictationSSELoop(call *activeCall, cl *api.Client) {
	defer call.wg.Done()

	stream := realtime.NewVoiceSessionStream(cl, call.sessionID, realtime.VoiceStreamCallbacks{
		OnEvents: func(page api.VoiceEventPage) {
			var draftTexts []string
			c.mu.Lock()
			if c.active != call {
				c.mu.Unlock()
				return
			}
			for _, item := range page.Items {
				if item.Transcript == nil {
					continue
				}
				tr := *item.Transcript
				if tr.ID != "" && c.seenTurnIDs[tr.ID] {
					continue
				}
				if tr.ID != "" {
					c.seenTurnIDs[tr.ID] = true
				}
				txt := strings.TrimSpace(tr.Text)
				if txt == "" {
					continue
				}
				c.snap.RuntimeReady = true
				c.snap.ProviderReady = true
				c.snap.PartialTranscript = ""
				c.appendEntryLocked(TranscriptEntry{
					ID:        tr.ID,
					Role:      "user",
					Text:      txt,
					Timestamp: tr.AcceptedAt,
				})
				if tr.Kind == "dictation_turn" {
					draftTexts = append(draftTexts, txt)
				}
			}
			c.mu.Unlock()
			for _, txt := range draftTexts {
				if c.deps.OnInsertDraft != nil {
					c.deps.OnInsertDraft(call.roomID, txt)
				}
			}
			c.notify()
		},
		OnPartial: func(partial api.VoiceTranscriptEventPage) {
			c.mu.Lock()
			if c.active == call {
				if partial.PartialTranscript != nil {
					c.snap.PartialTranscript = *partial.PartialTranscript
					c.snap.RuntimeReady = true
				} else {
					c.snap.PartialTranscript = ""
				}
			}
			c.mu.Unlock()
			c.notify()
		},
		OnSessionExpired: func(code, msg string) {
			go c.teardownIfCurrent(call, PhaseError, code, msg)
		},
	})

	_ = stream.RunOnce(call.ctx)
}

func (c *Controller) appendEntryLocked(entry TranscriptEntry) {
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now()
	}
	c.snap.Entries = append(c.snap.Entries, entry)
	if len(c.snap.Entries) > maxTranscriptEntries {
		c.snap.Entries = c.snap.Entries[len(c.snap.Entries)-maxTranscriptEntries:]
	}
}

func apiErrorCode(err error) string {
	var apiErr *api.APIError
	if errors.As(err, &apiErr) && apiErr.Code != "" {
		return apiErr.Code
	}
	return "VOICE_ERROR"
}
