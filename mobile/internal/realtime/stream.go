package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
)

const (
	// MaxRoomCursors matches TeamHub's maxEventStreamRoomCursors limit (50).
	MaxRoomCursors = 50
	// DefaultBaseBackoff is the initial SSE reconnect delay.
	DefaultBaseBackoff = 1 * time.Second
	// DefaultMaxBackoff caps exponential SSE reconnect backoff.
	DefaultMaxBackoff = 30 * time.Second
)

// StreamState describes the current lifecycle state of the SSE engine.
type StreamState string

const (
	StateDisconnected StreamState = "disconnected"
	StateConnecting   StreamState = "connecting"
	StateConnected    StreamState = "connected"
	StatePaused       StreamState = "paused"
	StateReconnecting StreamState = "reconnecting"
	StateExpired      StreamState = "expired"
)

// ResourceInvalidation is delivered on `event: resource.invalidated`.
type ResourceInvalidation struct {
	TenantID string `json:"tenant_id"`
	Resource string `json:"resource"`
	ID       string `json:"id"`
	RoomSeq  int64  `json:"room_seq,omitempty"`
}

// StreamCallbacks receives parsed SSE events and lifecycle transitions.
type StreamCallbacks struct {
	OnState          func(state StreamState, err error)
	OnRoomEvent      func(ev api.RoomEventEnvelope)
	OnInvalidated    func(inv ResourceInvalidation)
	OnResync         func(reason string)
	OnSessionExpired func(code, message string)
	OnHeartbeat      func(at time.Time)
}

// StreamManager maintains a single /v0/events SSE connection with room cursors,
// contiguous room_seq gap backfill, jittered exponential backoff, and pause/resume.
type StreamManager struct {
	client      *api.Client
	callbacks   StreamCallbacks
	baseBackoff time.Duration
	maxBackoff  time.Duration

	mu          sync.Mutex
	cursors     map[string]int64
	cursorOrder []string
	online      bool
	suspended   bool
	state       StreamState
	lastHB      time.Time
	streamDrop  context.CancelFunc
	wakeCh      chan struct{}
}

// StreamOptions configures optional backoff parameters for StreamManager.
type StreamOptions struct {
	BaseBackoff time.Duration
	MaxBackoff  time.Duration
}

// NewStreamManager constructs a StreamManager bound to client.
func NewStreamManager(client *api.Client, cb StreamCallbacks, opts StreamOptions) *StreamManager {
	base := opts.BaseBackoff
	if base <= 0 {
		base = DefaultBaseBackoff
	}
	maxB := opts.MaxBackoff
	if maxB <= 0 {
		maxB = DefaultMaxBackoff
	}
	return &StreamManager{
		client:      client,
		callbacks:   cb,
		baseBackoff: base,
		maxBackoff:  maxB,
		cursors:     map[string]int64{},
		online:      true,
		state:       StateDisconnected,
		wakeCh:      make(chan struct{}, 1),
	}
}

// State returns the current stream state.
func (m *StreamManager) State() StreamState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// LastHeartbeat returns the timestamp of the last SSE heartbeat or event frame.
func (m *StreamManager) LastHeartbeat() time.Time {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastHB
}

// SetRoomCursor tracks a room's committed room_seq cursor (capped at 50 rooms).
func (m *StreamManager) SetRoomCursor(roomID string, seq int64) {
	if roomID == "" || seq < 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if cur, exists := m.cursors[roomID]; exists {
		if seq > cur {
			m.cursors[roomID] = seq
		}
		return
	}
	if len(m.cursorOrder) >= MaxRoomCursors {
		oldest := m.cursorOrder[0]
		m.cursorOrder = m.cursorOrder[1:]
		delete(m.cursors, oldest)
	}
	m.cursors[roomID] = seq
	m.cursorOrder = append(m.cursorOrder, roomID)
}

// RemoveRoomCursor stops tracking a room cursor.
func (m *StreamManager) RemoveRoomCursor(roomID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.cursors, roomID)
	next := m.cursorOrder[:0]
	for _, id := range m.cursorOrder {
		if id != roomID {
			next = append(next, id)
		}
	}
	m.cursorOrder = next
}

// Cursors returns a snapshot copy of tracked room cursors.
func (m *StreamManager) Cursors() map[string]int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]int64, len(m.cursors))
	for k, v := range m.cursors {
		out[k] = v
	}
	return out
}

