package daemon

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/assignment"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/herdr"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/herdrcore"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/transport"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/protocol"
	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

type fakeHerdrCoreRPCRequest struct {
	Method string
	Params map[string]any
}

type fakeHerdrCoreAttachRecord struct {
	Params herdrcore.TerminalAttachParams
	Conn   *fakeFramedPeer
}

type fakeFramedPeer struct {
	conn    net.Conn
	writeMu sync.Mutex
	channel uint32

	mu       sync.Mutex
	received []herdrcore.Frame
	closed   chan struct{}
	once     sync.Once
}

func (p *fakeFramedPeer) sendFrame(kind herdrcore.FrameKind, payload []byte) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return herdrcore.WriteFrame(p.conn, herdrcore.Frame{
		Channel: p.channel,
		Kind:    kind,
		Payload: payload,
	})
}

func (p *fakeFramedPeer) close() {
	p.once.Do(func() {
		close(p.closed)
		_ = p.conn.Close()
	})
}

func (p *fakeFramedPeer) snapshotFrames() []herdrcore.Frame {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]herdrcore.Frame, len(p.received))
	copy(out, p.received)
	return out
}

// fakeHerdrCoreServer serves newline JSON-RPC and framed binary PTY attach
// sessions in memory over net.Pipe, so tests are deterministic and work across
// platforms with -race.
type fakeHerdrCoreServer struct {
	t *testing.T

	mu              sync.Mutex
	terminals       map[string]herdrcore.Terminal
	reads           map[string]herdrcore.ReadResult
	files           map[string]string
	docs            map[string]herdrcore.DocGetResult
	machines        []herdrcore.MachineView
	templates       []herdrcore.TemplateInfo
	requests        []fakeHerdrCoreRPCRequest
	attaches        []*fakeHerdrCoreAttachRecord
	closeConnOnSend bool
	nextChannel     uint32
	conns           []net.Conn
}

func newFakeHerdrCoreServer(t *testing.T) *fakeHerdrCoreServer {
	t.Helper()
	srv := &fakeHerdrCoreServer{
		t:           t,
		terminals:   map[string]herdrcore.Terminal{},
		reads:       map[string]herdrcore.ReadResult{},
		files:       map[string]string{},
		docs:        map[string]herdrcore.DocGetResult{},
		nextChannel: 1,
	}
	t.Cleanup(func() {
		srv.mu.Lock()
		conns := slices.Clone(srv.conns)
		srv.conns = nil
		srv.mu.Unlock()
		for _, c := range conns {
			_ = c.Close()
		}
	})
	return srv
}

func (s *fakeHerdrCoreServer) client() *herdrcore.Client {
	return &herdrcore.Client{
		Dial: func(ctx context.Context) (io.ReadWriteCloser, error) {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			clientConn, serverConn := net.Pipe()
			s.mu.Lock()
			s.conns = append(s.conns, serverConn)
			s.mu.Unlock()
			go s.serveConn(serverConn)
			return clientConn, nil
		},
	}
}

func (s *fakeHerdrCoreServer) recordedRequests() []fakeHerdrCoreRPCRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.requests)
}

func (s *fakeHerdrCoreServer) attachCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.attaches)
}

func (s *fakeHerdrCoreServer) latestAttach() *fakeHerdrCoreAttachRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.attaches) == 0 {
		return nil
	}
	return s.attaches[len(s.attaches)-1]
}

func (s *fakeHerdrCoreServer) serveConn(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	reader := bufio.NewReaderSize(conn, 64<<10)
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return
	}
	var req struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if json.Unmarshal(bytes.TrimSpace(line), &req) != nil {
		return
	}
	if req.Method == "hello" {
		var params herdrcore.HelloParams
		_ = json.Unmarshal(req.Params, &params)
		resp, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result": herdrcore.HelloResult{
				Core:       herdrcore.CoreInfo{ID: "core-fake", Name: "fake"},
				Framed:     params.Framed,
				Generation: herdrcore.ProtocolGeneration,
				Version:    "0.1.21",
			},
		})
		if _, err := conn.Write(append(resp, '\n')); err != nil {
			return
		}
		if params.Framed {
			s.serveFramed(conn, reader)
		}
		return
	}
	response := s.handleRPC(conn, req.ID, req.Method, req.Params)
	if response == nil {
		return
	}
	encoded, _ := json.Marshal(response)
	_, _ = conn.Write(append(encoded, '\n'))
}

func (s *fakeHerdrCoreServer) serveFramed(conn net.Conn, reader *bufio.Reader) {
	var peer *fakeFramedPeer
	defer func() {
		if peer != nil {
			peer.close()
		}
	}()
	for {
		frame, err := herdrcore.ReadFrame(reader)
		if err != nil {
			return
		}
		if frame.Channel == herdrcore.ControlChannel && frame.Kind == herdrcore.FrameData {
			var req struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}
			if json.Unmarshal(frame.Payload, &req) != nil {
				continue
			}
			if req.Method == "terminal.attach" {
				var params herdrcore.TerminalAttachParams
				_ = json.Unmarshal(req.Params, &params)
				s.mu.Lock()
				term, ok := s.terminals[params.Terminal]
				if !ok {
					s.mu.Unlock()
					reply, _ := json.Marshal(rpcErr(req.ID, -32000, "not_found", "terminal not found"))
					_ = herdrcore.WriteFrame(conn, herdrcore.Frame{Channel: herdrcore.ControlChannel, Kind: herdrcore.FrameData, Payload: reply})
					continue
				}
				ch := s.nextChannel
				s.nextChannel++
				peer = &fakeFramedPeer{conn: conn, channel: ch, closed: make(chan struct{})}
				s.attaches = append(s.attaches, &fakeHerdrCoreAttachRecord{Params: params, Conn: peer})
				s.mu.Unlock()

				reply, _ := json.Marshal(map[string]any{
					"jsonrpc": "2.0",
					"id":      req.ID,
					"result": herdrcore.AttachResult{
						Channel:             ch,
						ResizeNotifications: params.ResizeNotifications,
						Terminal:            term,
					},
				})
				peer.writeMu.Lock()
				err := herdrcore.WriteFrame(conn, herdrcore.Frame{Channel: herdrcore.ControlChannel, Kind: herdrcore.FrameData, Payload: reply})
				peer.writeMu.Unlock()
				if err != nil {
					return
				}
				continue
			}
			resp := s.handleRPC(conn, req.ID, req.Method, req.Params)
			if resp != nil {
				encoded, _ := json.Marshal(resp)
				_ = herdrcore.WriteFrame(conn, herdrcore.Frame{Channel: herdrcore.ControlChannel, Kind: herdrcore.FrameData, Payload: encoded})
			}
			continue
		}
		if peer != nil && frame.Channel == peer.channel {
			peer.mu.Lock()
			peer.received = append(peer.received, frame)
			peer.mu.Unlock()
			if frame.Kind == herdrcore.FrameClose {
				return
			}
		}
	}
}

func rpcOK(id json.RawMessage, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}

func rpcErr(id json.RawMessage, code int, kind, message string) map[string]any {
	return map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error": map[string]any{
			"code":    code,
			"message": message,
			"data":    map[string]any{"kind": kind},
		},
	}
}

