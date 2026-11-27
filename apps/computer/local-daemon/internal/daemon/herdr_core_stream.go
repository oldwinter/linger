package daemon

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/herdrcore"
)

const (
	herdrCoreStreamMaxSessions     = 64
	herdrCoreStreamMaxFrameBytes   = 2 * 1024 * 1024
	herdrCoreStreamWriteTimeout    = 15 * time.Second
	herdrCoreStreamControlTimeout  = 15 * time.Second
	herdrCoreStreamMaxHistoryLines = 10000
	herdrCoreStreamMaxPutBase64Len = 1_500_000
)

type herdrCoreAttachRequest struct {
	SessionID           string `json:"session_id"`
	StreamPath          string `json:"stream_path"`
	Address             string `json:"address"`
	Cols                int    `json:"cols"`
	Rows                int    `json:"rows"`
	Observe             bool   `json:"observe"`
	History             int    `json:"history"`
	Resumed             bool   `json:"resumed"`
	ResizeNotifications *bool  `json:"resize_notifications"`
}

type herdrCoreAttachBridge struct {
	daemon              *Daemon
	sessionID           string
	connectionEpoch     uint64
	address             string
	resizeNotifications bool
	ws                  *websocket.Conn
	ctx                 context.Context
	cancel              context.CancelFunc

	wsWriteMu  sync.Mutex
	mu         sync.Mutex
	attach     *herdrcore.AttachSession
	observe    bool
	cols       uint16
	rows       uint16
	closed     bool
	closedOnce sync.Once
}

