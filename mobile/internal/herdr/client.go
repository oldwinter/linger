package herdr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
)

const (
	// DefaultReadLines is the default scrollback line count requested from terminal/read.
	DefaultReadLines       = 120
	companionHerdrBasePath = "/companion/v1/herdr-core"
)

var (
	// ErrNotConnected indicates no active API client or computer ID is configured.
	ErrNotConnected = errors.New("herdr: not connected or no computer selected")
	// ErrUnavailable indicates herdr-core is unavailable or unsupported on the target backend.
	ErrUnavailable = errors.New("herdr: herdr-core unavailable")
	// ErrComputerOffline indicates the target Local Computer daemon is offline.
	ErrComputerOffline = errors.New("herdr: computer offline")
	// ErrUnauthorized indicates the caller's session or companion token was rejected.
	ErrUnauthorized = errors.New("herdr: unauthorized")
	// ErrPreconditionFailed indicates a compare-and-swap status guard (e.g. if="blocked") failed.
	ErrPreconditionFailed = errors.New("herdr: terminal state precondition failed")
	// ErrTerminalNotFound indicates the requested terminal address does not exist.
	ErrTerminalNotFound = errors.New("herdr: terminal not found")
)

// ClientError classifies structured API and transport errors returned by herdr-core endpoints.
type ClientError struct {
	StatusCode int
	Code       string
	Message    string
	RequestID  string
	Sentinel   error
	Cause      error
}

func (e *ClientError) Error() string {
	if e.Code != "" && e.Message != "" {
		return fmt.Sprintf("herdr %d %s: %s", e.StatusCode, e.Code, e.Message)
	}
	if e.Message != "" {
		return fmt.Sprintf("herdr %d: %s", e.StatusCode, e.Message)
	}
	if e.Cause != nil {
		return fmt.Sprintf("herdr: %v", e.Cause)
	}
	return fmt.Sprintf("herdr error: HTTP %d", e.StatusCode)
}

// Unwrap lets callers match classified sentinels (ErrUnavailable, ErrComputerOffline,
// ErrPreconditionFailed, ErrTerminalNotFound, ErrUnauthorized) via errors.Is.
func (e *ClientError) Unwrap() error {
	if e.Sentinel != nil {
		return e.Sentinel
	}
	return e.Cause
}

// ClientConfig configures a standalone herdr-core HTTP/WS client.
type ClientConfig struct {
	BaseURL        string
	FallbackURL    string
	Mode           api.AuthMode
	Token          string
	TLSFingerprint string
	AllowPlainHTTP bool
	Timeout        time.Duration
	ComputerID     string
}

// Client calls the shared TeamHub / Companion Gateway herdr-core endpoints for a selected computer.
type Client struct {
	apiClient *api.Client

	mu                 sync.RWMutex
	computerID         string
	useCompanionBridge bool
}

// NewClient constructs a herdr-core Client backed by a newly created *api.Client.
func NewClient(cfg ClientConfig) (*Client, error) {
	ac, err := api.NewClient(api.ClientConfig{
		BaseURL:        cfg.BaseURL,
		FallbackURL:    cfg.FallbackURL,
		Mode:           cfg.Mode,
		Token:          cfg.Token,
		TLSFingerprint: cfg.TLSFingerprint,
		AllowPlainHTTP: cfg.AllowPlainHTTP,
		Timeout:        cfg.Timeout,
	})
	if err != nil {
		return nil, err
	}
	return NewClientFromAPI(ac, cfg.ComputerID), nil
}

// NewClientFromAPI wraps an existing Linger Mobile *api.Client so herdr-core calls inherit
// SPKI TLS 1.3 pinning, Companion Bearer / Direct Cookie auth, and LAN/Tailscale failover.
func NewClientFromAPI(ac *api.Client, computerID string) *Client {
	return &Client{
		apiClient:  ac,
		computerID: strings.TrimSpace(computerID),
	}
}

// API returns the underlying *api.Client.
func (c *Client) API() *api.Client {
	if c == nil {
		return nil
	}
	return c.apiClient
}

// SetComputerID selects the target Local Computer ID for subsequent requests.
func (c *Client) SetComputerID(id string) {
	if c == nil {
		return
	}
	trimmed := strings.TrimSpace(id)
	c.mu.Lock()
	if c.computerID != trimmed {
		c.computerID = trimmed
		c.useCompanionBridge = false
	}
	c.mu.Unlock()
}

