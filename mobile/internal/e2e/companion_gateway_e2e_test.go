package e2e_test

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/discovery"
	"github.com/oldwinter/linger/mobile/internal/realtime"
	"github.com/oldwinter/linger/mobile/internal/screens/work"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

type standaloneBootstrap struct {
	HostID           string `json:"host_id"`
	HostName         string `json:"host_name"`
	Port             int    `json:"port"`
	TLS              bool   `json:"tls"`
	TLSFingerprint   string `json:"tls_fingerprint"`
	ShortFingerprint string `json:"short_fingerprint"`
	PairingPIN       string `json:"pairing_pin"`
	PairingURI       string `json:"pairing_uri"`
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve caller path")
	}
	// mobile/internal/e2e/companion_gateway_e2e_test.go -> repo root
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}

func startRealStandaloneGateway(t *testing.T, upstreamURL, dataDir string) (standaloneBootstrap, string) {
	t.Helper()
	root := repoRoot(t)
	script := filepath.Join(root, "apps", "desktop", "src", "main", "companion", "standalone.ts")
	if _, err := os.Stat(script); err != nil {
		t.Skipf("standalone companion gateway script not found at %s: %v", script, err)
	}
	pnpmPath, err := exec.LookPath("pnpm")
	if err != nil {
		t.Skip("pnpm not available in PATH; skipping real Node companion gateway E2E")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, pnpmPath, "exec", "tsx", script,
		"--teamhub-url", upstreamURL,
		"--port", "0",
		"--bind", "127.0.0.1",
		"--custom-host", "127.0.0.1",
		"--no-mdns",
		"--tls",
		"--open-pairing",
		"--json",
		"--data-dir", dataDir,
		"--host-name", "Studio Mac E2E",
		"--tenant-id", "ten_1",
		"--computer-id", "comp_mac_1",
		"--email", "alex@linger.dev",
		"--password", "linger-pass",
	)
	cmd.Dir = root

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		t.Fatalf("StdoutPipe: %v", err)
	}
	var stderrBuf strings.Builder
	var stderrMu sync.Mutex
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		t.Fatalf("StderrPipe: %v", err)
	}
	if err := cmd.Start(); err != nil {
		cancel()
		t.Fatalf("start standalone.ts: %v", err)
	}

	go func() {
		sc := bufio.NewScanner(stderr)
		for sc.Scan() {
			stderrMu.Lock()
			stderrBuf.WriteString(sc.Text())
			stderrBuf.WriteByte('\n')
			stderrMu.Unlock()
		}
	}()

	t.Cleanup(func() {
		cancel()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})

	lineCh := make(chan string, 1)
	errCh := make(chan error, 1)
	go func() {
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if strings.HasPrefix(line, "{") {
				lineCh <- line
				return
			}
		}
		if err := sc.Err(); err != nil {
			errCh <- err
			return
		}
		errCh <- errors.New("standalone.ts exited before emitting JSON bootstrap")
	}()

	var boot standaloneBootstrap
	select {
	case line := <-lineCh:
		if err := json.Unmarshal([]byte(line), &boot); err != nil {
			t.Fatalf("decode standalone.ts JSON (%q): %v", line, err)
		}
	case err := <-errCh:
		stderrMu.Lock()
		logs := stderrBuf.String()
		stderrMu.Unlock()
		t.Fatalf("standalone.ts startup failed: %v\nstderr:\n%s", err, logs)
	case <-time.After(20 * time.Second):
		stderrMu.Lock()
		logs := stderrBuf.String()
		stderrMu.Unlock()
		t.Fatalf("timed out waiting for standalone.ts JSON bootstrap\nstderr:\n%s", logs)
	}

	baseURL := fmt.Sprintf("https://127.0.0.1:%d", boot.Port)
	return boot, baseURL
}