func (s *fakeHerdrCoreServer) handleRPC(conn net.Conn, id json.RawMessage, method string, rawParams json.RawMessage) map[string]any {
	var paramMap map[string]any
	_ = json.Unmarshal(rawParams, &paramMap)
	s.mu.Lock()
	s.requests = append(s.requests, fakeHerdrCoreRPCRequest{Method: method, Params: paramMap})
	closeOnSend := s.closeConnOnSend
	s.mu.Unlock()

	switch method {
	case "server.status":
		s.mu.Lock()
		live, finished := uint(0), uint(0)
		for _, term := range s.terminals {
			if term.State == herdrcore.TerminalStateLive {
				live++
			} else {
				finished++
			}
		}
		s.mu.Unlock()
		return rpcOK(id, herdrcore.StatusResult{
			Core:     herdrcore.CoreInfo{ID: "core-1", Name: "default"},
			Version:  "0.1.21",
			PID:      4242,
			UptimeMS: 9001,
			Live:     live,
			Finished: finished,
		})
	case "templates.list":
		s.mu.Lock()
		tpls := slices.Clone(s.templates)
		s.mu.Unlock()
		return rpcOK(id, herdrcore.TemplatesResult{Templates: tpls})
	case "machine.list":
		s.mu.Lock()
		machines := slices.Clone(s.machines)
		s.mu.Unlock()
		return rpcOK(id, herdrcore.MachineListResult{Machines: machines})
	case "terminal.list":
		var params herdrcore.TerminalListParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		out := []herdrcore.Terminal{}
		for _, term := range s.terminals {
			if !params.All && term.State != herdrcore.TerminalStateLive {
				continue
			}
			matched := true
			for k, v := range params.Labels {
				if term.Labels[k] != v {
					matched = false
					break
				}
			}
			if matched {
				out = append(out, term)
			}
		}
		machines := slices.Clone(s.machines)
		s.mu.Unlock()
		return rpcOK(id, herdrcore.ListResult{Terminals: out, Machines: machines})
	case "terminal.get":
		var params herdrcore.TerminalGetParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		term, ok := s.terminals[params.Terminal]
		s.mu.Unlock()
		if !ok {
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "terminal not found")
		}
		return rpcOK(id, term)
	case "terminal.read":
		var params herdrcore.TerminalReadParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		res, ok := s.reads[params.Terminal]
		s.mu.Unlock()
		if !ok {
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "terminal not found")
		}
		return rpcOK(id, res)
	case "terminal.run":
		var params herdrcore.TerminalRunParams
		_ = json.Unmarshal(rawParams, &params)
		cols, rows := uint16(120), uint16(36)
		if params.Size != nil {
			cols, rows = params.Size.Cols, params.Size.Rows
		}
		addr := "t99"
		if params.On != nil && *params.On != "" {
			addr = *params.On + "/t99"
		}
		term := herdrcore.Terminal{
			Address:   addr,
			Argv:      params.Argv,
			Name:      params.Name,
			State:     herdrcore.TerminalStateLive,
			Cwd:       derefString(params.Cwd),
			Labels:    params.Labels,
			Keep:      params.Keep,
			Parent:    params.Parent,
			Cols:      cols,
			Rows:      rows,
			CreatedMS: 1732670400000,
		}
		s.mu.Lock()
		s.terminals[addr] = term
		s.mu.Unlock()
		return rpcOK(id, herdrcore.RunResult{Terminal: term})
	case "terminal.send":
		if closeOnSend {
			_ = conn.Close()
			return nil
		}
		var params herdrcore.TerminalSendParams
		_ = json.Unmarshal(rawParams, &params)
		if params.If != nil && *params.If != herdrcore.SendIfIdle && *params.If != herdrcore.SendIfWorking {
			return rpcErr(id, -32602, herdrcore.ErrKindInvalidParams, "unknown variant for if")
		}
		s.mu.Lock()
		term, ok := s.terminals[params.Terminal]
		s.mu.Unlock()
		if !ok {
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "terminal not found")
		}
		if term.State != herdrcore.TerminalStateLive {
			return rpcErr(id, -32000, herdrcore.ErrKindFinished, "terminal finished")
		}
		started := true
		status := herdrcore.StatusWorking
		return rpcOK(id, herdrcore.SendResult{Started: &started, Status: &status, Turn: term.Turn + 1})
	case "terminal.keys":
		var params herdrcore.TerminalKeysParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		term, ok := s.terminals[params.Terminal]
		s.mu.Unlock()
		if !ok {
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "terminal not found")
		}
		status := herdrcore.StatusWorking
		return rpcOK(id, herdrcore.KeysResult{Status: &status, Turn: term.Turn})
	case "terminal.interrupt":
		return rpcOK(id, herdrcore.InterruptResult{Key: "esc", Outcome: "stopped"})
	case "terminal.wait":
		var params herdrcore.TerminalWaitParams
		_ = json.Unmarshal(rawParams, &params)
		st := herdrcore.StatusDone
		return rpcOK(id, herdrcore.WaitResult{
			Terminal: derefString(params.Terminal),
			Ended:    true,
			Reason:   "status",
			Status:   &st,
			Turn:     2,
			Children: []herdrcore.WaitResult{},
		})
	case "terminal.kill":
		var params herdrcore.TerminalKillParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		term, ok := s.terminals[params.Terminal]
		if ok {
			term.State = herdrcore.TerminalStateFinished
			s.terminals[params.Terminal] = term
		}
		s.mu.Unlock()
		if !ok {
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "terminal not found")
		}
		return rpcOK(id, term)
	case "terminal.rm":
		var params herdrcore.TerminalRemoveParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		_, ok := s.terminals[params.Terminal]
		delete(s.terminals, params.Terminal)
		s.mu.Unlock()
		if !ok {
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "terminal not found")
		}
		return rpcOK(id, herdrcore.RemoveResult{Removed: params.Terminal})
	case "terminal.keep":
		var params herdrcore.TerminalKeepParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		term, ok := s.terminals[params.Terminal]
		if ok {
			term.Keep = params.Keep
			s.terminals[params.Terminal] = term
		}
		s.mu.Unlock()
		if !ok {
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "terminal not found")
		}
		return rpcOK(id, term)
	case "terminal.label":
		var params herdrcore.TerminalLabelParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		term, ok := s.terminals[params.Terminal]
		if ok {
			if term.Labels == nil {
				term.Labels = map[string]string{}
			}
			for k, v := range params.Labels {
				if v == "" {
					delete(term.Labels, k)
				} else {
					term.Labels[k] = v
				}
			}
			s.terminals[params.Terminal] = term
		}
		s.mu.Unlock()
		if !ok {
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "terminal not found")
		}
		return rpcOK(id, term)
	case "terminal.put":
		var params herdrcore.TerminalPutParams
		_ = json.Unmarshal(rawParams, &params)
		decoded, err := base64.StdEncoding.DecodeString(params.Data)
		if err != nil {
			return rpcErr(id, -32602, herdrcore.ErrKindInvalidParams, "invalid base64")
		}
		return rpcOK(id, herdrcore.PutResult{
			Path:  "/tmp/hc-put/" + params.Name,
			Bytes: uint(len(decoded)),
		})
	case "machine.exec":
		var params herdrcore.MachineExecParams
		_ = json.Unmarshal(rawParams, &params)
		code := int32(0)
		return rpcOK(id, herdrcore.ExecResult{
			Code:   &code,
			MS:     12,
			Stdout: base64.StdEncoding.EncodeToString([]byte("exec-ok\n")),
			Stderr: "",
		})
	case "file.write":
		var params herdrcore.FileWriteParams
		_ = json.Unmarshal(rawParams, &params)
		raw, err := base64.StdEncoding.DecodeString(params.Data)
		if err != nil {
			return rpcErr(id, -32602, herdrcore.ErrKindInvalidParams, "invalid base64")
		}
		s.mu.Lock()
		s.files[params.Path] = string(raw)
		s.mu.Unlock()
		return rpcOK(id, herdrcore.FileResult{Path: params.Path, Bytes: uint(len(raw))})
	case "file.read":
		var params herdrcore.FileReadParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		content, ok := s.files[params.Path]
		s.mu.Unlock()
		if !ok {
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "file not found")
		}
		return rpcOK(id, herdrcore.FileReadResult{Text: content, First: 1, Last: 1, Lines: 1})
	case "file.edit":
		var params herdrcore.FileEditParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		content, ok := s.files[params.Path]
		if !ok {
			s.mu.Unlock()
			return rpcErr(id, -32000, herdrcore.ErrKindNotFound, "file not found")
		}
		updated := content
		for _, edit := range params.Edits {
			if strings.Count(updated, edit.Old) != 1 {
				s.mu.Unlock()
				return rpcErr(id, -32000, herdrcore.ErrKindEditFailed, "old text must match exactly once")
			}
			updated = strings.Replace(updated, edit.Old, edit.New, 1)
		}
		s.files[params.Path] = updated
		s.mu.Unlock()
		return rpcOK(id, herdrcore.FileResult{Path: params.Path, Bytes: uint(len(updated))})
	case "doc.get":
		var params herdrcore.DocGetParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		doc, ok := s.docs[params.Name]
		s.mu.Unlock()
		if !ok {
			return rpcOK(id, herdrcore.DocGetResult{Version: 0, Value: json.RawMessage("null")})
		}
		return rpcOK(id, doc)
	case "doc.set":
		var params herdrcore.DocSetParams
		_ = json.Unmarshal(rawParams, &params)
		s.mu.Lock()
		current := s.docs[params.Name]
		if current.Version != params.Version {
			s.mu.Unlock()
			return rpcErr(id, -32000, herdrcore.ErrKindConflict, "version conflict")
		}
		nextVer := current.Version + 1
		s.docs[params.Name] = herdrcore.DocGetResult{Version: nextVer, Value: params.Value}
		s.mu.Unlock()
		return rpcOK(id, herdrcore.DocSetResult{Version: nextVer})
	default:
		return rpcErr(id, -32601, herdrcore.ErrKindInvalidParams, "unknown method: "+method)
	}
}