func (d *Daemon) attachHerdrCoreStream(connectionCtx, callCtx context.Context, connectionEpoch uint64, arguments json.RawMessage) map[string]any {
	var req herdrCoreAttachRequest
	if !decodes(arguments, &req) {
		return map[string]any{"status": "invalid_arguments", "detail": "Invalid attach arguments"}
	}
	req.SessionID = strings.TrimSpace(req.SessionID)
	req.StreamPath = strings.TrimSpace(req.StreamPath)
	req.Address = strings.TrimSpace(req.Address)
	if req.SessionID == "" || req.Address == "" {
		return map[string]any{"status": "invalid_arguments", "detail": "session_id and address are required"}
	}
	if !validHerdrCoreStreamPath(req.StreamPath) {
		return map[string]any{"status": "invalid_arguments", "detail": "stream_path must be a relative path"}
	}
	if req.Cols < 1 || req.Cols > herdrCoreMaxCols || req.Rows < 1 || req.Rows > herdrCoreMaxRows {
		return map[string]any{"status": "invalid_arguments", "detail": fmt.Sprintf("cols must be 1..%d and rows 1..%d", herdrCoreMaxCols, herdrCoreMaxRows)}
	}
	if req.History < 0 || req.History > herdrCoreStreamMaxHistoryLines {
		return map[string]any{"status": "invalid_arguments", "detail": "history out of range"}
	}
	streamURL, err := buildHerdrCoreStreamURL(d.herdrCoreStreamTarget.URL, req.StreamPath, req.SessionID, connectionEpoch)
	if err != nil {
		return map[string]any{"status": "unavailable", "detail": err.Error()}
	}
	if d.herdrCoreStreamTarget.BearerToken == "" {
		return map[string]any{"status": "unavailable", "detail": "Runner Gateway bearer token is unavailable"}
	}

	d.herdrCoreStreamsMu.Lock()
	if len(d.herdrCoreStreams) >= herdrCoreStreamMaxSessions {
		d.herdrCoreStreamsMu.Unlock()
		return map[string]any{"status": "busy", "detail": "Maximum concurrent herdr-core attach sessions reached"}
	}
	if _, exists := d.herdrCoreStreams[req.SessionID]; exists {
		d.herdrCoreStreamsMu.Unlock()
		return map[string]any{"status": "conflict", "detail": "Attach session_id is already active"}
	}
	d.herdrCoreStreamsMu.Unlock()

	resizeNotifications := true
	if req.ResizeNotifications != nil {
		resizeNotifications = *req.ResizeNotifications
	}
	attachParams := herdrcore.TerminalAttachParams{
		Terminal:            req.Address,
		Cols:                uint16(req.Cols),
		Rows:                uint16(req.Rows),
		Observe:             req.Observe,
		History:             uint(req.History),
		Resumed:             req.Resumed,
		ResizeNotifications: resizeNotifications,
	}
	attachSession, err := d.herdrCore.AttachWithOptions(callCtx, attachParams, herdrcore.AttachOptions{
		ManualCredit: true,
	})
	if err != nil {
		return herdrCoreErrorResult(err, false)
	}

	dialer := d.herdrCoreStreamTarget.Dialer
	if dialer == nil {
		dialer = websocket.DefaultDialer
	}
	header := http.Header{}
	header.Set("Authorization", "Bearer "+d.herdrCoreStreamTarget.BearerToken)
	wsConn, resp, err := dialer.DialContext(callCtx, streamURL, header)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		_ = attachSession.Close()
		return map[string]any{"status": "error", "detail": fmt.Sprintf("Failed to open PTY stream WebSocket: %v", err)}
	}
	wsConn.SetReadLimit(herdrCoreStreamMaxFrameBytes)

	effectiveCols := uint16(req.Cols)
	effectiveRows := uint16(req.Rows)
	if attachSession.Result.Terminal.Cols > 0 {
		effectiveCols = attachSession.Result.Terminal.Cols
	}
	if attachSession.Result.Terminal.Rows > 0 {
		effectiveRows = attachSession.Result.Terminal.Rows
	}

	sessionCtx, sessionCancel := context.WithCancel(connectionCtx)
	bridge := &herdrCoreAttachBridge{
		daemon:              d,
		sessionID:           req.SessionID,
		connectionEpoch:     connectionEpoch,
		address:             req.Address,
		resizeNotifications: resizeNotifications,
		ws:                  wsConn,
		ctx:                 sessionCtx,
		cancel:              sessionCancel,
		attach:              attachSession,
		observe:             req.Observe,
		cols:                effectiveCols,
		rows:                effectiveRows,
	}

	d.admissionMu.Lock()
	draining := d.draining
	d.admissionMu.Unlock()
	if draining || connectionCtx.Err() != nil {
		sessionCancel()
		_ = wsConn.Close()
		_ = attachSession.Close()
		return map[string]any{"status": "unavailable", "detail": "Local Computer Daemon is draining or disconnected"}
	}

	d.herdrCoreStreamsMu.Lock()
	if d.herdrCoreStreams == nil {
		d.herdrCoreStreams = make(map[string]*herdrCoreAttachBridge)
	}
	if len(d.herdrCoreStreams) >= herdrCoreStreamMaxSessions {
		d.herdrCoreStreamsMu.Unlock()
		sessionCancel()
		_ = wsConn.Close()
		_ = attachSession.Close()
		return map[string]any{"status": "busy", "detail": "Maximum concurrent herdr-core attach sessions reached"}
	}
	if _, exists := d.herdrCoreStreams[req.SessionID]; exists {
		d.herdrCoreStreamsMu.Unlock()
		sessionCancel()
		_ = wsConn.Close()
		_ = attachSession.Close()
		return map[string]any{"status": "conflict", "detail": "Attach session_id is already active"}
	}
	d.herdrCoreStreams[req.SessionID] = bridge
	d.herdrCoreStreamsWG.Add(1)
	d.herdrCoreStreamsMu.Unlock()

	if err := bridge.writeJSON(map[string]any{
		"type":                 "attached",
		"address":              req.Address,
		"terminal":             serializeHerdrCoreTerminal(attachSession.Result.Terminal),
		"cols":                 effectiveCols,
		"rows":                 effectiveRows,
		"observe":              req.Observe,
		"resumed":              req.Resumed,
		"resize_notifications": attachSession.Result.ResizeNotifications,
		"automatic_input":      attachSession.Result.AutomaticInput,
	}); err != nil {
		bridge.teardown("ws_write_failed")
		d.unregisterHerdrCoreStream(req.SessionID, bridge)
		d.herdrCoreStreamsWG.Done()
		return map[string]any{"status": "error", "detail": fmt.Sprintf("Failed to send attached frame: %v", err)}
	}
	if attachSession.Result.Terminal.Status != nil {
		_ = bridge.writeJSON(map[string]any{
			"type":   "status",
			"status": serializeHerdrCoreStatus(attachSession.Result.Terminal.Status),
		})
	}

	go bridge.run()
	return map[string]any{"status": "accepted", "session_id": req.SessionID}
}

