package voice

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

const (
	publisherIdentityPrefix = "publisher-"
	attrVoiceReadyGen       = "linger.voice_ready_generation"
	attrVoiceProviderReady  = "linger.voice_provider_ready"
	attrDictationFailure    = "linger.voice_dictation_failure"
	attrDictationFailCode   = "linger.voice_dictation_failure_code"
	attrDictationFailGen    = "linger.voice_dictation_failure_generation"
	maxConsecutivePLCFrames = 5
)

// ErrLoopbackLiveKitEndpoint indicates TeamHub advertised a loopback LiveKit URL
// that a remote mobile device cannot reach over LAN or Tailscale.
var ErrLoopbackLiveKitEndpoint = errors.New("voice: LiveKit endpoint points to loopback from a remote host")

// RoomConnectConfig configures one LiveKit WebRTC room join.
type RoomConnectConfig struct {
	Endpoint             string
	Token                string
	Purpose              string
	Generation           int64
	SubscribeRemoteAudio bool
	ReplyTrackName       string
}

// RoomCallbacks delivers real-time WebRTC media, data-channel, and connection events.
type RoomCallbacks struct {
	OnRemoteAudioPCM               func(samples []float32, sampleRate, channels int)
	OnDataPacket                   func(topic, senderIdentity string, payload []byte)
	OnParticipantAttributesChanged func(identity string, isAgent bool, attrs map[string]string)
	OnRuntimeDisconnected          func(identity string)
	OnReconnecting                 func()
	OnReconnected                  func()
	OnDisconnected                 func(reason string)
}

// RoomSession represents one active WebRTC participant connection to a LiveKit room.
type RoomSession interface {
	PublishOpusFrame(packet []byte, duration time.Duration) error
	SetMuted(muted bool) error
	SendData(topic string, payload []byte, reliable bool) error
	CheckRuntimeReadiness(generation int64) (ready bool, providerKnown bool, providerReady bool)
	Disconnect() error
}

// RoomTransport opens LiveKit WebRTC room sessions.
type RoomTransport interface {
	Connect(ctx context.Context, cfg RoomConnectConfig, cb RoomCallbacks) (RoomSession, error)
}

// ValidateLiveKitEndpoint checks that endpoint is a valid ws:// or wss:// URI
// and detects unreachable loopback endpoints when talking to a remote TeamHub host.
func ValidateLiveKitEndpoint(endpoint, apiBaseURL string) error {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("voice: invalid LiveKit endpoint %q", endpoint)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "ws" && scheme != "wss" {
		return fmt.Errorf("voice: unsupported LiveKit scheme %q", parsed.Scheme)
	}
	if isLoopbackHost(parsed.Hostname()) && strings.TrimSpace(apiBaseURL) != "" {
		if base, bErr := url.Parse(strings.TrimSpace(apiBaseURL)); bErr == nil && base.Hostname() != "" && !isLoopbackHost(base.Hostname()) {
			return fmt.Errorf("%w (%s via %s)", ErrLoopbackLiveKitEndpoint, parsed.Host, base.Hostname())
		}
	}
	return nil
}

