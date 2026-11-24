//go:build liveqa

package e2e_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/discovery"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

type autoClient struct {
	conn   net.Conn
	reader *bufio.Reader
	nextID int
}

func dialAutomation(sockPath string, timeout time.Duration) (*autoClient, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("unix", sockPath, 500*time.Millisecond)
		if err == nil {
			return &autoClient{conn: conn, reader: bufio.NewReader(conn)}, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return nil, fmt.Errorf("timed out waiting for automation socket %s", sockPath)
}

func (a *autoClient) Close() {
	if a != nil && a.conn != nil {
		_ = a.conn.Close()
	}
}

func (a *autoClient) call(method string, params any, out any) error {
	a.nextID++
	req := map[string]any{"id": a.nextID, "method": method}
	if params != nil {
		req["params"] = params
	}
	line, err := json.Marshal(req)
	if err != nil {
		return err
	}
	line = append(line, '\n')
	_ = a.conn.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err := a.conn.Write(line); err != nil {
		return err
	}
	respLine, err := a.reader.ReadBytes('\n')
	if err != nil {
		return err
	}
	var env struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respLine, &env); err != nil {
		return err
	}
	if env.Error != nil {
		return fmt.Errorf("automation %s error (%s): %s", method, env.Error.Code, env.Error.Message)
	}
	if out != nil && len(env.Result) > 0 {
		return json.Unmarshal(env.Result, out)
	}
	return nil
}

type autoNode struct {
	ID     string `json:"id"`
	Role   string `json:"role"`
	Label  string `json:"label"`
	Value  string `json:"value"`
	Bounds struct {
		X float64 `json:"x"`
		Y float64 `json:"y"`
		W float64 `json:"width"`
		H float64 `json:"height"`
	} `json:"bounds"`
}

func (a *autoClient) tree() ([]autoNode, error) {
	var res struct {
		Nodes []autoNode `json:"nodes"`
	}
	if err := a.call("tree", map[string]any{"window": 0}, &res); err != nil {
		return nil, err
	}
	return res.Nodes, nil
}

func (a *autoClient) idle(ms int) {
	_ = a.call("idle", map[string]any{"window": 0, "timeout": ms}, nil)
}

func (a *autoClient) waitText(substr string, timeout time.Duration) ([]autoNode, error) {
	deadline := time.Now().Add(timeout)
	var last []autoNode
	for time.Now().Before(deadline) {
		nodes, err := a.tree()
		if err == nil {
			last = nodes
			for _, n := range nodes {
				if strings.Contains(n.Label, substr) || strings.Contains(n.Value, substr) {
					a.idle(600)
					time.Sleep(150 * time.Millisecond)
					return nodes, nil
				}
			}
		}
		time.Sleep(120 * time.Millisecond)
	}
	labels := make([]string, 0, len(last))
	for _, n := range last {
		if n.Label != "" {
			labels = append(labels, n.Label)
		}
	}
	return last, fmt.Errorf("timed out waiting for text %q (visible labels: %v)", substr, labels)
}

func (a *autoClient) pressContains(substr string, preferRole string) error {
	nodes, err := a.tree()
	if err != nil {
		return err
	}
	var fallback *autoNode
	for i := range nodes {
		n := &nodes[i]
		if !strings.Contains(n.Label, substr) {
			continue
		}
		if preferRole != "" && n.Role == preferRole {
			if err := a.call("act", map[string]any{"window": 0, "id": n.ID, "action": "press"}, nil); err == nil {
				a.idle(800)
				time.Sleep(250 * time.Millisecond)
				return nil
			}
		}
		if fallback == nil && (n.Role == "button" || n.Role == "tab" || n.Role == "link" || n.Bounds.W > 0) {
			fallback = n
		}
	}
	if fallback != nil {
		if err := a.call("act", map[string]any{"window": 0, "id": fallback.ID, "action": "press"}, nil); err == nil {
			a.idle(800)
			time.Sleep(250 * time.Millisecond)
			return nil
		}
		// Fallback to pointer click at node center.
		cx := fallback.Bounds.X + fallback.Bounds.W/2
		cy := fallback.Bounds.Y + fallback.Bounds.H/2
		if err := a.call("input", map[string]any{
			"window": 0,
			"events": []map[string]any{{"type": "click", "x": cx, "y": cy}},
		}, nil); err != nil {
			return err
		}
		a.idle(800)
		time.Sleep(250 * time.Millisecond)
		return nil
	}
	return fmt.Errorf("element containing %q not found", substr)
}

