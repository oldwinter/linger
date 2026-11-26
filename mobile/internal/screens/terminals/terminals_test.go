package terminals_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/herdr"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/screens/terminals"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

type fakeHerdrBackend struct {
	srv *httptest.Server

	mu            sync.Mutex
	unavailable   bool
	unavailableSt int
	failNextCAS   bool
	terminals     []herdr.Terminal
	machines      []herdr.MachineView
	templates     []herdr.TemplateInfo
	screenByAddr  map[string]herdr.ReadResult
	sentReqs      []herdr.SendRequest
	keysReqs      []herdr.KeysRequest
	launchReqs    []herdr.LaunchRequest
	interruptReqs []herdr.InterruptRequest
	killAddrs     []string
	removedAddrs  []string
}

func newFakeHerdrBackend(t *testing.T) *fakeHerdrBackend {
	t.Helper()
	exitZero := 0
	fb := &fakeHerdrBackend{
		terminals: []herdr.Terminal{
			{
				Address: "vps/t7",
				Name:    "deploy-claude",
				State:   "live",
				Status: &herdr.OSCStatus{
					State: "blocked",
					Msg:   "Approve running database migration?",
					App:   "claude",
				},
				Cwd:    "/srv/linger",
				Keep:   true,
				Labels: map[string]string{"linger.room": "release-ops", "linger.work_item": "WI-108"},
			},
			{
				Address: "t1",
				Name:    "lead-codex",
				State:   "live",
				Status: &herdr.OSCStatus{
					State: "working",
					Msg:   "Running go test across mobile packages",
					App:   "codex",
				},
				Cwd:    "/Users/dev/linger",
				Keep:   true,
				Labels: map[string]string{"linger.room": "mobile-dev"},
			},
			{
				Address: "t2",
				Name:    "lint-helper",
				Parent:  "t1",
				State:   "live",
				Status: &herdr.OSCStatus{
					State: "working",
					Msg:   "Checking i18n catalog parity",
					App:   "codex",
				},
				Cwd: "/Users/dev/linger/mobile",
			},
			{
				Address:  "t9",
				Name:     "old-build",
				State:    "finished",
				ExitCode: &exitZero,
				Agent:    "zsh",
				Cwd:      "/Users/dev/linger",
			},
		},
		machines: []herdr.MachineView{
			{Name: "vps", State: "connected", Version: "0.1.21"},
		},
		templates: []herdr.TemplateInfo{
			{Name: "reviewer", Description: "Code reviewer template", Agent: "claude"},
			{Name: "builder", Description: "Go build and test runner", Agent: "codex"},
		},
		screenByAddr: map[string]herdr.ReadResult{
			"vps/t7": {
				Text:     "$ migrate up\nApply 2 pending migrations? [y/N]",
				Complete: true,
				How:      "history",
			},
			"t1": {
				Text:     "$ go test -race ./...\nok github.com/oldwinter/linger/mobile/internal/herdr",
				Complete: true,
				How:      "history",
			},
			"t9": {
				Text:     "Build succeeded.\nProcess exited with code 0.",
				Complete: true,
				How:      "history",
			},
		},
	}

	fb.srv = httptest.NewServer(http.HandlerFunc(fb.handle))
	t.Cleanup(fb.srv.Close)
	return fb
}

