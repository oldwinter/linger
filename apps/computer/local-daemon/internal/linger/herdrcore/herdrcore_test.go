package herdrcore

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
)

type recordedRPC struct {
	Method string
	Params map[string]any
}

// fakeCoreServer is an in-process fake herdr-core server speaking both plain
// JSON-RPC 2.0 and framed binary channels over a scratch Unix socket.
type fakeCoreServer struct {
	t      *testing.T
	socket string

	mu                 sync.Mutex
	terminals          map[string]Terminal
	reads              map[string]ReadResult
	machines           map[string]MachineView
	templates          []TemplateInfo
	docs               map[string]DocGetResult
	requests           []recordedRPC
	plainSubscribers   []net.Conn
	framedSubscribers  []*fakeFramedSub
	attachChannels     map[uint32]*fakeAttachPeer
	nextChannel        uint32
	seq                uint64
	sendError          *rpcErrorWire
	keysError          *rpcErrorWire
	attachAutomatic    bool
	attachResizeNotify bool
	earlyPaintBytes    []byte
	closeConnOnSend    bool
}

type fakeFramedSub struct {
	conn    net.Conn
	mu      *sync.Mutex
	channel uint32
	credits []uint32
}

type fakeAttachPeer struct {
	conn       net.Conn
	writeMu    *sync.Mutex
	channel    uint32
	received   chan Frame
	closedOnce sync.Once
	closed     chan struct{}
}

func newFakeCoreServer(t *testing.T) *fakeCoreServer {
	t.Helper()
	// Unix socket paths are bounded to 103 bytes on macOS; os.MkdirTemp uses /tmp.
	dir, err := os.MkdirTemp("", "hc")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	srv := &fakeCoreServer{
		t:                  t,
		socket:             filepath.Join(dir, "d.sock"),
		terminals:          map[string]Terminal{},
		reads:              map[string]ReadResult{},
		machines:           map[string]MachineView{},
		docs:               map[string]DocGetResult{},
		attachChannels:     map[uint32]*fakeAttachPeer{},
		attachAutomatic:    true,
		attachResizeNotify: true,
	}
	listener, err := net.Listen("unix", srv.socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = listener.Close()
		srv.mu.Lock()
		for _, sub := range srv.plainSubscribers {
			_ = sub.Close()
		}
		for _, sub := range srv.framedSubscribers {
			_ = sub.conn.Close()
		}
		for _, peer := range srv.attachChannels {
			_ = peer.conn.Close()
		}
		srv.mu.Unlock()
	})
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go srv.serve(conn)
		}
	}()
	return srv
}

func (s *fakeCoreServer) serve(conn net.Conn) {
	defer conn.Close()
	reader := bufio.NewReaderSize(conn, 64<<10)
	var writeMu sync.Mutex
	framed := false

	for {
		if !framed {
			line, err := readJSONLine(reader)
			if err != nil {
				return
			}
			var req struct {
				JSONRPC string          `json:"jsonrpc"`
				ID      json.RawMessage `json:"id"`
				Method  string          `json:"method"`
				Params  map[string]any  `json:"params"`
			}
			if json.Unmarshal(line, &req) != nil {
				continue
			}
			resp, switched, drop := s.handleRPC(conn, &writeMu, req.ID, req.Method, req.Params, false)
			if drop {
				return
			}
			writeMu.Lock()
			_, writeErr := conn.Write(append(resp, '\n'))
			writeMu.Unlock()
			if writeErr != nil {
				return
			}
			if switched {
				framed = true
			}
			continue
		}

		frame, err := ReadFrame(reader)
		if err != nil {
			return
		}
		if frame.Channel == ControlChannel && frame.Kind == FrameData {
			var req struct {
				JSONRPC string          `json:"jsonrpc"`
				ID      json.RawMessage `json:"id"`
				Method  string          `json:"method"`
				Params  map[string]any  `json:"params"`
			}
			if json.Unmarshal(frame.Payload, &req) != nil {
				continue
			}
			resp, _, drop := s.handleRPC(conn, &writeMu, req.ID, req.Method, req.Params, true)
			if drop {
				return
			}
			writeMu.Lock()
			writeErr := WriteFrame(conn, Frame{Channel: ControlChannel, Kind: FrameData, Payload: resp})
			if writeErr == nil && req.Method == "terminal.attach" && len(s.earlyPaintBytes) > 0 {
				var parsed struct {
					Result AttachResult `json:"result"`
				}
				if json.Unmarshal(resp, &parsed) == nil && parsed.Result.Channel > 0 {
					writeErr = WriteFrame(conn, Frame{Channel: parsed.Result.Channel, Kind: FrameData, Payload: s.earlyPaintBytes})
				}
			}
			writeMu.Unlock()
			if writeErr != nil {
				return
			}
			continue
		}

		s.mu.Lock()
		peer := s.attachChannels[frame.Channel]
		var framedSub *fakeFramedSub
		for _, candidate := range s.framedSubscribers {
			if candidate.conn == conn && candidate.channel == frame.Channel {
				framedSub = candidate
				break
			}
		}
		s.mu.Unlock()
		if framedSub != nil && frame.Kind == FrameCredit {
			if credit, decErr := DecodeCredit(frame.Payload); decErr == nil {
				s.mu.Lock()
				framedSub.credits = append(framedSub.credits, credit)
				s.mu.Unlock()
			}
		}
		if peer != nil {
			select {
			case peer.received <- frame:
			case <-peer.closed:
			}
			if frame.Kind == FrameClose {
				peer.closedOnce.Do(func() { close(peer.closed) })
			}
		}
	}
}

