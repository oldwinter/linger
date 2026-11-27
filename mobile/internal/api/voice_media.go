package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Voice session purposes supported by TeamHub's POST /v0/rooms/:roomId/voice-sessions.
const (
	VoicePurposeHardwareControl = "hardware_control"
	VoicePurposeChatDictation   = "chat_dictation"
	VoicePurposeChatLive        = "chat_live"
)

// VoiceLiveDataTopic is the reliable LiveKit data channel topic for chat_live events.
const VoiceLiveDataTopic = "linger.voice.live"

// VoiceLiveReplyTrackName is the remote audio track published by Voice Runtime in chat_live mode.
const VoiceLiveReplyTrackName = "linger-live-reply"

// VoiceConnectionCredential holds a short-lived LiveKit participant grant issued by TeamHub.
type VoiceConnectionCredential struct {
	Endpoint   string    `json:"endpoint"`
	Credential string    `json:"credential"`
	ExpiresAt  time.Time `json:"expires_at"`
	Generation int64     `json:"generation"`
}

// VoiceDictationCommitReceipt acknowledges POST /v0/voice-sessions/:id/dictation-commit.
type VoiceDictationCommitReceipt struct {
	RequestID string `json:"request_id"`
	Status    string `json:"status"`
}

// VoiceLiveRuntimeEvent is received from Voice Runtime over LiveKit topic linger.voice.live.
type VoiceLiveRuntimeEvent struct {
	Type        string `json:"type"`
	TurnID      string `json:"turn_id,omitempty"`
	SpeechID    string `json:"speech_id,omitempty"`
	CallID      string `json:"call_id,omitempty"`
	Tool        string `json:"tool,omitempty"`
	Text        string `json:"text,omitempty"`
	Interrupted bool   `json:"interrupted,omitempty"`
	Code        string `json:"code,omitempty"`
}

// VoiceLiveAudioStats reports WebRTC media diagnostics to Voice Runtime.
type VoiceLiveAudioStats struct {
	IntervalMs                     int      `json:"interval_ms"`
	SamplesReceived                *int     `json:"samples_received,omitempty"`
	ConcealedSamples               *int     `json:"concealed_samples,omitempty"`
	SilentConcealedSamples         *int     `json:"silent_concealed_samples,omitempty"`
	ConcealmentEvents              *int     `json:"concealment_events,omitempty"`
	InsertedSamplesForDeceleration *int     `json:"inserted_samples_for_deceleration,omitempty"`
	RemovedSamplesForAcceleration  *int     `json:"removed_samples_for_acceleration,omitempty"`
	JitterBufferDelayMs            *float64 `json:"jitter_buffer_delay_ms,omitempty"`
	PacketsLost                    *int     `json:"packets_lost,omitempty"`
	PacketsSent                    *int     `json:"packets_sent,omitempty"`
}

// VoiceLiveClientEvent is sent by the publisher over LiveKit topic linger.voice.live.
type VoiceLiveClientEvent struct {
	Type   string               `json:"type"`
	CallID string               `json:"call_id,omitempty"`
	Text   string               `json:"text,omitempty"`
	Audio  *VoiceLiveAudioStats `json:"audio,omitempty"`
}

// CreateVoiceSession opens a TeamHub-owned VoiceSession in roomID for purpose.
func (c *Client) CreateVoiceSession(ctx context.Context, roomID, purpose string) (VoiceSession, error) {
	var out VoiceSession
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/rooms/%s/voice-sessions", url.PathEscape(roomID)), map[string]string{
		"purpose": purpose,
	}, &out)
	return out, err
}

// GetVoiceSession reads the current TeamHub VoiceSession projection.
func (c *Client) GetVoiceSession(ctx context.Context, sessionID string) (VoiceSession, error) {
	var out VoiceSession
	err := c.DoJSON(ctx, http.MethodGet, fmt.Sprintf("/v0/voice-sessions/%s", url.PathEscape(sessionID)), nil, &out)
	return out, err
}

// CloseVoiceSession closes the VoiceSession and revokes its LiveKit publisher grant.
func (c *Client) CloseVoiceSession(ctx context.Context, sessionID string) (VoiceSession, error) {
	var out VoiceSession
	err := c.DoJSON(ctx, http.MethodDelete, fmt.Sprintf("/v0/voice-sessions/%s", url.PathEscape(sessionID)), nil, &out)
	return out, err
}

// CreateVoiceSessionCredential issues or refreshes a short-lived LiveKit publisher grant.
func (c *Client) CreateVoiceSessionCredential(ctx context.Context, sessionID string) (VoiceConnectionCredential, error) {
	var out VoiceConnectionCredential
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/voice-sessions/%s/connection-credentials", url.PathEscape(sessionID)), nil, &out)
	return out, err
}

// CommitVoiceDictationTurn asks the chat dictation runtime to finalize its current turn.
func (c *Client) CommitVoiceDictationTurn(ctx context.Context, sessionID, requestID string) (VoiceDictationCommitReceipt, error) {
	var out VoiceDictationCommitReceipt
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/voice-sessions/%s/dictation-commit", url.PathEscape(sessionID)), map[string]string{
		"request_id": requestID,
	}, &out)
	return out, err
}

// StartVoiceCapture begins a service-recorded capture on an active VoiceSession.
func (c *Client) StartVoiceCapture(ctx context.Context, sessionID, roomID string, startOffsetMs int64) (VoiceCapture, error) {
	var out VoiceCapture
	err := c.DoJSON(ctx, http.MethodPost, fmt.Sprintf("/v0/voice-sessions/%s/captures", url.PathEscape(sessionID)), map[string]any{
		"room_id":         roomID,
		"start_offset_ms": startOffsetMs,
	}, &out)
	return out, err
}