// SetOnline pauses the SSE stream when offline and immediately reconnects when back online.
func (m *StreamManager) SetOnline(online bool) {
	m.mu.Lock()
	if m.online == online {
		m.mu.Unlock()
		return
	}
	m.online = online
	drop := m.streamDrop
	m.mu.Unlock()
	if !online && drop != nil {
		drop()
	}
	m.signalWake()
}

// SetSuspended pauses the SSE stream on OS sleep/background and reconnects on resume.
func (m *StreamManager) SetSuspended(suspended bool) {
	m.mu.Lock()
	if m.suspended == suspended {
		m.mu.Unlock()
		return
	}
	m.suspended = suspended
	drop := m.streamDrop
	m.mu.Unlock()
	if suspended && drop != nil {
		drop()
	}
	m.signalWake()
}

// TriggerReconnect drops any active stream so the loop reconnects immediately
// (for example after subscribing to a newly opened Room cursor).
func (m *StreamManager) TriggerReconnect() {
	m.mu.Lock()
	drop := m.streamDrop
	m.mu.Unlock()
	if drop != nil {
		drop()
	}
	m.signalWake()
}

func (m *StreamManager) signalWake() {
	select {
	case m.wakeCh <- struct{}{}:
	default:
	}
}

func (m *StreamManager) isPaused() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return !m.online || m.suspended
}

func (m *StreamManager) setState(st StreamState, err error) {
	m.mu.Lock()
	m.state = st
	cb := m.callbacks.OnState
	m.mu.Unlock()
	if cb != nil {
		cb(st, err)
	}
}

// BuildStreamPath returns /v0/events?room=<id>:<seq>... with deterministic ordering.
func (m *StreamManager) BuildStreamPath() string {
	cursors := m.Cursors()
	if len(cursors) == 0 {
		return "/v0/events"
	}
	ids := make([]string, 0, len(cursors))
	for id := range cursors {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	q := url.Values{}
	for _, id := range ids {
		q.Add("room", id+":"+strconv.FormatInt(cursors[id], 10))
	}
	return "/v0/events?" + q.Encode()
}

// Run drives the SSE stream lifecycle until ctx is canceled or SESSION_EXPIRED occurs.
func (m *StreamManager) Run(ctx context.Context) error {
	attempt := 0
	for {
		if ctx.Err() != nil {
			m.setState(StateDisconnected, nil)
			return ctx.Err()
		}
		if m.isPaused() {
			m.setState(StatePaused, nil)
			select {
			case <-ctx.Done():
				m.setState(StateDisconnected, nil)
				return ctx.Err()
			case <-m.wakeCh:
				continue
			}
		}

		if attempt == 0 {
			m.setState(StateConnecting, nil)
		} else {
			m.setState(StateReconnecting, nil)
		}

		streamCtx, cancel := context.WithCancel(ctx)
		m.mu.Lock()
		m.streamDrop = cancel
		m.mu.Unlock()

		expired, err := m.runOnce(streamCtx)
		cancel()

		m.mu.Lock()
		m.streamDrop = nil
		m.mu.Unlock()

		if expired {
			m.setState(StateExpired, err)
			return err
		}
		if ctx.Err() != nil {
			m.setState(StateDisconnected, nil)
			return ctx.Err()
		}
		if m.isPaused() {
			attempt = 0
			continue
		}

		// If connection dropped cleanly after being active, reset backoff if a wake triggered it.
		select {
		case <-m.wakeCh:
			attempt = 0
			continue
		default:
		}

		attempt++
		delay := m.backoffDelay(attempt)
		m.setState(StateReconnecting, err)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			m.setState(StateDisconnected, nil)
			return ctx.Err()
		case <-m.wakeCh:
			timer.Stop()
			attempt = 0
		case <-timer.C:
		}
	}
}

func (m *StreamManager) backoffDelay(attempt int) time.Duration {
	shift := min(attempt-1, 6)
	d := m.baseBackoff * time.Duration(1<<shift)
	if d > m.maxBackoff {
		d = m.maxBackoff
	}
	// Apply +-20% jitter to avoid thundering herds on reconnect.
	jitterSpan := int64(d) / 5
	if jitterSpan > 0 {
		offset := rand.Int64N(2*jitterSpan+1) - jitterSpan
		d += time.Duration(offset)
	}
	if d < 50*time.Millisecond {
		d = 50 * time.Millisecond
	}
	return d
}

