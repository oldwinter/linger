package herdr

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
)

// AttachMode describes how an AttachClient is currently streaming a terminal.
type AttachMode string

const (
	AttachModeDisconnected AttachMode = "disconnected"
	AttachModeWebSocket    AttachMode = "websocket"
	AttachModePolling      AttachMode = "polling"
)

// AttachOptions configures a live terminal attach session.
type AttachOptions struct {
	Cols         int
	Rows         int
	Observe      bool
	PollInterval time.Duration
	ReadLines    int
}

// AttachOutput represents either a full screen snapshot (Replace=true) or an incremental chunk.
type AttachOutput struct {
	Data     []byte
	Text     string
	Replace  bool
	Complete bool
	How      string
	Why      string
}

// AttachCallbacks receives live output, status changes, transport mode changes, and errors.
type AttachCallbacks struct {
	OnOutput      func(out AttachOutput)
	OnStatus      func(status OSCStatus)
	OnModeChanged func(mode AttachMode)
	OnExit        func(exitCode *int, reason string)
	OnError       func(err error)
}

// ControlFrame represents a JSON control message sent over the live attach WebSocket.
type ControlFrame struct {
	Type    string   `json:"type"`
	Text    string   `json:"text,omitempty"`
	Keys    []string `json:"keys,omitempty"`
	Cols    int      `json:"cols,omitempty"`
	Rows    int      `json:"rows,omitempty"`
	Observe *bool    `json:"observe,omitempty"`
}

// AttachClient streams raw output and control frames over /herdr-core/attach,
// automatically falling back to periodic terminal/read polling when WS attach is unavailable.
type AttachClient struct {
	client  *Client
	address string
	opts    AttachOptions
	cb      AttachCallbacks

	mu         sync.Mutex
	mode       AttachMode
	ws         *wsConn
	cancel     context.CancelFunc
	done       chan struct{}
	pollWake   chan struct{}
	lastPolled string
	closed     bool
}

// NewAttachClient creates an AttachClient bound to client and terminal address.
func (c *Client) NewAttachClient(address string, opts AttachOptions, cb AttachCallbacks) *AttachClient {
	if opts.Cols <= 0 {
		opts.Cols = 80
	}
	if opts.Rows <= 0 {
		opts.Rows = 24
	}
	if opts.PollInterval <= 0 {
		opts.PollInterval = 1500 * time.Millisecond
	}
	if opts.ReadLines <= 0 {
		opts.ReadLines = DefaultReadLines
	}
	return &AttachClient{
		client:   c,
		address:  strings.TrimSpace(address),
		opts:     opts,
		cb:       cb,
		mode:     AttachModeDisconnected,
		pollWake: make(chan struct{}, 1),
	}
}

// Mode returns the active transport mode (websocket, polling, or disconnected).
func (a *AttachClient) Mode() AttachMode {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.mode
}

// Connect opens the WebSocket attach stream and starts reading in the background.
// When WebSocket attach is unavailable (HTTP 404/405/426/501/503 or upgrade failure),
// it automatically falls back to terminal/read polling and returns nil.
func (a *AttachClient) Connect(ctx context.Context) error {
	if a.client == nil || a.address == "" {
		return ErrNotConnected
	}

	wsURL, err := a.client.AttachURL(a.address, a.opts)
	if err != nil {
		return err
	}

	runCtx, cancel := context.WithCancel(context.Background())

	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		cancel()
		return errors.New("herdr: attach client already closed")
	}
	a.cancel = cancel
	a.done = make(chan struct{})
	a.mu.Unlock()

	ws, dialErr := dialWebSocket(ctx, wsURL, a.client.API())
	if dialErr == nil {
		a.mu.Lock()
		if a.closed {
			a.mu.Unlock()
			_ = ws.Close()
			close(a.done)
			return nil
		}
		a.ws = ws
		a.mode = AttachModeWebSocket
		a.mu.Unlock()
		a.emitMode(AttachModeWebSocket)
		go a.readWebSocketLoop(runCtx, ws)
		return nil
	}

	// Only hard-fail on explicit auth or plain-HTTP policy rejections; fall back to read polling otherwise.
	var upErr *wsUpgradeError
	if errors.As(dialErr, &upErr) && upErr.StatusCode == 401 {
		a.mu.Lock()
		a.cancel = nil
		close(a.done)
		a.mu.Unlock()
		cancel()
		return &ClientError{StatusCode: 401, Sentinel: ErrUnauthorized, Message: upErr.Error(), Cause: dialErr}
	}
	if errors.Is(dialErr, ErrUnauthorized) {
		a.mu.Lock()
		a.cancel = nil
		close(a.done)
		a.mu.Unlock()
		cancel()
		return dialErr
	}

	a.startPollingFallback(runCtx)
	return nil
}