// ComputerID returns the currently selected Local Computer ID.
func (c *Client) ComputerID() string {
	if c == nil {
		return ""
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.computerID
}

// WithComputer returns a lightweight Client sharing the same underlying *api.Client
// targeted at computerID.
func (c *Client) WithComputer(computerID string) *Client {
	if c == nil {
		return nil
	}
	return NewClientFromAPI(c.apiClient, computerID)
}

func (c *Client) basePrefix() (string, error) {
	if c == nil || c.apiClient == nil {
		return "", ErrNotConnected
	}
	c.mu.RLock()
	cid := c.computerID
	useBridge := c.useCompanionBridge
	c.mu.RUnlock()

	if useBridge && c.apiClient.Mode() == api.AuthModeCompanion {
		return companionHerdrBasePath, nil
	}
	if cid == "" {
		if c.apiClient.Mode() == api.AuthModeCompanion {
			return companionHerdrBasePath, nil
		}
		return "", ErrNotConnected
	}
	return "/api/v1/computers/" + url.PathEscape(cid) + "/herdr-core", nil
}

// doJSON sends a request to prefix+subPath and, in Companion Gateway mode, transparently
// falls back from /api/v1/computers/{id}/herdr-core to /companion/v1/herdr-core when the
// gateway does not expose /api/v1/* (HTTP 404).
func (c *Client) doJSON(ctx context.Context, method, subPath string, body, out any, terminalScoped bool) error {
	prefix, err := c.basePrefix()
	if err != nil {
		return err
	}
	err = c.apiClient.DoJSON(ctx, method, prefix+subPath, body, out)
	if err == nil {
		return nil
	}
	var apiErr *api.APIError
	if prefix != companionHerdrBasePath &&
		c.apiClient.Mode() == api.AuthModeCompanion &&
		errors.As(err, &apiErr) &&
		apiErr.StatusCode == http.StatusNotFound &&
		!strings.EqualFold(strings.TrimSpace(apiErr.Code), "TERMINAL_NOT_FOUND") {
		fallbackErr := c.apiClient.DoJSON(ctx, method, companionHerdrBasePath+subPath, body, out)
		if fallbackErr == nil {
			c.mu.Lock()
			c.useCompanionBridge = true
			c.mu.Unlock()
			return nil
		}
		var fbAPIErr *api.APIError
		if errors.As(fallbackErr, &fbAPIErr) && fbAPIErr.StatusCode != http.StatusNotFound {
			c.mu.Lock()
			c.useCompanionBridge = true
			c.mu.Unlock()
			return classifyError(fallbackErr, terminalScoped)
		}
	}
	return classifyError(err, terminalScoped)
}

// Status calls GET /api/v1/computers/{computerId}/herdr-core/status.
func (c *Client) Status(ctx context.Context) (CoreStatus, error) {
	var out CoreStatus
	if err := c.doJSON(ctx, http.MethodGet, "/status", nil, &out, false); err != nil {
		return CoreStatus{}, err
	}
	return out, nil
}

// ListTerminals calls GET /api/v1/computers/{computerId}/herdr-core/terminals.
func (c *Client) ListTerminals(ctx context.Context, opts ListTerminalsOptions) (ListTerminalsResult, error) {
	q := url.Values{}
	q.Set("all", strconv.FormatBool(opts.All))
	if m := strings.TrimSpace(opts.Machine); m != "" {
		q.Set("machine", m)
	}
	if r := strings.TrimSpace(opts.RoomID); r != "" {
		q.Set("room_id", r)
	}
	if wi := strings.TrimSpace(opts.WorkItemID); wi != "" {
		q.Set("work_item_id", wi)
	}
	if st := strings.TrimSpace(opts.Status); st != "" {
		q.Set("status", st)
	}
	var out ListTerminalsResult
	if err := c.doJSON(ctx, http.MethodGet, "/terminals?"+q.Encode(), nil, &out, false); err != nil {
		return ListTerminalsResult{}, err
	}
	return out, nil
}

// GetTerminal calls GET /api/v1/computers/{computerId}/herdr-core/terminal?address=<addr>.
func (c *Client) GetTerminal(ctx context.Context, address string) (Terminal, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return Terminal{}, errors.New("herdr: terminal address is required")
	}
	q := url.Values{}
	q.Set("address", address)
	var raw json.RawMessage
	if err := c.doJSON(ctx, http.MethodGet, "/terminal?"+q.Encode(), nil, &raw, true); err != nil {
		return Terminal{}, err
	}
	return decodeTerminalEnvelope(raw)
}