func (fb *fakeHerdrBackend) handle(w http.ResponseWriter, r *http.Request) {
	fb.mu.Lock()
	unavail := fb.unavailable
	unavailSt := fb.unavailableSt
	fb.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	if unavail {
		if unavailSt == 0 {
			unavailSt = http.StatusServiceUnavailable
		}
		w.WriteHeader(unavailSt)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{"code": "HERDR_UNAVAILABLE", "message": "herdr-core is not running"},
		})
		return
	}

	path := r.URL.Path
	switch {
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/herdr-core/status"):
		fb.mu.Lock()
		live, fin, blocked, working := 0, 0, 0, 0
		for _, term := range fb.terminals {
			if term.IsFinished() {
				fin++
			} else {
				live++
			}
			if term.IsBlocked() {
				blocked++
			}
			if term.IsWorking() {
				working++
			}
		}
		machines := append([]herdr.MachineView(nil), fb.machines...)
		fb.mu.Unlock()
		_ = json.NewEncoder(w).Encode(herdr.CoreStatus{
			Available:     true,
			Version:       "0.1.21",
			CoreID:        "core_mac",
			CoreName:      "Studio Mac",
			LiveCount:     live,
			FinishedCount: fin,
			BlockedCount:  blocked,
			WorkingCount:  working,
			Machines:      machines,
		})
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/herdr-core/terminals"):
		fb.mu.Lock()
		res := herdr.ListTerminalsResult{
			Terminals: append([]herdr.Terminal(nil), fb.terminals...),
			Machines:  append([]herdr.MachineView(nil), fb.machines...),
		}
		fb.mu.Unlock()
		_ = json.NewEncoder(w).Encode(res)
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/herdr-core/terminal"):
		addr := r.URL.Query().Get("address")
		fb.mu.Lock()
		var found *herdr.Terminal
		for i := range fb.terminals {
			if fb.terminals[i].Address == addr {
				cp := fb.terminals[i]
				found = &cp
				break
			}
		}
		fb.mu.Unlock()
		if found == nil {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{"code": "TERMINAL_NOT_FOUND", "message": "terminal not found"},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"terminal": found})
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/herdr-core/terminal/read"):
		addr := r.URL.Query().Get("address")
		fb.mu.Lock()
		res, ok := fb.screenByAddr[addr]
		fb.mu.Unlock()
		if !ok {
			res = herdr.ReadResult{Text: "$ ready", Complete: true, How: "screen"}
		}
		_ = json.NewEncoder(w).Encode(res)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/herdr-core/terminals"):
		var req herdr.LaunchRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		addr := "t10"
		if req.On != "" {
			addr = req.On + "/t10"
		}
		created := herdr.Terminal{
			Address:  addr,
			Name:     req.Name,
			Template: req.Template,
			Cwd:      req.Cwd,
			Keep:     req.Keep,
			Labels:   req.Labels,
			State:    "live",
			Status:   &herdr.OSCStatus{State: "working", Msg: req.Task, App: "claude"},
		}
		fb.mu.Lock()
		fb.launchReqs = append(fb.launchReqs, req)
		fb.terminals = append(fb.terminals, created)
		fb.screenByAddr[addr] = herdr.ReadResult{Text: "$ launched " + addr, Complete: true, How: "screen"}
		fb.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"terminal": created})
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/herdr-core/terminal/send"):
		var req herdr.SendRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		fb.mu.Lock()
		fb.sentReqs = append(fb.sentReqs, req)
		failCAS := fb.failNextCAS
		fb.failNextCAS = false
		if !failCAS {
			for i := range fb.terminals {
				if fb.terminals[i].Address == req.Address {
					fb.terminals[i].Status = &herdr.OSCStatus{State: "working", Msg: "Resumed after reply", App: fb.terminals[i].EffectiveApp()}
					break
				}
			}
		}
		fb.mu.Unlock()
		if failCAS {
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{"code": "STATUS_MISMATCH", "message": "not blocked"},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(herdr.SendResult{OK: true, Sent: true, Address: req.Address})
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/herdr-core/terminal/keys"):
		var req herdr.KeysRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		fb.mu.Lock()
		fb.keysReqs = append(fb.keysReqs, req)
		fb.mu.Unlock()
		_ = json.NewEncoder(w).Encode(herdr.KeysResult{OK: true, Address: req.Address, Keys: req.Keys})
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/herdr-core/terminal/interrupt"):
		var req herdr.InterruptRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		fb.mu.Lock()
		fb.interruptReqs = append(fb.interruptReqs, req)
		fb.mu.Unlock()
		_ = json.NewEncoder(w).Encode(herdr.InterruptResult{OK: true, Address: req.Address, Effect: "idle"})
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/herdr-core/terminal/kill"):
		var req herdr.KillRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		fb.mu.Lock()
		fb.killAddrs = append(fb.killAddrs, req.Address)
		for i := range fb.terminals {
			if fb.terminals[i].Address == req.Address {
				fb.terminals[i].State = "finished"
				fb.terminals[i].Status = nil
				break
			}
		}
		fb.mu.Unlock()
		_ = json.NewEncoder(w).Encode(herdr.KillResult{OK: true, Address: req.Address, State: "finished"})
	case r.Method == http.MethodDelete && strings.HasSuffix(path, "/herdr-core/terminal"):
		addr := r.URL.Query().Get("address")
		fb.mu.Lock()
		fb.removedAddrs = append(fb.removedAddrs, addr)
		kept := fb.terminals[:0]
		for _, term := range fb.terminals {
			if term.Address != addr {
				kept = append(kept, term)
			}
		}
		fb.terminals = kept
		fb.mu.Unlock()
		_ = json.NewEncoder(w).Encode(herdr.RemoveResult{OK: true, Address: addr, Removed: true})
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/herdr-core/templates"):
		fb.mu.Lock()
		tpls := append([]herdr.TemplateInfo(nil), fb.templates...)
		fb.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"templates": tpls})
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/herdr-core/machines"):
		fb.mu.Lock()
		ms := append([]herdr.MachineView(nil), fb.machines...)
		fb.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"machines": ms})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func newTestTerminalsScreen(t *testing.T, fb *fakeHerdrBackend) (*terminals.Screen, func(string) bool) {
	t.Helper()
	cl, err := herdr.NewClient(herdr.ClientConfig{
		BaseURL:        fb.srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          "lmc_test",
		AllowPlainHTTP: true,
		ComputerID:     "comp_mac_1",
	})
	if err != nil {
		t.Fatalf("herdr.NewClient: %v", err)
	}
	var (
		toastMu sync.Mutex
		toasts  []string
	)
	scr := terminals.New(terminals.Deps{
		Client: cl,
		Computers: []api.LocalComputer{
			{ComputerID: "comp_mac_1", DisplayName: "Studio Mac", Status: "online"},
			{ComputerID: "comp_linux_2", DisplayName: "Build Box", Status: "offline"},
		},
		ShowToast: func(msg string) {
			toastMu.Lock()
			toasts = append(toasts, msg)
			toastMu.Unlock()
		},
	})
	t.Cleanup(scr.Close)
	scr.Refresh(context.Background())
	hasToast := func(substr string) bool {
		toastMu.Lock()
		defer toastMu.Unlock()
		return strings.Contains(strings.Join(toasts, " | "), substr)
	}
	return scr, hasToast
}