// Send transmits a text input frame over WS, or delegates to HTTP terminal/send in polling mode.
func (a *AttachClient) Send(ctx context.Context, text string) error {
	a.mu.Lock()
	mode := a.mode
	ws := a.ws
	a.mu.Unlock()

	if mode == AttachModeWebSocket && ws != nil {
		return a.writeControl(ws, ControlFrame{Type: "send", Text: text})
	}
	_, err := a.client.Send(ctx, SendRequest{Address: a.address, Text: text})
	if err == nil {
		a.triggerPollNow()
	}
	return err
}

// Keys transmits named keystrokes over WS, or delegates to HTTP terminal/keys in polling mode.
func (a *AttachClient) Keys(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	a.mu.Lock()
	mode := a.mode
	ws := a.ws
	a.mu.Unlock()

	if mode == AttachModeWebSocket && ws != nil {
		return a.writeControl(ws, ControlFrame{Type: "keys", Keys: keys})
	}
	_, err := a.client.Keys(ctx, KeysRequest{Address: a.address, Keys: keys})
	if err == nil {
		a.triggerPollNow()
	}
	return err
}

// Resize sends a terminal dimension resize control frame over WS.
func (a *AttachClient) Resize(_ context.Context, cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return nil
	}
	a.mu.Lock()
	a.opts.Cols = cols
	a.opts.Rows = rows
	mode := a.mode
	ws := a.ws
	a.mu.Unlock()

	if mode == AttachModeWebSocket && ws != nil {
		return a.writeControl(ws, ControlFrame{Type: "resize", Cols: cols, Rows: rows})
	}
	return nil
}

// SetMode switches observe-only vs interactive attach mode via a control frame over WS.
func (a *AttachClient) SetMode(_ context.Context, observe bool) error {
	a.mu.Lock()
	a.opts.Observe = observe
	mode := a.mode
	ws := a.ws
	a.mu.Unlock()

	if mode == AttachModeWebSocket && ws != nil {
		obs := observe
		return a.writeControl(ws, ControlFrame{Type: "mode", Observe: &obs})
	}
	return nil
}

// Close shuts down the WebSocket connection or polling loop and waits for cleanup.
func (a *AttachClient) Close() error {
	a.mu.Lock()
	if a.closed {
		done := a.done
		a.mu.Unlock()
		if done != nil {
			<-done
		}
		return nil
	}
	a.closed = true
	cancel := a.cancel
	ws := a.ws
	a.ws = nil
	a.mode = AttachModeDisconnected
	done := a.done
	a.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if ws != nil {
		_ = ws.Close()
	}
	if done != nil {
		<-done
	}
	a.emitMode(AttachModeDisconnected)
	return nil
}

func (a *AttachClient) writeControl(ws *wsConn, frame ControlFrame) error {
	payload, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	return ws.WriteText(payload)
}

func (a *AttachClient) readWebSocketLoop(ctx context.Context, ws *wsConn) {
	defer func() {
		_ = ws.Close()
		a.mu.Lock()
		if a.ws == ws {
			a.ws = nil
		}
		closed := a.closed
		done := a.done
		a.mu.Unlock()
		if !closed && ctx.Err() == nil {
			// Seamless downgrade to polling if the live WebSocket drops mid-session.
			a.runPollingLoop(ctx)
		}
		if done != nil {
			close(done)
		}
	}()

	stopWatch := context.AfterFunc(ctx, func() {
		_ = ws.Close()
	})
	defer stopWatch()

	for {
		op, payload, err := ws.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			a.mu.Lock()
			closed := a.closed
			a.mu.Unlock()
			if !closed && a.cb.OnError != nil {
				a.cb.OnError(err)
			}
			return
		}
		if op == wsOpBinary {
			a.emitOutput(AttachOutput{
				Data: append([]byte(nil), payload...),
				Text: string(payload),
			})
			continue
		}
		a.handleTextFrame(payload)
	}
}