// Read calls GET /api/v1/computers/{computerId}/herdr-core/terminal/read?address=<addr>&lines=<n>.
func (c *Client) Read(ctx context.Context, address string, lines int) (ReadResult, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return ReadResult{}, errors.New("herdr: terminal address is required")
	}
	if lines <= 0 {
		lines = DefaultReadLines
	}
	q := url.Values{}
	q.Set("address", address)
	q.Set("lines", strconv.Itoa(lines))
	var out ReadResult
	if err := c.doJSON(ctx, http.MethodGet, "/terminal/read?"+q.Encode(), nil, &out, true); err != nil {
		return ReadResult{}, err
	}
	return out, nil
}

// Launch calls POST /api/v1/computers/{computerId}/herdr-core/terminals.
func (c *Client) Launch(ctx context.Context, req LaunchRequest) (Terminal, error) {
	var raw json.RawMessage
	if err := c.doJSON(ctx, http.MethodPost, "/terminals", req, &raw, false); err != nil {
		return Terminal{}, err
	}
	return decodeTerminalEnvelope(raw)
}

// Send calls POST /api/v1/computers/{computerId}/herdr-core/terminal/send.
func (c *Client) Send(ctx context.Context, req SendRequest) (SendResult, error) {
	req.Address = strings.TrimSpace(req.Address)
	if req.Address == "" {
		return SendResult{}, errors.New("herdr: terminal address is required")
	}
	var out SendResult
	if err := c.doJSON(ctx, http.MethodPost, "/terminal/send", req, &out, true); err != nil {
		return SendResult{}, err
	}
	return out, nil
}

// Keys calls POST /api/v1/computers/{computerId}/herdr-core/terminal/keys.
func (c *Client) Keys(ctx context.Context, req KeysRequest) (KeysResult, error) {
	req.Address = strings.TrimSpace(req.Address)
	if req.Address == "" || len(req.Keys) == 0 {
		return KeysResult{}, errors.New("herdr: terminal address and keys are required")
	}
	var out KeysResult
	if err := c.doJSON(ctx, http.MethodPost, "/terminal/keys", req, &out, true); err != nil {
		return KeysResult{}, err
	}
	return out, nil
}

// Interrupt calls POST /api/v1/computers/{computerId}/herdr-core/terminal/interrupt.
func (c *Client) Interrupt(ctx context.Context, req InterruptRequest) (InterruptResult, error) {
	req.Address = strings.TrimSpace(req.Address)
	if req.Address == "" {
		return InterruptResult{}, errors.New("herdr: terminal address is required")
	}
	var out InterruptResult
	if err := c.doJSON(ctx, http.MethodPost, "/terminal/interrupt", req, &out, true); err != nil {
		return InterruptResult{}, err
	}
	return out, nil
}

// Kill calls POST /api/v1/computers/{computerId}/herdr-core/terminal/kill.
func (c *Client) Kill(ctx context.Context, address string) (KillResult, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return KillResult{}, errors.New("herdr: terminal address is required")
	}
	var out KillResult
	if err := c.doJSON(ctx, http.MethodPost, "/terminal/kill", KillRequest{Address: address}, &out, true); err != nil {
		return KillResult{}, err
	}
	return out, nil
}

// Remove calls DELETE /api/v1/computers/{computerId}/herdr-core/terminal?address=<addr>.
func (c *Client) Remove(ctx context.Context, address string) (RemoveResult, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return RemoveResult{}, errors.New("herdr: terminal address is required")
	}
	q := url.Values{}
	q.Set("address", address)
	var out RemoveResult
	if err := c.doJSON(ctx, http.MethodDelete, "/terminal?"+q.Encode(), nil, &out, true); err != nil {
		return RemoveResult{}, err
	}
	if !out.OK && !out.Removed {
		out.OK = true
		out.Removed = true
		out.Address = address
	}
	return out, nil
}

// Templates calls GET /api/v1/computers/{computerId}/herdr-core/templates.
func (c *Client) Templates(ctx context.Context) ([]TemplateInfo, error) {
	var out struct {
		Templates []TemplateInfo `json:"templates"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/templates", nil, &out, false); err != nil {
		return nil, err
	}
	return out.Templates, nil
}

// Machines calls GET /api/v1/computers/{computerId}/herdr-core/machines.
func (c *Client) Machines(ctx context.Context) ([]MachineView, error) {
	var out struct {
		Machines []MachineView `json:"machines"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/machines", nil, &out, false); err != nil {
		return nil, err
	}
	return out.Machines, nil
}