func (d *Daemon) unregisterHerdrCoreStream(sessionID string, bridge *herdrCoreAttachBridge) {
	d.herdrCoreStreamsMu.Lock()
	if d.herdrCoreStreams[sessionID] == bridge {
		delete(d.herdrCoreStreams, sessionID)
	}
	d.herdrCoreStreamsMu.Unlock()
}

// closeHerdrCoreStreams closes all active binary PTY attach bridges (for
// example on disconnect, connection epoch change, or daemon drain).
func (d *Daemon) closeHerdrCoreStreams(reason string) {
	d.herdrCoreStreamsMu.Lock()
	bridges := make([]*herdrCoreAttachBridge, 0, len(d.herdrCoreStreams))
	for _, bridge := range d.herdrCoreStreams {
		bridges = append(bridges, bridge)
	}
	d.herdrCoreStreamsMu.Unlock()
	for _, bridge := range bridges {
		bridge.closeWithReason(reason)
	}
}

// ActiveHerdrCoreStreamCount reports how many outbound binary PTY attach
// tunnels are currently live on this Daemon.
func (d *Daemon) ActiveHerdrCoreStreamCount() int {
	d.herdrCoreStreamsMu.Lock()
	defer d.herdrCoreStreamsMu.Unlock()
	return len(d.herdrCoreStreams)
}

func (b *herdrCoreAttachBridge) run() {
	defer b.daemon.herdrCoreStreamsWG.Done()
	defer b.daemon.unregisterHerdrCoreStream(b.sessionID, b)
	defer b.teardown("stream_ended")

	stopWatch := context.AfterFunc(b.ctx, func() {
		b.closeUnderlying()
	})
	defer stopWatch()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		defer b.cancel()
		b.pumpPTYToWS()
	}()
	go func() {
		defer wg.Done()
		defer b.cancel()
		b.pumpWSToPTY()
	}()
	wg.Wait()
}

func (b *herdrCoreAttachBridge) pumpPTYToWS() {
	for {
		sess := b.currentAttach()
		if sess == nil {
			return
		}
		ev, err := sess.NextEvent(b.ctx)
		if err != nil {
			if b.ctx.Err() != nil {
				return
			}
			if b.isReplaced(sess) {
				continue
			}
			reason := "pty_closed"
			if !errors.Is(err, io.EOF) {
				reason = "pty_error"
			}
			b.sendClosed(reason)
			return
		}
		switch ev.Kind {
		case herdrcore.FrameData:
			if len(ev.Data) == 0 {
				continue
			}
			if err := b.writeBinary(ev.Data); err != nil {
				return
			}
			// ManualCredit: replenish upstream credit only after the WS frame
			// has been flushed, preserving bounded memory under backpressure.
			if err := sess.SendCredit(uint32(len(ev.Data))); err != nil && !b.isReplaced(sess) {
				return
			}
		case herdrcore.FrameResize:
			b.mu.Lock()
			b.cols = ev.Cols
			b.rows = ev.Rows
			b.mu.Unlock()
			if b.resizeNotifications {
				if err := b.writeJSON(map[string]any{
					"type": "resize",
					"cols": ev.Cols,
					"rows": ev.Rows,
				}); err != nil {
					return
				}
			}
		case herdrcore.FrameFacts:
			b.handleFactsFrame(ev.Data)
		}
	}
}