func (s *fakeCoreServer) handleRPC(conn net.Conn, writeMu *sync.Mutex, id json.RawMessage, method string, params map[string]any, framed bool) ([]byte, bool, bool) {
	s.mu.Lock()
	s.requests = append(s.requests, recordedRPC{Method: method, Params: params})
	var result any
	var rpcErr *rpcErrorWire
	switched := false
	drop := false

	switch method {
	case "hello":
		wantFramed, _ := params["framed"].(bool)
		switched = wantFramed
		result = HelloResult{
			Core:       CoreInfo{ID: "core-1", Name: "test-host"},
			Features:   []string{"framed", "attach", "events", "status", "resize_notifications", "automatic_input"},
			Framed:     wantFramed,
			Generation: ProtocolGeneration,
			Methods:    []string{"hello", "server.status", "terminal.run", "terminal.attach", "events.subscribe"},
			Version:    "0.1.21",
		}
	case "server.status":
		live, finished := uint(0), uint(0)
		for _, term := range s.terminals {
			if term.State == TerminalStateLive {
				live++
			} else {
				finished++
			}
		}
		result = StatusResult{
			Core:     CoreInfo{ID: "core-1", Name: "test-host"},
			Version:  "0.1.21",
			PID:      4242,
			UptimeMS: 12345,
			Holders:  []HolderInfo{{Current: true, Instance: "h1", PID: 4243, Terminals: live}},
			Live:     live,
			Finished: finished,
		}
	case "templates.list":
		result = TemplatesResult{Templates: s.templates}
	case "terminal.run":
		addr := "t1"
		if on, _ := params["on"].(string); on != "" {
			addr = on + "/t1"
		}
		term := Terminal{
			Address:   addr,
			State:     TerminalStateLive,
			Cwd:       "/repo",
			Screen:    "exact",
			Cols:      200,
			Rows:      120,
			CreatedMS: 1000,
			Labels:    map[string]string{},
		}
		if name, _ := params["name"].(string); name != "" {
			term.Name = &name
		}
		if labels, ok := params["labels"].(map[string]any); ok {
			for k, v := range labels {
				if sv, ok := v.(string); ok {
					term.Labels[k] = sv
				}
			}
		}
		s.terminals[addr] = term
		result = RunResult{Terminal: term}
	case "terminal.list":
		all, _ := params["all"].(bool)
		terms := make([]Terminal, 0, len(s.terminals))
		hidden := uint(0)
		for _, term := range s.terminals {
			if !all && term.State != TerminalStateLive {
				hidden++
				continue
			}
			terms = append(terms, term)
		}
		machines := make([]MachineView, 0, len(s.machines))
		for _, m := range s.machines {
			machines = append(machines, m)
		}
		result = ListResult{Terminals: terms, HiddenFinished: hidden, Machines: machines}
	case "terminal.get":
		addr, _ := params["terminal"].(string)
		if term, ok := s.terminals[addr]; ok {
			result = term
		} else {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "terminal not found", Data: json.RawMessage(`{"kind":"not_found","hint":"check hc ls"}`)}
		}
	case "terminal.kill":
		addr, _ := params["terminal"].(string)
		if term, ok := s.terminals[addr]; ok {
			term.State = TerminalStateFinished
			term.Status = nil
			reason := "killed"
			term.Reason = &reason
			s.terminals[addr] = term
			result = term
		} else {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "not_found", Data: json.RawMessage(`{"kind":"not_found"}`)}
		}
	case "terminal.rm":
		addr, _ := params["terminal"].(string)
		if term, ok := s.terminals[addr]; !ok {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "not_found", Data: json.RawMessage(`{"kind":"not_found"}`)}
		} else if term.State == TerminalStateLive {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "live", Data: json.RawMessage(`{"kind":"live"}`)}
		} else {
			delete(s.terminals, addr)
			result = RemoveResult{Removed: addr}
		}
	case "terminal.keep":
		addr, _ := params["terminal"].(string)
		keep, _ := params["keep"].(bool)
		if term, ok := s.terminals[addr]; ok {
			term.Keep = keep
			s.terminals[addr] = term
			result = term
		} else {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "not_found", Data: json.RawMessage(`{"kind":"not_found"}`)}
		}
	case "terminal.label":
		addr, _ := params["terminal"].(string)
		if term, ok := s.terminals[addr]; ok {
			if term.Labels == nil {
				term.Labels = map[string]string{}
			}
			if labels, ok := params["labels"].(map[string]any); ok {
				for k, v := range labels {
					sv, _ := v.(string)
					if sv == "" {
						delete(term.Labels, k)
					} else {
						term.Labels[k] = sv
					}
				}
			}
			s.terminals[addr] = term
			result = term
		} else {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "not_found", Data: json.RawMessage(`{"kind":"not_found"}`)}
		}
	case "terminal.read":
		addr, _ := params["terminal"].(string)
		if res, ok := s.reads[addr]; ok {
			result = res
		} else {
			result = ReadResult{Text: "", Complete: true, How: "screen"}
		}
	case "terminal.attach":
		if !framed {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "needs_framed", Data: json.RawMessage(`{"kind":"needs_framed"}`)}
		} else {
			addr, _ := params["terminal"].(string)
			term, ok := s.terminals[addr]
			if !ok {
				rpcErr = &rpcErrorWire{Code: -32000, Message: "not_found", Data: json.RawMessage(`{"kind":"not_found"}`)}
			} else {
				s.nextChannel++
				ch := s.nextChannel
				s.attachChannels[ch] = &fakeAttachPeer{
					conn:     conn,
					writeMu:  writeMu,
					channel:  ch,
					received: make(chan Frame, 32),
					closed:   make(chan struct{}),
				}
				result = AttachResult{
					Channel:             ch,
					Terminal:            term,
					ResizeNotifications: s.attachResizeNotify,
					AutomaticInput:      s.attachAutomatic,
				}
			}
		}
	case "terminal.send":
		if s.closeConnOnSend {
			drop = true
			break
		}
		if cond, hasIf := params["if"]; hasIf && cond != nil {
			if condStr, _ := cond.(string); condStr != "idle" && condStr != "working" {
				rpcErr = &rpcErrorWire{
					Code:    -32602,
					Message: "unknown variant `" + condStr + "`, expected `idle` or `working`",
					Data:    json.RawMessage(`{"kind":"invalid_params","hint":"see hc schema"}`),
				}
				break
			}
		}
		if s.sendError != nil {
			rpcErr = s.sendError
			break
		}
		addr, _ := params["terminal"].(string)
		term, ok := s.terminals[addr]
		if !ok {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "not_found", Data: json.RawMessage(`{"kind":"not_found"}`)}
			break
		}
		force, _ := params["force"].(bool)
		if term.Status != nil && term.Status.State == StatusBlocked && !force {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "blocked", Data: json.RawMessage(`{"kind":"blocked"}`)}
			break
		}
		started := true
		statusWord := ""
		if term.Status != nil {
			statusWord = term.Status.State
		}
		result = SendResult{Turn: term.Turn, Started: &started, Status: &statusWord}
	case "terminal.wait":
		addr, _ := params["terminal"].(string)
		result = WaitResult{Terminal: addr, Ended: true, Reason: "status", Turn: 1, Children: []WaitResult{}}
	case "terminal.keys":
		if s.keysError != nil {
			rpcErr = s.keysError
			break
		}
		addr, _ := params["terminal"].(string)
		term, ok := s.terminals[addr]
		if !ok {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "not_found", Data: json.RawMessage(`{"kind":"not_found"}`)}
			break
		}
		result = KeysResult{Turn: term.Turn}
	case "terminal.interrupt":
		result = InterruptResult{Key: "esc", Outcome: "stopped"}
	case "terminal.put":
		name, _ := params["name"].(string)
		rawB64, _ := params["data"].(string)
		decoded, _ := base64.StdEncoding.DecodeString(rawB64)
		result = PutResult{Path: "/tmp/put/" + name, Bytes: uint(len(decoded))}
	case "machine.exec":
		code := int32(0)
		result = ExecResult{
			Code:   &code,
			MS:     12,
			Stdout: base64.StdEncoding.EncodeToString([]byte("hello\n")),
			Stderr: "",
		}
	case "file.read":
		result = FileReadResult{Text: "line1\nline2\n", First: 1, Last: 2, Lines: 2}
	case "file.write":
		path, _ := params["path"].(string)
		rawB64, _ := params["data"].(string)
		decoded, _ := base64.StdEncoding.DecodeString(rawB64)
		result = FileResult{Path: path, Bytes: uint(len(decoded))}
	case "file.edit":
		path, _ := params["path"].(string)
		result = FileResult{Path: path, Bytes: 42}
	case "doc.get":
		name, _ := params["name"].(string)
		if doc, ok := s.docs[name]; ok {
			result = doc
		} else {
			result = DocGetResult{Value: json.RawMessage("null"), Version: 0}
		}
	case "doc.set":
		name, _ := params["name"].(string)
		version := uint64(params["version"].(float64))
		cur := s.docs[name]
		if cur.Version != version {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "conflict", Data: json.RawMessage(`{"kind":"conflict"}`)}
		} else {
			rawVal, _ := json.Marshal(params["value"])
			nextVer := version + 1
			s.docs[name] = DocGetResult{Value: rawVal, Version: nextVer}
			result = DocSetResult{Version: nextVer}
		}
	case "machine.list":
		list := make([]MachineView, 0, len(s.machines))
		for _, m := range s.machines {
			list = append(list, m)
		}
		result = MachineListResult{Machines: list}
	case "machine.add":
		name, _ := params["name"].(string)
		target, _ := params["target"].(string)
		if name == "" {
			name = target
		}
		m := Machine{Name: name, Target: target, ID: "m-1", Host: target, Version: "0.1.21"}
		s.machines[name] = MachineView{Name: m.Name, Target: m.Target, ID: m.ID, Host: m.Host, Version: m.Version, State: "connected"}
		result = m
	case "machine.connect":
		name, _ := params["machine"].(string)
		if m, ok := s.machines[name]; ok {
			m.State = "connected"
			s.machines[name] = m
			result = m
		} else {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "machine_unknown", Data: json.RawMessage(`{"kind":"machine_unknown"}`)}
		}
	case "machine.rename":
		name, _ := params["machine"].(string)
		newName, _ := params["new_name"].(string)
		if m, ok := s.machines[name]; ok {
			delete(s.machines, name)
			m.Name = newName
			s.machines[newName] = m
			result = Machine{Name: m.Name, Target: m.Target, ID: m.ID, Host: m.Host, Version: m.Version}
		} else {
			rpcErr = &rpcErrorWire{Code: -32000, Message: "machine_unknown", Data: json.RawMessage(`{"kind":"machine_unknown"}`)}
		}
	case "machine.rm":
		name, _ := params["machine"].(string)
		delete(s.machines, name)
		result = RemoveResult{Removed: name}
	case "rpc.discover":
		result = map[string]any{"openrpc": "1.3.2", "info": map[string]any{"title": "herdr-core", "version": "0.1.21"}}
	case "events.subscribe":
		terms := make([]Terminal, 0, len(s.terminals))
		for _, term := range s.terminals {
			terms = append(terms, term)
		}
		subRes := SubscribeResult{Seq: s.seq, Terminals: terms}
		if framed {
			s.nextChannel++
			ch := s.nextChannel
			subRes.Channel = &ch
			s.framedSubscribers = append(s.framedSubscribers, &fakeFramedSub{conn: conn, mu: writeMu, channel: ch})
		} else {
			s.plainSubscribers = append(s.plainSubscribers, conn)
		}
		result = subRes
	default:
		rpcErr = &rpcErrorWire{Code: -32601, Message: "method not found"}
	}
	s.mu.Unlock()

	if drop {
		return nil, false, true
	}
	envelope := map[string]any{"jsonrpc": "2.0", "id": id}
	if rpcErr != nil {
		envelope["error"] = rpcErr
	} else {
		envelope["result"] = result
	}
	encoded, _ := json.Marshal(envelope)
	return encoded, switched, false
}

