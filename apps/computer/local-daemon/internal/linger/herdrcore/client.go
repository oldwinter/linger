package herdrcore

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// maxResponseBytes accommodates 8 MiB base64-encoded file.read / machine.exec payloads plus JSON envelope overhead.
const maxResponseBytes = 20 << 20

const (
	framedChannelQueueSize = 64
	maxEarlyFramesPerChan  = 256
)

// Client calls a herdr-core server over its Unix socket or `hc connect` stdio
// subprocess transport.
type Client struct {
	Socket          string
	Executable      string
	Session         string
	Environment     []string
	UseConnectStdio bool
	// Dial overrides transport dialing in unit tests.
	Dial func(ctx context.Context) (io.ReadWriteCloser, error)

	nextID atomic.Uint64
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      uint64 `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

type rpcErrorWire struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type rpcEnvelope struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcErrorWire   `json:"error,omitempty"`
}

func (e *rpcErrorWire) toError() *Error {
	if e == nil {
		return nil
	}
	err := &Error{
		Code:    e.Code,
		Message: e.Message,
		Data:    e.Data,
	}
	if len(e.Data) > 0 {
		var meta struct {
			Kind string `json:"kind"`
			Hint string `json:"hint"`
		}
		if json.Unmarshal(e.Data, &meta) == nil {
			err.Kind = meta.Kind
			err.Hint = meta.Hint
		}
	}
	return err
}

func (c *Client) dial(ctx context.Context) (io.ReadWriteCloser, error) {
	if c.Dial != nil {
		return c.Dial(ctx)
	}
	if !c.UseConnectStdio && c.Socket != "" {
		var dialer net.Dialer
		conn, err := dialer.DialContext(ctx, "unix", c.Socket)
		if err != nil {
			return nil, err
		}
		if deadline, ok := ctx.Deadline(); ok {
			_ = conn.SetDeadline(deadline)
		}
		return conn, nil
	}
	if c.Executable != "" {
		return startConnectStdio(ctx, c.Executable, c.Session, c.Environment)
	}
	return nil, errors.New("herdr-core transport is not configured")
}

// stdioConn wraps an `hc connect` child process using owned os.Pipe pairs so
// Close can safely tear down the process and pipes without racing os/exec.Wait.
type stdioConn struct {
	cmd      *exec.Cmd
	inWrite  *os.File
	outRead  *os.File
	waitDone chan struct{}
	closeMu  sync.Mutex
	closed   bool
}

func startConnectStdio(ctx context.Context, executable, session string, extraEnv []string) (io.ReadWriteCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	inRead, inWrite, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("create hc connect stdin pipe: %w", err)
	}
	outRead, outWrite, err := os.Pipe()
	if err != nil {
		_ = inRead.Close()
		_ = inWrite.Close()
		return nil, fmt.Errorf("create hc connect stdout pipe: %w", err)
	}
	args := []string{"connect"}
	if session != "" && session != DefaultSession {
		args = append(args, "--session", session)
	}
	cmd := exec.Command(executable, args...)
	if len(extraEnv) > 0 {
		cmd.Env = append(os.Environ(), extraEnv...)
	}
	cmd.Stdin = inRead
	cmd.Stdout = outWrite
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		_ = inRead.Close()
		_ = inWrite.Close()
		_ = outRead.Close()
		_ = outWrite.Close()
		return nil, fmt.Errorf("start hc connect: %w", err)
	}
	_ = inRead.Close()
	_ = outWrite.Close()
	waitDone := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(waitDone)
	}()
	return &stdioConn{
		cmd:      cmd,
		inWrite:  inWrite,
		outRead:  outRead,
		waitDone: waitDone,
	}, nil
}

func (s *stdioConn) Read(p []byte) (int, error) {
	return s.outRead.Read(p)
}

func (s *stdioConn) Write(p []byte) (int, error) {
	return s.inWrite.Write(p)
}

func (s *stdioConn) Close() error {
	s.closeMu.Lock()
	if s.closed {
		s.closeMu.Unlock()
		return nil
	}
	s.closed = true
	s.closeMu.Unlock()

	errIn := s.inWrite.Close()
	errOut := s.outRead.Close()
	timer := time.NewTimer(200 * time.Millisecond)
	select {
	case <-s.waitDone:
		timer.Stop()
	case <-timer.C:
		if s.cmd.Process != nil {
			_ = s.cmd.Process.Kill()
		}
		<-s.waitDone
	}
	if errIn != nil && !errors.Is(errIn, os.ErrClosed) {
		return errIn
	}
	if errOut != nil && !errors.Is(errOut, os.ErrClosed) {
		return errOut
	}
	return nil
}

func encodeRequest(id uint64, method string, params any) ([]byte, error) {
	if params == nil {
		params = map[string]any{}
	}
	return json.Marshal(rpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	})
}

func matchResponseID(raw json.RawMessage, expected uint64) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return false
	}
	if trimmed[0] == '"' {
		var text string
		if json.Unmarshal(trimmed, &text) != nil {
			return false
		}
		parsed, err := strconv.ParseUint(text, 10, 64)
		return err == nil && parsed == expected
	}
	parsed, err := strconv.ParseUint(string(trimmed), 10, 64)
	return err == nil && parsed == expected
}

func readJSONLine(reader *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		chunk, isPrefix, err := reader.ReadLine()
		if err != nil {
			return nil, err
		}
		line = append(line, chunk...)
		if len(line) > maxResponseBytes {
			return nil, errors.New("herdr-core response exceeds maximum size")
		}
		if !isPrefix {
			return line, nil
		}
	}
}

// Call sends one newline-delimited JSON-RPC 2.0 request and decodes its result.
func (c *Client) Call(ctx context.Context, method string, params, result any) error {
	conn, err := c.dial(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()

	id := c.nextID.Add(1)
	payload, err := encodeRequest(id, method, params)
	if err != nil {
		return err
	}
	if _, err := conn.Write(append(payload, '\n')); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	}
	reader := bufio.NewReaderSize(conn, 64<<10)
	for {
		line, err := readJSONLine(reader)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var env rpcEnvelope
		if json.Unmarshal(line, &env) != nil || !matchResponseID(env.ID, id) {
			continue
		}
		if env.Error != nil {
			return env.Error.toError()
		}
		if result == nil {
			return nil
		}
		return json.Unmarshal(env.Result, result)
	}
}

// Hello performs a plain JSON-RPC handshake with herdr-core.
func (c *Client) Hello(ctx context.Context, params HelloParams) (HelloResult, error) {
	if params.Generation == nil {
		gen := ProtocolGeneration
		params.Generation = &gen
	}
	var result HelloResult
	err := c.Call(ctx, "hello", params, &result)
	return result, err
}

// ServerStatus returns core identity, version, holder, and terminal counts.
func (c *Client) ServerStatus(ctx context.Context) (StatusResult, error) {
	var result StatusResult
	err := c.Call(ctx, "server.status", nil, &result)
	return result, err
}

// TemplatesList lists configured role templates.
func (c *Client) TemplatesList(ctx context.Context) (TemplatesResult, error) {
	var result TemplatesResult
	err := c.Call(ctx, "templates.list", nil, &result)
	return result, err
}

// TerminalRun starts a program, shell, or template in a new terminal.
func (c *Client) TerminalRun(ctx context.Context, params TerminalRunParams) (RunResult, error) {
	var result RunResult
	err := c.Call(ctx, "terminal.run", params, &result)
	return result, err
}

// TerminalList lists live (or all) terminals and connected machines.
func (c *Client) TerminalList(ctx context.Context, params TerminalListParams) (ListResult, error) {
	var result ListResult
	err := c.Call(ctx, "terminal.list", params, &result)
	return result, err
}

// TerminalGet returns one terminal's facts.
func (c *Client) TerminalGet(ctx context.Context, params TerminalGetParams) (Terminal, error) {
	var result Terminal
	err := c.Call(ctx, "terminal.get", params, &result)
	return result, err
}

// TerminalKill terminates a live terminal's program.
func (c *Client) TerminalKill(ctx context.Context, params TerminalKillParams) (Terminal, error) {
	var result Terminal
	err := c.Call(ctx, "terminal.kill", params, &result)
	return result, err
}

// TerminalRemove removes a finished terminal.
func (c *Client) TerminalRemove(ctx context.Context, params TerminalRemoveParams) (RemoveResult, error) {
	var result RemoveResult
	err := c.Call(ctx, "terminal.rm", params, &result)
	return result, err
}

// TerminalKeep configures crash-recovery shell replacement for a live terminal.
func (c *Client) TerminalKeep(ctx context.Context, params TerminalKeepParams) (Terminal, error) {
	var result Terminal
	err := c.Call(ctx, "terminal.keep", params, &result)
	return result, err
}

// TerminalLabel sets or deletes free-form labels on a terminal.
func (c *Client) TerminalLabel(ctx context.Context, params TerminalLabelParams) (Terminal, error) {
	var result Terminal
	err := c.Call(ctx, "terminal.label", params, &result)
	return result, err
}

// TerminalRead returns a terminal's visible screen plus scrollback lines as text.
func (c *Client) TerminalRead(ctx context.Context, params TerminalReadParams) (ReadResult, error) {
	var result ReadResult
	err := c.Call(ctx, "terminal.read", params, &result)
	return result, err
}

// TerminalSend pastes text and presses Enter into a live terminal.
func (c *Client) TerminalSend(ctx context.Context, params TerminalSendParams) (SendResult, error) {
	var result SendResult
	err := c.Call(ctx, "terminal.send", params, &result)
	return result, err
}

// TerminalWait waits for a terminal or its children to stop working or match output.
func (c *Client) TerminalWait(ctx context.Context, params TerminalWaitParams) (WaitResult, error) {
	var result WaitResult
	err := c.Call(ctx, "terminal.wait", params, &result)
	return result, err
}

// TerminalKeys presses named keys into a live terminal.
func (c *Client) TerminalKeys(ctx context.Context, params TerminalKeysParams) (KeysResult, error) {
	var result KeysResult
	err := c.Call(ctx, "terminal.keys", params, &result)
	return result, err
}

// TerminalInterrupt presses the stop key without escalating to termination.
func (c *Client) TerminalInterrupt(ctx context.Context, params TerminalInterruptParams) (InterruptResult, error) {
	var result InterruptResult
	err := c.Call(ctx, "terminal.interrupt", params, &result)
	return result, err
}

// TerminalPut writes base64-encoded bytes to a file beside a live terminal.
func (c *Client) TerminalPut(ctx context.Context, params TerminalPutParams) (PutResult, error) {
	var result PutResult
	err := c.Call(ctx, "terminal.put", params, &result)
	return result, err
}

// MachineExec runs a program without a terminal here or on a remote machine.
func (c *Client) MachineExec(ctx context.Context, params MachineExecParams) (ExecResult, error) {
	var result ExecResult
	err := c.Call(ctx, "machine.exec", params, &result)
	return result, err
}

// FileRead reads a text file line range locally or on a remote machine.
func (c *Client) FileRead(ctx context.Context, params FileReadParams) (FileReadResult, error) {
	var result FileReadResult
	err := c.Call(ctx, "file.read", params, &result)
	return result, err
}

// FileWrite atomically writes base64-encoded bytes locally or on a remote machine.
func (c *Client) FileWrite(ctx context.Context, params FileWriteParams) (FileResult, error) {
	var result FileResult
	err := c.Call(ctx, "file.write", params, &result)
	return result, err
}

// FileEdit atomically applies exact replacements to a text file.
func (c *Client) FileEdit(ctx context.Context, params FileEditParams) (FileResult, error) {
	var result FileResult
	err := c.Call(ctx, "file.edit", params, &result)
	return result, err
}

// DocGet reads an opaque JSON document and its CAS version.
func (c *Client) DocGet(ctx context.Context, params DocGetParams) (DocGetResult, error) {
	var result DocGetResult
	err := c.Call(ctx, "doc.get", params, &result)
	return result, err
}

// DocSet writes or deletes an opaque JSON document with optimistic CAS version check.
func (c *Client) DocSet(ctx context.Context, params DocSetParams) (DocSetResult, error) {
	var result DocSetResult
	err := c.Call(ctx, "doc.set", params, &result)
	return result, err
}

// MachineList lists machines added to this core and their connection state.
func (c *Client) MachineList(ctx context.Context) (MachineListResult, error) {
	var result MachineListResult
	err := c.Call(ctx, "machine.list", nil, &result)
	return result, err
}

// MachineAdd adds a remote machine reached over SSH or a `--via` command.
func (c *Client) MachineAdd(ctx context.Context, params MachineAddParams) (Machine, error) {
	var result Machine
	err := c.Call(ctx, "machine.add", params, &result)
	return result, err
}

// MachineConnect triggers an immediate dial to a saved machine.
func (c *Client) MachineConnect(ctx context.Context, params MachineConnectParams) (MachineView, error) {
	var result MachineView
	err := c.Call(ctx, "machine.connect", params, &result)
	return result, err
}

// MachineRename renames a saved machine on this core.
func (c *Client) MachineRename(ctx context.Context, params MachineRenameParams) (Machine, error) {
	var result Machine
	err := c.Call(ctx, "machine.rename", params, &result)
	return result, err
}

// MachineRemove forgets a saved machine without stopping its remote terminals.
func (c *Client) MachineRemove(ctx context.Context, params MachineRemoveParams) (RemoveResult, error) {
	var result RemoveResult
	err := c.Call(ctx, "machine.rm", params, &result)
	return result, err
}

// RPCDiscover retrieves the core's OpenRPC 1.3.2 schema document.
func (c *Client) RPCDiscover(ctx context.Context) (json.RawMessage, error) {
	var result json.RawMessage
	err := c.Call(ctx, "rpc.discover", nil, &result)
	return result, err
}

// StreamMessageKind classifies messages yielded by EventStream.Next.
type StreamMessageKind string

const (
	// StreamMessageEvent is an ordered incremental event notification.
	StreamMessageEvent StreamMessageKind = "event"
	// StreamMessageHeartbeat is a periodic keepalive notification.
	StreamMessageHeartbeat StreamMessageKind = "heartbeat"
	// StreamMessageMissed indicates the subscriber fell behind and received a resync snapshot.
	StreamMessageMissed StreamMessageKind = "missed"
)

// StreamMessage is one notification read from an EventStream.
type StreamMessage struct {
	Kind   StreamMessageKind
	Event  *EventNotification
	Missed *MissedNotification
}

// EventStream reads ordered notifications from `events.subscribe` in either
// plain newline-delimited mode or framed channel mode.
type EventStream struct {
	Snapshot SubscribeResult

	conn       io.ReadWriteCloser
	reader     *bufio.Reader
	framed     *FramedConn
	channel    uint32
	frames     <-chan Frame
	pendingBuf []byte

	closeOnce sync.Once
	closeErr  error
}

// EventsSubscribe opens a plain-mode `events.subscribe` stream and returns its
// initial snapshot along with an EventStream for subsequent notifications.
func (c *Client) EventsSubscribe(ctx context.Context, params EventsSubscribeParams) (*EventStream, error) {
	conn, err := c.dial(ctx)
	if err != nil {
		return nil, err
	}
	if netConn, ok := conn.(net.Conn); ok {
		_ = netConn.SetDeadline(time.Time{})
	}
	stopHandshake := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stopHandshake()

	id := c.nextID.Add(1)
	payload, err := encodeRequest(id, "events.subscribe", params)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if _, err := conn.Write(append(payload, '\n')); err != nil {
		_ = conn.Close()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	reader := bufio.NewReaderSize(conn, 64<<10)
	for {
		line, err := readJSONLine(reader)
		if err != nil {
			_ = conn.Close()
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, err
		}
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var env rpcEnvelope
		if json.Unmarshal(line, &env) != nil || !matchResponseID(env.ID, id) {
			continue
		}
		if env.Error != nil {
			_ = conn.Close()
			return nil, env.Error.toError()
		}
		var snapshot SubscribeResult
		if err := json.Unmarshal(env.Result, &snapshot); err != nil {
			_ = conn.Close()
			return nil, err
		}
		// Keep the stream open after handshake; Next manages per-read cancellation.
		stopHandshake()
		return &EventStream{
			Snapshot: snapshot,
			conn:     conn,
			reader:   reader,
		}, nil
	}
}

// Next reads the next event, heartbeat, or missed-resync notification.
func (es *EventStream) Next(ctx context.Context) (StreamMessage, error) {
	if es.framed != nil {
		return es.nextFramed(ctx)
	}
	stop := context.AfterFunc(ctx, func() { _ = es.Close() })
	defer stop()
	for {
		line, err := readJSONLine(es.reader)
		if err != nil {
			if ctx.Err() != nil {
				return StreamMessage{}, ctx.Err()
			}
			return StreamMessage{}, err
		}
		msg, ok, err := decodeStreamLine(line)
		if err != nil {
			return StreamMessage{}, err
		}
		if ok {
			return msg, nil
		}
	}
}

func (es *EventStream) nextFramed(ctx context.Context) (StreamMessage, error) {
	for {
		if idx := bytes.IndexByte(es.pendingBuf, '\n'); idx >= 0 {
			line := es.pendingBuf[:idx]
			es.pendingBuf = es.pendingBuf[idx+1:]
			msg, ok, err := decodeStreamLine(line)
			if err != nil {
				return StreamMessage{}, err
			}
			if ok {
				return msg, nil
			}
			continue
		}
		select {
		case <-ctx.Done():
			return StreamMessage{}, ctx.Err()
		case frame, ok := <-es.frames:
			if !ok {
				if err := es.framed.readError(); err != nil {
					return StreamMessage{}, err
				}
				return StreamMessage{}, io.EOF
			}
			switch frame.Kind {
			case FrameData:
				if len(frame.Payload) > 0 {
					es.pendingBuf = append(es.pendingBuf, frame.Payload...)
					_ = es.framed.SendCredit(es.channel, uint32(len(frame.Payload)))
				}
			case FrameClose:
				return StreamMessage{}, io.EOF
			}
		}
	}
}

func decodeStreamLine(line []byte) (StreamMessage, bool, error) {
	trimmed := bytes.TrimSpace(line)
	if len(trimmed) == 0 {
		return StreamMessage{}, false, nil
	}
	var env rpcEnvelope
	if err := json.Unmarshal(trimmed, &env); err != nil {
		return StreamMessage{}, false, fmt.Errorf("decode herdr-core notification: %w", err)
	}
	switch env.Method {
	case "heartbeat":
		return StreamMessage{Kind: StreamMessageHeartbeat}, true, nil
	case "missed":
		var missed MissedNotification
		if len(env.Params) > 0 {
			if err := json.Unmarshal(env.Params, &missed); err != nil {
				return StreamMessage{}, false, fmt.Errorf("decode missed notification: %w", err)
			}
		}
		return StreamMessage{Kind: StreamMessageMissed, Missed: &missed}, true, nil
	case "event":
		var event EventNotification
		if err := json.Unmarshal(env.Params, &event); err != nil {
			return StreamMessage{}, false, fmt.Errorf("decode event notification: %w", err)
		}
		if event.Type == "missed" {
			var missed MissedNotification
			missed.Seq = event.Seq
			if len(event.Data) > 0 {
				_ = json.Unmarshal(event.Data, &missed)
				if missed.Seq == 0 {
					missed.Seq = event.Seq
				}
			}
			return StreamMessage{Kind: StreamMessageMissed, Missed: &missed}, true, nil
		}
		return StreamMessage{Kind: StreamMessageEvent, Event: &event}, true, nil
	default:
		return StreamMessage{}, false, nil
	}
}

// Close ends the subscription stream.
func (es *EventStream) Close() error {
	es.closeOnce.Do(func() {
		if es.framed != nil {
			_ = es.framed.SendClose(es.channel)
			es.framed.unregisterChannel(es.channel)
			return
		}
		if es.conn != nil {
			es.closeErr = es.conn.Close()
		}
	})
	return es.closeErr
}

// FramedConn is a multiplexed herdr-core connection switched to framed binary
// mode via `hello(framed: true)`. Channel 0 carries JSON-RPC 2.0 calls while
// non-zero channels carry PTY attach streams and framed event subscriptions.
type FramedConn struct {
	conn    io.ReadWriteCloser
	reader  *bufio.Reader
	hello   HelloResult
	nextID  atomic.Uint64
	writeMu sync.Mutex

	mu             sync.Mutex
	pending        map[uint64]chan rpcResult
	channels       map[uint32]chan Frame
	earlyFrames    map[uint32][]Frame
	closedChannels map[uint32]bool
	readErr        error
	closed         chan struct{}
	closeOnce      sync.Once
}

type rpcResult struct {
	result json.RawMessage
	err    error
}

// DialFramed opens a connection, executes `hello(framed: true)`, and returns a
// multiplexed FramedConn alongside the server's HelloResult.
func (c *Client) DialFramed(ctx context.Context, params HelloParams) (*FramedConn, HelloResult, error) {
	conn, err := c.dial(ctx)
	if err != nil {
		return nil, HelloResult{}, err
	}
	if netConn, ok := conn.(net.Conn); ok {
		_ = netConn.SetDeadline(time.Time{})
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })

	params.Framed = true
	if params.Generation == nil {
		gen := ProtocolGeneration
		params.Generation = &gen
	}
	payload, err := encodeRequest(0, "hello", params)
	if err != nil {
		stop()
		_ = conn.Close()
		return nil, HelloResult{}, err
	}
	if _, err := conn.Write(append(payload, '\n')); err != nil {
		stop()
		_ = conn.Close()
		if ctx.Err() != nil {
			return nil, HelloResult{}, ctx.Err()
		}
		return nil, HelloResult{}, err
	}
	reader := bufio.NewReaderSize(conn, 64<<10)
	line, err := readJSONLine(reader)
	stop()
	if err != nil {
		_ = conn.Close()
		if ctx.Err() != nil {
			return nil, HelloResult{}, ctx.Err()
		}
		return nil, HelloResult{}, err
	}
	var env rpcEnvelope
	if err := json.Unmarshal(line, &env); err != nil {
		_ = conn.Close()
		return nil, HelloResult{}, fmt.Errorf("decode framed hello: %w", err)
	}
	if env.Error != nil {
		_ = conn.Close()
		return nil, HelloResult{}, env.Error.toError()
	}
	var hello HelloResult
	if err := json.Unmarshal(env.Result, &hello); err != nil {
		_ = conn.Close()
		return nil, HelloResult{}, fmt.Errorf("decode hello result: %w", err)
	}
	if !hello.Framed {
		_ = conn.Close()
		return nil, HelloResult{}, errors.New("herdr-core refused framed mode")
	}

	fc := &FramedConn{
		conn:           conn,
		reader:         reader,
		hello:          hello,
		pending:        make(map[uint64]chan rpcResult),
		channels:       make(map[uint32]chan Frame),
		earlyFrames:    make(map[uint32][]Frame),
		closedChannels: make(map[uint32]bool),
		closed:         make(chan struct{}),
	}
	go fc.readLoop()
	return fc, hello, nil
}

// HelloResult returns the handshake metadata negotiated when this connection opened.
func (f *FramedConn) HelloResult() HelloResult {
	return f.hello
}

// Call executes one JSON-RPC 2.0 request over control channel 0.
func (f *FramedConn) Call(ctx context.Context, method string, params, result any) error {
	id := f.nextID.Add(1)
	payload, err := encodeRequest(id, method, params)
	if err != nil {
		return err
	}
	waiter := make(chan rpcResult, 1)
	f.mu.Lock()
	select {
	case <-f.closed:
		readErr := f.readErr
		f.mu.Unlock()
		if readErr != nil {
			return readErr
		}
		return io.ErrClosedPipe
	default:
		f.pending[id] = waiter
	}
	f.mu.Unlock()

	defer func() {
		f.mu.Lock()
		delete(f.pending, id)
		f.mu.Unlock()
	}()

	if err := f.WriteFrame(Frame{Channel: ControlChannel, Kind: FrameData, Payload: payload}); err != nil {
		return err
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-f.closed:
		if err := f.readError(); err != nil {
			return err
		}
		return io.EOF
	case reply := <-waiter:
		if reply.err != nil {
			return reply.err
		}
		if result == nil {
			return nil
		}
		return json.Unmarshal(reply.result, result)
	}
}

// WriteFrame serializes and sends one frame on this framed connection.
func (f *FramedConn) WriteFrame(frame Frame) error {
	f.writeMu.Lock()
	defer f.writeMu.Unlock()
	return WriteFrame(f.conn, frame)
}

// SendCredit sends a flow-control credit update for channel.
func (f *FramedConn) SendCredit(channel, byteCount uint32) error {
	if byteCount == 0 {
		return nil
	}
	return f.WriteFrame(Frame{Channel: channel, Kind: FrameCredit, Payload: EncodeCredit(byteCount)})
}

// SendClose sends a clean close frame for channel.
func (f *FramedConn) SendClose(channel uint32) error {
	return f.WriteFrame(Frame{Channel: channel, Kind: FrameClose})
}

// EventsSubscribe opens a multiplexed `events.subscribe` channel on this framed connection.
func (f *FramedConn) EventsSubscribe(ctx context.Context, params EventsSubscribeParams) (*EventStream, error) {
	var snapshot SubscribeResult
	if err := f.Call(ctx, "events.subscribe", params, &snapshot); err != nil {
		return nil, err
	}
	if snapshot.Channel == nil {
		return nil, errors.New("framed events.subscribe returned no channel")
	}
	channelID := *snapshot.Channel
	frames := f.registerChannel(channelID)
	return &EventStream{
		Snapshot: snapshot,
		framed:   f,
		channel:  channelID,
		frames:   frames,
	}, nil
}

// Close closes the underlying framed connection and wakes all pending callers.
func (f *FramedConn) Close() error {
	var err error
	f.closeOnce.Do(func() {
		f.shutdown(io.EOF)
		err = f.conn.Close()
	})
	return err
}

func (f *FramedConn) registerChannel(channelID uint32) <-chan Frame {
	f.mu.Lock()
	defer f.mu.Unlock()
	early := f.earlyFrames[channelID]
	delete(f.earlyFrames, channelID)
	size := framedChannelQueueSize
	if len(early) > size {
		size = len(early)
	}
	ch := make(chan Frame, size)
	for _, frame := range early {
		ch <- frame
	}
	select {
	case <-f.closed:
		close(ch)
	default:
		f.channels[channelID] = ch
	}
	return ch
}

func (f *FramedConn) unregisterChannel(channelID uint32) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if ch, ok := f.channels[channelID]; ok {
		delete(f.channels, channelID)
		close(ch)
	}
	delete(f.earlyFrames, channelID)
	f.closedChannels[channelID] = true
}

func (f *FramedConn) readError() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.readErr
}

func (f *FramedConn) shutdown(err error) {
	f.mu.Lock()
	select {
	case <-f.closed:
		f.mu.Unlock()
		return
	default:
		if err != nil {
			f.readErr = err
		}
		close(f.closed)
		for id, waiter := range f.pending {
			waiter <- rpcResult{err: err}
			delete(f.pending, id)
		}
		for channelID, ch := range f.channels {
			close(ch)
			delete(f.channels, channelID)
		}
		clear(f.earlyFrames)
	}
	f.mu.Unlock()
}

func (f *FramedConn) readLoop() {
	for {
		frame, err := ReadFrame(f.reader)
		if err != nil {
			f.shutdown(err)
			return
		}
		if frame.Channel == ControlChannel {
			if frame.Kind == FrameData {
				f.dispatchControl(frame.Payload)
			}
			continue
		}
		f.dispatchChannel(frame)
	}
}

func (f *FramedConn) dispatchControl(payload []byte) {
	var env rpcEnvelope
	if json.Unmarshal(payload, &env) != nil {
		return
	}
	trimmed := bytes.TrimSpace(env.ID)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return
	}
	var id uint64
	if trimmed[0] == '"' {
		var text string
		if json.Unmarshal(trimmed, &text) != nil {
			return
		}
		parsed, err := strconv.ParseUint(text, 10, 64)
		if err != nil {
			return
		}
		id = parsed
	} else {
		parsed, err := strconv.ParseUint(strings.TrimSpace(string(trimmed)), 10, 64)
		if err != nil {
			return
		}
		id = parsed
	}
	f.mu.Lock()
	waiter := f.pending[id]
	f.mu.Unlock()
	if waiter == nil {
		return
	}
	if env.Error != nil {
		waiter <- rpcResult{err: env.Error.toError()}
		return
	}
	waiter <- rpcResult{result: env.Result}
}

func (f *FramedConn) dispatchChannel(frame Frame) {
	f.mu.Lock()
	ch, ok := f.channels[frame.Channel]
	if !ok {
		if !f.closedChannels[frame.Channel] && len(f.earlyFrames[frame.Channel]) < maxEarlyFramesPerChan {
			f.earlyFrames[frame.Channel] = append(f.earlyFrames[frame.Channel], frame)
		}
		f.mu.Unlock()
		return
	}
	f.mu.Unlock()

	select {
	case ch <- frame:
	case <-f.closed:
	}
}
