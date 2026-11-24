// Package api implements the unified HTTP and SSE client for Linger Mobile,
// supporting both Desktop Companion mode (Bearer auth + SPKI TLS 1.3 pinning +
// LAN/Tailscale failover) and Direct TeamHub mode (session cookie auth).
package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/oldwinter/linger/mobile/internal/discovery"
)

const (
	// UserAgent identifies Linger Mobile to Companion Gateway and TeamHub.
	UserAgent = "linger-mobile/0.1.0"
	// SessionCookieName is TeamHub's public session cookie name.
	SessionCookieName = "teamhub_session"
)

// AuthMode controls how outbound requests authenticate.
type AuthMode string

const (
	AuthModeNone      AuthMode = "none"
	AuthModeCompanion AuthMode = "companion"
	AuthModeDirect    AuthMode = "direct"
)

var (
	// ErrTLSFingerprintMismatch is returned when the server's leaf SPKI digest does not match the pinned fingerprint.
	ErrTLSFingerprintMismatch = errors.New("api: TLS SPKI fingerprint mismatch")
	// ErrPlainHTTPDisallowed is returned when plain HTTP is requested without explicit opt-in.
	ErrPlainHTTPDisallowed = errors.New("api: plain HTTP requires explicit opt-in")
	// ErrUnauthorized is returned on HTTP 401 or SESSION_EXPIRED.
	ErrUnauthorized = errors.New("api: unauthorized")
)

// APIError represents the structured error envelope returned by TeamHub and Companion Gateway.
type APIError struct {
	StatusCode int
	Code       string          `json:"code"`
	Message    string          `json:"message"`
	RequestID  string          `json:"request_id,omitempty"`
	Details    json.RawMessage `json:"details,omitempty"`
}

func (e *APIError) Error() string {
	if e.Code != "" && e.Message != "" {
		return fmt.Sprintf("api %d %s: %s", e.StatusCode, e.Code, e.Message)
	}
	if e.Message != "" {
		return fmt.Sprintf("api %d: %s", e.StatusCode, e.Message)
	}
	return fmt.Sprintf("api error: HTTP %d", e.StatusCode)
}

// Unwrap lets callers match ErrUnauthorized via errors.Is.
func (e *APIError) Unwrap() error {
	if e.IsUnauthenticated() {
		return ErrUnauthorized
	}
	return nil
}

// IsUnauthenticated reports whether the error indicates an expired or revoked session/token.
func (e *APIError) IsUnauthenticated() bool {
	if e.StatusCode == http.StatusUnauthorized {
		return true
	}
	switch strings.ToUpper(e.Code) {
	case "UNAUTHENTICATED", "SESSION_EXPIRED", "DEVICE_REVOKED", "INVALID_TOKEN":
		return true
	default:
		return false
	}
}

// IsConflict reports an optimistic-concurrency version conflict (HTTP 409).
func (e *APIError) IsConflict() bool {
	return e.StatusCode == http.StatusConflict
}

// ClientConfig configures a unified Linger Mobile API client.
type ClientConfig struct {
	BaseURL        string
	FallbackURL    string
	Mode           AuthMode
	Token          string
	TLSFingerprint string
	AllowPlainHTTP bool
	Timeout        time.Duration
	OnTokenChanged func(newToken string)
}

// Client is a thread-safe HTTP/SSE client for Companion Gateway and TeamHub.
type Client struct {
	mu             sync.RWMutex
	baseURL        string
	primaryURL     string
	fallbackURL    string
	activeVia      string
	mode           AuthMode
	token          string
	tlsFingerprint string
	allowPlainHTTP bool
	onTokenChanged func(string)
	lastRTT        time.Duration

	transport *http.Transport
	http      *http.Client
	sseHTTP   *http.Client
}