func (b *herdrCoreAttachBridge) pumpWSToPTY() {
	for {
		msgType, payload, err := b.ws.ReadMessage()
		if err != nil {
			return
		}
		switch msgType {
		case websocket.BinaryMessage:
			sess, observe := b.currentAttachAndObserve()
			if observe {
				_ = b.writeJSON(map[string]any{
					"type":    "error",
					"code":    "OBSERVE_ONLY",
					"message": "Attach session is in observe-only mode",
				})
				continue
			}
			if sess == nil || len(payload) == 0 {
				continue
			}
			if _, err := sess.Write(payload); err != nil && !b.isReplaced(sess) {
				b.sendClosed("pty_write_error")
				return
			}
		case websocket.TextMessage:
			b.handleClientControl(payload)
		}
	}
}

func (b *herdrCoreAttachBridge) handleClientControl(payload []byte) {
	var header struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(payload, &header) != nil || header.Type == "" {
		_ = b.writeJSON(map[string]any{
			"type":    "error",
			"code":    "INVALID_CONTROL_FRAME",
			"message": "Control frame must be valid JSON with a string type",
		})
		return
	}
	switch header.Type {
	case "ping":
		_ = b.writeJSON(map[string]any{"type": "pong"})
	case "resize":
		var msg struct {
			Cols int `json:"cols"`
			Rows int `json:"rows"`
		}
		if json.Unmarshal(payload, &msg) != nil || msg.Cols < 1 || msg.Cols > herdrCoreMaxCols || msg.Rows < 1 || msg.Rows > herdrCoreMaxRows {
			_ = b.writeJSON(map[string]any{
				"type":    "error",
				"code":    "INVALID_CONTROL_FRAME",
				"message": fmt.Sprintf("resize requires integer cols (1..%d) and rows (1..%d)", herdrCoreMaxCols, herdrCoreMaxRows),
			})
			return
		}
		sess, observe := b.currentAttachAndObserve()
		if observe {
			_ = b.writeJSON(map[string]any{
				"type":    "error",
				"code":    "OBSERVE_ONLY",
				"message": "Cannot resize terminal while observe=true",
			})
			return
		}
		if sess == nil {
			return
		}
		cols := uint16(msg.Cols)
		rows := uint16(msg.Rows)
		if err := sess.Resize(cols, rows); err != nil {
			_ = b.writeJSON(map[string]any{
				"type":    "error",
				"code":    "RESIZE_FAILED",
				"message": err.Error(),
			})
			return
		}
		b.mu.Lock()
		b.cols = cols
		b.rows = rows
		b.mu.Unlock()
	case "focus":
		var msg struct {
			Focused bool `json:"focused"`
		}
		if json.Unmarshal(payload, &msg) != nil {
			return
		}
		sess, observe := b.currentAttachAndObserve()
		if !observe && sess != nil {
			_ = sess.SetFocus(msg.Focused)
		}
	case "mode":
		var msg struct {
			Observe *bool `json:"observe"`
			Cols    int   `json:"cols"`
			Rows    int   `json:"rows"`
		}
		if json.Unmarshal(payload, &msg) != nil || msg.Observe == nil {
			_ = b.writeJSON(map[string]any{
				"type":    "error",
				"code":    "INVALID_CONTROL_FRAME",
				"message": "mode requires boolean observe",
			})
			return
		}
		b.switchMode(*msg.Observe, msg.Cols, msg.Rows)
	case "put":
		var msg struct {
			Name       string `json:"name"`
			DataBase64 string `json:"data_base64"`
		}
		if json.Unmarshal(payload, &msg) != nil {
			_ = b.writeJSON(map[string]any{
				"type":  "put_result",
				"ok":    false,
				"error": "invalid put control frame",
			})
			return
		}
		_, observe := b.currentAttachAndObserve()
		if observe {
			_ = b.writeJSON(map[string]any{
				"type":    "error",
				"code":    "OBSERVE_ONLY",
				"message": "Cannot upload files while observe=true",
			})
			return
		}
		b.handlePutControl(msg.Name, msg.DataBase64)
	default:
		_ = b.writeJSON(map[string]any{
			"type":    "error",
			"code":    "INVALID_CONTROL_FRAME",
			"message": "Unsupported control frame type: " + header.Type,
		})
	}
}