func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for condition")
}

func settle(tt *ui.Tester) {
	tt.Frame()
	tt.Advance(600 * time.Millisecond)
	tt.Frame()
}

func TestTerminalsOverviewBlockedInboxFiltersHierarchyAndThemes(t *testing.T) {
	t.Cleanup(func() {
		i18n.SetPreference(config.LanguageEN)
	})
	fb := newFakeHerdrBackend(t)
	scr, _ := newTestTerminalsScreen(t, fb)

	if scr.BlockedCount() != 1 {
		t.Fatalf("BlockedCount = %d, want 1", scr.BlockedCount())
	}

	for _, lang := range []config.LanguagePreference{config.LanguageEN, config.LanguageZhHans} {
		i18n.SetPreference(lang)
		for _, vp := range testutil.StandardMobileViewports {
			for _, dark := range []bool{false, true} {
				mode := "light"
				if dark {
					mode = "dark"
				}
				t.Run(string(lang)+"_"+vp.Name+"_"+mode, func(t *testing.T) {
					tt := testutil.NewPhoneTester(func(c *ui.Context) {
						if dark {
							c.SetTheme(theme.TownDark())
						} else {
							c.SetTheme(theme.TownLight())
						}
						scr.View(c)
					}, vp)
					tt.Frame()

					if !tt.HasText("deploy-claude") || !tt.HasText("Approve running database migration?") {
						t.Fatalf("expected blocked priority inbox item, texts=%v", tt.Texts())
					}
					if !tt.HasText("Studio Mac") || !tt.HasText("vps") {
						t.Fatalf("expected computer picker and SSH machine chips, texts=%v", tt.Texts())
					}

					// Scroll down to verify hierarchical sub-agent and Room/Work Item labels.
					tt.Scroll(160, 420, 0, 320)
					tt.Frame()
					joined := strings.Join(tt.Texts(), " ")
					if !strings.Contains(joined, "lead-codex") && !strings.Contains(joined, "release-ops") {
						t.Fatalf("expected live terminals and linger labels in list, texts=%v", tt.Texts())
					}
				})
			}
		}
	}

	// Verify machine filter & status filter interactions in English.
	i18n.SetPreference(config.LanguageEN)
	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Filter to Local machine: remote vps/t7 disappears, local t1 + child t2 stay visible.
	if err := tt.Click("Machine Local"); err != nil {
		t.Fatalf("click Machine Local: %v", err)
	}
	tt.Frame()
	if tt.HasText("Approve running database migration?") {
		t.Fatal("expected vps blocked banner hidden when filtered to Local")
	}
	if !tt.HasText("lead-codex") || !tt.HasText("lint-helper") {
		t.Fatalf("expected local parent and child sub-agent visible, texts=%v", tt.Texts())
	}
	if !tt.HasText("\u21b3 Sub-agent of t1") {
		t.Fatalf("expected sub-agent hierarchy badge, texts=%v", tt.Texts())
	}

	// Filter to Done: only finished t9 remains.
	if err := tt.Click("Done"); err != nil {
		t.Fatalf("click Done status filter: %v", err)
	}
	tt.Frame()
	if !tt.HasText("old-build") || tt.HasText("lead-codex") {
		t.Fatalf("expected only finished terminal under Done filter, texts=%v", tt.Texts())
	}
}

