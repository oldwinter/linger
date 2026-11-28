package testutil

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
)

// VoiceServerState tracks simulated TeamHub VoiceSession & LiveKit credential
// lifecycle calls in FakeServer for deterministic integration tests.
type VoiceServerState struct {
	LiveKitEndpoint       string
	CredentialTTL         time.Duration
	FailCreateCode        string
	FailCreateStatus      int
	FailCreateMessage     string
	InputReadyImmediate   bool
	ActiveSessions        map[string]api.VoiceSession
	ClosedSessionIDs      []string
	IssuedCredentials     int
	CommittedDictationIDs []string
	NextSessionSeq        int
}

func (f *FakeServer) ensureVoiceStateLocked() *VoiceServerState {
	if f.voiceState == nil {
		f.voiceState = &VoiceServerState{
			LiveKitEndpoint:     "wss://livekit.test.local",
			CredentialTTL:       10 * time.Minute,
			InputReadyImmediate: true,
			ActiveSessions:      map[string]api.VoiceSession{},
		}
	}
	return f.voiceState
}

// VoiceState returns the mutable simulated VoiceSession server state (lock via f.SetVoicePolicy/helpers).
func (f *FakeServer) ConfigureVoiceMedia(fn func(policy *api.VoiceMediaPolicy, st *VoiceServerState)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	st := f.ensureVoiceStateLocked()
	fn(&f.VoicePolicy, st)
}

// ClosedVoiceSessionIDs returns a copy of VoiceSession IDs closed via DELETE /v0/voice-sessions/:id.
func (f *FakeServer) ClosedVoiceSessionIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.voiceState == nil {
		return nil
	}
	return append([]string(nil), f.voiceState.ClosedSessionIDs...)
}

// IssuedVoiceCredentialsCount returns how many LiveKit publisher grants were issued.
func (f *FakeServer) IssuedVoiceCredentialsCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.voiceState == nil {
		return 0
	}
	return f.voiceState.IssuedCredentials
}