// VerifySPKIPin returns a tls.Config.VerifyPeerCertificate verifier that checks
// the leaf certificate's SubjectPublicKeyInfo SHA-256 against expectedFP
// (unpadded base64url, 43 chars) using constant-time comparison.
func VerifySPKIPin(expectedFP string) func(rawCerts [][]byte, verifiedChains [][]*x509.Certificate) error {
	expectedBytes, expectedErr := discovery.ValidateFingerprint(expectedFP)
	return func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if expectedErr != nil {
			return fmt.Errorf("%w: %v", ErrTLSFingerprintMismatch, expectedErr)
		}
		if len(rawCerts) == 0 {
			return fmt.Errorf("%w: peer presented no certificate", ErrTLSFingerprintMismatch)
		}
		leaf, err := x509.ParseCertificate(rawCerts[0])
		if err != nil {
			return fmt.Errorf("%w: parse leaf certificate: %v", ErrTLSFingerprintMismatch, err)
		}
		sum := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
		if subtle.ConstantTimeCompare(sum[:], expectedBytes) != 1 {
			gotFP := base64.RawURLEncoding.EncodeToString(sum[:])
			return fmt.Errorf("%w: got %s, want %s", ErrTLSFingerprintMismatch, gotFP, expectedFP)
		}
		return nil
	}
}

// NewClient constructs a configured API client.
func NewClient(cfg ClientConfig) (*Client, error) {
	primary := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if primary == "" {
		return nil, errors.New("api: base URL is required")
	}
	if err := validateEndpointPolicy(primary, cfg.AllowPlainHTTP); err != nil {
		return nil, err
	}
	fallback := strings.TrimRight(strings.TrimSpace(cfg.FallbackURL), "/")
	if fallback != "" {
		if err := validateEndpointPolicy(fallback, cfg.AllowPlainHTTP); err != nil {
			return nil, err
		}
	}
	if cfg.TLSFingerprint != "" {
		if _, err := discovery.ValidateFingerprint(cfg.TLSFingerprint); err != nil {
			return nil, err
		}
	}

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	transport := newPinnedTransport(cfg.TLSFingerprint)

	mode := cfg.Mode
	if mode == "" {
		mode = AuthModeNone
	}
	return &Client{
		baseURL:        primary,
		primaryURL:     primary,
		fallbackURL:    fallback,
		activeVia:      "primary",
		mode:           mode,
		token:          cfg.Token,
		tlsFingerprint: cfg.TLSFingerprint,
		allowPlainHTTP: cfg.AllowPlainHTTP,
		onTokenChanged: cfg.OnTokenChanged,
		transport:      transport,
		http:           &http.Client{Transport: transport, Timeout: timeout},
		sseHTTP:        &http.Client{Transport: transport},
	}, nil
}

func validateEndpointPolicy(rawURL string, allowPlainHTTP bool) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("api: invalid URL %q: %w", rawURL, err)
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		return nil
	case "http":
		if !allowPlainHTTP {
			return fmt.Errorf("%w (%s)", ErrPlainHTTPDisallowed, rawURL)
		}
		return nil
	default:
		return fmt.Errorf("api: unsupported URL scheme %q", u.Scheme)
	}
}

func newPinnedTransport(spkiFingerprint string) *http.Transport {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConnsPerHost = 16
	tr.IdleConnTimeout = 60 * time.Second
	tr.ResponseHeaderTimeout = 0
	if spkiFingerprint != "" {
		// Pin the leaf SubjectPublicKeyInfo SHA-256 directly over TLS 1.3.
		// InsecureSkipVerify disables default CA chain validation because
		// Desktop issues a self-signed per-host certificate; VerifyPeerCertificate
		// enforces exact constant-time SPKI pin validation on every handshake.
		tr.TLSClientConfig = &tls.Config{
			MinVersion:            tls.VersionTLS13,
			InsecureSkipVerify:    true, //nolint:gosec // Enforced via VerifyPeerCertificate SPKI pin
			VerifyPeerCertificate: VerifySPKIPin(spkiFingerprint),
		}
	} else {
		tr.TLSClientConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
	}
	return tr
}

// CloseIdleConnections releases idle HTTP connections.
func (c *Client) CloseIdleConnections() {
	c.transport.CloseIdleConnections()
}

type authRoundTripper struct {
	client *Client
	base   http.RoundTripper
}

func (a *authRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	cloned := req.Clone(req.Context())
	cloned.Header.Del("Origin")
	cloned.Header.Del("Sec-Fetch-Site")
	cloned.Header.Set("User-Agent", UserAgent)

	a.client.mu.RLock()
	mode := a.client.mode
	token := a.client.token
	a.client.mu.RUnlock()

	if token != "" {
		switch mode {
		case AuthModeCompanion:
			cloned.Header.Set("Authorization", "Bearer "+token)
		case AuthModeDirect:
			cloned.Header.Set("Cookie", SessionCookieName+"="+token)
		}
	}
	return a.base.RoundTrip(cloned)
}