func TestTerminalsBlockedQuickKeysCASReplyAndConflict(t *testing.T) {
	i18n.SetPreference(config.LanguageEN)
	fb := newFakeHerdrBackend(t)
	scr, hasToast := newTestTerminalsScreen(t, fb)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// 1. Tap quick key "y" in blocked inbox -> POST .../terminal/keys.
	if err := tt.Click("y"); err != nil {
		t.Fatalf("click quick key y: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		fb.mu.Lock()
		defer fb.mu.Unlock()
		return len(fb.keysReqs) == 1
	})
	fb.mu.Lock()
	if fb.keysReqs[0].Address != "vps/t7" || len(fb.keysReqs[0].Keys) != 1 || fb.keysReqs[0].Keys[0] != "y" {
		t.Fatalf("unexpected keys req: %+v", fb.keysReqs[0])
	}
	fb.mu.Unlock()

	// 2. CAS conflict first: type reply and trigger 409 STATUS_MISMATCH.
	fb.mu.Lock()
	fb.failNextCAS = true
	fb.mu.Unlock()

	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		info, ok := tt.AccessByRole(ui.RoleTextField, "Reply to deploy-claude")
		return ok && !info.Disabled
	})
	info, ok := tt.AccessByRole(ui.RoleTextField, "Reply to deploy-claude")
	if !ok {
		t.Fatalf("missing blocked reply text field, nodes=%v", tt.Texts())
	}
	tt.ClickAt(info.Bounds.X+info.Bounds.W/2, info.Bounds.Y+info.Bounds.H/2)
	tt.Type("approve migration")
	tt.Frame()
	if err := tt.Click("Send"); err != nil {
		t.Fatalf("click Send blocked reply: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		fb.mu.Lock()
		defer fb.mu.Unlock()
		return len(fb.sentReqs) == 1
	})
	fb.mu.Lock()
	casReq := fb.sentReqs[0]
	fb.mu.Unlock()
	if casReq.Address != "vps/t7" || casReq.Text != "approve migration" || casReq.If != "blocked" || !casReq.Force {
		t.Fatalf("expected CAS blocked send with if=blocked & force=true, got %+v", casReq)
	}
	waitUntil(t, 2*time.Second, func() bool {
		return hasToast("no longer blocked")
	})

	// 3. Retry Send once enabled -> succeeds and clears blocked state!
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		btn, ok := tt.AccessByRole(ui.RoleButton, "Send")
		return ok && !btn.Disabled
	})
	if err := tt.Click("Send"); err != nil {
		t.Fatalf("click retry Send: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return scr.BlockedCount() == 0
	})
}