// AttachURL constructs the ws:// or wss:// endpoint for live terminal streaming attach.
func (c *Client) AttachURL(address string, opts AttachOptions) (string, error) {
	prefix, err := c.basePrefix()
	if err != nil {
		return "", err
	}
	address = strings.TrimSpace(address)
	if address == "" {
		return "", errors.New("herdr: terminal address is required")
	}
	parsed, err := url.Parse(c.apiClient.BaseURL())
	if err != nil {
		return "", fmt.Errorf("herdr: parse base URL: %w", err)
	}
	switch strings.ToLower(parsed.Scheme) {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		if !c.apiClient.AllowPlainHTTP() {
			return "", api.ErrPlainHTTPDisallowed
		}
		parsed.Scheme = "ws"
	case "ws", "wss":
		// Keep explicit WebSocket scheme.
	default:
		return "", fmt.Errorf("herdr: unsupported scheme %q", parsed.Scheme)
	}
	q := url.Values{}
	q.Set("address", address)
	if opts.Cols > 0 {
		q.Set("cols", strconv.Itoa(opts.Cols))
	}
	if opts.Rows > 0 {
		q.Set("rows", strconv.Itoa(opts.Rows))
	}
	q.Set("observe", strconv.FormatBool(opts.Observe))
	parsed.Path = strings.TrimRight(parsed.Path, "/") + prefix + "/attach"
	parsed.RawQuery = q.Encode()
	return parsed.String(), nil
}

func decodeTerminalEnvelope(raw json.RawMessage) (Terminal, error) {
	if len(raw) == 0 {
		return Terminal{}, nil
	}
	var wrapped struct {
		Terminal *Terminal `json:"terminal"`
	}
	if err := json.Unmarshal(raw, &wrapped); err == nil && wrapped.Terminal != nil {
		return *wrapped.Terminal, nil
	}
	var flat Terminal
	if err := json.Unmarshal(raw, &flat); err != nil {
		return Terminal{}, fmt.Errorf("herdr: decode terminal: %w", err)
	}
	return flat, nil
}

// IsUnavailable reports whether err means herdr-core or the target computer is unavailable/offline.
func IsUnavailable(err error) bool {
	return errors.Is(err, ErrUnavailable) || errors.Is(err, ErrComputerOffline)
}

func classifyError(err error, terminalScoped bool) error {
	if err == nil {
		return nil
	}
	var apiErr *api.APIError
	if errors.As(err, &apiErr) {
		codeUpper := strings.ToUpper(strings.TrimSpace(apiErr.Code))
		ce := &ClientError{
			StatusCode: apiErr.StatusCode,
			Code:       apiErr.Code,
			Message:    apiErr.Message,
			RequestID:  apiErr.RequestID,
			Cause:      apiErr,
		}
		switch {
		case apiErr.IsUnauthenticated():
			ce.Sentinel = ErrUnauthorized
		case codeUpper == "COMPUTER_OFFLINE" || codeUpper == "LOCAL_COMPUTER_OFFLINE":
			ce.Sentinel = ErrComputerOffline
		case codeUpper == "STATUS_MISMATCH" || codeUpper == "PRECONDITION_FAILED" ||
			codeUpper == "TERMINAL_NOT_BLOCKED" || codeUpper == "PANE_NOT_BLOCKED" ||
			codeUpper == "TURN_MISMATCH" || codeUpper == "STALE_TURN" || codeUpper == "CONFLICT" ||
			apiErr.StatusCode == http.StatusConflict || apiErr.StatusCode == http.StatusPreconditionFailed:
			ce.Sentinel = ErrPreconditionFailed
		case terminalScoped && (codeUpper == "TERMINAL_NOT_FOUND" || codeUpper == "PANE_CLOSED" ||
			codeUpper == "FINISHED" || apiErr.StatusCode == http.StatusGone):
			ce.Sentinel = ErrTerminalNotFound
		case codeUpper == "HERDR_UNAVAILABLE" || codeUpper == "HERDR_CORE_UNAVAILABLE" ||
			codeUpper == "HERDR_NOT_RUNNING" ||
			codeUpper == "DEPENDENCY_UNAVAILABLE" || codeUpper == "FEATURE_DISABLED" ||
			apiErr.StatusCode == http.StatusNotFound || apiErr.StatusCode == http.StatusNotImplemented ||
			apiErr.StatusCode == http.StatusBadGateway || apiErr.StatusCode == http.StatusServiceUnavailable ||
			apiErr.StatusCode == http.StatusGatewayTimeout:
			if terminalScoped && apiErr.StatusCode == http.StatusNotFound && codeUpper == "NOT_FOUND" {
				ce.Sentinel = ErrTerminalNotFound
			} else {
				ce.Sentinel = ErrUnavailable
			}
		}
		return ce
	}
	if errors.Is(err, api.ErrUnauthorized) {
		return &ClientError{Sentinel: ErrUnauthorized, Message: err.Error(), Cause: err}
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return &ClientError{Sentinel: ErrUnavailable, Message: err.Error(), Cause: err}
	}
	return err
}