func (a *autoClient) captureTo(path string) (int, int, error) {
	a.idle(1000)
	time.Sleep(250 * time.Millisecond)
	var res struct {
		PNG    []byte `json:"png"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	}
	if err := a.call("capture", map[string]any{"window": 0}, &res); err != nil {
		return 0, 0, err
	}
	if err := os.WriteFile(path, res.PNG, 0o644); err != nil {
		return 0, 0, err
	}
	return res.Width, res.Height, nil
}

func launchAppForQA(t *testing.T, binPath, sockPath, gwURL, token, fp, themeMode string) (*exec.Cmd, *autoClient) {
	t.Helper()
	_ = os.Remove(sockPath)
	dataDir := t.TempDir()
	cmd := exec.Command(binPath,
		"--host-url", gwURL,
		"--token", token,
		"--tls-fp", fp,
		"--data-dir", dataDir,
		"--theme", themeMode,
	)
	cmd.Env = append(os.Environ(), "MYGO_AUTOMATION="+sockPath)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start %s: %v", binPath, err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		_ = os.Remove(sockPath)
	})

	ac, err := dialAutomation(sockPath, 15*time.Second)
	if err != nil {
		t.Fatalf("dialAutomation (%s): %v", themeMode, err)
	}
	t.Cleanup(ac.Close)

	// Wait for window to exist and initial Rooms data to hydrate through real Node gateway.
	if _, err := ac.waitText("Product Launch", 15*time.Second); err != nil {
		// If still on Connect tab, tap Rooms tab once SSE connects.
		_ = ac.pressContains("Rooms", "tab")
		if _, err2 := ac.waitText("Product Launch", 10*time.Second); err2 != nil {
			t.Fatalf("app failed to hydrate Rooms (%s): %v (fallback: %v)", themeMode, err, err2)
		}
	}
	return cmd, ac
}

func TestLiveMacOSVisualQA(t *testing.T) {
	qaRoot := "/tmp/linger-mobile-qa"
	screensDir := filepath.Join(qaRoot, "screens")
	if err := os.MkdirAll(screensDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	binPath := filepath.Join(qaRoot, "linger-mobile-e2e")
	if _, err := os.Stat(binPath); err != nil {
		t.Fatalf("missing binary %s: build with go build -tags e2e first (%v)", binPath, err)
	}

	// Boot richly populated upstream + REAL Node Companion Gateway (TLS 1.3).
	upstream, err := testutil.NewFakeServer(false)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	upstream.SeedAllFixtures()
	defer upstream.Close()

	boot, gwURL := startRealStandaloneGateway(t, upstream.URL, t.TempDir())
	parsed, err := discovery.ParsePairingURI(boot.PairingURI)
	if err != nil {
		t.Fatalf("ParsePairingURI: %v", err)
	}

	unauth, err := api.NewClient(api.ClientConfig{
		BaseURL:        gwURL,
		Mode:           api.AuthModeCompanion,
		TLSFingerprint: boot.TLSFingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	pairResp, err := unauth.Pair(context.Background(), api.PairRequest{
		Code:       parsed.Code,
		DeviceName: "Linger Live QA Mac",
		Platform:   "darwin",
		AppVersion: "0.1.0",
	})
	if err != nil {
		t.Fatalf("Pair with real Node gateway: %v", err)
	}

	capture := func(ac *autoClient, filename string) {
		p := filepath.Join(screensDir, filename)
		w, h, err := ac.captureTo(p)
		if err != nil {
			t.Fatalf("capture %s: %v", filename, err)
		}
		t.Logf("captured %s (%dx%d)", p, w, h)
	}

	// ================= PASS 1: TOWN LIGHT =================
	cmdLight, acLight := launchAppForQA(t, binPath, filepath.Join(qaRoot, "auto-light.sock"), gwURL, pairResp.Token, boot.TLSFingerprint, "light")
	capture(acLight, "02-rooms-list-light.png")

	// Open Room Chat -> Decision Card
	if err := acLight.pressContains("Room Product Launch", "button"); err != nil {
		t.Fatalf("open Room Product Launch: %v", err)
	}
	if _, err := acLight.waitText("Run go test in linger-mobile", 8*time.Second); err != nil {
		t.Fatalf("wait Room Chat decision card: %v", err)
	}
	capture(acLight, "04-room-chat-decision-light.png")

	// Live -> Pending Approvals
	if err := acLight.pressContains("Live", "tab"); err != nil {
		t.Fatalf("switch to Live tab: %v", err)
	}
	if _, err := acLight.waitText("Approvals", 5*time.Second); err != nil {
		t.Fatalf("wait Live tab: %v", err)
	}
	if err := acLight.pressContains("Approvals", "tab"); err != nil {
		t.Fatalf("select Approvals segment: %v", err)
	}
	if _, err := acLight.waitText("Send release update email", 5*time.Second); err != nil {
		t.Fatalf("wait Approvals inbox: %v", err)
	}
	capture(acLight, "06-live-approvals-light.png")

	// Work -> Issues & Pocket
	if err := acLight.pressContains("Work", "tab"); err != nil {
		t.Fatalf("switch to Work tab: %v", err)
	}
	if _, err := acLight.waitText("Ship Mobile Companion Wave C-2", 8*time.Second); err != nil {
		t.Fatalf("wait Work issues: %v", err)
	}
	capture(acLight, "08-work-issues-routines-light.png")

	if err := acLight.pressContains("Pocket", "tab"); err != nil {
		t.Fatalf("select Pocket segment: %v", err)
	}
	if _, err := acLight.waitText("Today's Pocket Note", 5*time.Second); err != nil {
		t.Fatalf("wait Pocket view: %v", err)
	}
	capture(acLight, "09-work-pocket-light.png")

	// Library -> Docs & Search
	if err := acLight.pressContains("Library", "tab"); err != nil {
		t.Fatalf("switch to Library tab: %v", err)
	}
	if _, err := acLight.waitText("main.go", 8*time.Second); err != nil {
		t.Fatalf("wait Library docs: %v", err)
	}
	capture(acLight, "10-library-docs-search-light.png")

	// More -> Settings Overview
	if err := acLight.pressContains("More", "tab"); err != nil {
		t.Fatalf("switch to More tab: %v", err)
	}
	if _, err := acLight.waitText("Manage Hosts / Pair New Desktop", 8*time.Second); err != nil {
		t.Fatalf("wait More settings: %v", err)
	}
	capture(acLight, "12-more-settings-light.png")

	// Connection Hub
	if err := acLight.pressContains("Manage Hosts / Pair New Desktop", "button"); err != nil {
		t.Fatalf("open Connection Hub: %v", err)
	}
	if _, err := acLight.waitText("Saved Desktop & Remote Hosts", 5*time.Second); err != nil {
		t.Fatalf("wait Connection Hub: %v", err)
	}
	capture(acLight, "01-connect-hub-light.png")

	acLight.Close()
	_ = cmdLight.Process.Kill()
	_ = cmdLight.Wait()

	// ================= PASS 2: TOWN DARK =================
	cmdDark, acDark := launchAppForQA(t, binPath, filepath.Join(qaRoot, "auto-dark.sock"), gwURL, pairResp.Token, boot.TLSFingerprint, "dark")
	capture(acDark, "03-rooms-list-dark.png")

	// Open Room Chat -> Watch Live (Live Run Watch Dark)
	if err := acDark.pressContains("Room Product Launch", "button"); err != nil {
		t.Fatalf("open Room Product Launch (dark): %v", err)
	}
	if _, err := acDark.waitText("Watch Live", 8*time.Second); err != nil {
		t.Fatalf("wait Watch Live banner (dark): %v", err)
	}
	if err := acDark.pressContains("Watch Live", "button"); err != nil {
		t.Fatalf("open Live Run Watch: %v", err)
	}
	if _, err := acDark.waitText("Execution Plan", 8*time.Second); err != nil {
		t.Fatalf("wait Live Run Watch: %v", err)
	}
	capture(acDark, "05-live-run-watch-dark.png")

	// Live -> Compute & Local Models (Dark)
	if err := acDark.pressContains("Live", "tab"); err != nil {
		t.Fatalf("switch to Live tab (dark): %v", err)
	}
	if _, err := acDark.waitText("Compute", 5*time.Second); err != nil {
		t.Fatalf("wait Live segments (dark): %v", err)
	}
	if err := acDark.pressContains("Compute", "tab"); err != nil {
		t.Fatalf("select Compute segment (dark): %v", err)
	}
	if _, err := acDark.waitText("Local Models", 5*time.Second); err != nil {
		t.Fatalf("wait Local Models (dark): %v", err)
	}
	capture(acDark, "07-live-compute-local-models-dark.png")

	// Library -> Personal Wiki & Knowledge Graph (Dark)
	if err := acDark.pressContains("Library", "tab"); err != nil {
		t.Fatalf("switch to Library tab (dark): %v", err)
	}
	if _, err := acDark.waitText("Wiki", 8*time.Second); err != nil {
		t.Fatalf("wait Library tab (dark): %v", err)
	}
	if err := acDark.pressContains("Wiki", "tab"); err != nil {
		t.Fatalf("select Wiki segment (dark): %v", err)
	}
	if _, err := acDark.waitText("Personal Knowledge Wiki", 5*time.Second); err != nil {
		t.Fatalf("wait Wiki view (dark): %v", err)
	}
	capture(acDark, "11-library-wiki-graph-dark.png")

	// More -> My Rules (Dark)
	if err := acDark.pressContains("More", "tab"); err != nil {
		t.Fatalf("switch to More tab (dark): %v", err)
	}
	if _, err := acDark.waitText("My Rules", 8*time.Second); err != nil {
		t.Fatalf("wait More tab (dark): %v", err)
	}
	if err := acDark.pressContains("My Rules", "tab"); err != nil {
		t.Fatalf("select My Rules segment (dark): %v", err)
	}
	if _, err := acDark.waitText("Promote", 5*time.Second); err != nil {
		_, _ = acDark.waitText("Shadow", 3*time.Second)
	}
	capture(acDark, "13-more-rules-dark.png")

	acDark.Close()
	_ = cmdDark.Process.Kill()
	_ = cmdDark.Wait()
}