func (f *FakeServer) serveVoiceRoute(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.Path

	// GET/POST /v0/rooms/:roomId/voice-sessions
	if strings.HasPrefix(path, "/v0/rooms/") && strings.HasSuffix(path, "/voice-sessions") {
		roomID := strings.TrimSuffix(strings.TrimPrefix(path, "/v0/rooms/"), "/voice-sessions")
		if roomID == "" || strings.Contains(roomID, "/") {
			return false
		}
		switch r.Method {
		case http.MethodGet:
			f.mu.Lock()
			st := f.ensureVoiceStateLocked()
			for _, vs := range st.ActiveSessions {
				if vs.RoomID == roomID && vs.Status != "closed" {
					f.mu.Unlock()
					writeJSON(w, http.StatusOK, vs)
					return true
				}
			}
			f.mu.Unlock()
			writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "no active voice session")
			return true

		case http.MethodPost:
			var req struct {
				Purpose string `json:"purpose"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid voice session body")
				return true
			}
			f.mu.Lock()
			st := f.ensureVoiceStateLocked()
			if st.FailCreateCode != "" {
				code := st.FailCreateCode
				status := st.FailCreateStatus
				if status == 0 {
					status = http.StatusConflict
				}
				msg := st.FailCreateMessage
				if msg == "" {
					msg = code
				}
				f.mu.Unlock()
				writeJSONError(w, status, code, msg)
				return true
			}
			if f.VoicePolicy.VoiceAvailable != nil && !*f.VoicePolicy.VoiceAvailable {
				f.mu.Unlock()
				writeJSONError(w, http.StatusServiceUnavailable, "VOICE_MEDIA_UNAVAILABLE", "Voice media is disabled")
				return true
			}
			if req.Purpose == api.VoicePurposeChatLive {
				if f.VoicePolicy.LiveEnabled == nil || !*f.VoicePolicy.LiveEnabled || f.VoicePolicy.LiveSupported == nil || !*f.VoicePolicy.LiveSupported {
					f.mu.Unlock()
					writeJSONError(w, http.StatusServiceUnavailable, "VOICE_MEDIA_UNAVAILABLE", "Live voice provider is not configured")
					return true
				}
			} else if !f.VoicePolicy.VoiceMediaSupported {
				f.mu.Unlock()
				writeJSONError(w, http.StatusServiceUnavailable, "VOICE_MEDIA_UNAVAILABLE", "Voice transcription provider is not configured")
				return true
			}
			st.NextSessionSeq++
			now := time.Now().UTC()
			vs := api.VoiceSession{
				ID:                   fmt.Sprintf("vs_live_%d", st.NextSessionSeq),
				TenantID:             f.TenantID,
				RoomID:               roomID,
				Purpose:              req.Purpose,
				Status:               "connected",
				CredentialGeneration: 0,
				CreatedByActorID:     "act_human_1",
				CreatedAt:            now,
				UpdatedAt:            now,
			}
			st.ActiveSessions[vs.ID] = vs
			f.VoiceSession = vs
			f.mu.Unlock()
			writeJSON(w, http.StatusCreated, vs)
			return true
		}
	}

	if !strings.HasPrefix(path, "/v0/voice-sessions/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/v0/voice-sessions/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		return false
	}
	sessionID := parts[0]

	// POST /v0/voice-sessions/:id/connection-credentials
	if len(parts) == 2 && parts[1] == "connection-credentials" && r.Method == http.MethodPost {
		f.mu.Lock()
		st := f.ensureVoiceStateLocked()
		vs, ok := st.ActiveSessions[sessionID]
		if !ok || vs.Status == "closed" {
			f.mu.Unlock()
			writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "voice session not found")
			return true
		}
		vs.CredentialGeneration++
		if st.InputReadyImmediate {
			vs.InputReadyGeneration = vs.CredentialGeneration
		}
		vs.UpdatedAt = time.Now().UTC()
		st.ActiveSessions[sessionID] = vs
		st.IssuedCredentials++
		ttl := st.CredentialTTL
		if ttl <= 0 {
			ttl = 10 * time.Minute
		}
		cred := api.VoiceConnectionCredential{
			Endpoint:   st.LiveKitEndpoint,
			Credential: fmt.Sprintf("lk_jwt_%s_gen_%d", sessionID, vs.CredentialGeneration),
			ExpiresAt:  time.Now().UTC().Add(ttl),
			Generation: vs.CredentialGeneration,
		}
		f.mu.Unlock()
		writeJSON(w, http.StatusCreated, cred)
		return true
	}

	// POST /v0/voice-sessions/:id/dictation-commit
	if len(parts) == 2 && parts[1] == "dictation-commit" && r.Method == http.MethodPost {
		var req struct {
			RequestID string `json:"request_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.RequestID) == "" {
			writeJSONError(w, http.StatusBadRequest, "INVALID_REQUEST", "request_id is required")
			return true
		}
		f.mu.Lock()
		st := f.ensureVoiceStateLocked()
		st.CommittedDictationIDs = append(st.CommittedDictationIDs, req.RequestID)
		f.mu.Unlock()
		writeJSON(w, http.StatusAccepted, api.VoiceDictationCommitReceipt{
			RequestID: req.RequestID,
			Status:    "accepted",
		})
		return true
	}

	// GET/DELETE /v0/voice-sessions/:id
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			f.mu.Lock()
			st := f.ensureVoiceStateLocked()
			vs, ok := st.ActiveSessions[sessionID]
			f.mu.Unlock()
			if !ok {
				writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "voice session not found")
				return true
			}
			writeJSON(w, http.StatusOK, vs)
			return true

		case http.MethodDelete:
			f.mu.Lock()
			st := f.ensureVoiceStateLocked()
			vs, ok := st.ActiveSessions[sessionID]
			if !ok {
				f.mu.Unlock()
				writeJSONError(w, http.StatusNotFound, "NOT_FOUND", "voice session not found")
				return true
			}
			now := time.Now().UTC()
			vs.Status = "closed"
			vs.ClosedAt = &now
			vs.UpdatedAt = now
			st.ActiveSessions[sessionID] = vs
			st.ClosedSessionIDs = append(st.ClosedSessionIDs, sessionID)
			f.mu.Unlock()
			writeJSON(w, http.StatusOK, vs)
			return true
		}
	}

	return false
}