func tamperFingerprint(fp string) string {
	if len(fp) == 0 {
		return "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	}
	if fp[0] == 'A' {
		return "B" + fp[1:]
	}
	return "A" + fp[1:]
}

func TestCrossStackGoMobileWithRealNodeCompanionGateway(t *testing.T) {
	// 1. Boot real TeamHub-compatible HTTP/SSE upstream + real Node standalone.ts gateway with TLS 1.3.
	upstream, err := testutil.NewFakeServer(false)
	if err != nil {
		t.Fatalf("NewFakeServer upstream: %v", err)
	}
	upstream.SeedAllFixtures()
	defer upstream.Close()

	boot1, gwURL1 := startRealStandaloneGateway(t, upstream.URL, t.TempDir())
	if !boot1.TLS || boot1.Port <= 0 || boot1.TLSFingerprint == "" {
		t.Fatalf("unexpected standalone.ts bootstrap: %+v", boot1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	// 2. Parse the real linger://pair?... URI emitted by standalone.ts.
	parsed, err := discovery.ParsePairingURI(boot1.PairingURI)
	if err != nil {
		t.Fatalf("ParsePairingURI(%q): %v", boot1.PairingURI, err)
	}
	if parsed.Port != boot1.Port || !parsed.TLS || parsed.TLSFingerprint != boot1.TLSFingerprint || parsed.Code == "" {
		t.Fatalf("parsed pair URI mismatch: got %+v, boot=%+v", parsed, boot1)
	}

	// 3. Verify SPKI TLS 1.3 pinning security: tampered fingerprint FAILS; exact fingerprint SUCCEEDS.
	badClient, err := api.NewClient(api.ClientConfig{
		BaseURL:        gwURL1,
		Mode:           api.AuthModeCompanion,
		TLSFingerprint: tamperFingerprint(boot1.TLSFingerprint),
	})
	if err != nil {
		t.Fatalf("NewClient tampered: %v", err)
	}
	if _, err := badClient.GetCompanionInfo(ctx); err == nil {
		t.Fatal("expected TLS SPKI pinning error with tampered fingerprint, got nil")
	}

	unauthClient, err := api.NewClient(api.ClientConfig{
		BaseURL:        gwURL1,
		Mode:           api.AuthModeCompanion,
		TLSFingerprint: boot1.TLSFingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient pinned: %v", err)
	}
	info, err := unauthClient.GetCompanionInfo(ctx)
	if err != nil {
		t.Fatalf("GetCompanionInfo with pinned TLS 1.3 failed: %v", err)
	}
	if !info.TLS || !info.PairingOpen || info.HostName != "Studio Mac E2E" || info.TLSFingerprint != boot1.TLSFingerprint {
		t.Fatalf("unexpected CompanionInfo: %+v", info)
	}

	// 4a. Complete real POST /companion/v1/pair via QR code.
	pairResp, err := unauthClient.Pair(ctx, api.PairRequest{
		Code:       parsed.Code,
		DeviceName: "Linger Mobile E2E iPhone",
		Platform:   "ios",
		AppVersion: "0.1.0",
	})
	if err != nil {
		t.Fatalf("Pair with QR code failed: %v", err)
	}
	if !strings.HasPrefix(pairResp.Token, "lmc_") || pairResp.DeviceID == "" || pairResp.SessionMode != "dedicated" {
		t.Fatalf("unexpected PairResponse: %+v", pairResp)
	}

	// 4b. Verify 6-digit PIN pairing on a second fresh pairing window.
	boot2, gwURL2 := startRealStandaloneGateway(t, upstream.URL, t.TempDir())
	pinClient, err := api.NewClient(api.ClientConfig{
		BaseURL:        gwURL2,
		Mode:           api.AuthModeCompanion,
		TLSFingerprint: boot2.TLSFingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient pin gw2: %v", err)
	}
	pinResp, err := pinClient.Pair(ctx, api.PairRequest{
		PIN:        boot2.PairingPIN,
		DeviceName: "Linger Mobile PIN Test",
		Platform:   "android",
		AppVersion: "0.1.0",
	})
	if err != nil || !strings.HasPrefix(pinResp.Token, "lmc_") {
		t.Fatalf("Pair with 6-digit PIN failed: resp=%+v err=%v", pinResp, err)
	}

	// 4c. Verify 5 wrong PINs locks the pairing window with PAIRING_LOCKED!
	boot3, gwURL3 := startRealStandaloneGateway(t, upstream.URL, t.TempDir())
	lockClient, err := api.NewClient(api.ClientConfig{
		BaseURL:        gwURL3,
		Mode:           api.AuthModeCompanion,
		TLSFingerprint: boot3.TLSFingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient lock gw3: %v", err)
	}
	var lockedCode string
	for i := 1; i <= 5; i++ {
		wrongPIN := fmt.Sprintf("%06d", i)
		if wrongPIN == boot3.PairingPIN {
			wrongPIN = "999999"
		}
		_, perr := lockClient.Pair(ctx, api.PairRequest{
			PIN:        wrongPIN,
			DeviceName: "Brute Force Probe",
			Platform:   "ios",
			AppVersion: "0.1.0",
		})
		if perr == nil {
			t.Fatalf("attempt %d: expected wrong PIN to fail", i)
		}
		var apiErr *api.APIError
		if errors.As(perr, &apiErr) {
			lockedCode = apiErr.Code
		}
	}
	if lockedCode != "PAIRING_LOCKED" {
		t.Fatalf("expected 5th wrong PIN to return PAIRING_LOCKED, got %q", lockedCode)
	}
	if _, err := lockClient.Pair(ctx, api.PairRequest{
		PIN:        boot3.PairingPIN,
		DeviceName: "After Lock Probe",
		Platform:   "ios",
		AppVersion: "0.1.0",
	}); err == nil {
		t.Fatal("expected valid PIN to fail after window was locked")
	}

	// Authenticated client for Gateway #1.
	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        gwURL1,
		Mode:           api.AuthModeCompanion,
		Token:          pairResp.Token,
		TLSFingerprint: boot1.TLSFingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient authed: %v", err)
	}

	// 5. Call GET /companion/v1/status with minted lmc_ bearer token.
	status, err := client.GetCompanionStatus(ctx)
	if err != nil {
		t.Fatalf("GetCompanionStatus: %v", err)
	}
	if status.HostName != "Studio Mac E2E" || status.ComputerID != "comp_mac_1" || status.PairedDevicesCount != 1 {
		t.Fatalf("unexpected CompanionStatus: %+v", status)
	}

	// 6. Exercise real authenticated /v0/* proxy flows across ALL 5 tabs!
	// Tab 1: Rooms list + Send message + live /v0/events SSE delivery + runtime-presentation-events
	roomsPage, err := client.ListRooms(ctx, "ten_1", 20, "")
	if err != nil || len(roomsPage.Items) == 0 {
		t.Fatalf("ListRooms via gateway: %+v (%v)", roomsPage, err)
	}
	createdMsg, err := client.CreateMessage(ctx, "room_general", api.CreateMessageRequest{
		RawMessage: "Hello through real Node Companion Gateway!",
	}, "e2e_msg_1")
	if err != nil || createdMsg.RawMessage != "Hello through real Node Companion Gateway!" {
		t.Fatalf("CreateMessage via gateway: %+v (%v)", createdMsg, err)
	}

	// Live /v0/events SSE through Node Companion Gateway
	sseConnected := make(chan struct{}, 1)
	sseEventsCh := make(chan api.RoomEventEnvelope, 8)
	sseMgr := realtime.NewStreamManager(client, realtime.StreamCallbacks{
		OnState: func(st realtime.StreamState, _ error) {
			if st == realtime.StateConnected {
				select {
				case sseConnected <- struct{}{}:
				default:
				}
			}
		},
		OnRoomEvent: func(ev api.RoomEventEnvelope) {
			sseEventsCh <- ev
		},
	}, realtime.StreamOptions{})
	sseCtx, sseCancel := context.WithCancel(ctx)
	defer sseCancel()
	go sseMgr.Run(sseCtx)

	select {
	case <-sseConnected:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for /v0/events SSE to connect through real Node gateway")
	}

	// Push live message.created + agent_run.status_changed from upstream -> verify arrival through Node gateway!
	upstream.AppendRoomEvent(api.RoomEventEnvelope{
		EventID:   "ev_101",
		TenantID:  "ten_1",
		RoomID:    "room_general",
		RoomSeq:   101,
		EventType: "message.created",
		Payload:   json.RawMessage(`{"id":"msg_sse_1","raw_message":"Live over TLS 1.3 gateway"}`),
	}, true)
	upstream.AppendRoomEvent(api.RoomEventEnvelope{
		EventID:   "ev_102",
		TenantID:  "ten_1",
		RoomID:    "room_general",
		RoomSeq:   102,
		EventType: "agent_run.status_changed",
		Payload:   json.RawMessage(`{"run_id":"run_1","status":"active"}`),
	}, true)

	gotMsgEv, gotRunEv := false, false
	deadline := time.After(5 * time.Second)
	for !(gotMsgEv && gotRunEv) {
		select {
		case ev := <-sseEventsCh:
			if ev.EventType == "message.created" && ev.RoomSeq == 101 {
				gotMsgEv = true
			}
			if ev.EventType == "agent_run.status_changed" && ev.RoomSeq == 102 {
				gotRunEv = true
			}
		case <-deadline:
			t.Fatalf("timed out waiting for SSE events via Node gateway (msg=%v run=%v)", gotMsgEv, gotRunEv)
		}
	}

	presPage, err := client.ListRoomRuntimePresentationEvents(ctx, "room_general", "run_1", 0)
	if err != nil || len(presPage.Items) == 0 {
		t.Fatalf("ListRoomRuntimePresentationEvents via gateway: %+v (%v)", presPage, err)
	}

	// Tab 2: Decision Card approval + Local Models list & remote action + Model Source check
	decidedMsg, err := client.DecideDecision(ctx, "dec_cw_1", api.DecisionRequest{
		Decision:        "approve",
		ExpectedVersion: 1,
	})
	if err != nil || decidedMsg.Card == nil || decidedMsg.Card.Status != "approved" {
		t.Fatalf("DecideDecision via gateway: %+v (%v)", decidedMsg, err)
	}
	lmView, err := client.GetLocalComputerModels(ctx, "ten_1", "comp_mac_1")
	if err != nil || len(lmView.Models) == 0 {
		t.Fatalf("GetLocalComputerModels via gateway: %+v (%v)", lmView, err)
	}
	if err := client.ActOnLocalComputerModelWithUnload(ctx, "ten_1", "comp_mac_1", "llama3.3-8b:Q4_K_M", "load", []string{"qwen3-4b:Q4_K_M"}); err != nil {
		t.Fatalf("ActOnLocalComputerModelWithUnload via gateway: %v", err)
	}
	msView, err := client.GetLocalComputerModelSource(ctx, "ten_1", "comp_mac_1")
	if err != nil || msView.Status == nil {
		t.Fatalf("GetLocalComputerModelSource via gateway: %+v (%v)", msView, err)
	}

	// Tab 3: Work Item create/comment + Routine toggle/run + Pocket Note offline SQLite outbox -> reconnect sync
	prio := "high"
	wi, err := client.CreateWorkItemIdempotent(ctx, "ten_1", api.WorkItemCreateInput{
		Kind:     "issue",
		Title:    "Cross-stack gateway E2E issue",
		Priority: &prio,
	}, "e2e_wi_create_1")
	if err != nil || wi.ID == "" {
		t.Fatalf("CreateWorkItemIdempotent via gateway: %+v (%v)", wi, err)
	}
	if _, err := client.CreateWorkItemCommentIdempotent(ctx, wi.ID, "Verified via TLS 1.3 companion proxy", "e2e_wi_comment_1"); err != nil {
		t.Fatalf("CreateWorkItemCommentIdempotent via gateway: %v", err)
	}
	routines, err := client.ListRoomRoutines(ctx, "room_general")
	if err != nil || len(routines) == 0 {
		t.Fatalf("ListRoomRoutines via gateway: %+v (%v)", routines, err)
	}
	toggled := !routines[0].Enabled
	if _, err := client.UpdateRoutineTyped(ctx, routines[0].ID, api.RoutineUpdateInput{
		Enabled:          &toggled,
		ExpectedRevision: routines[0].Revision,
	}); err != nil {
		t.Fatalf("UpdateRoutineTyped via gateway: %v", err)
	}
	if _, err := client.RunRoutineNowTyped(ctx, routines[0].ID); err != nil {
		t.Fatalf("RunRoutineNowTyped via gateway: %v", err)
	}

	cs, err := cache.Open(ctx, filepath.Join(t.TempDir(), "e2e-cache.db"))
	if err != nil {
		t.Fatalf("cache.Open: %v", err)
	}
	defer func() { _ = cs.Close() }()

	var onlineFlag atomic.Bool
	onlineFlag.Store(false)
	workScr := work.New(work.Deps{
		Client:   client,
		Cache:    cs,
		TenantID: "ten_1",
		Online:   func() bool { return onlineFlag.Load() },
	})
	defer workScr.Close()
	workScr.SavePocketNoteDraft("Offline note drafted on airplane -> synced via Companion Gateway")
	outboxDeadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(outboxDeadline) {
		items, _ := cs.ListOutbox(ctx)
		if len(items) > 0 {
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	queuedItems, err := cs.ListOutbox(ctx)
	if err != nil || len(queuedItems) == 0 {
		t.Fatalf("expected queued pocket note in SQLite outbox while offline, got %d (%v)", len(queuedItems), err)
	}
	onlineFlag.Store(true)
	if err := workScr.SyncPocketOutbox(ctx); err != nil {
		t.Fatalf("SyncPocketOutbox via gateway: %v", err)
	}
	afterItems, _ := cs.ListOutbox(ctx)
	if len(afterItems) != 0 {
		t.Fatalf("expected SQLite outbox empty after reconnect sync, got %d", len(afterItems))
	}

	// Tab 4: Library Document + FTS5 + Server Search
	docsPage, err := client.ListLibraryDocuments(ctx, 20, "")
	if err != nil || len(docsPage.Items) == 0 {
		t.Fatalf("ListLibraryDocuments via gateway: %+v (%v)", docsPage, err)
	}
	if err := cs.UpsertDocuments(ctx, docsPage.Items); err != nil {
		t.Fatalf("cache.UpsertDocuments: %v", err)
	}
	ftsHits, err := cs.Search(ctx, "Architecture", 10)
	if err != nil || len(ftsHits) == 0 {
		t.Fatalf("SQLite FTS5 search failed: %+v (%v)", ftsHits, err)
	}
	liveDocHits, err := client.SearchLibraryDocuments(ctx, "Architecture", 10)
	if err != nil || len(liveDocHits.Items) == 0 {
		t.Fatalf("SearchLibraryDocuments via gateway: %+v (%v)", liveDocHits, err)
	}

	// Tab 5: Proactive Rule Promote
	ruleBook, err := client.ListProactiveRulesC2(ctx, "ten_1")
	if err != nil || len(ruleBook.Rules) == 0 {
		t.Fatalf("ListProactiveRulesC2 via gateway: %+v (%v)", ruleBook, err)
	}
	shadowID := ""
	for _, r := range ruleBook.Rules {
		if r.Status == "shadow" {
			shadowID = r.ID
			break
		}
	}
	if shadowID == "" {
		t.Fatal("expected at least one shadow proactive rule in seeded fixtures")
	}
	if _, err := client.PromoteProactiveRule(ctx, "ten_1", shadowID); err != nil {
		t.Fatalf("PromoteProactiveRule via gateway: %v", err)
	}

	// 7. Token Rotation: old token immediately rejected (401); rotated token works!
	oldClient, err := api.NewClient(api.ClientConfig{
		BaseURL:        gwURL1,
		Mode:           api.AuthModeCompanion,
		Token:          pairResp.Token,
		TLSFingerprint: boot1.TLSFingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient oldClient: %v", err)
	}
	rotResp, err := client.RotateCompanionToken(ctx)
	if err != nil || !strings.HasPrefix(rotResp.Token, "lmc_") || rotResp.Token == pairResp.Token {
		t.Fatalf("RotateCompanionToken via gateway: %+v (%v)", rotResp, err)
	}
	if _, err := oldClient.GetCompanionStatus(ctx); err == nil {
		t.Fatal("expected old rotated-out token to be rejected with 401")
	}
	client.SetToken(rotResp.Token)
	if _, err := client.GetMe(ctx); err != nil {
		t.Fatalf("GetMe with rotated token failed: %v", err)
	}

	// 8. Unpair / Revocation: open raw SSE stream with active rotated token, then unpair ->
	// active SSE disconnects immediately AND subsequent /v0/* returns 401!
	sseCancel() // stop earlier stream using pre-rotation token
	rawHTTP := client.AuthenticatedHTTPClient()
	sseReq, err := http.NewRequestWithContext(ctx, http.MethodGet, gwURL1+"/v0/events", nil)
	if err != nil {
		t.Fatalf("new SSE request: %v", err)
	}
	sseReq.Header.Set("Accept", "text/event-stream")
	sseResp, err := rawHTTP.Do(sseReq)
	if err != nil || sseResp.StatusCode != http.StatusOK {
		t.Fatalf("open raw SSE before unpair: resp=%v err=%v", sseResp, err)
	}
	defer func() { _ = sseResp.Body.Close() }()

	// Read first line to confirm stream is actively open and flowing.
	sseReader := bufio.NewReader(sseResp.Body)
	if _, err := sseReader.ReadString('\n'); err != nil {
		t.Fatalf("read initial SSE line: %v", err)
	}
	sseClosed := make(chan error, 1)
	go func() {
		_, rerr := io.Copy(io.Discard, sseReader)
		sseClosed <- rerr
	}()

	if _, err := client.UnpairCompanion(ctx); err != nil {
		t.Fatalf("UnpairCompanion via gateway: %v", err)
	}
	select {
	case <-sseClosed:
		// Active SSE connection was actively terminated by gateway revocation!
	case <-time.After(3 * time.Second):
		t.Fatal("expected active /v0/events SSE connection to disconnect immediately on unpair")
	}
	if _, err := client.GetMe(ctx); err == nil {
		t.Fatal("expected /v0/me to return 401 after unpair")
	} else {
		var apiErr *api.APIError
		if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 after unpair, got %v", err)
		}
	}

	// 9. Security Guards over Real TLS 1.3 Socket:
	//    a) CSRF Origin rejection (403)
	//    b) DNS-rebinding bogus Host rejection (403)
	//    c) Forbidden /v0/local/identity & /v0/auth/login denial (403)
	secClient, err := api.NewClient(api.ClientConfig{
		BaseURL:        gwURL2,
		Mode:           api.AuthModeCompanion,
		Token:          pinResp.Token,
		TLSFingerprint: boot2.TLSFingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient secClient: %v", err)
	}
	// Use a raw TLS 1.3 transport (without api.Client's Origin-stripping middleware)
	// to prove the Node gateway itself rejects browser Origin and bogus Host headers.
	rawTLS := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				MinVersion:         tls.VersionTLS13,
				InsecureSkipVerify: true, //nolint:gosec // SPKI pinning already verified above; probing Origin/Host rejection here
			},
		},
		Timeout: 5 * time.Second,
	}

	// 9a. Origin header rejected with 403
	reqOrigin, _ := http.NewRequestWithContext(ctx, http.MethodGet, gwURL2+"/companion/v1/info", nil)
	reqOrigin.Header.Set("Origin", "https://evil.example")
	respOrigin, err := rawTLS.Do(reqOrigin)
	if err != nil {
		t.Fatalf("Origin check request error: %v", err)
	}
	_ = respOrigin.Body.Close()
	if respOrigin.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 FORBIDDEN_ORIGIN for browser Origin header, got %d", respOrigin.StatusCode)
	}

	// 9b. Bogus Host header rejected with 403 (DNS rebinding defense)
	reqHost, _ := http.NewRequestWithContext(ctx, http.MethodGet, gwURL2+"/companion/v1/info", nil)
	reqHost.Host = "evil-rebind.attacker.test:443"
	respHost, err := rawTLS.Do(reqHost)
	if err != nil {
		t.Fatalf("Host rebinding request error: %v", err)
	}
	_ = respHost.Body.Close()
	if respHost.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 INVALID_HOST for bogus Host header, got %d", respHost.StatusCode)
	}

	// 9c. Forbidden /v0/local/identity and /v0/auth/login rejected with 403
	for _, blockedPath := range []string{"/v0/local/identity", "/v0/auth/login"} {
		method := http.MethodGet
		if blockedPath == "/v0/auth/login" {
			method = http.MethodPost
		}
		err := secClient.DoJSON(ctx, method, blockedPath, nil, nil)
		var apiErr *api.APIError
		if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusForbidden {
			t.Fatalf("expected 403 FORBIDDEN_PATH for %s, got %v", blockedPath, err)
		}
	}
}