func (a *AttachClient) handleTextFrame(payload []byte) {
	var env struct {
		Type     string     `json:"type"`
		Data     string     `json:"data"`
		Text     string     `json:"text"`
		Encoding string     `json:"encoding"`
		Complete *bool      `json:"complete"`
		How      string     `json:"how"`
		Why      string     `json:"why"`
		Status   *OSCStatus `json:"status"`
		ExitCode *int       `json:"exit_code"`
		Reason   string     `json:"reason"`
		Code     string     `json:"code"`
		Message  string     `json:"message"`
	}
	if err := json.Unmarshal(payload, &env); err != nil || env.Type == "" {
		a.emitOutput(AttachOutput{
			Data: append([]byte(nil), payload...),
			Text: string(payload),
		})
		return
	}

	switch strings.ToLower(strings.TrimSpace(env.Type)) {
	case "output", "data", "screen", "snapshot":
		rawStr := env.Data
		if rawStr == "" {
			rawStr = env.Text
		}
		dataBytes := []byte(rawStr)
		if strings.EqualFold(env.Encoding, "base64") && rawStr != "" {
			if decoded, err := base64.StdEncoding.DecodeString(rawStr); err == nil {
				dataBytes = decoded
			}
		}
		replace := env.Type == "screen" || env.Type == "snapshot"
		complete := true
		if env.Complete != nil {
			complete = *env.Complete
		}
		a.emitOutput(AttachOutput{
			Data:     dataBytes,
			Text:     string(dataBytes),
			Replace:  replace,
			Complete: complete,
			How:      env.How,
			Why:      env.Why,
		})
	case "status":
		if env.Status != nil && a.cb.OnStatus != nil {
			a.cb.OnStatus(*env.Status)
		}
	case "exit", "closed":
		if a.cb.OnExit != nil {
			a.cb.OnExit(env.ExitCode, env.Reason)
		}
	case "error":
		if a.cb.OnError != nil {
			a.cb.OnError(&ClientError{
				Code:    env.Code,
				Message: env.Message,
			})
		}
	}
}

func (a *AttachClient) startPollingFallback(ctx context.Context) {
	go func() {
		defer func() {
			a.mu.Lock()
			done := a.done
			a.mu.Unlock()
			if done != nil {
				close(done)
			}
		}()
		a.runPollingLoop(ctx)
	}()
}

func (a *AttachClient) runPollingLoop(ctx context.Context) {
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		return
	}
	a.mode = AttachModePolling
	interval := a.opts.PollInterval
	readLines := a.opts.ReadLines
	a.mu.Unlock()
	a.emitMode(AttachModePolling)

	pollOnce := func() {
		reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		res, err := a.client.Read(reqCtx, a.address, readLines)
		cancel()
		if err != nil {
			if ctx.Err() == nil && a.cb.OnError != nil {
				a.cb.OnError(err)
			}
			return
		}
		a.mu.Lock()
		changed := res.Text != a.lastPolled || a.lastPolled == ""
		a.lastPolled = res.Text
		a.mu.Unlock()
		if changed {
			a.emitOutput(AttachOutput{
				Data:     []byte(res.Text),
				Text:     res.Text,
				Replace:  true,
				Complete: res.Complete,
				How:      res.How,
				Why:      res.Why,
			})
		}
	}

	pollOnce()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pollOnce()
		case <-a.pollWake:
			pollOnce()
		}
	}
}

func (a *AttachClient) triggerPollNow() {
	select {
	case a.pollWake <- struct{}{}:
	default:
	}
}

func (a *AttachClient) emitOutput(out AttachOutput) {
	if a.cb.OnOutput != nil {
		a.cb.OnOutput(out)
	}
}

func (a *AttachClient) emitMode(mode AttachMode) {
	if a.cb.OnModeChanged != nil {
		a.cb.OnModeChanged(mode)
	}
}