func (b *herdrCoreAttachBridge) switchMode(nextObserve bool, reqCols, reqRows int) {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return
	}
	currentObserve := b.observe
	cols := b.cols
	rows := b.rows
	if reqCols >= 1 && reqCols <= herdrCoreMaxCols && reqRows >= 1 && reqRows <= herdrCoreMaxRows {
		cols = uint16(reqCols)
		rows = uint16(reqRows)
	}
	b.mu.Unlock()

	if currentObserve == nextObserve {
		_ = b.writeJSON(map[string]any{
			"type":                 "attached",
			"address":              b.address,
			"cols":                 cols,
			"rows":                 rows,
			"observe":              nextObserve,
			"resumed":              true,
			"resize_notifications": b.resizeNotifications,
		})
		return
	}

	reattachCtx, cancel := context.WithTimeout(b.ctx, herdrCoreStreamControlTimeout)
	defer cancel()
	newSess, err := b.daemon.herdrCore.AttachWithOptions(reattachCtx, herdrcore.TerminalAttachParams{
		Terminal:            b.address,
		Cols:                cols,
		Rows:                rows,
		Observe:             nextObserve,
		History:             0,
		Resumed:             true,
		ResizeNotifications: b.resizeNotifications,
	}, herdrcore.AttachOptions{
		ManualCredit: true,
	})
	if err != nil {
		_ = b.writeJSON(map[string]any{
			"type":    "error",
			"code":    "MODE_SWITCH_FAILED",
			"message": err.Error(),
		})
		return
	}

	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		_ = newSess.Close()
		return
	}
	oldSess := b.attach
	b.attach = newSess
	b.observe = nextObserve
	if newSess.Result.Terminal.Cols > 0 {
		b.cols = newSess.Result.Terminal.Cols
	} else {
		b.cols = cols
	}
	if newSess.Result.Terminal.Rows > 0 {
		b.rows = newSess.Result.Terminal.Rows
	} else {
		b.rows = rows
	}
	effectiveCols := b.cols
	effectiveRows := b.rows
	b.mu.Unlock()

	if oldSess != nil {
		_ = oldSess.Close()
	}
	_ = b.writeJSON(map[string]any{
		"type":                 "attached",
		"address":              b.address,
		"terminal":             serializeHerdrCoreTerminal(newSess.Result.Terminal),
		"cols":                 effectiveCols,
		"rows":                 effectiveRows,
		"observe":              nextObserve,
		"resumed":              true,
		"resize_notifications": newSess.Result.ResizeNotifications,
		"automatic_input":      newSess.Result.AutomaticInput,
	})
}

func (b *herdrCoreAttachBridge) handlePutControl(name, dataBase64 string) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 256 || len(dataBase64) > herdrCoreStreamMaxPutBase64Len {
		_ = b.writeJSON(map[string]any{
			"type":  "put_result",
			"ok":    false,
			"error": "put requires a valid name and bounded data_base64",
		})
		return
	}
	raw, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil || len(raw) > herdrCoreMaxPutBytes {
		_ = b.writeJSON(map[string]any{
			"type":  "put_result",
			"ok":    false,
			"error": "put payload must be valid base64 within 8 MiB",
		})
		return
	}
	putCtx, cancel := context.WithTimeout(b.ctx, herdrCoreStreamControlTimeout)
	defer cancel()
	res, err := b.daemon.herdrCore.TerminalPut(putCtx, herdrcore.TerminalPutParams{
		Terminal: b.address,
		Name:     name,
		Data:     dataBase64,
	})
	if err != nil {
		_ = b.writeJSON(map[string]any{
			"type":  "put_result",
			"ok":    false,
			"error": err.Error(),
		})
		return
	}
	_ = b.writeJSON(map[string]any{
		"type":  "put_result",
		"ok":    true,
		"name":  name,
		"path":  res.Path,
		"bytes": res.Bytes,
	})
}