func executeComputerTool(t *testing.T, d *Daemon, ctx context.Context, agentID, server, toolName string, args map[string]any) map[string]any {
	t.Helper()
	stream := &browserEventStream{}
	payload := mustJSON(map[string]any{
		"tool_session_id": "sess-1",
		"server":          server,
		"tool_name":       toolName,
		"arguments":       args,
		"deadline_ms":     10000,
	})
	err := d.handleComputerTool(ctx, stream, protocol.Command{
		Type:            protocol.CommandComputerToolCall,
		CommandID:       "cmd-1",
		RunnerID:        d.computerID,
		ConnectionEpoch: 7,
		TenantID:        "tenant-1",
		OwnerActorID:    "owner-1",
		AgentID:         agentID,
		Payload:         payload,
	})
	if err != nil {
		t.Fatalf("handleComputerTool(%s/%s): %v", server, toolName, err)
	}
	if len(stream.events) != 1 || stream.events[0].Type != protocol.EventComputerToolResult {
		t.Fatalf("events=%+v", stream.events)
	}
	var wireResult wire.ComputerToolResult
	if err := json.Unmarshal(stream.events[0].Payload, &wireResult); err != nil {
		t.Fatalf("unmarshal ComputerToolResult: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(wireResult.Result, &out); err != nil {
		t.Fatalf("unmarshal tool result: %v", err)
	}
	return out
}

func TestHerdrCoreServiceFeaturesGatingAndDualStackCoexistence(t *testing.T) {
	device, err := transport.GenerateIdentity()
	if err != nil {
		t.Fatal(err)
	}
	srv := newFakeHerdrCoreServer(t)
	panes := &recordedHerdrPanes{status: herdr.AnswerSent}
	assignments := assignment.NewMemoryStore()
	putReadyAssignment(t, assignments, "computer-hc", "tenant-1", "agent-1")

	release1 := make(chan struct{})
	stream1 := &fakeStream{
		commands: []protocol.Command{{Type: protocol.CommandRunnerWelcome, ConnectionEpoch: 1}},
		wait:     release1,
	}
	release2 := make(chan struct{})
	stream2 := &fakeStream{
		commands: []protocol.Command{{
			Type:            protocol.CommandRunnerWelcome,
			ConnectionEpoch: 2,
			ServiceFeatures: []string{serviceFeatureHerdrCoreV1},
		}},
		wait: release2,
	}
	plane := &sequenceControlPlane{streams: []*fakeStream{stream1, stream2}}
	d, err := newTestDaemon(t, Options{
		ComputerID:        "computer-hc",
		ControlPlane:      plane,
		IdentityStore:     fakeStore{value: device},
		OperationResolver: fakeOperationResolver{},
		Assignments:       assignments,
		Owners:            []ComputerOwner{{TenantID: "tenant-1", OwnerActorID: "owner-1"}},
		HerdrPanes:        panes,
		HerdrCore:         srv.client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	d.now = func() time.Time { return time.Date(2026, 11, 27, 1, 0, 0, 0, time.UTC) }

	// Connection 1: no herdr_core_v1 feature -> runner.herdr_core_event is suppressed,
	// herdr_core tools report unavailable, while legacy herdr still works seamlessly.
	conn1Done := make(chan error, 1)
	go func() { conn1Done <- d.runConnection(context.Background(), device) }()
	waitCondition(t, func() bool {
		d.connectionMu.Lock()
		defer d.connectionMu.Unlock()
		return d.diagnosticsStream == stream1
	})

	progress := uint8(50)
	statusMS := uint64(1732670400000)
	hcEvent := herdrcore.Event{
		Kind:     herdrcore.EventBlocked,
		Address:  "vps/t7",
		Name:     "worker",
		Template: "codex",
		Parent:   "vps/t1",
		Cwd:      "/srv/app",
		Title:    "Deploy",
		Status:   &herdrcore.Status{State: herdrcore.StatusBlocked, App: "codex", Msg: "Approve?", Progress: &progress, Title: "Wait"},
		Turn:     4,
		StatusMS: &statusMS,
		Labels:   map[string]string{"linger.room": "room-1"},
		Tail:     "export API_KEY=sk-secretvalue1234567890\nApprove? [y/N]",
	}
	if err := d.PublishHerdrCoreEvent(t.Context(), hcEvent); err != nil {
		t.Fatalf("PublishHerdrCoreEvent without feature should return nil, got %v", err)
	}
	if err := d.PublishHerdrEvent(t.Context(), herdr.Event{Kind: herdr.EventBlocked, PaneID: "w1:p1", StateChangeSeq: 7}); err != nil {
		t.Fatalf("legacy PublishHerdrEvent failed: %v", err)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "status", map[string]any{}); got["status"] != "unavailable" {
		t.Fatalf("status without herdr_core_v1 = %+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), "agent-1", "herdr", "answer", map[string]any{"pane_id": "w1:p1", "state_change_seq": 7, "text": "yes"}); got["status"] != "ok" {
		t.Fatalf("legacy herdr answer failed: %+v", got)
	}
	for _, ev := range stream1.snapshotEvents() {
		if ev.Type == protocol.EventHerdrCore {
			t.Fatalf("runner.herdr_core_event leaked without herdr_core_v1: %+v", ev)
		}
	}
	close(release1)
	<-conn1Done

	// Connection 2: herdr_core_v1 enabled (without herdr_core_stream).
	d.setGatewayState("connecting")
	conn2Done := make(chan error, 1)
	go func() { conn2Done <- d.runConnection(context.Background(), device) }()
	waitCondition(t, func() bool {
		d.connectionMu.Lock()
		defer d.connectionMu.Unlock()
		return d.diagnosticsStream == stream2 && d.herdrCoreV1.Load()
	})

	for _, kind := range []string{herdrcore.EventBlocked, herdrcore.EventFinished, herdrcore.EventError, herdrcore.EventTerminalChanged} {
		ev := hcEvent
		ev.Kind = kind
		if err := d.PublishHerdrCoreEvent(t.Context(), ev); err != nil {
			t.Fatalf("PublishHerdrCoreEvent(%s): %v", kind, err)
		}
	}
	// attach must remain gated until herdr_core_stream is advertised.
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "attach", map[string]any{
		"session_id": "s1", "stream_path": "/v1/runner-gateway/herdr-core-stream", "address": "vps/t7", "cols": 120, "rows": 36,
	}); got["status"] != "unavailable" {
		t.Fatalf("attach without herdr_core_stream = %+v", got)
	}

	var published []wire.RunnerHerdrCoreEvent
	for _, ev := range stream2.snapshotEvents() {
		if ev.Type != protocol.EventHerdrCore {
			continue
		}
		var frame wire.RunnerHerdrCoreEvent
		if err := wire.Decode(ev.Payload, &frame); err != nil {
			t.Fatalf("wire.Decode(RunnerHerdrCoreEvent): %v payload=%s", err, ev.Payload)
		}
		published = append(published, frame)
	}
	if len(published) != 4 {
		t.Fatalf("published herdr_core events=%d, want 4", len(published))
	}
	first := published[0]
	if first.Event.Kind != "agent_blocked" || first.Event.Address != "vps/t7" || first.Event.Machine != "vps" ||
		first.Event.Turn != 4 || first.Event.StatusMs != 1732670400000 || first.Event.Parent != "vps/t1" ||
		first.Event.Status == nil || first.Event.Status.State != "blocked" || first.Event.Status.App != "codex" ||
		strings.Contains(first.Event.Tail, "sk-secretvalue") || !strings.HasSuffix(first.Event.Tail, "Approve? [y/N]") {
		t.Fatalf("unexpected RunnerHerdrCoreEvent frame: %+v", first)
	}

	close(release2)
	<-conn2Done

	// After disconnect, features are reset to false.
	if d.herdrCoreV1.Load() || d.herdrCoreStream.Load() {
		t.Fatal("service_features flags were not cleared after disconnect")
	}
}

func TestHerdrCoreControlPlaneAllToolsAndAuth(t *testing.T) {
	srv := newFakeHerdrCoreServer(t)
	name := "worker"
	tpl := "codex"
	parent := "vps/t1"
	statusMS := uint64(1732670400000)
	srv.terminals["vps/t7"] = herdrcore.Terminal{
		Address:    "vps/t7",
		Name:       &name,
		Template:   &tpl,
		Parent:     &parent,
		State:      herdrcore.TerminalStateLive,
		Turn:       5,
		StatusMS:   &statusMS,
		Status:     &herdrcore.Status{State: herdrcore.StatusBlocked, App: "codex", Msg: "Run tests?"},
		Cwd:        "/srv/app",
		Foreground: &herdrcore.Foreground{Cwd: "/srv/app/sub", Name: "codex"},
		Labels:     map[string]string{"linger.room": "room-1", "linger.work_item": "wi-1"},
		Cols:       120,
		Rows:       36,
		CreatedMS:  1732670300000,
	}
	srv.terminals["t2"] = herdrcore.Terminal{
		Address:   "t2",
		State:     herdrcore.TerminalStateLive,
		Turn:      2,
		Status:    &herdrcore.Status{State: herdrcore.StatusWorking, App: "claude"},
		Cwd:       "/local",
		Labels:    map[string]string{"linger.room": "room-2"},
		Cols:      80,
		Rows:      24,
		CreatedMS: 1732670350000,
	}
	srv.terminals["t3"] = herdrcore.Terminal{
		Address:   "t3",
		State:     herdrcore.TerminalStateFinished,
		Turn:      1,
		CreatedMS: 1732670200000,
	}
	srv.reads["vps/t7"] = herdrcore.ReadResult{Text: "Prompt? [y/N]", Complete: true, How: "screen"}
	srv.machines = []herdrcore.MachineView{{Name: "vps", Host: "10.0.0.2", State: "connected", Version: "0.1.21"}}
	srv.templates = []herdrcore.TemplateInfo{{Name: "reviewer", Description: "Code reviewer", Command: "codex --no-daemon"}}

	assignments := assignment.NewMemoryStore()
	putReadyAssignment(t, assignments, "computer-1", "tenant-1", "agent-ready")
	d := &Daemon{
		computerID:       "computer-1",
		owners:           []ComputerOwner{{TenantID: "tenant-1", OwnerActorID: "owner-1"}},
		assignments:      assignments,
		locallyStopped:   map[string]bool{"agent-stopped": true},
		herdrCore:        srv.client(),
		herdrCoreStreams: make(map[string]*herdrCoreAttachBridge),
	}
	d.herdrCoreV1.Store(true)

	// Authorization checks: owner-scoped sentinel works without an assignment;
	// unplaced/stopped agents and wrong owners are forbidden.
	if got := executeComputerTool(t, d, t.Context(), "agent-unplaced", "herdr_core", "status", map[string]any{}); got["status"] != "forbidden" {
		t.Fatalf("unplaced agent got=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), "agent-stopped", "herdr_core", "status", map[string]any{}); got["status"] != "forbidden" {
		t.Fatalf("stopped agent got=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), "agent-ready", "herdr_core", "status", map[string]any{}); got["available"] != true {
		t.Fatalf("ready agent status got=%+v", got)
	}

	// 1. status
	statusRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "status", map[string]any{})
	if statusRes["available"] != true || statusRes["blocked_count"] != float64(1) || statusRes["working_count"] != float64(1) {
		t.Fatalf("status=%+v", statusRes)
	}

	// 2. list with machine, room_id, status filters
	listRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "list", map[string]any{
		"machine": "vps", "room_id": "room-1", "status": "blocked",
	})
	terms := listRes["terminals"].([]any)
	if len(terms) != 1 || terms[0].(map[string]any)["address"] != "vps/t7" {
		t.Fatalf("list=%+v", listRes)
	}

	// 3. get
	getRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "get", map[string]any{"address": "vps/t7"})
	if getRes["terminal"].(map[string]any)["foreground_cwd"] != "/srv/app/sub" {
		t.Fatalf("get=%+v", getRes)
	}

	// 4. read
	readRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "read", map[string]any{"address": "vps/t7", "lines": 50})
	if readRes["text"] != "Prompt? [y/N]" || readRes["complete"] != true {
		t.Fatalf("read=%+v", readRes)
	}

	// 5. run (template + task + COLSxROWS size)
	runRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "run", map[string]any{
		"template": "reviewer", "task": "audit main.go", "on": "vps", "size": "100x30", "labels": map[string]string{"linger.room": "r9"},
	})
	if runRes["terminal"].(map[string]any)["address"] != "vps/t99" {
		t.Fatalf("run=%+v", runRes)
	}

	// 6. send: if="blocked" CAS (success, stale turn, non-blocked, finished), plus if="working"
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": "vps/t7", "text": "yes", "if": "blocked", "turn": 4,
	}); got["status"] != herdrcore.AnswerTerminalNotBlocked {
		t.Fatalf("stale turn send(if=blocked) = %+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": "t2", "text": "yes", "if": "blocked",
	}); got["status"] != herdrcore.AnswerTerminalNotBlocked {
		t.Fatalf("working terminal send(if=blocked) = %+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": "t3", "text": "yes", "if": "blocked",
	}); got["status"] != herdrcore.AnswerTerminalClosed {
		t.Fatalf("finished terminal send(if=blocked) = %+v", got)
	}
	sendBlocked := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": "vps/t7", "text": "yes", "if": "blocked", "turn": 5,
	})
	if sendBlocked["status"] != "working" || sendBlocked["started"] != true || sendBlocked["turn"] != float64(6) {
		t.Fatalf("send(if=blocked) = %+v", sendBlocked)
	}
	sendWorking := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": "t2", "text": "focus", "if": "working", "timeout": 15000,
	})
	if sendWorking["status"] != "working" {
		t.Fatalf("send(if=working) = %+v", sendWorking)
	}
	// Verify the blocked send dispatched force=true and NO "if" parameter,
	// while the working send forwarded if="working" and converted 15000ms -> 15s.
	var sawBlockedSend, sawWorkingSend bool
	for _, req := range srv.recordedRequests() {
		if req.Method != "terminal.send" {
			continue
		}
		if req.Params["terminal"] == "vps/t7" && req.Params["text"] == "yes" {
			if req.Params["force"] != true {
				t.Fatalf("blocked CAS send must set force=true: %+v", req.Params)
			}
			if _, hasIf := req.Params["if"]; hasIf {
				t.Fatalf("blocked CAS send must omit if: %+v", req.Params)
			}
			sawBlockedSend = true
		}
		if req.Params["terminal"] == "t2" && req.Params["if"] == "working" && req.Params["timeout"] == float64(15) {
			sawWorkingSend = true
		}
	}
	if !sawBlockedSend || !sawWorkingSend {
		t.Fatalf("sawBlockedSend=%v sawWorkingSend=%v", sawBlockedSend, sawWorkingSend)
	}

	// 7-16: keys, interrupt, wait, keep, label, put, templates, machines, kill, rm
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "keys", map[string]any{"address": "vps/t7", "keys": []string{"y", "enter"}}); got["status"] != "working" {
		t.Fatalf("keys=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "interrupt", map[string]any{"address": "vps/t7", "timeout": 5000}); got["outcome"] != "stopped" {
		t.Fatalf("interrupt=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "wait", map[string]any{"address": "vps/t7", "timeout": 5}); got["ended"] != true {
		t.Fatalf("wait=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "keep", map[string]any{"address": "vps/t7", "keep": true}); got["terminal"].(map[string]any)["keep"] != true {
		t.Fatalf("keep=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "label", map[string]any{"address": "vps/t7", "labels": map[string]string{"env": "prod"}}); got["terminal"].(map[string]any)["labels"].(map[string]any)["env"] != "prod" {
		t.Fatalf("label=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "put", map[string]any{
		"address": "vps/t7", "name": "shot.png", "data_base64": base64.StdEncoding.EncodeToString([]byte("PNGDATA")),
	}); got["path"] != "/tmp/hc-put/shot.png" || got["bytes"] != float64(7) {
		t.Fatalf("put=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "templates", map[string]any{}); len(got["templates"].([]any)) != 1 {
		t.Fatalf("templates=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "machines", map[string]any{}); len(got["machines"].([]any)) != 1 {
		t.Fatalf("machines=%+v", got)
	}

	// 17-22: exec, file_write, file_read, file_edit (single + replace_all), doc_get, doc_set
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "exec", map[string]any{"argv": []string{"echo", "ok"}}); got["stdout"] != "exec-ok\n" || got["code"] != float64(0) {
		t.Fatalf("exec=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_write", map[string]any{
		"path": "/tmp/a.txt", "content": "foo bar foo",
	}); got["bytes"] != float64(11) {
		t.Fatalf("file_write=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_read", map[string]any{
		"path": "/tmp/a.txt", "offset": 0,
	}); got["text"] != "foo bar foo" {
		t.Fatalf("file_read=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_edit", map[string]any{
		"path": "/tmp/a.txt", "old": "bar", "new": "baz",
	}); got["bytes"] != float64(11) {
		t.Fatalf("file_edit single=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_edit", map[string]any{
		"path": "/tmp/a.txt", "old": "foo", "new": "qux", "replace_all": true,
	}); got["bytes"] != float64(11) {
		t.Fatalf("file_edit replace_all=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_read", map[string]any{"path": "/tmp/a.txt"}); got["text"] != "qux baz qux" {
		t.Fatalf("file_read after replace_all=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "doc_set", map[string]any{
		"name": "linger-workbench", "version": 0, "value": map[string]any{"pinned": []string{"vps/t7"}},
	}); got["version"] != float64(1) {
		t.Fatalf("doc_set=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "doc_set", map[string]any{
		"name": "linger-workbench", "version": 0, "value": map[string]any{"stale": true},
	}); got["status"] != "version_conflict" {
		t.Fatalf("doc_set conflict=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "doc_get", map[string]any{"name": "linger-workbench"}); got["version"] != float64(1) {
		t.Fatalf("doc_get=%+v", got)
	}

	// 23. answer (text + keys + stale + invalid + post-check transport drop -> outcome_unknown)
	if got := executeComputerTool(t, d, t.Context(), "agent-ready", "herdr_core", "answer", map[string]any{
		"address": "vps/t7", "turn": 5, "text": "Proceed",
	}); got["status"] != "ok" {
		t.Fatalf("answer text=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), "agent-ready", "herdr_core", "answer", map[string]any{
		"address": "vps/t7", "turn": 5, "keys": []string{"down", "enter"},
	}); got["status"] != "ok" {
		t.Fatalf("answer keys=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), "agent-ready", "herdr_core", "answer", map[string]any{
		"address": "vps/t7", "turn": 4, "text": "Stale",
	}); got["status"] != herdrcore.AnswerTerminalNotBlocked {
		t.Fatalf("answer stale=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), "agent-ready", "herdr_core", "answer", map[string]any{
		"address": "vps/t7", "turn": 5, "text": "bad\nline",
	}); got["status"] != herdrcore.AnswerInvalid {
		t.Fatalf("answer invalid=%+v", got)
	}
	srv.mu.Lock()
	srv.closeConnOnSend = true
	srv.mu.Unlock()
	if got := executeComputerTool(t, d, t.Context(), "agent-ready", "herdr_core", "answer", map[string]any{
		"address": "vps/t7", "turn": 5, "text": "Drop mid-flight",
	}); got["status"] != "outcome_unknown" {
		t.Fatalf("answer post-check drop=%+v", got)
	}

	// kill + rm
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "kill", map[string]any{"address": "t2"}); got["ok"] != true {
		t.Fatalf("kill=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "rm", map[string]any{"address": "t2"}); got["removed"] != true {
		t.Fatalf("rm=%+v", got)
	}

	// Unavailable when HerdrCore client is nil or unreachable socket.
	dNil := &Daemon{computerID: "computer-1", owners: d.owners, locallyStopped: map[string]bool{}}
	dNil.herdrCoreV1.Store(true)
	if got := executeComputerTool(t, dNil, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "status", map[string]any{}); got["status"] != herdrcore.AnswerUnavailable {
		t.Fatalf("nil client status=%+v", got)
	}
	dUnreachable := &Daemon{
		computerID:     "computer-1",
		owners:         d.owners,
		locallyStopped: map[string]bool{},
		herdrCore:      &herdrcore.Client{Socket: filepath.Join(t.TempDir(), "missing.sock")},
	}
	dUnreachable.herdrCoreV1.Store(true)
	if got := executeComputerTool(t, dUnreachable, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "status", map[string]any{}); got["status"] != herdrcore.AnswerUnavailable {
		t.Fatalf("unreachable status=%+v", got)
	}
}

func TestHerdrCoreAttachStreamBridgeObserveTakeOverPutAndTeardown(t *testing.T) {
	srv := newFakeHerdrCoreServer(t)
	srv.terminals["vps/t7"] = herdrcore.Terminal{
		Address: "vps/t7",
		State:   herdrcore.TerminalStateLive,
		Cols:    120,
		Rows:    36,
		Status:  &herdrcore.Status{State: herdrcore.StatusWorking, App: "codex"},
	}

	type wsArrival struct {
		conn  *websocket.Conn
		query string
		auth  string
	}
	arrivals := make(chan wsArrival, 2)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/runner-gateway/herdr-core-stream" {
			http.NotFound(w, r)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		arrivals <- wsArrival{conn: conn, query: r.URL.RawQuery, auth: r.Header.Get("Authorization")}
	}))
	defer relay.Close()

	wsOrigin := "ws" + strings.TrimPrefix(relay.URL, "http") + "/v1/runner-gateway/ws"
	d := &Daemon{
		computerID:     "computer-hc",
		owners:         []ComputerOwner{{TenantID: "tenant-1", OwnerActorID: "owner-1"}},
		locallyStopped: map[string]bool{},
		herdrCore:      srv.client(),
		herdrCoreStreamTarget: HerdrCoreStreamTarget{
			URL:         wsOrigin,
			BearerToken: "runner-secret-token",
		},
		herdrCoreStreams: make(map[string]*herdrCoreAttachBridge),
	}
	d.herdrCoreV1.Store(true)
	d.herdrCoreStream.Store(true)

	connCtx, cancelConn := context.WithCancel(t.Context())
	defer cancelConn()

	attachRes := executeComputerTool(t, d, connCtx, ownerHerdrCoreAgentID, "herdr_core", "attach", map[string]any{
		"session_id":           "hcs-1",
		"stream_path":          "/v1/runner-gateway/herdr-core-stream",
		"address":              "vps/t7",
		"cols":                 120,
		"rows":                 36,
		"observe":              true,
		"history":              200,
		"resumed":              false,
		"resize_notifications": true,
	})
	if attachRes["status"] != "accepted" || attachRes["session_id"] != "hcs-1" {
		t.Fatalf("attach result=%+v", attachRes)
	}
	if d.ActiveHerdrCoreStreamCount() != 1 {
		t.Fatalf("ActiveHerdrCoreStreamCount=%d, want 1", d.ActiveHerdrCoreStreamCount())
	}

	var arrival wsArrival
	select {
	case arrival = <-arrivals:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for outbound WS dial")
	}
	defer func() { _ = arrival.conn.Close() }()
	if arrival.auth != "Bearer runner-secret-token" ||
		!strings.Contains(arrival.query, "session_id=hcs-1") ||
		!strings.Contains(arrival.query, "connection_epoch=7") {
		t.Fatalf("unexpected WS dial auth=%q query=%q", arrival.auth, arrival.query)
	}

	// Read initial attached + status control frames.
	readJSON := func() map[string]any {
		t.Helper()
		_ = arrival.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		msgType, data, err := arrival.conn.ReadMessage()
		if err != nil {
			t.Fatalf("ws ReadMessage: %v", err)
		}
		if msgType != websocket.TextMessage {
			t.Fatalf("expected TextMessage, got %d (%q)", msgType, data)
		}
		var out map[string]any
		if err := json.Unmarshal(data, &out); err != nil {
			t.Fatalf("unmarshal text frame: %v", err)
		}
		return out
	}
	attachedMsg := readJSON()
	if attachedMsg["type"] != "attached" || attachedMsg["address"] != "vps/t7" || attachedMsg["observe"] != true {
		t.Fatalf("attached frame=%+v", attachedMsg)
	}
	statusMsg := readJSON()
	if statusMsg["type"] != "status" {
		t.Fatalf("status frame=%+v", statusMsg)
	}

	// PTY -> WS binary bytes + ManualCredit verification.
	firstAttach := srv.latestAttach()
	if firstAttach == nil || !firstAttach.Params.Observe || !firstAttach.Params.ResizeNotifications {
		t.Fatalf("first attach params=%+v", firstAttach)
	}
	wantPTY := []byte("\x1b[32mhello>\x1b[0m ")
	if err := firstAttach.Conn.sendFrame(herdrcore.FrameData, wantPTY); err != nil {
		t.Fatal(err)
	}
	_ = arrival.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	msgType, rawPTY, err := arrival.conn.ReadMessage()
	if err != nil || msgType != websocket.BinaryMessage || !bytes.Equal(rawPTY, wantPTY) {
		t.Fatalf("PTY binary frame type=%d data=%q err=%v", msgType, rawPTY, err)
	}
	waitCondition(t, func() bool {
		for _, f := range firstAttach.Conn.snapshotFrames() {
			if f.Kind == herdrcore.FrameCredit {
				n, decErr := herdrcore.DecodeCredit(f.Payload)
				if decErr == nil && n == uint32(len(wantPTY)) {
					return true
				}
			}
		}
		return false
	})

	// Server-to-observer FrameResize forwards as JSON resize frame.
	if err := firstAttach.Conn.sendFrame(herdrcore.FrameResize, herdrcore.EncodeResize(100, 30)); err != nil {
		t.Fatal(err)
	}
	resizeNote := readJSON()
	if resizeNote["type"] != "resize" || resizeNote["cols"] != float64(100) || resizeNote["rows"] != float64(30) {
		t.Fatalf("resize notification=%+v", resizeNote)
	}

	// While observe=true: binary input, resize, and put are blocked locally as defense-in-depth.
	if err := arrival.conn.WriteMessage(websocket.BinaryMessage, []byte("rm -rf /\r")); err != nil {
		t.Fatal(err)
	}
	if errFrame := readJSON(); errFrame["type"] != "error" || errFrame["code"] != "OBSERVE_ONLY" {
		t.Fatalf("observe binary rejection=%+v", errFrame)
	}
	if err := arrival.conn.WriteJSON(map[string]any{"type": "resize", "cols": 90, "rows": 25}); err != nil {
		t.Fatal(err)
	}
	if errFrame := readJSON(); errFrame["type"] != "error" || errFrame["code"] != "OBSERVE_ONLY" {
		t.Fatalf("observe resize rejection=%+v", errFrame)
	}
	if err := arrival.conn.WriteJSON(map[string]any{"type": "put", "name": "a.txt", "data_base64": base64.StdEncoding.EncodeToString([]byte("x"))}); err != nil {
		t.Fatal(err)
	}
	if errFrame := readJSON(); errFrame["type"] != "error" || errFrame["code"] != "OBSERVE_ONLY" {
		t.Fatalf("observe put rejection=%+v", errFrame)
	}
	for _, f := range firstAttach.Conn.snapshotFrames() {
		if f.Kind == herdrcore.FrameData || f.Kind == herdrcore.FrameResize {
			t.Fatalf("observe-mode client input leaked to herdr-core: %+v", f)
		}
	}

	// ping -> pong
	if err := arrival.conn.WriteJSON(map[string]any{"type": "ping"}); err != nil {
		t.Fatal(err)
	}
	if pong := readJSON(); pong["type"] != "pong" {
		t.Fatalf("pong=%+v", pong)
	}

	// Take Over: mode observe=false re-attaches interactively with resumed=true.
	if err := arrival.conn.WriteJSON(map[string]any{"type": "mode", "observe": false}); err != nil {
		t.Fatal(err)
	}
	takeOverAttached := readJSON()
	if takeOverAttached["type"] != "attached" || takeOverAttached["observe"] != false || takeOverAttached["resumed"] != true {
		t.Fatalf("take over attached=%+v", takeOverAttached)
	}
	if srv.attachCount() != 2 {
		t.Fatalf("attachCount=%d, want 2 after mode switch", srv.attachCount())
	}
	interactiveAttach := srv.latestAttach()
	if interactiveAttach.Params.Observe || !interactiveAttach.Params.Resumed {
		t.Fatalf("interactive attach params=%+v", interactiveAttach.Params)
	}

	// Now binary input, resize, and put flow through cleanly!
	if err := arrival.conn.WriteJSON(map[string]any{"type": "resize", "cols": 110, "rows": 32}); err != nil {
		t.Fatal(err)
	}
	if err := arrival.conn.WriteMessage(websocket.BinaryMessage, []byte("echo ok\r")); err != nil {
		t.Fatal(err)
	}
	waitCondition(t, func() bool {
		var sawResize, sawInput bool
		for _, f := range interactiveAttach.Conn.snapshotFrames() {
			if f.Kind == herdrcore.FrameResize {
				c, r, decErr := herdrcore.DecodeResize(f.Payload)
				if decErr == nil && c == 110 && r == 32 {
					sawResize = true
				}
			}
			if f.Kind == herdrcore.FrameData && string(f.Payload) == "echo ok\r" {
				sawInput = true
			}
		}
		return sawResize && sawInput
	})

	if err := arrival.conn.WriteJSON(map[string]any{
		"type":        "put",
		"name":        "drop.txt",
		"data_base64": base64.StdEncoding.EncodeToString([]byte("hello")),
	}); err != nil {
		t.Fatal(err)
	}
	putRes := readJSON()
	if putRes["type"] != "put_result" || putRes["ok"] != true || putRes["path"] != "/tmp/hc-put/drop.txt" || putRes["bytes"] != float64(5) {
		t.Fatalf("put_result=%+v", putRes)
	}

	// Clean teardown on daemon drain leaves zero active streams and zero leaked goroutines.
	d.Drain()
	closedMsg := readJSON()
	if closedMsg["type"] != "closed" || closedMsg["reason"] != "daemon_draining" {
		t.Fatalf("closed frame=%+v", closedMsg)
	}
	waitDone := make(chan struct{})
	go func() {
		d.WaitForOperations()
		close(waitDone)
	}()
	select {
	case <-waitDone:
	case <-time.After(5 * time.Second):
		t.Fatal("WaitForOperations hung waiting on herdr-core attach stream goroutines")
	}
	if d.ActiveHerdrCoreStreamCount() != 0 {
		t.Fatalf("ActiveHerdrCoreStreamCount=%d after teardown", d.ActiveHerdrCoreStreamCount())
	}
}

func TestHerdrCoreRealBinaryIsolatedE2E(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("isolated Unix socket E2E runs on Unix hosts")
	}
	hcBin := findLocalHC(t)
	if hcBin == "" {
		t.Skip("hc binary not installed on this machine")
	}

	// Strictly isolate XDG_STATE_HOME, XDG_CONFIG_HOME, HC_SESSION, and HC_SOCKET
	// inside a short temp directory under /tmp (macOS limits Unix socket paths
	// to 103 bytes) so we NEVER touch the user's running default core.
	rootDir, err := os.MkdirTemp("/tmp", "hc-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(rootDir) })

	stateDir := filepath.Join(rootDir, "s")
	configDir := filepath.Join(rootDir, "c")
	workDir := filepath.Join(rootDir, "w")
	for _, dir := range []string{stateDir, configDir, workDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	sessionName := "e2e"
	socketPath := filepath.Join(stateDir, "herdr-core", sessionName, sessionName+".sock")

	isolatedEnv := buildIsolatedHCEnv(stateDir, configDir, sessionName, socketPath)
	runHC := func(args ...string) ([]byte, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, hcBin, args...)
		cmd.Env = isolatedEnv
		return cmd.CombinedOutput()
	}

	if out, err := runHC("server", "start"); err != nil {
		t.Fatalf("start isolated hc server: %v\n%s", err, out)
	}
	t.Cleanup(func() {
		_, _ = runHC("server", "stop")
	})

	hcClient := &herdrcore.Client{
		Socket:      socketPath,
		Executable:  hcBin,
		Session:     sessionName,
		Environment: []string{"HC_SESSION=" + sessionName, "HC_SOCKET=" + socketPath, "XDG_STATE_HOME=" + stateDir, "XDG_CONFIG_HOME=" + configDir},
	}
	waitCondition(t, func() bool {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := hcClient.ServerStatus(ctx)
		return err == nil
	})

	// Mock WS relay for testing real binary PTY attach over WebSocket.
	wsArrivals := make(chan *websocket.Conn, 2)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		wsArrivals <- conn
	}))
	defer relay.Close()

	assignments := assignment.NewMemoryStore()
	putReadyAssignment(t, assignments, "computer-e2e", "tenant-1", "agent-1")
	liveStream := &syncEventStream{}
	d := &Daemon{
		computerID:        "computer-e2e",
		owners:            []ComputerOwner{{TenantID: "tenant-1", OwnerActorID: "owner-1"}},
		assignments:       assignments,
		locallyStopped:    map[string]bool{},
		herdrCore:         hcClient,
		diagnosticsStream: liveStream,
		now:               time.Now,
		herdrCoreStreamTarget: HerdrCoreStreamTarget{
			URL:         "ws" + strings.TrimPrefix(relay.URL, "http") + "/v1/runner-gateway/ws",
			BearerToken: "e2e-runner-token",
		},
		herdrCoreStreams: make(map[string]*herdrCoreAttachBridge),
	}
	d.herdrCoreV1.Store(true)
	d.herdrCoreStream.Store(true)

	// Start real herdrcore.Watch -> Daemon.PublishHerdrCoreEvent on the isolated server.
	watchCtx, cancelWatch := context.WithCancel(t.Context())
	watchDone := make(chan error, 1)
	go func() {
		watchDone <- herdrcore.WatchWithOptions(watchCtx, hcClient, herdrcore.WatchOptions{
			Settle:              50 * time.Millisecond,
			RetryInitial:        50 * time.Millisecond,
			RetryMax:            200 * time.Millisecond,
			EmitTerminalChanges: true,
		}, d.PublishHerdrCoreEvent)
	}()
	defer func() {
		cancelWatch()
		<-watchDone
	}()

	// 1. status, templates, machines
	statusRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "status", map[string]any{})
	if statusRes["available"] != true || statusRes["version"] == "" {
		t.Fatalf("real hc status=%+v", statusRes)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "templates", map[string]any{}); got["templates"] == nil {
		t.Fatalf("real hc templates=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "machines", map[string]any{}); got["machines"] == nil {
		t.Fatalf("real hc machines=%+v", got)
	}
	t.Logf("real hc status: version=%v pid=%v core=%v", statusRes["version"], statusRes["pid"], statusRes["core_name"])

	// 2. exec (shell-less argv)
	execRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "exec", map[string]any{
		"argv": []string{"/bin/sh", "-c", "printf 'hello-hc-exec'"},
		"cwd":  workDir,
	})
	if execRes["stdout"] != "hello-hc-exec" || execRes["code"] != float64(0) {
		t.Fatalf("real hc exec=%+v", execRes)
	}

	// 3. file_write -> file_read -> file_edit (single + replace_all)
	testFile := filepath.Join(workDir, "sample.txt")
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_write", map[string]any{
		"path": testFile, "content": "alpha beta alpha\nline2\n",
	}); got["bytes"] != float64(23) {
		t.Fatalf("real hc file_write=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_read", map[string]any{
		"path": testFile, "offset": 1, "limit": 2,
	}); got["text"] != "alpha beta alpha\nline2\n" {
		t.Fatalf("real hc file_read=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_edit", map[string]any{
		"path": testFile, "old": "beta", "new": "gamma",
	}); got["bytes"] != float64(24) {
		t.Fatalf("real hc file_edit single=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_edit", map[string]any{
		"path": testFile, "old": "alpha", "new": "delta", "replace_all": true,
	}); got["bytes"] != float64(24) {
		t.Fatalf("real hc file_edit replace_all=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "file_read", map[string]any{
		"path": testFile,
	}); got["text"] != "delta gamma delta\nline2\n" {
		t.Fatalf("real hc file_read after edits=%+v", got)
	}

	// 4. doc_set -> doc_get -> doc_set conflict
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "doc_set", map[string]any{
		"name": "linger-workbench", "version": 0, "value": map[string]any{"room": "r-e2e"},
	}); got["version"] != float64(1) {
		t.Fatalf("real hc doc_set=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "doc_get", map[string]any{
		"name": "linger-workbench",
	}); got["version"] != float64(1) {
		t.Fatalf("real hc doc_get=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "doc_set", map[string]any{
		"name": "linger-workbench", "version": 0, "value": map[string]any{"stale": true},
	}); got["status"] != "version_conflict" {
		t.Fatalf("real hc doc_set conflict=%+v", got)
	}

	// 5. run a live interactive shell terminal, list, get, label, keep, send, read, keys, put, interrupt
	runRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "run", map[string]any{
		"argv":   []string{"/bin/sh"},
		"cwd":    workDir,
		"name":   "e2e-shell",
		"labels": map[string]string{"linger.room": "room-e2e"},
		"size":   "100x30",
	})
	termObj, ok := runRes["terminal"].(map[string]any)
	if !ok {
		t.Fatalf("real hc run=%+v", runRes)
	}
	addr, _ := termObj["address"].(string)
	if addr == "" {
		t.Fatalf("missing terminal address in run=%+v", runRes)
	}

	listRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "list", map[string]any{
		"room_id": "room-e2e",
	})
	if len(listRes["terminals"].([]any)) != 1 {
		t.Fatalf("real hc list=%+v", listRes)
	}

	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "label", map[string]any{
		"address": addr, "labels": map[string]string{"linger.origin": "e2e"},
	}); got["terminal"].(map[string]any)["labels"].(map[string]any)["linger.origin"] != "e2e" {
		t.Fatalf("real hc label=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "keep", map[string]any{
		"address": addr, "keep": false,
	}); got["terminal"].(map[string]any)["keep"] != false {
		t.Fatalf("real hc keep=%+v", got)
	}

	// Send a command + verify via read
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": addr, "text": "echo E2E_MARKER_123",
	}); got["turn"] == nil {
		t.Fatalf("real hc send=%+v", got)
	}
	waitCondition(t, func() bool {
		got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "read", map[string]any{
			"address": addr, "lines": 50,
		})
		text, _ := got["text"].(string)
		return strings.Contains(text, "E2E_MARKER_123")
	})

	// Put a file beside the terminal
	putRes := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "put", map[string]any{
		"address":     addr,
		"name":        "note.txt",
		"data_base64": base64.StdEncoding.EncodeToString([]byte("put-payload")),
	})
	putPath, _ := putRes["path"].(string)
	if putPath == "" || putRes["bytes"] != float64(11) {
		t.Fatalf("real hc put=%+v", putRes)
	}

	// Test real OSC 7501 blocked state -> Watch event -> send(if="blocked") CAS & answer!
	// Emit OSC 7501 working -> blocked from inside the real shell, then read one line into ANSWER_VAL.
	msgB64 := base64.StdEncoding.EncodeToString([]byte("Confirm deploy?"))
	oscCmd := fmt.Sprintf(
		`printf '\033]7501;state=working:app=codex\033\\\033]7501;state=blocked:kind=question:app=codex:msg=%s\033\\'; read -r ANSWER_VAL; printf 'GOT_ANSWER=%%s\n' "$ANSWER_VAL"; printf '\033]7501;state=done:app=codex\033\\'`,
		msgB64,
	)
	_ = executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": addr, "text": oscCmd,
	})
	var blockedTurn uint64
	waitCondition(t, func() bool {
		got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "get", map[string]any{"address": addr})
		term, _ := got["terminal"].(map[string]any)
		st, _ := term["status"].(map[string]any)
		if st != nil && st["state"] == "blocked" {
			if turnVal, ok := term["turn"].(float64); ok {
				blockedTurn = uint64(turnVal)
				return true
			}
		}
		return false
	})
	// Verify Watch emitted agent_blocked onto liveStream!
	waitCondition(t, func() bool {
		for _, ev := range liveStream.snapshot() {
			if ev.Type == protocol.EventHerdrCore && strings.Contains(string(ev.Payload), `"kind":"agent_blocked"`) {
				return true
			}
		}
		return false
	})
	// Stale turn send(if="blocked") must fail cleanly with terminal_not_blocked.
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": addr, "text": "wrong-turn", "if": "blocked", "turn": blockedTurn + 99,
	}); got["status"] != herdrcore.AnswerTerminalNotBlocked {
		t.Fatalf("real hc stale blocked send=%+v", got)
	}
	// Matching turn send(if="blocked") CAS must succeed via force=true (no invalid if="blocked")!
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": addr, "text": "YES_SHIP_IT", "if": "blocked", "turn": blockedTurn,
	}); got["turn"] == nil {
		t.Fatalf("real hc blocked send=%+v", got)
	}
	waitCondition(t, func() bool {
		got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "read", map[string]any{"address": addr, "lines": 50})
		text, _ := got["text"].(string)
		return strings.Contains(text, "GOT_ANSWER=YES_SHIP_IT")
	})

	// Test real answer tool (AnswerKeys) bound to (address, turn) through Agent placement!
	oscKeysCmd := fmt.Sprintf(
		`printf '\033]7501;state=working:app=codex\033\\\033]7501;state=blocked:kind=permission:app=codex:msg=%s\033\\'; read -r KEY_ANS; printf 'GOT_KEYS=%%s\n' "$KEY_ANS"; printf '\033]7501;state=done:app=codex\033\\'`,
		msgB64,
	)
	_ = executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": addr, "text": oscKeysCmd,
	})
	var keysTurn uint64
	waitCondition(t, func() bool {
		got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "get", map[string]any{"address": addr})
		term, _ := got["terminal"].(map[string]any)
		st, _ := term["status"].(map[string]any)
		if st != nil && st["state"] == "blocked" {
			if turnVal, ok := term["turn"].(float64); ok && uint64(turnVal) > blockedTurn {
				keysTurn = uint64(turnVal)
				return true
			}
		}
		return false
	})
	if got := executeComputerTool(t, d, t.Context(), "agent-1", "herdr_core", "answer", map[string]any{
		"address": addr, "turn": keysTurn, "keys": []string{"y", "enter"},
	}); got["status"] != "ok" {
		t.Fatalf("real hc answer keys=%+v", got)
	}
	waitCondition(t, func() bool {
		got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "read", map[string]any{"address": addr, "lines": 50})
		text, _ := got["text"].(string)
		return strings.Contains(text, "GOT_KEYS=y")
	})

	// Test keys + interrupt on a sleeping process inside the real terminal
	_ = executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "send", map[string]any{
		"address": addr, "text": "sleep 30",
	})
	time.Sleep(150 * time.Millisecond)
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "interrupt", map[string]any{
		"address": addr, "timeout": 3000,
	}); got["key"] == "" {
		t.Fatalf("real hc interrupt=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "keys", map[string]any{
		"address": addr, "keys": []string{"enter"},
	}); got["turn"] == nil {
		t.Fatalf("real hc keys=%+v", got)
	}

	// 6. Real binary PTY attach tunnel end-to-end (observe -> mode switch -> interactive binary I/O -> close)
	attachCtx, cancelAttach := context.WithCancel(t.Context())
	defer cancelAttach()
	attachRes := executeComputerTool(t, d, attachCtx, ownerHerdrCoreAgentID, "herdr_core", "attach", map[string]any{
		"session_id":           "e2e-attach-1",
		"stream_path":          "/v1/runner-gateway/herdr-core-stream",
		"address":              addr,
		"cols":                 100,
		"rows":                 30,
		"observe":              true,
		"history":              50,
		"resize_notifications": true,
	})
	if attachRes["status"] != "accepted" {
		t.Fatalf("real hc attach=%+v", attachRes)
	}
	var relayWS *websocket.Conn
	select {
	case relayWS = <-wsArrivals:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for real hc outbound attach WS")
	}
	defer func() { _ = relayWS.Close() }()

	// Drain until we see the attached frame, then switch to interactive mode and send real PTY input!
	var sawAttached bool
	for range 10 {
		_ = relayWS.SetReadDeadline(time.Now().Add(5 * time.Second))
		msgType, payload, err := relayWS.ReadMessage()
		if err != nil {
			t.Fatalf("read initial real attach frame: %v", err)
		}
		if msgType == websocket.TextMessage && strings.Contains(string(payload), `"type":"attached"`) {
			sawAttached = true
			break
		}
	}
	if !sawAttached {
		t.Fatal("never saw initial attached control frame")
	}
	// Take Over -> interactive mode, then type a real shell command over binary WS!
	if err := relayWS.WriteJSON(map[string]any{"type": "mode", "observe": false}); err != nil {
		t.Fatal(err)
	}
	if err := relayWS.WriteMessage(websocket.BinaryMessage, []byte("echo REAL_ATTACH_STREAM_OK\r")); err != nil {
		t.Fatal(err)
	}
	var ptyTranscript bytes.Buffer
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_ = relayWS.SetReadDeadline(deadline)
		msgType, payload, err := relayWS.ReadMessage()
		if err != nil {
			t.Fatalf("read real attach stream: %v (captured=%q)", err, ptyTranscript.String())
		}
		if msgType == websocket.BinaryMessage {
			ptyTranscript.Write(payload)
			if strings.Contains(ptyTranscript.String(), "REAL_ATTACH_STREAM_OK") {
				break
			}
		}
	}
	if !strings.Contains(ptyTranscript.String(), "REAL_ATTACH_STREAM_OK") {
		t.Fatalf("real binary PTY stream did not echo command; captured=%q", ptyTranscript.String())
	}

	// Close WS and ensure clean zero-leak teardown.
	_ = relayWS.Close()
	waitCondition(t, func() bool { return d.ActiveHerdrCoreStreamCount() == 0 })

	// 7. kill + rm
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "kill", map[string]any{"address": addr}); got["ok"] != true {
		t.Fatalf("real hc kill=%+v", got)
	}
	if got := executeComputerTool(t, d, t.Context(), ownerHerdrCoreAgentID, "herdr_core", "rm", map[string]any{"address": addr}); got["removed"] != true {
		t.Fatalf("real hc rm=%+v", got)
	}
}