// AuthenticatedHTTPClient returns an *http.Client sharing this client's
// SPKI-pinned TLS transport and injecting live auth headers automatically
// (for ui/netimage authenticated image loading).
func (c *Client) AuthenticatedHTTPClient() *http.Client {
	return &http.Client{
		Transport: &authRoundTripper{client: c, base: c.transport},
		Timeout:   20 * time.Second,
	}
}

// BaseURL returns the currently active base URL.
func (c *Client) BaseURL() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.baseURL
}

// ActiveVia returns whether requests currently target "primary" or "fallback".
func (c *Client) ActiveVia() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.activeVia
}

// Mode returns the active auth mode.
func (c *Client) Mode() AuthMode {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.mode
}

// Token returns the current Bearer token or session cookie value.
func (c *Client) Token() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.token
}

// SetToken updates the active Bearer token or session cookie value.
func (c *Client) SetToken(token string) {
	c.mu.Lock()
	c.token = token
	cb := c.onTokenChanged
	c.mu.Unlock()
	if cb != nil {
		cb(token)
	}
}

// LastRTT returns the round-trip duration of the most recent completed request.
func (c *Client) LastRTT() time.Duration {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lastRTT
}

// TLSFingerprint returns the pinned SPKI fingerprint if configured.
func (c *Client) TLSFingerprint() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.tlsFingerprint
}

// ProbeAndSelectEndpoint tests primary LAN URL first (1.5s timeout) and
// switches automatically to FallbackURL (Tailscale) if primary is unreachable.
func (c *Client) ProbeAndSelectEndpoint(ctx context.Context, lanTimeout time.Duration) (discovery.ReachableResult, error) {
	c.mu.RLock()
	primary := c.primaryURL
	fallback := c.fallbackURL
	fp := c.tlsFingerprint
	allowHTTP := c.allowPlainHTTP
	mode := c.mode
	c.mu.RUnlock()

	lanTarget := &discovery.EndpointTarget{
		URL:            primary,
		TLS:            strings.HasPrefix(primary, "https://"),
		TLSFingerprint: fp,
		AllowPlainHTTP: allowHTTP,
		Via:            "primary",
	}
	var tsTarget *discovery.EndpointTarget
	if fallback != "" {
		tsTarget = &discovery.EndpointTarget{
			URL:            fallback,
			TLS:            strings.HasPrefix(fallback, "https://"),
			TLSFingerprint: fp,
			AllowPlainHTTP: allowHTTP,
			Via:            "fallback",
		}
	}

	probePath := "/companion/v1/info"
	if mode == AuthModeDirect {
		probePath = "/v0/session"
	}

	res, err := discovery.ResolveReachableEndpoint(ctx, lanTarget, tsTarget, func(pCtx context.Context, target discovery.EndpointTarget) error {
		req, err := c.buildRequest(pCtx, http.MethodGet, target.URL+probePath, nil, nil)
		if err != nil {
			return err
		}
		resp, err := c.http.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
		// Any valid HTTP response (even 401 on /v0/session) proves reachability + TLS pin match.
		if resp.StatusCode >= 500 {
			return fmt.Errorf("probe status %d", resp.StatusCode)
		}
		return nil
	}, lanTimeout)
	if err != nil {
		return discovery.ReachableResult{}, err
	}

	c.mu.Lock()
	c.baseURL = res.Target.URL
	c.activeVia = res.Target.Via
	c.lastRTT = res.RTT
	c.mu.Unlock()
	return res, nil
}

