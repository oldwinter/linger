package voicekey

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// The provider APIs a saved key is checked against. Tests point an
// HTTPChecker at fakes instead.
const (
	DefaultSonioxBaseURL     = "https://api.soniox.com"
	DefaultSonioxRealtimeURL = "wss://stt-rt.soniox.com/transcribe-websocket"
	DefaultXAIBaseURL        = "https://api.x.ai"
	checkTimeout             = 10 * time.Second
	// realtimeProbeTimeout bounds the whole Soniox stream probe, handshake
	// included, so a save never waits on an unresponsive Soniox for long.
	realtimeProbeTimeout = 5 * time.Second
	// sonioxRealtimeModel is the realtime model the Voice Runtime transcribes
	// with; the probe opens its stream with the same start request shape.
	sonioxRealtimeModel = "stt-rt-v6"
)

// HTTPChecker checks a key with one authenticated read: Soniox lists one
// uploaded file, xAI describes the key itself. Neither costs usage. A Soniox
// key is then also probed on the realtime stream voice runs on.
type HTTPChecker struct {
	SonioxBaseURL     string
	SonioxRealtimeURL string
	XAIBaseURL        string
	Client            *http.Client
}

// NewHTTPChecker checks keys against the real provider APIs.
func NewHTTPChecker() *HTTPChecker {
	return &HTTPChecker{
		SonioxBaseURL: DefaultSonioxBaseURL, SonioxRealtimeURL: DefaultSonioxRealtimeURL, XAIBaseURL: DefaultXAIBaseURL,
		// A key never follows a redirect to another host.
		Client: &http.Client{Timeout: checkTimeout, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
	}
}

// Check returns nil when provider accepts key; ErrRejected when it refuses it,
// ErrNoBalance when the account cannot pay for usage, ErrNoRealtime when a
// Soniox key may not stream, and ErrProviderUnavailable otherwise. Errors
// never carry the key or the provider's response.
func (c *HTTPChecker) Check(ctx context.Context, provider Provider, key string) error {
	var endpoint string
	switch provider {
	case Soniox:
		endpoint = strings.TrimRight(c.SonioxBaseURL, "/") + "/v1/files?limit=1"
	case XAI:
		endpoint = strings.TrimRight(c.XAIBaseURL, "/") + "/v1/api-key"
	default:
		return ErrInvalid
	}
	if err := c.read(ctx, provider, endpoint, key); err != nil || provider != Soniox {
		return err
	}
	return c.probeSonioxRealtime(ctx, key)
}

func (c *HTTPChecker) read(ctx context.Context, provider Provider, endpoint, key string) error {
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ErrProviderUnavailable
	}
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Accept", "application/json")
	response, err := c.Client.Do(request)
	if err != nil {
		return ErrProviderUnavailable
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	switch {
	case response.StatusCode >= 200 && response.StatusCode < 300:
		if provider == XAI && xaiKeyBlocked(body) {
			return ErrRejected
		}
		return nil
	// The request carries nothing but the key, so xAI's 400 for a malformed
	// key is a refusal like 401 and 403.
	case response.StatusCode == http.StatusBadRequest || response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden:
		return ErrRejected
	case response.StatusCode == http.StatusPaymentRequired:
		return ErrNoBalance
	default:
		return ErrProviderUnavailable
	}
}

// probeSonioxRealtime opens the realtime stream voice transcribes on, sends
// the start request and at once ends the stream without audio, then reads
// Soniox's answer. The REST read above cannot tell a key without balance or
// without realtime permission from a good one; the stream refuses both.
// Soniox maps each error to a fixed HTTP status on every surface, so the
// status alone decides, on the handshake or in the stream's error response.
func (c *HTTPChecker) probeSonioxRealtime(ctx context.Context, key string) error {
	ctx, cancel := context.WithTimeout(ctx, realtimeProbeTimeout)
	defer cancel()
	dialer := websocket.Dialer{Proxy: http.ProxyFromEnvironment}
	// The key goes with the connection; Soniox deprecates it in the start
	// request.
	conn, response, err := dialer.DialContext(ctx, c.SonioxRealtimeURL, http.Header{"Authorization": {"Bearer " + key}})
	if response != nil {
		_ = response.Body.Close()
	}
	if err != nil {
		if response == nil {
			return ErrProviderUnavailable
		}
		return sonioxRefusal(response.StatusCode)
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	conn.SetReadLimit(64 << 10)
	start := map[string]any{"model": sonioxRealtimeModel, "audio_format": "pcm_s16le", "sample_rate": 16000, "num_channels": 1}
	// An empty text frame ends the stream.
	if conn.WriteJSON(start) != nil || conn.WriteMessage(websocket.TextMessage, nil) != nil {
		return ErrProviderUnavailable
	}
	for {
		var reply struct {
			ErrorCode *int `json:"error_code"`
			Finished  bool `json:"finished"`
		}
		if conn.ReadJSON(&reply) != nil {
			return ErrProviderUnavailable
		}
		switch {
		// Soniox authenticates the key and checks balance and permission
		// before it runs the stream, so a 400 for the stream itself (no
		// audio) means the key passed every check. A 429 for the
		// organization's concurrent streams also comes after authentication.
		case reply.ErrorCode != nil && (*reply.ErrorCode == http.StatusBadRequest || *reply.ErrorCode == http.StatusTooManyRequests):
			return nil
		case reply.ErrorCode != nil:
			return sonioxRefusal(*reply.ErrorCode)
		case reply.Finished:
			return nil
		}
	}
}

// sonioxRefusal maps the HTTP status Soniox gives an error to the reason a
// key cannot run voice.
func sonioxRefusal(status int) error {
	switch status {
	case http.StatusUnauthorized:
		return ErrRejected
	case http.StatusPaymentRequired:
		return ErrNoBalance
	case http.StatusForbidden:
		return ErrNoRealtime
	default:
		return ErrProviderUnavailable
	}
}

// xaiKeyBlocked reads only the flags xAI sets on a key it would refuse: a key
// can be described with 200 and still be blocked or disabled. An unreadable
// body or absent flags accept the key; the body is never logged or returned.
func xaiKeyBlocked(body []byte) bool {
	var flags struct {
		APIKeyBlocked  bool `json:"api_key_blocked"`
		APIKeyDisabled bool `json:"api_key_disabled"`
		TeamBlocked    bool `json:"team_blocked"`
	}
	if json.Unmarshal(body, &flags) != nil {
		return false
	}
	return flags.APIKeyBlocked || flags.APIKeyDisabled || flags.TeamBlocked
}