func findLocalHC(t *testing.T) string {
	t.Helper()
	if found, err := exec.LookPath("hc"); err == nil {
		return found
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidate := filepath.Join(home, ".local", "bin", "hc")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func buildIsolatedHCEnv(stateDir, configDir, sessionName, socketPath string) []string {
	drop := map[string]bool{
		"HC_SESSION":      true,
		"HC_SOCKET":       true,
		"HC_TERMINAL_ID":  true,
		"XDG_STATE_HOME":  true,
		"XDG_CONFIG_HOME": true,
	}
	env := make([]string, 0, len(os.Environ())+4)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if drop[key] {
			continue
		}
		env = append(env, entry)
	}
	env = append(env,
		"XDG_STATE_HOME="+stateDir,
		"XDG_CONFIG_HOME="+configDir,
		"HC_SESSION="+sessionName,
		"HC_SOCKET="+socketPath,
	)
	return env
}

type syncEventStream struct {
	mu     sync.Mutex
	events []protocol.Event
}

func (s *syncEventStream) Receive(context.Context) (protocol.Command, error) {
	return protocol.Command{}, context.Canceled
}

func (s *syncEventStream) Send(_ context.Context, event protocol.Event) error {
	s.mu.Lock()
	s.events = append(s.events, event)
	s.mu.Unlock()
	return nil
}

func (s *syncEventStream) Close() error { return nil }

func (s *syncEventStream) snapshot() []protocol.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.events)
}

func putReadyAssignment(t *testing.T, store *assignment.MemoryStore, runnerID, tenantID, agentID string) {
	t.Helper()
	if _, err := store.Apply(t.Context(), assignment.Command{
		Type:               "agent_runner.ensure",
		CommandID:          "cmd-assign-" + agentID,
		RunnerID:           runnerID,
		TenantID:           tenantID,
		AgentID:            agentID,
		RegistrationID:     "reg-1",
		AssignmentRevision: 1,
		RunnerRevision:     1,
		Runtime:            json.RawMessage(`{"type":"codex"}`),
		WorkspaceGrantID:   "grant-1",
	}, 1234); err != nil {
		t.Fatalf("apply ready assignment: %v", err)
	}
}

func waitCondition(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition was not met before timeout")
}