func (c *Client) buildRequest(ctx context.Context, method, fullURL string, body io.Reader, extraHeaders map[string]string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, fullURL, body)
	if err != nil {
		return nil, err
	}
	// Explicitly omit Origin and Sec-Fetch-Site so Companion Gateway CSRF checks pass.
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")

	c.mu.RLock()
	mode := c.mode
	token := c.token
	c.mu.RUnlock()

	if token != "" {
		switch mode {
		case AuthModeCompanion:
			req.Header.Set("Authorization", "Bearer "+token)
		case AuthModeDirect:
			req.Header.Set("Cookie", SessionCookieName+"="+token)
		}
	}
	for k, v := range extraHeaders {
		if strings.EqualFold(k, "Origin") || strings.EqualFold(k, "Sec-Fetch-Site") {
			continue
		}
		req.Header.Set(k, v)
	}
	return req, nil
}

// DoJSON sends a JSON HTTP request and decodes the response into out (if non-nil).
func (c *Client) DoJSON(ctx context.Context, method, path string, reqBody any, out any) error {
	return c.DoJSONWithHeaders(ctx, method, path, reqBody, nil, out)
}

// DoJSONWithHeaders sends a JSON HTTP request with custom headers (such as Idempotency-Key).
func (c *Client) DoJSONWithHeaders(ctx context.Context, method, path string, reqBody any, headers map[string]string, out any) error {
	var bodyReader io.Reader
	mergedHeaders := make(map[string]string, len(headers)+1)
	for k, v := range headers {
		mergedHeaders[k] = v
	}
	if reqBody != nil {
		payload, err := json.Marshal(reqBody)
		if err != nil {
			return fmt.Errorf("api: marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(payload)
		mergedHeaders["Content-Type"] = "application/json"
	}

	fullURL := c.BaseURL() + path
	req, err := c.buildRequest(ctx, method, fullURL, bodyReader, mergedHeaders)
	if err != nil {
		return err
	}

	start := time.Now()
	resp, err := c.http.Do(req)
	rtt := time.Since(start)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	c.mu.Lock()
	c.lastRTT = rtt
	mode := c.mode
	c.mu.Unlock()

	if mode == AuthModeDirect {
		c.captureSessionCookie(resp)
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return fmt.Errorf("api: read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return parseAPIError(resp.StatusCode, raw)
	}
	if out == nil || len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("api: decode %s %s response: %w", method, path, err)
	}
	return nil
}

// DoBytes performs an authenticated GET (or specified method) and returns raw
// bytes and Content-Type (used for screenshots, avatars, and document downloads).
func (c *Client) DoBytes(ctx context.Context, method, path string, body io.Reader, headers map[string]string) ([]byte, string, error) {
	req, err := c.buildRequest(ctx, method, c.BaseURL()+path, body, headers)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "*/*")
	start := time.Now()
	resp, err := c.http.Do(req)
	rtt := time.Since(start)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	c.mu.Lock()
	c.lastRTT = rtt
	c.mu.Unlock()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", parseAPIError(resp.StatusCode, data)
	}
	return data, resp.Header.Get("Content-Type"), nil
}

// OpenSSE opens a long-lived Server-Sent Events stream using the shared TLS-pinned
// transport without the request timeout.
func (c *Client) OpenSSE(ctx context.Context, path string) (*http.Response, error) {
	req, err := c.buildRequest(ctx, http.MethodGet, c.BaseURL()+path, nil, map[string]string{
		"Accept":        "text/event-stream",
		"Cache-Control": "no-cache",
	})
	if err != nil {
		return nil, err
	}
	resp, err := c.sseHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		return nil, parseAPIError(resp.StatusCode, raw)
	}
	return resp, nil
}

func (c *Client) captureSessionCookie(resp *http.Response) {
	for _, ck := range resp.Cookies() {
		if ck.Name == SessionCookieName && ck.Value != "" {
			c.SetToken(ck.Value)
			return
		}
	}
}

func parseAPIError(statusCode int, raw []byte) *APIError {
	var envelope struct {
		Error *APIError `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil && envelope.Error != nil {
		envelope.Error.StatusCode = statusCode
		return envelope.Error
	}
	msg := strings.TrimSpace(string(raw))
	if len(msg) > 240 {
		msg = msg[:240]
	}
	return &APIError{
		StatusCode: statusCode,
		Code:       http.StatusText(statusCode),
		Message:    msg,
	}
}

// BuildQuery builds a URL-encoded query string from non-empty key/value pairs.
func BuildQuery(params url.Values) string {
	encoded := params.Encode()
	if encoded == "" {
		return ""
	}
	return "?" + encoded
}
