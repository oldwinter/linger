package herdr_test

import (
	"bufio"
	"context"
	"crypto/sha1" //nolint:gosec // RFC 6455 test server handshake
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/herdr"
)

func TestHerdrClientRoutesRemoteAddressEscapingAndBlockedCAS(t *testing.T) {
	var (
		mu             sync.Mutex
		gotRequests    []string
		gotSendPayload herdr.SendRequest
		gotKeysPayload herdr.KeysRequest
		gotLaunch      herdr.LaunchRequest
		gotInterrupt   herdr.InterruptRequest
		gotKill        herdr.KillRequest
		gotDeleteAddr  string
		gotAuthHeader  string
		gotOrigin      string
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotRequests = append(gotRequests, r.Method+" "+r.URL.RequestURI())
		gotAuthHeader = r.Header.Get("Authorization")
		gotOrigin = r.Header.Get("Origin")
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/status":
			_ = json.NewEncoder(w).Encode(herdr.CoreStatus{
				Available:     true,
				Version:       "0.1.21",
				CoreID:        "core_1",
				CoreName:      "studio-mac",
				PID:           4201,
				UptimeMs:      91234,
				LiveCount:     3,
				FinishedCount: 1,
				BlockedCount:  1,
				WorkingCount:  1,
				Machines:      []herdr.MachineView{{Name: "vps", State: "connected"}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/terminals":
			if r.URL.Query().Get("all") != "true" || r.URL.Query().Get("machine") != "vps" || r.URL.Query().Get("status") != "blocked" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(herdr.ListTerminalsResult{
				Terminals: []herdr.Terminal{
					{
						Address: "vps/t7",
						Name:    "deploy-agent",
						State:   "live",
						Status:  &herdr.OSCStatus{State: "blocked", Msg: "Allow running terraform apply?", App: "claude"},
						Cwd:     "/srv/app",
						Labels:  map[string]string{"linger.room": "ops-room", "linger.work_item": "WI-42"},
					},
				},
				Machines: []herdr.MachineView{{Name: "vps", State: "connected"}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/terminal":
			if r.URL.Query().Get("address") != "vps/t7" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"terminal": map[string]any{
					"address": "vps/t7",
					"state":   "live",
					"status":  "blocked",
					"agent":   "claude",
					"cwd":     "/srv/app",
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/terminal/read":
			if r.URL.Query().Get("address") != "vps/t7" || r.URL.Query().Get("lines") != "120" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(herdr.ReadResult{
				Text:     "$ terraform plan\nProceed? [y/N]",
				Complete: true,
				How:      "history",
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/terminals":
			_ = json.NewDecoder(r.Body).Decode(&gotLaunch)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"terminal": herdr.Terminal{Address: "vps/t8", Name: gotLaunch.Name, State: "live", Keep: gotLaunch.Keep, Labels: gotLaunch.Labels},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/terminal/send":
			_ = json.NewDecoder(r.Body).Decode(&gotSendPayload)
			if gotSendPayload.If == "blocked" && gotSendPayload.Text == "stale" {
				w.WriteHeader(http.StatusConflict)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"error": map[string]any{
						"code":       "STATUS_MISMATCH",
						"message":    "terminal is no longer blocked",
						"request_id": "req_cas_1",
					},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(herdr.SendResult{OK: true, Sent: true, Address: gotSendPayload.Address, Turn: 4})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/terminal/keys":
			_ = json.NewDecoder(r.Body).Decode(&gotKeysPayload)
			_ = json.NewEncoder(w).Encode(herdr.KeysResult{OK: true, Address: gotKeysPayload.Address, Keys: gotKeysPayload.Keys})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/terminal/interrupt":
			_ = json.NewDecoder(r.Body).Decode(&gotInterrupt)
			_ = json.NewEncoder(w).Encode(herdr.InterruptResult{OK: true, Address: gotInterrupt.Address, Effect: "idle"})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/terminal/kill":
			_ = json.NewDecoder(r.Body).Decode(&gotKill)
			_ = json.NewEncoder(w).Encode(herdr.KillResult{OK: true, Address: gotKill.Address, State: "finished"})
		case r.Method == http.MethodDelete && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/terminal":
			gotDeleteAddr = r.URL.Query().Get("address")
			_ = json.NewEncoder(w).Encode(herdr.RemoveResult{OK: true, Address: gotDeleteAddr, Removed: true})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/templates":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"templates": []herdr.TemplateInfo{{Name: "reviewer", Description: "Code review agent", Agent: "claude"}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/computers/comp_mac_1/herdr-core/machines":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"machines": []herdr.MachineView{{Name: "vps", State: "connected", Version: "0.1.21"}},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	client, err := herdr.NewClient(herdr.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          "lmc_test_secret",
		AllowPlainHTTP: true,
		ComputerID:     "comp_mac_1",
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	ctx := context.Background()

	st, err := client.Status(ctx)
	if err != nil || !st.Available || st.Version != "0.1.21" || st.BlockedCount != 1 {
		t.Fatalf("Status: %+v (%v)", st, err)
	}

	list, err := client.ListTerminals(ctx, herdr.ListTerminalsOptions{All: true, Machine: "vps", Status: "blocked"})
	if err != nil || len(list.Terminals) != 1 || !list.Terminals[0].IsBlocked() || list.Terminals[0].EffectiveMachine() != "vps" {
		t.Fatalf("ListTerminals: %+v (%v)", list, err)
	}
	if list.Terminals[0].RoomLabel() != "ops-room" || list.Terminals[0].WorkItemLabel() != "WI-42" {
		t.Fatalf("unexpected linger labels: room=%q wi=%q", list.Terminals[0].RoomLabel(), list.Terminals[0].WorkItemLabel())
	}

	// Verify string status unmarshals cleanly into OSCStatus.
	term, err := client.GetTerminal(ctx, "vps/t7")
	if err != nil || term.Address != "vps/t7" || !term.IsBlocked() {
		t.Fatalf("GetTerminal(vps/t7): %+v (%v)", term, err)
	}

	readRes, err := client.Read(ctx, "vps/t7", 0)
	if err != nil || !readRes.Complete || !strings.Contains(readRes.Text, "terraform plan") {
		t.Fatalf("Read(vps/t7): %+v (%v)", readRes, err)
	}

	launched, err := client.Launch(ctx, herdr.LaunchRequest{
		Template: "reviewer",
		Task:     "audit PR",
		Name:     "pr-audit",
		On:       "vps",
		Keep:     true,
		Labels:   map[string]string{"linger.origin": "mobile"},
	})
	if err != nil || launched.Address != "vps/t8" || !launched.Keep || gotLaunch.Labels["linger.origin"] != "mobile" {
		t.Fatalf("Launch: %+v got=%+v (%v)", launched, gotLaunch, err)
	}

	// Blocked CAS send with if="blocked", force=true.
	sendRes, err := client.Send(ctx, herdr.SendRequest{
		Address: "vps/t7",
		Text:    "yes, proceed",
		If:      "blocked",
		Force:   true,
	})
	if err != nil || !sendRes.OK || gotSendPayload.If != "blocked" || !gotSendPayload.Force {
		t.Fatalf("Send blocked CAS: %+v payload=%+v (%v)", sendRes, gotSendPayload, err)
	}

	// Stale CAS rejection classifies as ErrPreconditionFailed.
	_, casErr := client.Send(ctx, herdr.SendRequest{
		Address: "vps/t7",
		Text:    "stale",
		If:      "blocked",
		Force:   true,
	})
	if !errors.Is(casErr, herdr.ErrPreconditionFailed) {
		t.Fatalf("expected ErrPreconditionFailed on CAS conflict, got %v", casErr)
	}

	if _, err := client.Keys(ctx, herdr.KeysRequest{Address: "vps/t7", Keys: []string{"enter"}}); err != nil {
		t.Fatalf("Keys: %v", err)
	}
	if _, err := client.Interrupt(ctx, herdr.InterruptRequest{Address: "vps/t7", Timeout: 5}); err != nil {
		t.Fatalf("Interrupt: %v", err)
	}
	if _, err := client.Kill(ctx, "vps/t7"); err != nil {
		t.Fatalf("Kill: %v", err)
	}
	if _, err := client.Remove(ctx, "vps/t7"); err != nil || gotDeleteAddr != "vps/t7" {
		t.Fatalf("Remove: addr=%q err=%v", gotDeleteAddr, err)
	}

	tpls, err := client.Templates(ctx)
	if err != nil || len(tpls) != 1 || tpls[0].Name != "reviewer" {
		t.Fatalf("Templates: %+v (%v)", tpls, err)
	}
	machines, err := client.Machines(ctx)
	if err != nil || len(machines) != 1 || machines[0].Name != "vps" {
		t.Fatalf("Machines: %+v (%v)", machines, err)
	}

	// Confirm remote address was properly percent-encoded in URL query strings and CSRF headers omitted.
	mu.Lock()
	defer mu.Unlock()
	if gotAuthHeader != "Bearer lmc_test_secret" {
		t.Fatalf("Authorization header = %q, want Bearer lmc_test_secret", gotAuthHeader)
	}
	if gotOrigin != "" {
		t.Fatalf("unexpected Origin header %q", gotOrigin)
	}
	foundEscaped := false
	for _, reqLine := range gotRequests {
		if strings.Contains(reqLine, "address=vps%2Ft7") {
			foundEscaped = true
			break
		}
	}
	if !foundEscaped {
		t.Fatalf("expected URL-escaped address=vps%%2Ft7 in requests, got %v", gotRequests)
	}
}

func TestHerdrErrorEnvelopeClassification(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		code     string
		wantSent error
	}{
		{"unavailable_404", http.StatusNotFound, "NOT_FOUND", herdr.ErrUnavailable},
		{"unavailable_503", http.StatusServiceUnavailable, "HERDR_UNAVAILABLE", herdr.ErrUnavailable},
		{"computer_offline", http.StatusServiceUnavailable, "COMPUTER_OFFLINE", herdr.ErrComputerOffline},
		{"unauthorized_401", http.StatusUnauthorized, "SESSION_EXPIRED", herdr.ErrUnauthorized},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"error": map[string]any{
						"code":       tc.code,
						"message":    "simulated failure",
						"request_id": "req_1",
					},
				})
			}))
			defer srv.Close()

			cl, err := herdr.NewClient(herdr.ClientConfig{
				BaseURL:        srv.URL,
				AllowPlainHTTP: true,
				ComputerID:     "comp_1",
			})
			if err != nil {
				t.Fatalf("NewClient: %v", err)
			}
			_, err = cl.Status(context.Background())
			if !errors.Is(err, tc.wantSent) {
				t.Fatalf("got %v, want errors.Is(_, %v)", err, tc.wantSent)
			}
		})
	}
}

func TestAttachClientWebSocketFramesAndControls(t *testing.T) {
	var (
		mu          sync.Mutex
		gotControls []herdr.ControlFrame
		gotQuery    string
		gotOrigin   string
	)
	receivedAll := make(chan struct{})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/herdr-core/attach") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		mu.Lock()
		gotQuery = r.URL.RawQuery
		gotOrigin = r.Header.Get("Origin")
		mu.Unlock()

		key := r.Header.Get("Sec-WebSocket-Key")
		h := sha1.New() //nolint:gosec // RFC 6455 test server handshake
		_, _ = io.WriteString(h, key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
		accept := base64.StdEncoding.EncodeToString(h.Sum(nil))

		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Error("ResponseWriter does not implement http.Hijacker")
			return
		}
		conn, rw, err := hj.Hijack()
		if err != nil {
			return
		}
		defer conn.Close()

		_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\n" +
			"Connection: Upgrade\r\n" +
			"Sec-WebSocket-Accept: " + accept + "\r\n\r\n")
		_ = rw.Flush()

		// Send one JSON snapshot frame, one binary output frame, and one status frame.
		writeServerWSFrame(rw, 0x1, []byte(`{"type":"screen","text":"$ ls\nREADME.md\n","complete":true}`))
		writeServerWSFrame(rw, 0x2, []byte("go.mod\n"))
		writeServerWSFrame(rw, 0x1, []byte(`{"type":"status","status":{"state":"blocked","msg":"Approve push?","app":"claude"}}`))
		_ = rw.Flush()

		// Read 4 client-masked control frames: send, keys, resize, mode.
		for i := 0; i < 4; i++ {
			payload, err := readServerMaskedWSFrame(rw.Reader)
			if err != nil {
				return
			}
			var cf herdr.ControlFrame
			if json.Unmarshal(payload, &cf) == nil {
				mu.Lock()
				gotControls = append(gotControls, cf)
				mu.Unlock()
			}
		}
		close(receivedAll)
		// Keep connection open briefly until client closes.
		_, _ = readServerMaskedWSFrame(rw.Reader)
	}))
	defer srv.Close()

	cl, err := herdr.NewClient(herdr.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          "lmc_ws_token",
		AllowPlainHTTP: true,
		ComputerID:     "comp_1",
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var (
		outMu     sync.Mutex
		outputs   []herdr.AttachOutput
		statuses  []herdr.OSCStatus
		modes     []herdr.AttachMode
		gotStatus = make(chan struct{}, 1)
	)

	attach := cl.NewAttachClient("vps/t7", herdr.AttachOptions{
		Cols:    100,
		Rows:    30,
		Observe: true,
	}, herdr.AttachCallbacks{
		OnOutput: func(out herdr.AttachOutput) {
			outMu.Lock()
			outputs = append(outputs, out)
			outMu.Unlock()
		},
		OnStatus: func(st herdr.OSCStatus) {
			outMu.Lock()
			statuses = append(statuses, st)
			outMu.Unlock()
			select {
			case gotStatus <- struct{}{}:
			default:
			}
		},
		OnModeChanged: func(mode herdr.AttachMode) {
			outMu.Lock()
			modes = append(modes, mode)
			outMu.Unlock()
		},
	})

	ctx := context.Background()
	if err := attach.Connect(ctx); err != nil {
		t.Fatalf("AttachClient.Connect: %v", err)
	}
	if attach.Mode() != herdr.AttachModeWebSocket {
		t.Fatalf("Mode = %q, want websocket", attach.Mode())
	}

	// Send all 4 control frame kinds.
	if err := attach.Send(ctx, "hello agent"); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := attach.Keys(ctx, "ctrl+c", "enter"); err != nil {
		t.Fatalf("Keys: %v", err)
	}
	if err := attach.Resize(ctx, 120, 40); err != nil {
		t.Fatalf("Resize: %v", err)
	}
	if err := attach.SetMode(ctx, false); err != nil {
		t.Fatalf("SetMode: %v", err)
	}

	select {
	case <-receivedAll:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for server to receive all 4 control frames")
	}
	select {
	case <-gotStatus:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for status frame")
	}
	_ = attach.Close()

	mu.Lock()
	defer mu.Unlock()
	if gotOrigin != "" {
		t.Fatalf("WS handshake must omit Origin header, got %q", gotOrigin)
	}
	if !strings.Contains(gotQuery, "address=vps%2Ft7") || !strings.Contains(gotQuery, "cols=100") || !strings.Contains(gotQuery, "rows=30") || !strings.Contains(gotQuery, "observe=true") {
		t.Fatalf("unexpected attach query: %q", gotQuery)
	}
	if len(gotControls) != 4 || gotControls[0].Type != "send" || gotControls[1].Type != "keys" || gotControls[2].Type != "resize" || gotControls[3].Type != "mode" {
		t.Fatalf("unexpected control frames: %+v", gotControls)
	}
	if gotControls[3].Observe == nil || *gotControls[3].Observe != false {
		t.Fatalf("expected mode observe=false, got %+v", gotControls[3])
	}

	outMu.Lock()
	defer outMu.Unlock()
	if len(outputs) < 2 || !outputs[0].Replace || outputs[1].Text != "go.mod\n" {
		t.Fatalf("unexpected outputs: %+v", outputs)
	}
	if len(statuses) != 1 || statuses[0].State != "blocked" || statuses[0].Msg != "Approve push?" {
		t.Fatalf("unexpected statuses: %+v", statuses)
	}
	if len(modes) == 0 || modes[0] != herdr.AttachModeWebSocket {
		t.Fatalf("unexpected modes: %+v", modes)
	}
}

func TestAttachClientFallsBackToReadPollingWhenWSUnavailable(t *testing.T) {
	var (
		mu         sync.Mutex
		readCount  int
		sentViaAPI string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/herdr-core/attach"):
			w.WriteHeader(http.StatusNotFound)
		case strings.HasSuffix(r.URL.Path, "/herdr-core/terminal/read"):
			mu.Lock()
			readCount++
			n := readCount
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(herdr.ReadResult{
				Text:     "poll snapshot #" + string(rune('0'+n)),
				Complete: true,
				How:      "history",
			})
		case strings.HasSuffix(r.URL.Path, "/herdr-core/terminal/send"):
			var req herdr.SendRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			mu.Lock()
			sentViaAPI = req.Text
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(herdr.SendResult{OK: true, Sent: true})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	cl, err := herdr.NewClient(herdr.ClientConfig{
		BaseURL:        srv.URL,
		AllowPlainHTTP: true,
		ComputerID:     "comp_1",
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	gotOut := make(chan herdr.AttachOutput, 4)
	gotMode := make(chan herdr.AttachMode, 4)
	attach := cl.NewAttachClient("t1", herdr.AttachOptions{
		PollInterval: 40 * time.Millisecond,
		ReadLines:    80,
	}, herdr.AttachCallbacks{
		OnOutput: func(out herdr.AttachOutput) {
			select {
			case gotOut <- out:
			default:
			}
		},
		OnModeChanged: func(mode herdr.AttachMode) {
			select {
			case gotMode <- mode:
			default:
			}
		},
	})

	if err := attach.Connect(context.Background()); err != nil {
		t.Fatalf("Connect fallback: %v", err)
	}

	select {
	case m := <-gotMode:
		if m != herdr.AttachModePolling {
			t.Fatalf("mode = %q, want polling", m)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for polling mode callback")
	}

	select {
	case out := <-gotOut:
		if !out.Replace || !strings.Contains(out.Text, "poll snapshot") {
			t.Fatalf("unexpected fallback output: %+v", out)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for fallback read snapshot")
	}

	// Sending in polling mode delegates transparently to HTTP terminal/send.
	if err := attach.Send(context.Background(), "status check"); err != nil {
		t.Fatalf("Send in polling mode: %v", err)
	}
	_ = attach.Close()

	mu.Lock()
	defer mu.Unlock()
	if sentViaAPI != "status check" {
		t.Fatalf("sentViaAPI = %q, want 'status check'", sentViaAPI)
	}
}

func writeServerWSFrame(w io.Writer, opcode byte, payload []byte) {
	var hdr [4]byte
	hdr[0] = 0x80 | opcode
	n := len(payload)
	if n < 126 {
		hdr[1] = byte(n)
		_, _ = w.Write(hdr[:2])
	} else {
		hdr[1] = 126
		binary.BigEndian.PutUint16(hdr[2:4], uint16(n))
		_, _ = w.Write(hdr[:4])
	}
	_, _ = w.Write(payload)
}

func readServerMaskedWSFrame(r *bufio.Reader) ([]byte, error) {
	var hdr [2]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	masked := (hdr[1] & 0x80) != 0
	n := int(hdr[1] & 0x7f)
	if n == 126 {
		var ext [2]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return nil, err
		}
		n = int(binary.BigEndian.Uint16(ext[:]))
	}
	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(r, mask[:]); err != nil {
			return nil, err
		}
	}
	payload := make([]byte, n)
	if n > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return nil, err
		}
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return payload, nil
}