func (b *herdrCoreAttachBridge) handleFactsFrame(data []byte) {
	if len(data) == 0 {
		return
	}
	var facts struct {
		Status *herdrcore.Status `json:"status"`
		Title  string            `json:"title"`
		Turn   *uint64           `json:"turn"`
	}
	if json.Unmarshal(data, &facts) != nil {
		return
	}
	if facts.Status == nil && facts.Title == "" && facts.Turn == nil {
		return
	}
	payload := map[string]any{"type": "status"}
	if facts.Status != nil {
		payload["status"] = serializeHerdrCoreStatus(facts.Status)
	}
	if facts.Title != "" {
		payload["title"] = facts.Title
	}
	if facts.Turn != nil {
		payload["turn"] = *facts.Turn
	}
	if err := b.writeJSON(payload); err != nil {
		slog.Debug("herdrcore.stream.status_send_failed", "session_id", b.sessionID, "error", err)
	}
}

func (b *herdrCoreAttachBridge) currentAttach() *herdrcore.AttachSession {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil
	}
	return b.attach
}

func (b *herdrCoreAttachBridge) currentAttachAndObserve() (*herdrcore.AttachSession, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil, b.observe
	}
	return b.attach, b.observe
}

func (b *herdrCoreAttachBridge) isReplaced(sess *herdrcore.AttachSession) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return !b.closed && b.attach != nil && b.attach != sess
}

func (b *herdrCoreAttachBridge) writeBinary(data []byte) error {
	b.wsWriteMu.Lock()
	defer b.wsWriteMu.Unlock()
	if err := b.ws.SetWriteDeadline(time.Now().Add(herdrCoreStreamWriteTimeout)); err != nil {
		return err
	}
	return b.ws.WriteMessage(websocket.BinaryMessage, data)
}

func (b *herdrCoreAttachBridge) writeJSON(value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	b.wsWriteMu.Lock()
	defer b.wsWriteMu.Unlock()
	if err := b.ws.SetWriteDeadline(time.Now().Add(herdrCoreStreamWriteTimeout)); err != nil {
		return err
	}
	return b.ws.WriteMessage(websocket.TextMessage, encoded)
}

func (b *herdrCoreAttachBridge) sendClosed(reason string) {
	b.closedOnce.Do(func() {
		_ = b.writeJSON(map[string]any{"type": "closed", "reason": reason})
	})
}

func (b *herdrCoreAttachBridge) closeWithReason(reason string) {
	b.sendClosed(reason)
	b.teardown(reason)
}

func (b *herdrCoreAttachBridge) teardown(reason string) {
	b.mu.Lock()
	alreadyClosed := b.closed
	b.closed = true
	sess := b.attach
	b.attach = nil
	b.mu.Unlock()
	b.cancel()
	if sess != nil {
		_ = sess.Close()
	}
	if !alreadyClosed {
		b.wsWriteMu.Lock()
		_ = b.ws.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, clipRunes(reason, 120)),
			time.Now().Add(2*time.Second),
		)
		b.wsWriteMu.Unlock()
		_ = b.ws.Close()
	}
}

func (b *herdrCoreAttachBridge) closeUnderlying() {
	b.mu.Lock()
	b.closed = true
	sess := b.attach
	b.attach = nil
	b.mu.Unlock()
	if sess != nil {
		_ = sess.Close()
	}
	_ = b.ws.Close()
}

func validHerdrCoreStreamPath(streamPath string) bool {
	if !strings.HasPrefix(streamPath, "/") || strings.HasPrefix(streamPath, "//") {
		return false
	}
	if strings.ContainsAny(streamPath, "?#\r\n\\") {
		return false
	}
	return path.Clean(streamPath) == streamPath
}

func buildHerdrCoreStreamURL(gatewayURL, streamPath, sessionID string, connectionEpoch uint64) (string, error) {
	if gatewayURL == "" {
		return "", errors.New("Runner Gateway URL is unavailable")
	}
	parsed, err := url.Parse(gatewayURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "ws" && parsed.Scheme != "wss") {
		return "", errors.New("Runner Gateway URL is invalid")
	}
	target := &url.URL{
		Scheme: parsed.Scheme,
		Host:   parsed.Host,
		Path:   streamPath,
	}
	query := url.Values{}
	query.Set("session_id", sessionID)
	if connectionEpoch > 0 {
		query.Set("connection_epoch", strconv.FormatUint(connectionEpoch, 10))
	}
	target.RawQuery = query.Encode()
	return target.String(), nil
}