func TestTerminalsDetailLiveReaderControlBarAndConfirmations(t *testing.T) {
	i18n.SetPreference(config.LanguageEN)
	fb := newFakeHerdrBackend(t)
	scr, _ := newTestTerminalsScreen(t, fb)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Open vps/t7 detail via Inspect button.
	if err := tt.Click("Inspect"); err != nil {
		t.Fatalf("click Inspect: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("$ migrate up\nApply 2 pending migrations? [y/N]")
	})

	// Toggle Live attach -> backend returns 404 on /attach -> automatically enters Auto Poll mode!
	if err := tt.Click("Live"); err != nil {
		t.Fatalf("click Live attach toggle: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return tt.HasText("Auto Poll")
	})

	// Send Ctrl+C quick key.
	if err := tt.Click("Ctrl+C"); err != nil {
		t.Fatalf("click Ctrl+C: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		fb.mu.Lock()
		defer fb.mu.Unlock()
		return len(fb.keysReqs) == 1 && fb.keysReqs[0].Keys[0] == "ctrl+c"
	})

	// Type and send a prompt from the bottom command bar.
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		info, ok := tt.AccessByRole(ui.RoleTextField, "Terminal prompt input")
		return ok && !info.Disabled
	})
	promptInfo, ok := tt.AccessByRole(ui.RoleTextField, "Terminal prompt input")
	if !ok {
		t.Fatal("missing Terminal prompt input in detail view")
	}
	tt.ClickAt(promptInfo.Bounds.X+promptInfo.Bounds.W/2, promptInfo.Bounds.Y+promptInfo.Bounds.H/2)
	tt.Type("status --short")
	tt.Frame()
	if err := tt.Click("Send"); err != nil {
		t.Fatalf("click detail Send: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		fb.mu.Lock()
		defer fb.mu.Unlock()
		return len(fb.sentReqs) == 1 && fb.sentReqs[0].Text == "status --short"
	})

	// Click Interrupt.
	if err := tt.Click("Interrupt"); err != nil {
		t.Fatalf("click Interrupt: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		fb.mu.Lock()
		defer fb.mu.Unlock()
		return len(fb.interruptReqs) == 1 && fb.interruptReqs[0].Address == "vps/t7"
	})

	// Click Kill -> confirmation sheet appears -> confirm Kill Terminal.
	if err := tt.Click("Kill"); err != nil {
		t.Fatalf("click Kill: %v", err)
	}
	settle(tt)
	if !tt.HasText("Kill Terminal") {
		t.Fatalf("expected Kill confirmation dialog, texts=%v", tt.Texts())
	}
	if err := tt.Click("Kill Terminal"); err != nil {
		t.Fatalf("click Kill Terminal confirm: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		fb.mu.Lock()
		defer fb.mu.Unlock()
		return len(fb.killAddrs) == 1 && fb.killAddrs[0] == "vps/t7"
	})

	// Once killed (finished), Remove button appears and is enabled -> confirm Remove Terminal -> returns to overview!
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		btn, ok := tt.AccessByRole(ui.RoleButton, "Remove")
		return ok && !btn.Disabled
	})
	if err := tt.Click("Remove"); err != nil {
		t.Fatalf("click Remove: %v", err)
	}
	settle(tt)
	if err := tt.Click("Remove Terminal"); err != nil {
		t.Fatalf("click Remove Terminal confirm: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		fb.mu.Lock()
		removed := len(fb.removedAddrs) == 1 && fb.removedAddrs[0] == "vps/t7"
		fb.mu.Unlock()
		return removed && tt.HasText("+ Launch")
	})
}

