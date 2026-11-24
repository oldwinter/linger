package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sync"

	"github.com/oldwinter/linger/mobile/internal/api"
)

// VoiceStreamCallbacks receives frames from GET /v0/voice-sessions/:id/events/stream.
type VoiceStreamCallbacks struct {
	OnEvents         func(page api.VoiceEventPage)
	OnPartial        func(partial api.VoiceTranscriptEventPage)
	OnReady          func()
	OnSessionExpired func(code, message string)
}

// VoiceSessionStream reads live transcript and capture updates for one VoiceSession.
type VoiceSessionStream struct {
	client    *api.Client
	sessionID string
	callbacks VoiceStreamCallbacks

	mu     sync.Mutex
	cursor string
}

// NewVoiceSessionStream creates a VoiceSessionStream for sessionID.
func NewVoiceSessionStream(client *api.Client, sessionID string, cb VoiceStreamCallbacks) *VoiceSessionStream {
	return &VoiceSessionStream{
		client:    client,
		sessionID: sessionID,
		callbacks: cb,
	}
}

// Cursor returns the latest voice event cursor observed on the stream.
func (s *VoiceSessionStream) Cursor() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cursor
}

// RunOnce opens /v0/voice-sessions/:id/events/stream and streams frames until EOF or ctx cancellation.
func (s *VoiceSessionStream) RunOnce(ctx context.Context) error {
	path := fmt.Sprintf("/v0/voice-sessions/%s/events/stream", url.PathEscape(s.sessionID))
	if cur := s.Cursor(); cur != "" {
		path += "?after=" + url.QueryEscape(cur)
	}
	resp, err := s.client.OpenSSE(ctx, path)
	if err != nil {
		if errors.Is(err, api.ErrUnauthorized) && s.callbacks.OnSessionExpired != nil {
			s.callbacks.OnSessionExpired("SESSION_EXPIRED", err.Error())
		}
		return err
	}
	defer resp.Body.Close()

	return ReadSSE(resp.Body, func(frame SSEEvent) bool {
		if frame.Comment != "" {
			return true
		}
		if frame.ID != "" {
			s.mu.Lock()
			s.cursor = frame.ID
			s.mu.Unlock()
		}
		switch frame.Event {
		case "voice.events":
			var page api.VoiceEventPage
			if json.Unmarshal([]byte(frame.Data), &page) == nil {
				if page.NextCursor != "" {
					s.mu.Lock()
					s.cursor = page.NextCursor
					s.mu.Unlock()
				}
				if s.callbacks.OnEvents != nil {
					s.callbacks.OnEvents(page)
				}
			}
		case "voice.partial":
			var partial api.VoiceTranscriptEventPage
			if json.Unmarshal([]byte(frame.Data), &partial) == nil && s.callbacks.OnPartial != nil {
				s.callbacks.OnPartial(partial)
			}
		case "voice.ready":
			if s.callbacks.OnReady != nil {
				s.callbacks.OnReady()
			}
		case "session.expired", "SESSION_EXPIRED":
			if s.callbacks.OnSessionExpired != nil {
				s.callbacks.OnSessionExpired("SESSION_EXPIRED", "voice session expired")
			}
			return false
		}
		return true
	})
}