func (s *fakeCoreServer) setTerminal(term Terminal) {
	s.mu.Lock()
	s.terminals[term.Address] = term
	s.mu.Unlock()
}

func (s *fakeCoreServer) setRead(addr string, text string) {
	s.mu.Lock()
	s.reads[addr] = ReadResult{Text: text, Complete: true, How: "screen"}
	s.mu.Unlock()
}

func (s *fakeCoreServer) pushPlainNotification(method string, params any) {
	encoded, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	})
	line := append(encoded, '\n')
	s.mu.Lock()
	plain := append([]net.Conn(nil), s.plainSubscribers...)
	framed := append([]*fakeFramedSub(nil), s.framedSubscribers...)
	s.mu.Unlock()
	for _, conn := range plain {
		_, _ = conn.Write(line)
	}
	for _, sub := range framed {
		sub.mu.Lock()
		_ = WriteFrame(sub.conn, Frame{Channel: sub.channel, Kind: FrameData, Payload: line})
		sub.mu.Unlock()
	}
}

func (s *fakeCoreServer) pushEvent(terminal, eventType string, data any) uint64 {
	s.mu.Lock()
	s.seq++
	seq := s.seq
	s.mu.Unlock()
	rawData, _ := json.Marshal(data)
	s.pushPlainNotification("event", EventNotification{
		Seq:      seq,
		Terminal: terminal,
		Type:     eventType,
		Data:     rawData,
	})
	return seq
}