func TestTerminalsQuickLaunchSheetTemplateAndCustomCommand(t *testing.T) {
	i18n.SetPreference(config.LanguageEN)
	fb := newFakeHerdrBackend(t)
	scr, _ := newTestTerminalsScreen(t, fb)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Open Quick Launch sheet.
	if err := tt.Click("+ Launch"); err != nil {
		t.Fatalf("click + Launch: %v", err)
	}
	settle(tt)
	if !tt.HasText("Quick Launch") || !tt.HasText("reviewer") {
		t.Fatalf("expected Quick Launch sheet with templates, texts=%v", tt.Texts())
	}

	// Select remote machine vps and launch reviewer template.
	if err := tt.Click("vps"); err != nil {
		t.Fatalf("select target machine vps: %v", err)
	}
	tt.Frame()
	if info, ok := tt.AccessByRole(ui.RoleTextField, "Task / Prompt (optional)"); ok {
		tt.ClickAt(info.Bounds.X+info.Bounds.W/2, info.Bounds.Y+info.Bounds.H/2)
		tt.Type("Audit mobile client")
		tt.Frame()
	}
	if err := tt.Click("Launch Terminal"); err != nil {
		t.Fatalf("click Launch Terminal: %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		fb.mu.Lock()
		defer fb.mu.Unlock()
		return len(fb.launchReqs) == 1
	})
	fb.mu.Lock()
	launched := fb.launchReqs[0]
	fb.mu.Unlock()
	if launched.Template != "reviewer" || launched.On != "vps" || !launched.Keep || launched.Labels["linger.origin"] != "mobile" {
		t.Fatalf("unexpected launch request: %+v", launched)
	}

	// Wait until Quick Launch sheet dismiss animation completes and detail view is interactive.
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("All Terminals") && !tt.HasText("Quick Launch")
	})
	if err := tt.Click("All Terminals"); err != nil {
		t.Fatalf("click All Terminals: %v", err)
	}
	settle(tt)
	if err := tt.Click("+ Launch"); err != nil {
		t.Fatalf("reopen + Launch: %v", err)
	}
	settle(tt)
	if err := tt.Click("Command"); err != nil {
		t.Fatalf("switch launch mode to Command: %v", err)
	}
	tt.Frame()
	cmdInfo, ok := tt.AccessByRole(ui.RoleTextField, "Command")
	if !ok {
		t.Fatalf("missing Command text field, texts=%v", tt.Texts())
	}
	tt.ClickAt(cmdInfo.Bounds.X+cmdInfo.Bounds.W/2, cmdInfo.Bounds.Y+cmdInfo.Bounds.H/2)
	tt.Type("go test ./...")
	tt.Frame()
	if err := tt.Click("Local"); err != nil {
		t.Fatalf("select Local target machine: %v", err)
	}
	tt.Frame()
	if err := tt.Click("Launch Terminal"); err != nil {
		t.Fatalf("click Launch Terminal (custom command): %v", err)
	}
	waitUntil(t, 2*time.Second, func() bool {
		fb.mu.Lock()
		defer fb.mu.Unlock()
		return len(fb.launchReqs) == 2
	})
	fb.mu.Lock()
	cmdLaunch := fb.launchReqs[1]
	fb.mu.Unlock()
	if cmdLaunch.Line != "go test ./..." || cmdLaunch.On != "" || !cmdLaunch.Keep || cmdLaunch.Labels["linger.origin"] != "mobile" {
		t.Fatalf("unexpected custom command launch request: %+v", cmdLaunch)
	}
}

func TestTerminalsGracefulUnavailableAndOfflineStates(t *testing.T) {
	i18n.SetPreference(config.LanguageEN)

	// 1. Unpaired / nil client renders calm connect prompt without panicking.
	unpaired := terminals.New(terminals.Deps{})
	defer unpaired.Close()
	ttUnpaired := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		unpaired.View(c)
	}, testutil.StandardMobileViewports[1])
	ttUnpaired.Frame()
	if !ttUnpaired.HasText("Connect a Host for Terminals") {
		t.Fatalf("expected unpaired connect state, texts=%v", ttUnpaired.Texts())
	}

	// 2. Backend returning 503/404 renders herdr-core Unavailable gracefully.
	fb := newFakeHerdrBackend(t)
	fb.mu.Lock()
	fb.unavailable = true
	fb.unavailableSt = http.StatusNotFound
	fb.mu.Unlock()

	scr, _ := newTestTerminalsScreen(t, fb)
	ttUnavail := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	ttUnavail.Frame()
	if !ttUnavail.HasText("herdr-core Unavailable") || !ttUnavail.HasText("Retry") {
		t.Fatalf("expected graceful unavailable empty state, texts=%v", ttUnavail.Texts())
	}

	// 3. Switching to offline computer renders offline explanation cleanly.
	scr.SelectComputer("comp_linux_2")
	waitUntil(t, 2*time.Second, func() bool {
		ttUnavail.Frame()
		return ttUnavail.HasText("This Local Computer is currently offline. Retry once it reconnects.")
	})
}