func isLoopbackHost(host string) bool {
	h := strings.TrimSpace(strings.ToLower(host))
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// LiveKitTransport connects to real LiveKit rooms over WebRTC using livekit/server-sdk-go
// and pion/webrtc/v4 with pure-Go Opus decoding and zero CGO dependencies.
type LiveKitTransport struct{}

// NewLiveKitTransport returns the production LiveKit WebRTC transport.
func NewLiveKitTransport() RoomTransport {
	return LiveKitTransport{}
}

// Connect joins the LiveKit room, publishes an Opus microphone track, and subscribes
// selectively to the live assistant reply audio track when SubscribeRemoteAudio is true.
func (LiveKitTransport) Connect(ctx context.Context, cfg RoomConnectConfig, cb RoomCallbacks) (RoomSession, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := ValidateLiveKitEndpoint(cfg.Endpoint, ""); err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.Token) == "" {
		return nil, errors.New("voice: missing LiveKit participant credential")
	}
	replyTrackName := strings.TrimSpace(cfg.ReplyTrackName)
	if replyTrackName == "" {
		replyTrackName = api.VoiceLiveReplyTrackName
	}

	sessCtx, sessCancel := context.WithCancel(context.Background())
	sess := &liveKitRoomSession{
		cfg:            cfg,
		replyTrackName: replyTrackName,
		cb:             cb,
		ctx:            sessCtx,
		cancel:         sessCancel,
		trackCancels:   map[string]context.CancelFunc{},
	}

	roomCB := &lksdk.RoomCallback{
		OnReconnecting: func() {
			if cb.OnReconnecting != nil {
				cb.OnReconnecting()
			}
		},
		OnReconnected: func() {
			if cb.OnReconnected != nil {
				cb.OnReconnected()
			}
		},
		OnDisconnectedWithReason: func(reason lksdk.DisconnectionReason) {
			if cb.OnDisconnected != nil {
				cb.OnDisconnected(string(reason))
			}
		},
		OnParticipantDisconnected: func(rp *lksdk.RemoteParticipant) {
			if rp != nil && !strings.HasPrefix(rp.Identity(), publisherIdentityPrefix) && cb.OnRuntimeDisconnected != nil {
				cb.OnRuntimeDisconnected(rp.Identity())
			}
		},
		ParticipantCallback: lksdk.ParticipantCallback{
			OnTrackPublished: func(pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
				sess.maybeSubscribeRemoteAudio(pub, rp)
			},
			OnTrackSubscribed: func(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
				sess.handleTrackSubscribed(track, pub, rp)
			},
			OnTrackUnsubscribed: func(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, _ *lksdk.RemoteParticipant) {
				sid := ""
				if pub != nil {
					sid = pub.SID()
				}
				if sid == "" && track != nil {
					sid = track.ID()
				}
				sess.stopTrackReader(sid)
			},
			OnDataPacket: func(data lksdk.DataPacket, params lksdk.DataReceiveParams) {
				if cb.OnDataPacket == nil {
					return
				}
				udp, ok := data.(*lksdk.UserDataPacket)
				if !ok || udp == nil {
					return
				}
				topic := udp.Topic
				if topic == "" {
					topic = params.Topic
				}
				sender := params.SenderIdentity
				if sender == "" && params.Sender != nil {
					sender = params.Sender.Identity()
				}
				payload := append([]byte(nil), udp.Payload...)
				cb.OnDataPacket(topic, sender, payload)
			},
			OnAttributesChanged: func(_ map[string]string, p lksdk.Participant) {
				if p == nil || cb.OnParticipantAttributesChanged == nil {
					return
				}
				attrs := p.Attributes()
				cloned := make(map[string]string, len(attrs))
				for k, v := range attrs {
					cloned[k] = v
				}
				cb.OnParticipantAttributesChanged(p.Identity(), p.Kind() == lksdk.ParticipantAgent, cloned)
			},
		},
	}

	type connectResult struct {
		room *lksdk.Room
		err  error
	}
	resCh := make(chan connectResult, 1)
	go func() {
		room, err := lksdk.ConnectToRoomWithToken(cfg.Endpoint, cfg.Token, roomCB, lksdk.WithAutoSubscribe(false))
		resCh <- connectResult{room: room, err: err}
	}()

	var room *lksdk.Room
	select {
	case <-ctx.Done():
		sessCancel()
		go func() {
			if r := <-resCh; r.room != nil {
				r.room.Disconnect()
			}
		}()
		return nil, ctx.Err()
	case res := <-resCh:
		if res.err != nil {
			sessCancel()
			return nil, fmt.Errorf("voice: connect LiveKit room: %w", res.err)
		}
		room = res.room
	}

	sess.mu.Lock()
	sess.room = room
	sess.mu.Unlock()

	// RFC 7587 SDP requires opus/48000/2 even when carrying mono Opus frames.
	localTrack, err := lksdk.NewLocalSampleTrack(webrtc.RTPCodecCapability{
		MimeType:    webrtc.MimeTypeOpus,
		ClockRate:   SampleRate,
		Channels:    2,
		SDPFmtpLine: "minptime=10;useinbandfec=1",
	})
	if err != nil {
		_ = sess.Disconnect()
		return nil, fmt.Errorf("voice: create local opus track: %w", err)
	}

	pub, err := room.LocalParticipant.PublishTrack(localTrack, &lksdk.TrackPublicationOptions{
		Name:       "microphone",
		Source:     livekit.TrackSource_MICROPHONE,
		DisableDTX: true,
		Stereo:     false,
	})
	if err != nil {
		_ = sess.Disconnect()
		return nil, fmt.Errorf("voice: publish microphone track: %w", err)
	}

	sess.mu.Lock()
	sess.localTrack = localTrack
	sess.localPub = pub
	sess.mu.Unlock()

	// Subscribe to reply tracks that were already published before we finished joining.
	if cfg.SubscribeRemoteAudio {
		for _, rp := range room.GetRemoteParticipants() {
			for _, tp := range rp.TrackPublications() {
				if rtp, ok := tp.(*lksdk.RemoteTrackPublication); ok {
					sess.maybeSubscribeRemoteAudio(rtp, rp)
				}
			}
		}
	}

	return sess, nil
}