func (s *fakeCoreServer) closeAllSubscribers() {
	s.mu.Lock()
	plain := s.plainSubscribers
	s.plainSubscribers = nil
	framed := s.framedSubscribers
	s.framedSubscribers = nil
	s.mu.Unlock()
	for _, conn := range plain {
		_ = conn.Close()
	}
	for _, sub := range framed {
		_ = sub.conn.Close()
	}
}

func (s *fakeCoreServer) recordedRequests() []recordedRPC {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]recordedRPC(nil), s.requests...)
}

func TestLocateUnixAndWindowsFallback(t *testing.T) {
	bin := t.TempDir()
	home := t.TempDir()

	if _, ok := locateForOS("darwin", map[string]string{"PATH": "/nonexistent", "HOME": home}); ok {
		t.Fatal("found herdr-core when absent from PATH")
	}

	hcPath := filepath.Join(bin, "hc")
	if err := os.WriteFile(hcPath, []byte("#!/bin/sh\necho hc 0.1.21\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	inst, ok := locateForOS("darwin", map[string]string{"PATH": "/nonexistent:" + bin, "HOME": home})
	wantSock := filepath.Join(home, ".local", "state", "herdr-core", "default", "default.sock")
	if !ok || inst.Executable != hcPath || inst.Socket != wantSock || inst.Session != DefaultSession || inst.Transport != TransportUnixSocket {
		t.Fatalf("darwin locate=%+v ok=%v", inst, ok)
	}
	if inst.Running() {
		t.Fatal("missing socket should not report running")
	}
	if runtime.GOOS != "windows" {
		if version := inst.Version(context.Background()); version != "0.1.21" {
			t.Fatalf("version=%q, want 0.1.21", version)
		}
	}

	// Custom HC_SESSION, XDG_STATE_HOME, and HC_SOCKET precedence.
	if got := SocketPath(map[string]string{"HOME": home, "HC_SESSION": "work"}); got != filepath.Join(home, ".local", "state", "herdr-core", "work", "work.sock") {
		t.Fatalf("session socket=%q", got)
	}
	if got := SocketPath(map[string]string{"HOME": home, "XDG_STATE_HOME": "/xdg-state", "HC_SESSION": "ci"}); got != filepath.Join("/xdg-state", "herdr-core", "ci", "ci.sock") {
		t.Fatalf("xdg socket=%q", got)
	}
	if got := SocketPath(map[string]string{"HOME": home, "XDG_STATE_HOME": "/xdg-state", "HC_SOCKET": "/run/custom.sock"}); got != "/run/custom.sock" {
		t.Fatalf("override socket=%q", got)
	}

	// Without HOME/XDG_STATE_HOME/HC_SOCKET on Unix, falls back to connect_stdio.
	fallback, ok := locateForOS("linux", map[string]string{"PATH": bin})
	if !ok || fallback.Transport != TransportConnectStdio || fallback.Socket != "" {
		t.Fatalf("unix fallback=%+v ok=%v", fallback, ok)
	}

	// Windows discovery selects hc.exe and TransportConnectStdio with case-insensitive Path.
	winBin := t.TempDir()
	winExe := filepath.Join(winBin, "hc.exe")
	if err := os.WriteFile(winExe, []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	winInst, ok := locateForOS("windows", map[string]string{"Path": winBin, "HC_SESSION": "winwork"})
	if !ok || winInst.Executable != winExe || winInst.Transport != TransportConnectStdio || winInst.Socket != "" || winInst.Session != "winwork" {
		t.Fatalf("windows locate=%+v ok=%v", winInst, ok)
	}
	winClient := winInst.Client()
	if !winClient.UseConnectStdio || winClient.Executable != winExe || winClient.Session != "winwork" {
		t.Fatalf("windows client=%+v", winClient)
	}
}

func TestFrameCodecRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	frames := []Frame{
		{Channel: ControlChannel, Kind: FrameData, Payload: []byte(`{"id":1}`)},
		{Channel: 3, Kind: FrameCredit, Payload: EncodeCredit(4096)},
		{Channel: 3, Kind: FrameResize, Payload: EncodeResize(120, 40)},
		{Channel: 3, Kind: FrameFocus, Payload: EncodeFocus(true)},
		{Channel: 3, Kind: FrameFocus, Payload: EncodeFocus(false)},
		{Channel: 3, Kind: FrameAutomaticInput, Payload: []byte("abc")},
		{Channel: 3, Kind: FrameClose},
	}
	for _, frame := range frames {
		if err := WriteFrame(&buf, frame); err != nil {
			t.Fatalf("WriteFrame: %v", err)
		}
	}
	for index, want := range frames {
		got, err := ReadFrame(&buf)
		if err != nil {
			t.Fatalf("ReadFrame[%d]: %v", index, err)
		}
		if got.Channel != want.Channel || got.Kind != want.Kind || !bytes.Equal(got.Payload, want.Payload) {
			t.Fatalf("frame[%d]=%+v, want %+v", index, got, want)
		}
	}
	if credit, err := DecodeCredit(EncodeCredit(251)); err != nil || credit != 251 {
		t.Fatalf("credit=%d err=%v", credit, err)
	}
	if cols, rows, err := DecodeResize(EncodeResize(111, 33)); err != nil || cols != 111 || rows != 33 {
		t.Fatalf("resize=(%d,%d) err=%v", cols, rows, err)
	}
	if focused, err := DecodeFocus(EncodeFocus(true)); err != nil || !focused {
		t.Fatalf("focus=%v err=%v", focused, err)
	}
	if _, err := DecodeCredit([]byte{1, 2}); err == nil {
		t.Fatal("expected error for short credit payload")
	}
	if _, _, err := DecodeResize([]byte{1, 2, 3}); err == nil {
		t.Fatal("expected error for short resize payload")
	}
	if _, err := DecodeFocus(nil); err == nil {
		t.Fatal("expected error for empty focus payload")
	}
}

func TestClientRPCMethodsAndErrors(t *testing.T) {
	srv := newFakeCoreServer(t)
	srv.templates = []TemplateInfo{{Name: "reviewer", Description: "Code reviewer", Command: "codex --no-daemon"}}
	client := &Client{Socket: srv.socket}
	ctx := context.Background()

	hello, err := client.Hello(ctx, HelloParams{})
	if err != nil || hello.Version != "0.1.21" || hello.Generation != ProtocolGeneration || hello.Framed {
		t.Fatalf("hello=%+v err=%v", hello, err)
	}

	status, err := client.ServerStatus(ctx)
	if err != nil || status.PID != 4242 || status.Core.Name != "test-host" {
		t.Fatalf("status=%+v err=%v", status, err)
	}

	templates, err := client.TemplatesList(ctx)
	if err != nil || len(templates.Templates) != 1 || templates.Templates[0].Name != "reviewer" {
		t.Fatalf("templates=%+v err=%v", templates, err)
	}

	name := "build"
	run, err := client.TerminalRun(ctx, TerminalRunParams{
		Argv:   []string{"go", "test"},
		Name:   &name,
		Labels: map[string]string{"linger.room": "room-1"},
	})
	if err != nil || run.Address != "t1" || run.Labels["linger.room"] != "room-1" {
		t.Fatalf("run=%+v err=%v", run, err)
	}

	listed, err := client.TerminalList(ctx, TerminalListParams{})
	if err != nil || len(listed.Terminals) != 1 {
		t.Fatalf("list=%+v err=%v", listed, err)
	}

	labeled, err := client.TerminalLabel(ctx, TerminalLabelParams{
		Terminal: "t1",
		Labels:   map[string]string{"linger.work_item": "wi-9"},
	})
	if err != nil || labeled.Labels["linger.work_item"] != "wi-9" {
		t.Fatalf("label=%+v err=%v", labeled, err)
	}

	kept, err := client.TerminalKeep(ctx, TerminalKeepParams{Terminal: "t1", Keep: true})
	if err != nil || !kept.Keep {
		t.Fatalf("keep=%+v err=%v", kept, err)
	}

	srv.setRead("t1", "ok output")
	readRes, err := client.TerminalRead(ctx, TerminalReadParams{Terminal: "t1", Lines: 50})
	if err != nil || readRes.Text != "ok output" {
		t.Fatalf("read=%+v err=%v", readRes, err)
	}

	if sendRes, sendErr := client.TerminalSend(ctx, TerminalSendParams{Terminal: "t1", Text: "hello"}); sendErr != nil || sendRes.Started == nil || !*sendRes.Started {
		t.Fatalf("send=%+v err=%v", sendRes, sendErr)
	}
	if _, keyErr := client.TerminalKeys(ctx, TerminalKeysParams{Terminal: "t1", Keys: []string{"enter"}}); keyErr != nil {
		t.Fatalf("keys: %v", keyErr)
	}
	if intr, intrErr := client.TerminalInterrupt(ctx, TerminalInterruptParams{Terminal: "t1"}); intrErr != nil || intr.Outcome != "stopped" {
		t.Fatalf("interrupt=%+v err=%v", intr, intrErr)
	}
	termAddr := "t1"
	if waitRes, waitErr := client.TerminalWait(ctx, TerminalWaitParams{Terminal: &termAddr}); waitErr != nil || !waitRes.Ended {
		t.Fatalf("wait=%+v err=%v", waitRes, waitErr)
	}
	putRes, err := client.TerminalPut(ctx, TerminalPutParams{
		Terminal: "t1",
		Name:     "shot.png",
		Data:     base64.StdEncoding.EncodeToString([]byte("pngbytes")),
	})
	if err != nil || putRes.Bytes != 8 || !strings.HasSuffix(putRes.Path, "shot.png") {
		t.Fatalf("put=%+v err=%v", putRes, err)
	}

	execRes, err := client.MachineExec(ctx, MachineExecParams{Argv: []string{"echo", "hello"}})
	if err != nil || execRes.Code == nil || *execRes.Code != 0 {
		t.Fatalf("exec=%+v err=%v", execRes, err)
	}
	if fileRead, err := client.FileRead(ctx, FileReadParams{Path: "/repo/a.txt"}); err != nil || fileRead.Lines != 2 {
		t.Fatalf("file.read=%+v err=%v", fileRead, err)
	}
	if fileWrite, err := client.FileWrite(ctx, FileWriteParams{Path: "/repo/b.txt", Data: base64.StdEncoding.EncodeToString([]byte("abc"))}); err != nil || fileWrite.Bytes != 3 {
		t.Fatalf("file.write=%+v err=%v", fileWrite, err)
	}
	if fileEdit, err := client.FileEdit(ctx, FileEditParams{Path: "/repo/b.txt", Edits: []Edit{{Old: "a", New: "b"}}}); err != nil || fileEdit.Bytes != 42 {
		t.Fatalf("file.edit=%+v err=%v", fileEdit, err)
	}

	// Doc CAS get/set/conflict.
	doc0, err := client.DocGet(ctx, DocGetParams{Name: "linger-workbench"})
	if err != nil || doc0.Version != 0 {
		t.Fatalf("doc.get=%+v err=%v", doc0, err)
	}
	doc1, err := client.DocSet(ctx, DocSetParams{Name: "linger-workbench", Value: json.RawMessage(`{"pinned":["t1"]}`), Version: 0})
	if err != nil || doc1.Version != 1 {
		t.Fatalf("doc.set=%+v err=%v", doc1, err)
	}
	if _, err := client.DocSet(ctx, DocSetParams{Name: "linger-workbench", Value: json.RawMessage(`{}`), Version: 0}); !IsErrorKind(err, ErrKindConflict) {
		t.Fatalf("stale doc.set err=%v, want conflict", err)
	}

	// Machine lifecycle.
	target := "vps.example"
	added, err := client.MachineAdd(ctx, MachineAddParams{Target: &target})
	if err != nil || added.Name != "vps.example" {
		t.Fatalf("machine.add=%+v err=%v", added, err)
	}
	if list, err := client.MachineList(ctx); err != nil || len(list.Machines) != 1 {
		t.Fatalf("machine.list=%+v err=%v", list, err)
	}
	if connected, err := client.MachineConnect(ctx, MachineConnectParams{Machine: "vps.example"}); err != nil || connected.State != "connected" {
		t.Fatalf("machine.connect=%+v err=%v", connected, err)
	}
	if renamed, err := client.MachineRename(ctx, MachineRenameParams{Machine: "vps.example", NewName: "vps"}); err != nil || renamed.Name != "vps" {
		t.Fatalf("machine.rename=%+v err=%v", renamed, err)
	}
	if removed, err := client.MachineRemove(ctx, MachineRemoveParams{Machine: "vps"}); err != nil || removed.Removed != "vps" {
		t.Fatalf("machine.rm=%+v err=%v", removed, err)
	}

	// Kill, rm, and structured Error kind/hint check.
	if _, err := client.TerminalRemove(ctx, TerminalRemoveParams{Terminal: "t1"}); !IsErrorKind(err, ErrKindLive) {
		t.Fatalf("rm live err=%v, want live", err)
	}
	if killed, err := client.TerminalKill(ctx, TerminalKillParams{Terminal: "t1"}); err != nil || killed.State != TerminalStateFinished {
		t.Fatalf("kill=%+v err=%v", killed, err)
	}
	if removed, err := client.TerminalRemove(ctx, TerminalRemoveParams{Terminal: "t1"}); err != nil || removed.Removed != "t1" {
		t.Fatalf("rm=%+v err=%v", removed, err)
	}
	_, err = client.TerminalGet(ctx, TerminalGetParams{Terminal: "missing"})
	var hcErr *Error
	if !errors.As(err, &hcErr) || hcErr.Kind != ErrKindNotFound || hcErr.Hint != "check hc ls" || hcErr.Code != -32000 {
		t.Fatalf("missing error=%#v", err)
	}

	if schema, err := client.RPCDiscover(ctx); err != nil || !strings.Contains(string(schema), `"openrpc":"1.3.2"`) {
		t.Fatalf("discover=%s err=%v", string(schema), err)
	}
}

func TestConnectStdioTransportFallback(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell helper script test runs on Unix")
	}
	dir := t.TempDir()
	// Fake hc binary that implements `connect` over stdin/stdout JSON-RPC 2.0.
	fakeHC := filepath.Join(dir, "hc")
	script := `#!/bin/sh
if [ "$1" = "server" ] && [ "$2" = "status" ]; then
  echo '{"core":{"id":"c-win","name":"win-box"},"version":"0.1.21","pid":99,"uptime_ms":50,"holders":[],"live":1,"finished":0}'
  exit 0
fi
if [ "$1" = "connect" ]; then
  while IFS= read -r line; do
    case "$line" in
      *server.status*)
        echo '{"jsonrpc":"2.0","id":1,"result":{"core":{"id":"c-stdio","name":"stdio-box"},"version":"0.1.21","pid":77,"uptime_ms":10,"holders":[],"live":2,"finished":0}}'
        ;;
      *hello*)
        echo '{"jsonrpc":"2.0","id":1,"result":{"core":{"id":"c-stdio","name":"stdio-box"},"version":"0.1.21","generation":1,"framed":false,"methods":["server.status"],"features":[]}}'
        ;;
    esac
  done
  exit 0
fi
echo "hc 0.1.21"
`
	if err := os.WriteFile(fakeHC, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	client := &Client{Executable: fakeHC, Session: "custom", UseConnectStdio: true}
	status, err := client.ServerStatus(context.Background())
	if err != nil || status.Core.ID != "c-stdio" || status.Live != 2 {
		t.Fatalf("stdio ServerStatus=%+v err=%v", status, err)
	}

	inst := Installation{Executable: fakeHC, Session: "custom", Transport: TransportConnectStdio}
	probed, err := inst.ProbeStatus(context.Background())
	if err != nil || probed.Core.ID != "c-win" || probed.PID != 99 {
		t.Fatalf("ProbeStatus=%+v err=%v", probed, err)
	}
}

func TestFramedConnEventsSubscribeAndCredit(t *testing.T) {
	srv := newFakeCoreServer(t)
	srv.setTerminal(Terminal{Address: "t1", State: TerminalStateLive, Cwd: "/repo"})
	client := &Client{Socket: srv.socket}

	fc, hello, err := client.DialFramed(context.Background(), HelloParams{})
	if err != nil || !hello.Framed {
		t.Fatalf("DialFramed=%+v err=%v", hello, err)
	}
	defer fc.Close()

	stream, err := fc.EventsSubscribe(context.Background(), EventsSubscribeParams{})
	if err != nil || len(stream.Snapshot.Terminals) != 1 || stream.Snapshot.Channel == nil {
		t.Fatalf("framed EventsSubscribe=%+v err=%v", stream, err)
	}
	defer stream.Close()

	srv.pushEvent("t1", "title", TitleEventData{Title: "Working"})
	msg, err := stream.Next(context.Background())
	if err != nil || msg.Kind != StreamMessageEvent || msg.Event == nil || msg.Event.Type != "title" {
		t.Fatalf("Next=%+v err=%v", msg, err)
	}

	// Verify multiplexed RPC works concurrently on channel 0 while events stream on channel 1.
	var status StatusResult
	if err := fc.Call(context.Background(), "server.status", nil, &status); err != nil || status.PID != 4242 {
		t.Fatalf("framed Call=%+v err=%v", status, err)
	}

	// Closing stream unblocks Next cleanly.
	if err := stream.Close(); err != nil {
		t.Fatalf("stream.Close: %v", err)
	}
	if _, err := stream.Next(context.Background()); !errors.Is(err, io.EOF) {
		t.Fatalf("post-close Next err=%v, want EOF", err)
	}

	// Ensure reflect.DeepEqual check on labels works cleanly.
	if !reflect.DeepEqual(hello.Core, CoreInfo{ID: "core-1", Name: "test-host"}) {
		t.Fatalf("core=%+v", hello.Core)
	}
}