func (m *StreamManager) runOnce(ctx context.Context) (expired bool, err error) {
	resp, err := m.client.OpenSSE(ctx, m.BuildStreamPath())
	if err != nil {
		if errors.Is(err, api.ErrUnauthorized) {
			if m.callbacks.OnSessionExpired != nil {
				m.callbacks.OnSessionExpired("SESSION_EXPIRED", err.Error())
			}
			return true, err
		}
		return false, err
	}
	defer resp.Body.Close()

	m.setState(StateConnected, nil)

	var sessionExpiredErr error
	readErr := ReadSSE(resp.Body, func(frame SSEEvent) bool {
		now := time.Now()
		m.mu.Lock()
		m.lastHB = now
		m.mu.Unlock()

		if frame.Comment != "" {
			if m.callbacks.OnHeartbeat != nil {
				m.callbacks.OnHeartbeat(now)
			}
			return true
		}

		switch frame.Event {
		case "room.event":
			var ev api.RoomEventEnvelope
			if json.Unmarshal([]byte(frame.Data), &ev) == nil && ev.RoomID != "" {
				m.deliverRoomEventWithBackfill(ctx, ev)
			}
		case "resource.invalidated":
			var inv ResourceInvalidation
			if json.Unmarshal([]byte(frame.Data), &inv) == nil && m.callbacks.OnInvalidated != nil {
				m.callbacks.OnInvalidated(inv)
			}
		case "stream.resync":
			var body struct {
				Reason string `json:"reason"`
			}
			_ = json.Unmarshal([]byte(frame.Data), &body)
			if m.callbacks.OnResync != nil {
				m.callbacks.OnResync(body.Reason)
			}
		case "session.expired", "SESSION_EXPIRED":
			var body struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			_ = json.Unmarshal([]byte(frame.Data), &body)
			if body.Code == "" {
				body.Code = "SESSION_EXPIRED"
			}
			if body.Message == "" {
				body.Message = "session expired"
			}
			sessionExpiredErr = fmt.Errorf("realtime: %s: %s", body.Code, body.Message)
			if m.callbacks.OnSessionExpired != nil {
				m.callbacks.OnSessionExpired(body.Code, body.Message)
			}
			return false
		default:
			// Also detect raw SESSION_EXPIRED payloads delivered under generic event names.
			if strings.Contains(frame.Data, "SESSION_EXPIRED") {
				sessionExpiredErr = errors.New("realtime: SESSION_EXPIRED")
				if m.callbacks.OnSessionExpired != nil {
					m.callbacks.OnSessionExpired("SESSION_EXPIRED", "session expired")
				}
				return false
			}
		}
		return true
	})

	if sessionExpiredErr != nil {
		return true, sessionExpiredErr
	}
	return false, readErr
}

// deliverRoomEventWithBackfill enforces strict contiguous room_seq ordering.
// If an incoming room.event jumps past cursor+1, it backfills missing events
// from GET /v0/rooms/:id/events?after=<cursor> before delivering the gap-closing events.
func (m *StreamManager) deliverRoomEventWithBackfill(ctx context.Context, ev api.RoomEventEnvelope) {
	m.mu.Lock()
	cur, tracked := m.cursors[ev.RoomID]
	m.mu.Unlock()

	if tracked && ev.RoomSeq <= cur {
		// Duplicate or already applied.
		return
	}

	if tracked && cur > 0 && ev.RoomSeq > cur+1 {
		after := cur
		for after < ev.RoomSeq {
			page, err := m.client.ListRoomEvents(ctx, ev.RoomID, after, 100)
			if err != nil || len(page.Items) == 0 {
				break
			}
			progressed := false
			for _, missed := range page.Items {
				if missed.RoomSeq <= after {
					continue
				}
				m.SetRoomCursor(ev.RoomID, missed.RoomSeq)
				after = missed.RoomSeq
				progressed = true
				if m.callbacks.OnRoomEvent != nil {
					m.callbacks.OnRoomEvent(missed)
				}
			}
			if !progressed || !page.HasMore {
				break
			}
		}
		// Check whether backfill already delivered ev.RoomSeq.
		m.mu.Lock()
		newCur := m.cursors[ev.RoomID]
		m.mu.Unlock()
		if ev.RoomSeq <= newCur {
			return
		}
	}

	m.SetRoomCursor(ev.RoomID, ev.RoomSeq)
	if m.callbacks.OnRoomEvent != nil {
		m.callbacks.OnRoomEvent(ev)
	}
}