type liveKitRoomSession struct {
	cfg            RoomConnectConfig
	replyTrackName string
	cb             RoomCallbacks

	ctx    context.Context
	cancel context.CancelFunc

	mu           sync.Mutex
	room         *lksdk.Room
	localTrack   *lksdk.LocalTrack
	localPub     *lksdk.LocalTrackPublication
	trackCancels map[string]context.CancelFunc
	closed       bool

	wg        sync.WaitGroup
	closeOnce sync.Once
}

func (s *liveKitRoomSession) maybeSubscribeRemoteAudio(pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
	if !s.cfg.SubscribeRemoteAudio || pub == nil || rp == nil {
		return
	}
	if strings.HasPrefix(rp.Identity(), publisherIdentityPrefix) {
		return
	}
	if pub.Kind() != lksdk.TrackKindAudio {
		return
	}
	if s.replyTrackName != "" && pub.Name() != s.replyTrackName {
		return
	}
	_ = pub.SetSubscribed(true)
}

func (s *liveKitRoomSession) handleTrackSubscribed(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
	if !s.cfg.SubscribeRemoteAudio || track == nil || rp == nil {
		return
	}
	if strings.HasPrefix(rp.Identity(), publisherIdentityPrefix) {
		return
	}
	if track.Kind() != webrtc.RTPCodecTypeAudio {
		return
	}
	if pub != nil && s.replyTrackName != "" && pub.Name() != s.replyTrackName {
		return
	}
	if !strings.EqualFold(track.Codec().MimeType, webrtc.MimeTypeOpus) {
		return
	}

	trackID := track.ID()
	if pub != nil && pub.SID() != "" {
		trackID = pub.SID()
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	if prev, ok := s.trackCancels[trackID]; ok {
		prev()
	}
	tCtx, tCancel := context.WithCancel(s.ctx)
	s.trackCancels[trackID] = tCancel
	s.wg.Add(1)
	s.mu.Unlock()

	go s.readRemoteAudioTrack(tCtx, trackID, track)
}

func (s *liveKitRoomSession) stopTrackReader(trackID string) {
	if trackID == "" {
		return
	}
	s.mu.Lock()
	if cancel, ok := s.trackCancels[trackID]; ok {
		delete(s.trackCancels, trackID)
		cancel()
	}
	s.mu.Unlock()
}

func (s *liveKitRoomSession) readRemoteAudioTrack(ctx context.Context, trackID string, track *webrtc.TrackRemote) {
	defer s.wg.Done()
	defer s.stopTrackReader(trackID)

	dec, err := NewOpusDecoder()
	if err != nil {
		return
	}
	var (
		hasSeq  bool
		lastSeq uint16
	)
	for {
		if ctx.Err() != nil {
			return
		}
		pkt, _, err := track.ReadRTP()
		if err != nil {
			if errors.Is(err, io.EOF) || ctx.Err() != nil {
				return
			}
			return
		}
		if ctx.Err() != nil {
			return
		}
		if hasSeq {
			gap := int(uint16(pkt.SequenceNumber - lastSeq))
			if gap > 1 && gap <= maxConsecutivePLCFrames+1 {
				for missing := 1; missing < gap; missing++ {
					if plc, pErr := dec.DecodePLC(FrameSamples); pErr == nil && len(plc) > 0 && s.cb.OnRemoteAudioPCM != nil {
						s.cb.OnRemoteAudioPCM(plc, SampleRate, Channels)
					}
				}
			}
		}
		hasSeq = true
		lastSeq = pkt.SequenceNumber

		if len(pkt.Payload) == 0 {
			continue
		}
		pcm, dErr := dec.DecodeFloat32(pkt.Payload)
		if dErr != nil || len(pcm) == 0 {
			continue
		}
		if s.cb.OnRemoteAudioPCM != nil {
			s.cb.OnRemoteAudioPCM(pcm, SampleRate, Channels)
		}
	}
}

func (s *liveKitRoomSession) PublishOpusFrame(packet []byte, duration time.Duration) error {
	if len(packet) == 0 {
		return nil
	}
	s.mu.Lock()
	track := s.localTrack
	closed := s.closed
	s.mu.Unlock()
	if closed || track == nil {
		return io.ErrClosedPipe
	}
	return track.WriteSample(media.Sample{
		Data:     packet,
		Duration: duration,
	}, nil)
}

func (s *liveKitRoomSession) SetMuted(muted bool) error {
	s.mu.Lock()
	pub := s.localPub
	closed := s.closed
	s.mu.Unlock()
	if closed || pub == nil {
		return nil
	}
	pub.SetMuted(muted)
	return nil
}

func (s *liveKitRoomSession) SendData(topic string, payload []byte, reliable bool) error {
	s.mu.Lock()
	room := s.room
	closed := s.closed
	s.mu.Unlock()
	if closed || room == nil || room.LocalParticipant == nil {
		return io.ErrClosedPipe
	}
	pkt := lksdk.UserData(payload)
	pkt.Topic = topic
	return room.LocalParticipant.PublishDataPacket(
		pkt,
		lksdk.WithDataPublishReliable(reliable),
		lksdk.WithDataPublishTopic(topic),
	)
}

func (s *liveKitRoomSession) CheckRuntimeReadiness(generation int64) (ready bool, providerKnown bool, providerReady bool) {
	s.mu.Lock()
	room := s.room
	closed := s.closed
	s.mu.Unlock()
	if closed || room == nil {
		return false, false, false
	}
	wantGen := strconv.FormatInt(generation, 10)
	for _, rp := range room.GetRemoteParticipants() {
		if rp == nil || rp.Kind() != lksdk.ParticipantAgent {
			continue
		}
		attrs := rp.Attributes()
		if attrs[attrVoiceReadyGen] == wantGen {
			ready = true
			if pv, ok := attrs[attrVoiceProviderReady]; ok {
				providerKnown = true
				providerReady = pv != "0"
			} else {
				providerKnown = true
				providerReady = true
			}
			return ready, providerKnown, providerReady
		}
	}
	return false, false, false
}

func (s *liveKitRoomSession) Disconnect() error {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		room := s.room
		pub := s.localPub
		for id, cancel := range s.trackCancels {
			cancel()
			delete(s.trackCancels, id)
		}
		s.mu.Unlock()

		s.cancel()
		if room != nil && pub != nil && room.LocalParticipant != nil {
			_ = room.LocalParticipant.UnpublishTrack(pub.SID())
		}
		if room != nil {
			room.Disconnect()
		}
		s.wg.Wait()
	})
	return nil
}
