package localtools

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"log/slog"
	"maps"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/linger/mcpproxy"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/process"
)

type cuaSession struct {
	op           *operation
	client       *mcpClient
	label        string
	desktopCheck func() error
	mu           sync.Mutex
	started      bool
	// desktop is a second Cua session for whole-screen tools. Cua makes a
	// desktop escalation permanent, which would disable the window tools.
	desktop bool
	// permitted caches a Windows UI Automation check; it cannot change while
	// the driver process runs at the same integrity level.
	permitted bool
	ended     bool
	unknown   *actionReceipt
	// servicePID is the macOS Cua service this session talks to, or 0.
	servicePID int
	// lost marks a session whose service has exited; the Operation opens a
	// new one on its next call.
	lost bool
	// leased is the macOS app the Computer last brought to the front, or 0.
	leased int
	// focus is, per macOS app, the window the Computer last saw become the
	// app's key window. Cua's z_index does not follow a window raised inside
	// an app, so this record decides which window holds the keys.
	focus map[int]focusRecord
	// named is, per macOS app, the window the Agent last named.
	named map[int]float64
	// input is, per macOS app, when the Agent last sent it input.
	input map[int]time.Time
	// snapshots carries the Agent's tokens over the Computer's own reads.
	snapshots *snapshotRows
}

func (c *cuaSession) checkDesktop() error {
	if c.desktopCheck != nil {
		return c.desktopCheck()
	}
	return desktopReady()
}

// inputSettle is how long a read of an app's focused window waits after
// input to that app. Cua no longer waits for a window change after each
// input, and a window that cmd+n opens is listed only after ~0.2 s.
var inputSettle = 300 * time.Millisecond

// focusRecord is an app's key window and the windows the app showed then. A
// window opened since, such as a new document, sheet or panel, opens in front.
type focusRecord struct {
	window float64
	known  map[float64]bool
}

// checkPermissionsTool is the Computer's own read-only desktop tool. Both the
// Cua catalog and the unavailable-driver catalog add it beside cuaTools.
const checkPermissionsTool = "check_permissions"

// cuaTools are the Cua 0.35.4 tools an Agent may call. Both platforms ship the
// same catalog; Cua owns the platform-specific input routes.
var cuaTools = map[string]bool{"list_windows": true, "get_window_state": true, "get_desktop_state": true, "get_screen_size": true, "get_cursor_position": true,
	"click": true, "double_click": true, "right_click": true, "move_cursor": true, "drag": true, "scroll": true, "type_text": true, "press_key": true, "hotkey": true,
	"clipboard_read": true, "clipboard_write": true, "launch_app": true, "bring_to_front": true, "set_window_frame": true}

func (m *Manager) openCua(ctx context.Context, op *operation) (*cuaSession, []tool, error) {
	if !filepath.IsAbs(m.options.CuaPath) {
		return nil, nil, errors.New("managed Cua driver is not installed; repair the Computer installation")
	}
	environment := append(append([]string{}, m.env...), cuaQuietEnvironment...)
	arguments := []string{"mcp", "--direct"}
	run := process.Run
	servicePID := 0
	if runtime.GOOS == "windows" {
		// Each Operation owns one in-process driver in the signed-in session;
		// Windows needs no permission grant beyond UI Automation.
		if err := interactiveSession(); err != nil {
			return nil, nil, err
		}
		// Applications that launch_app starts belong to the user. Only the
		// driver joins the Operation's Job Object, so task end never closes
		// them, as on macOS where Launch Services starts them.
		run = process.RunDirectChild
	} else {
		socket, err := m.ensureCuaService(ctx)
		if err != nil {
			return nil, nil, err
		}
		// The signed application owns TCC permissions. Embedded mode here applies
		// only to the proxy: it must not auto-launch another, prompting service.
		environment = append(environment, "CUA_DRIVER_EMBEDDED=1")
		arguments = []string{"mcp", "--socket", socket}
		servicePID = cuaServicePID(socket)
	}
	client, err := startClientWith(ctx, run, m.options.CuaPath, arguments, op.spec.WorkingDirectory, environment)
	var session *cuaSession
	if client != nil {
		session = &cuaSession{op: op, client: client, label: "linger-" + rand.Text(), servicePID: servicePID, snapshots: newSnapshotRows(&m.cuaInputGeneration)}
		client.observe = session.snapshots.observe
	}
	if err != nil {
		return session, nil, err
	}
	catalog, err := client.tools(ctx)
	if err != nil {
		return session, nil, err
	}
	var tools []tool
	for _, item := range catalog {
		if !cuaTools[item.Name] && (item.Name != "run_script" || runtime.GOOS != "darwin") {
			continue
		}
		if runtime.GOOS == "windows" && windowsHiddenTools[item.Name] {
			continue
		}
		var input map[string]any
		if json.Unmarshal(item.InputSchema, &input) != nil {
			return session, nil, errors.New("invalid Cua tool schema")
		}
		if props, ok := input["properties"].(map[string]any); ok {
			delete(props, "session")
		}
		if required, ok := input["required"].([]any); ok {
			kept := []any{}
			for _, key := range required {
				if key != "session" {
					kept = append(kept, key)
				}
			}
			input["required"] = kept
		}
		if runtime.GOOS == "windows" && inputTools[item.Name] {
			windowsSchema(input)
		}
		item.InputSchema, _ = json.Marshal(input)
		if item.Name == "scroll" && runtime.GOOS == "windows" {
			item.Description = windowsScrollDescription
		}
		if inputTools[item.Name] {
			if runtime.GOOS == "darwin" {
				item.Description += macInputResult
			} else {
				item.Description += " With pid and window_id, the result ends with what changed in that window since your last read, as text with a new snapshot_id. The read replaces the snapshot, so use the new snapshot's tokens next. A screenshot follows only when the window has no readable tree. Send several inputs planned on one snapshot as one run_actions call."
			}
		}
		if item.Name == "launch_app" && runtime.GOOS == "darwin" {
			item.Description = "Open a macOS app in the background through Launch Services, as `open -g` does, and return its pid and windows. Optional urls are handed to the app; for Finder, pass a folder to open it in a window."
			item.InputSchema = schema(map[string]any{"bundle_id": map[string]string{"type": "string", "description": "Preferred, for example com.apple.TextEdit."}, "name": map[string]string{"type": "string", "description": "App name, when the bundle id is unknown."}, "urls": map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "Files or folders to open in the app."},
				"agent_browser": map[string]string{"type": "boolean", "description": "Open the URLs in the Computer's own browser window, which keeps working while other windows cover it on the user's desktop. Only a site's home page opens there, such as https://www.example.com/. With no bundle_id it is the first installed of Chrome, Edge, Firefox and Safari; a bundle_id of com.google.Chrome, com.microsoft.edgemac, org.mozilla.firefox or com.apple.Safari picks one. In Chrome and Safari it is a window of the Computer's own in the user's everyday browser, with the user's sign-ins; in Chrome it opens one site per call. Edge and Firefox run as separate instances with their own sign-ins."}})
		}
		if item.Name == "get_desktop_state" {
			item.Description += " Read-only whole-screen view; act through the window tools with a pid and window_id. A system privacy prompt about CuaDriver belongs to the user: never answer it, and keep working through the window tools."
		}
		if compact, ok := macCompactTools[item.Name]; ok && runtime.GOOS == "darwin" {
			// Codex shows these tools directly, so the model sees every schema
			// field; only the fields the Computer routes stay.
			item.Description, item.InputSchema = compact.description, compact.schema()
		}
		if item.Name == "run_script" {
			item.Description, item.InputSchema = macScriptDescription, macScriptSchema()
		}
		if item.Name == "type_text" {
			item.Description += " In a macOS Open or Save panel, the name field takes a file name only: a slash there becomes a colon in the saved name. To choose the folder, press cmd+shift+g on that window, enter the folder path in the field that opens, press return, then set the name."
		}
		tools = append(tools, item)
	}
	names := slices.Sorted(maps.Keys(inputTools))
	step := map[string]any{"type": "object", "properties": map[string]any{"tool": map[string]any{"type": "string", "enum": names}}, "required": []string{"tool"}}
	batchDescription := "Preferred for two or more inputs you can already plan on one get_window_state snapshot, for example set a field, click Save and press Return. Each step names an input tool with its usual arguments, such as pid, window_id and element_token. Runs the steps in order, stops at the first failed step and says which steps ran, then reads the last step's window once, as one input does. Steps keep their tokens valid for the next steps; a token from an older read is refused."
	if runtime.GOOS == "darwin" {
		batchDescription = "Runs one or more planned inputs in one call, for example cmd+shift+g, type a path and press Return. Each step names an input tool with its usual arguments, such as pid, window_id and element_token. Runs the steps in order and stops at the first failed step and says which steps ran. Inputs keep the read's tokens valid, so later steps can use them; a token from an older read is refused, and a step with role and name is found when it runs. Steps report only whether they were sent. The call then reads the window once and returns what changed: by default the last step's window, or the app's focused window when that step names none; pass read with get_window_state arguments, such as {pid, window_id, query}, to read another window."
	}
	batchProperties := map[string]any{"actions": map[string]any{"type": "array", "minItems": 1, "maxItems": maxBatchActions, "items": step}}
	if runtime.GOOS == "darwin" {
		batchProperties["read"] = map[string]any{"type": "object", "description": "get_window_state arguments for the read after the last step; defaults to the last step's window with since: \"latest\"."}
	}
	tools = append(tools, tool{Name: "run_actions", Description: batchDescription, InputSchema: schema(batchProperties, "actions")})
	if runtime.GOOS == "darwin" {
		tools = append(tools, tool{Name: "report_blocker", Description: reportBlockerDescription, InputSchema: reportBlockerSchema()})
	}
	tools = append(tools, tool{Name: checkPermissionsTool, Description: "Read Cua application permissions without prompting. Also reports an unresolved prior action.", InputSchema: schema(map[string]any{})})
	return session, tools, nil
}

// cuaQuietEnvironment keeps the pinned driver offline: no telemetry and no
// update check. Computer upgrades replace it with a reviewed release.
var cuaQuietEnvironment = []string{"CUA_TELEMETRY_ENABLED=false", "CUA_DRIVER_RS_UPDATE_CHECK=0"}

// cuaServiceEnvironment also stops the macOS service from waiting up to a
// second after each action for a window to change. As in Codex, the Agent
// reads the window itself after its inputs, so that wait only delayed each
// click and key by 0.3–0.4 seconds.
var cuaServiceEnvironment = append([]string{"CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS=0"}, cuaQuietEnvironment...)

type cuaResult struct {
	IsError    bool `json:"isError"`
	Structured struct {
		Session         string `json:"session"`
		Active          *bool  `json:"active"`
		Code            string `json:"code"`
		Effect          string `json:"effect"`
		Detail          string `json:"detail"`
		Degraded        string `json:"degraded_reason"`
		Tool            string `json:"tool"`
		Accessibility   bool   `json:"accessibility"`
		ScreenRecording bool   `json:"screen_recording"`
		UIA             bool   `json:"uia"`
		Source          struct {
			Attribution string `json:"attribution"`
			Embedded    bool   `json:"embedded"`
		} `json:"source"`
	} `json:"structuredContent"`
}

func cuaPermissionsGranted(permission cuaResult, embedded bool) bool {
	if runtime.GOOS == "windows" {
		return !permission.IsError && permission.Structured.UIA
	}
	if permission.IsError || !permission.Structured.Accessibility || !permission.Structured.ScreenRecording {
		return false
	}
	if embedded {
		return permission.Structured.Source.Attribution == "host" && permission.Structured.Source.Embedded
	}
	return permission.Structured.Source.Attribution == "driver-daemon"
}

func (c *cuaSession) permissions(ctx context.Context) (json.RawMessage, error) {
	// Windows has no permission prompt, and Cua rejects the argument there.
	arguments := map[string]bool{"prompt": false}
	if runtime.GOOS == "windows" {
		arguments = map[string]bool{}
	}
	return c.client.request(ctx, "tools/call", map[string]any{"name": checkPermissionsTool, "arguments": arguments})
}

func (c *cuaSession) call(ctx context.Context, name string, args json.RawMessage) (output json.RawMessage, callErr error) {
	ctx, release, err := c.op.manager.holdLane(ctx, desktopLane)
	if err != nil {
		return nil, err
	}
	defer release()
	if c.needsFocus(ctx, name, args) {
		var releaseFocus func()
		if ctx, releaseFocus, err = c.op.manager.holdFocusedInput(ctx); err != nil {
			return nil, err
		}
		defer releaseFocus()
	}
	c.mu.Lock()
	pending := c.unknown != nil
	c.mu.Unlock()
	// Another call may have retired this session while this one waited for
	// the screen; a pending unknown action settles once the driver is gone.
	if c.retired() || pending && c.driverStopped() {
		return nil, errDriverGone
	}
	switch name {
	case checkPermissionsTool:
		return c.checkPermissionsCall(ctx)
	case "run_actions":
		return c.runActions(ctx, args)
	case "report_blocker":
		if runtime.GOOS == "darwin" {
			return c.reportBlocker(args)
		}
	}
	arguments, err := cuaCallArguments(args)
	if err != nil {
		return nil, err
	}
	if runtime.GOOS == "windows" {
		if err := windowsInputRefusal(name, arguments, func() bool { return c.chromiumTarget(arguments) }); err != nil {
			return nil, err
		}
	}
	namedWindow := arguments["window_id"] != nil
	if inputTools[name] && ctx.Value(cuaInternalInput{}) == nil {
		if err := c.checkWindowToken(arguments); err != nil {
			return nil, err
		}
	}
	if own, _ := arguments["agent_browser"].(bool); own && name == "launch_app" {
		// Refused before the launch takes the browser, the pace or the journal.
		urls, _ := arguments["urls"].([]any)
		for _, item := range urls {
			if address, ok := item.(string); ok {
				if err := homePage(address); err != nil {
					return nil, err
				}
			}
		}
	}
	// A key to the user's Chrome reaches the window that has the keyboard,
	// whichever window it names, so it is refused before anything is taken.
	if name == "hotkey" || name == "type_text" || name == "press_key" {
		if err := c.userChromeKeys(ctx, arguments); err != nil {
			return nil, err
		}
	}
	agentChrome, err := c.claimAgentChromeInput(ctx, name, arguments)
	if err != nil {
		return nil, err
	}
	// A Skill script names its window in args, which the script takes in. A
	// script that names none is taken to drive the window this task opened in
	// the Computer's own browser, if any. Only a script that goes to that
	// browser is paced; any script takes its lease.
	scriptTarget, _ := arguments["args"].(map[string]any)
	if name == "run_script" && agentChrome && (scriptTarget == nil || scriptTarget["pid"] == nil) {
		scriptTarget = c.agentChromeTarget()
	}
	ownScript := false
	if name == "run_script" && agentChrome && scriptTarget != nil {
		if ownScript, err = c.isAgentChrome(ctx, scriptTarget["pid"], scriptTarget["window_id"]); err != nil {
			return nil, err
		}
	}
	paced := agentChrome && (inputTools[name] || ownScript)
	scriptInputs := 0
	if paced {
		// A script reserves nothing: its own pause runs inside it, and its
		// inputs are counted from its call log once it ends.
		reserve := 1
		if name == "run_script" {
			reserve = 0
		}
		left, err := c.paceAgentChrome(ctx, reserve)
		if err != nil {
			return nil, err
		}
		scriptInputs = min(agentChromeScriptInputs, left)
	}
	// target is the window an input goes to; a script names its own.
	target := arguments
	if name == "run_script" && scriptTarget != nil {
		target = scriptTarget
	}
	if paced {
		if err := c.checkAgentChromeTabs(ctx, target["pid"], target["window_id"]); err != nil {
			return nil, err
		}
	}
	if name == "run_script" {
		// A script's body may reach any app, so its guard checks every key
		// against the user's Chrome, whatever window args names.
		chrome, err := userChromePID(ctx)
		if err != nil {
			return nil, err
		}
		if err := scriptArguments(ctx, arguments, c.reviewScope(), scriptInputs, chrome); err != nil {
			return nil, err
		}
	}
	if err := c.checkDesktop(); err != nil {
		return nil, err
	}
	// Only a call that passed every refusal above may un-minimize a window.
	if runtime.GOOS == "windows" {
		pid, window := c.targetWindow(arguments)
		if err := windowsRestore(name, pid, window, restoreMinimizedWindow); err != nil {
			return nil, err
		}
	}
	// timing splits one call into its phases, so a slow input names its cause.
	started := time.Now()
	var focusMs, driverMs int64
	defer func() {
		slog.Info("cua.call.timing", "tool", name, "pid", arguments["pid"], "window_id", arguments["window_id"], "since", arguments["since"] != nil, "focus_ms", focusMs, "driver_ms", driverMs, "total_ms", time.Since(started).Milliseconds(), "failed", callErr != nil)
	}()
	// Only the retained original transport can drain an older cancelled call.
	// This never constructs a new client to clear an unknown prior action.
	c.op.manager.retryCleanup()
	receipt, err := c.op.manager.journal.begin(ctx, actionIdentity{AgentID: c.op.spec.AgentID, OperationID: c.op.identity.OperationID, Session: c.label, Background: !holdsFocus(ctx)})
	if err != nil {
		return nil, err
	}
	confirmed := true
	defer func() {
		if callErr != nil && c.driverStopped() {
			// A stopped service runs no action, so the outcome is final.
			confirmed, callErr = true, errDriverStopped
		}
		if !confirmed {
			c.mu.Lock()
			c.unknown = receipt
			c.mu.Unlock()
			c.op.markUnknown()
		}
		if err := receipt.finish(confirmed); err != nil {
			c.mu.Lock()
			c.unknown = receipt
			c.mu.Unlock()
			c.op.markUnknown()
			callErr = errors.Join(callErr, mcpproxy.ErrCleanupUnconfirmed, err)
		}
	}()
	if err := c.requirePermissions(ctx); err != nil {
		return nil, err
	}
	// Only a script to the Computer's own browser wakes it first.
	wake := scriptTarget
	if !ownScript {
		wake = nil
	}
	appKeys, textRead, err := c.prepareInput(ctx, name, arguments, agentChrome, wake)
	if err != nil {
		return nil, err
	}
	label, err := c.startInputSessions(ctx, name, arguments, appKeys)
	if err != nil {
		confirmed = !errors.Is(err, errOutcomeUnknown) && !errors.Is(err, errUnconfirmedSession)
		return nil, err
	}
	arguments["session"] = label
	owner, picked, pickConfirmed, err := c.pickFocusedWindow(ctx, name, arguments)
	if err != nil {
		confirmed = pickConfirmed
		return nil, err
	}
	if name == "launch_app" && runtime.GOOS == "darwin" {
		if c.snapshots != nil {
			c.snapshots.sent(name)
		}
		result, err := c.launchApp(ctx, arguments)
		confirmed = !errors.Is(err, errOutcomeUnknown)
		return result, err
	}
	if appKeys || runtime.GOOS == "darwin" && foregroundInput(name, arguments) {
		focusStarted := time.Now()
		err := c.focusApp(ctx, name, arguments)
		focusMs = time.Since(focusStarted).Milliseconds()
		if err != nil {
			confirmed = !errors.Is(err, errOutcomeUnknown)
			return nil, err
		}
	}
	if c.snapshots != nil {
		// The Computer's own reads since the Agent's read, such as the tab
		// check, replaced the snapshot the Agent's token names.
		c.snapshots.remap(arguments)
	}
	token, _ := arguments["element_token"].(string)
	pagePress := agentChrome && name == "click" && c.snapshots != nil && c.snapshots.unpressable(token)
	driverStarted := time.Now()
	result, err := c.sendInput(ctx, name, arguments, appKeys, agentChrome)
	if err == nil && pagePress && !failed(result) {
		// Chrome clicks a page element on a press even where the element
		// lists no press, as the sort menu of a review list did; the Agent
		// took Cua's warning as a miss and clicked by x,y, which missed.
		result = withNote(result, "In the Computer's own browser, a press goes to the element as a person's click would, even where its row lists no press. Check its effect in the next read; repeat it by x,y only if that read shows no effect.")
	}
	var scriptReads []windowRead
	if err == nil && name == "run_script" {
		result, scriptReads = scriptResultReads(result)
	}
	if c.snapshots != nil {
		c.snapshots.sent(name)
		// The script's reads after its last input come after the fence, so
		// their tokens carry over the Computer's reads before the next call.
		for _, read := range scriptReads {
			c.snapshots.record(read)
		}
	}
	driverMs = time.Since(driverStarted).Milliseconds()
	if err == nil && runtime.GOOS == "windows" && inputTools[name] {
		result = windowsRefusedResult(name, result)
	}
	if err == nil {
		result = c.annotateInputResult(name, result)
	}
	result, err = c.rereadWindow(ctx, name, arguments, result, err, owner, picked, textRead)
	confirmed = !errors.Is(err, errOutcomeUnknown)
	if paced && name == "run_script" && err == nil {
		c.countScriptInputs(result)
	}
	// A script that throws has still sent the inputs before the throw. One
	// that sent none changed no tab, and a read of the strip after it would
	// stale the tokens its queries returned, which the Daemon keeps no rows of.
	sentNone := false
	if name == "run_script" {
		sent, known := scriptInputsSent(result)
		sentNone = known && sent == 0
	}
	if paced && (err == nil || name == "run_script") && !sentNone {
		if note := c.recordAgentChromeTabs(ctx, target["pid"], target["window_id"], len(scriptReads) > 0); note != "" && result != nil {
			result = withNote(result, note)
		}
	}
	return c.finishInput(ctx, name, arguments, appKeys, namedWindow, result, err)
}

// cuaReadTools send no input.
var cuaReadTools = map[string]bool{"list_windows": true, "get_window_state": true, "get_desktop_state": true, "get_screen_size": true, "get_cursor_position": true, checkPermissionsTool: true, "report_blocker": true}

// backgroundTools are the macOS inputs Cua delivers to the target app in the
// background, without the front window or the clipboard. A double-click is
// not one: when a Finder row refuses AXOpen, sendInput brings Finder to the
// front and double-clicks there.
var backgroundTools = map[string]bool{"click": true, "right_click": true, "scroll": true}

// needsFocus reports a call that must not run beside browser calls; see
// focusGate. Only reads and a macOS background input to a known app other
// than a Chromium browser run beside them. Keys and text may go to the
// front app or through the clipboard, and a script or a batch may send
// anything. Chrome is left out because its window may be a Playwright
// browser's, whose page a background click would meet mid-action.
func (c *cuaSession) needsFocus(ctx context.Context, name string, args json.RawMessage) bool {
	switch {
	case cuaReadTools[name]:
		return false
	case runtime.GOOS != "darwin" || !backgroundTools[name]:
		return true
	}
	var arguments map[string]any
	if json.Unmarshal(args, &arguments) != nil {
		return true
	}
	if modifiers, _ := arguments["modifier"].([]any); len(modifiers) > 0 || foregroundInput(name, arguments) {
		return true
	}
	pid, _ := arguments["pid"].(float64)
	if token, ok := arguments["element_token"].(string); ok && pid == 0 {
		if key, _, found := c.op.reads.row(token); found {
			pid = float64(key.pid)
		}
	}
	return pid <= 0 || c.op.manager.chromiumProcess(ctx, int(pid))
}

// checkPermissionsCall answers check_permissions, which sends no input.
func (c *cuaSession) checkPermissionsCall(ctx context.Context) (json.RawMessage, error) {
	result, err := c.permissions(ctx)
	if err != nil {
		if c.driverStopped() {
			return nil, errDriverStopped
		}
		return nil, err
	}
	if c.op.manager.journal.blocked() {
		return nil, errors.New("COMPUTER_ACTION_UNKNOWN: an earlier action has no verified cleanup receipt; restart alone does not authorize new input")
	}
	return result, nil
}

// cuaCallArguments decodes an Agent's Cua arguments and refuses the fields the
// Computer owns.
func cuaCallArguments(args json.RawMessage) (map[string]any, error) {
	var arguments map[string]any
	if json.Unmarshal(args, &arguments) != nil || arguments == nil {
		return nil, errors.New("invalid Cua arguments")
	}
	if _, exists := arguments["session"]; exists {
		return nil, errors.New("Cua session is owned by the Operation")
	}
	for _, key := range []string{"window_id", "pid"} {
		if value, ok := arguments[key]; ok && value == nil {
			// A null id means none, as an absent one does.
			delete(arguments, key)
		}
	}
	for name := range arguments {
		if strings.HasPrefix(name, "_") {
			return nil, errors.New("Cua transport metadata is owned by the Computer")
		}
	}
	return arguments, nil
}

// textResultTools are the Cua tools whose text content says all their
// structuredContent does. Claude Code shows a result's structuredContent as
// JSON in place of its text, so a window read reached the model as escaped
// Markdown wrapped in capture metadata, and a script's result as its full
// call log. list_windows keeps it: its text only counts the windows.
var textResultTools = map[string]bool{"get_window_state": true, "run_script": true, "click": true, "double_click": true, "right_click": true,
	"drag": true, "scroll": true, "type_text": true, "press_key": true, "hotkey": true}

// withoutStructured drops a result's structuredContent.
func withoutStructured(result json.RawMessage) json.RawMessage {
	var reply map[string]json.RawMessage
	if json.Unmarshal(result, &reply) != nil || reply["structuredContent"] == nil {
		return result
	}
	delete(reply, "structuredContent")
	if encoded, err := json.Marshal(reply); err == nil {
		return encoded
	}
	return result
}

// stampInput records that the Agent just sent input to the app pid.
func (c *cuaSession) stampInput(pid any) {
	number, ok := pid.(float64)
	if !ok {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.input == nil {
		c.input = map[int]time.Time{}
	}
	c.input[int(number)] = time.Now()
}

// errUnconfirmedSession reports a start_session reply that does not prove
// the owned session.
var errUnconfirmedSession = errors.New("Cua did not confirm the owned session")

// startSession starts the window ("auto") or desktop Cua session once.
func (c *cuaSession) startSession(ctx context.Context, scope string) error {
	label := c.label
	if scope == "desktop" {
		label = c.desktopLabel()
	}
	c.mu.Lock()
	started := c.started
	if scope == "desktop" {
		started = c.desktop
	}
	ended := c.ended
	if !ended && !started {
		// The same transport must retain cleanup authority even if the start
		// response is lost after the driver accepted it.
		if scope == "desktop" {
			c.desktop = true
		} else {
			c.started = true
		}
	}
	c.mu.Unlock()
	if ended {
		return errors.New("Cua Operation session has ended")
	}
	if started {
		return nil
	}
	result, err := c.client.request(ctx, "tools/call", map[string]any{"name": "start_session", "arguments": map[string]any{"session": label, "capture_scope": scope}})
	if err != nil {
		return err
	}
	var start cuaResult
	if json.Unmarshal(result, &start) != nil || start.Structured.Session != label || start.Structured.Active == nil || !*start.Structured.Active {
		return errUnconfirmedSession
	}
	return nil
}

// cuaInternalInput marks inputs run_actions sends, which read the window
// themselves.

// axRefused reports whether Cua refused accessibility text insertion before
// sending anything: Cua marks a result whose actuator never ran with effect
// "refused".
func axRefused(result json.RawMessage) bool {
	var reply cuaResult
	return json.Unmarshal(result, &reply) == nil && reply.IsError && reply.Structured.Effect == "refused"
}

// cuaWindowNotFound reports whether Cua rejected a window_id that no longer
// names a live window.
func cuaWindowNotFound(result json.RawMessage) bool {
	var reply cuaResult
	return json.Unmarshal(result, &reply) == nil && reply.IsError && reply.Structured.Code == "window_id_not_found"
}

// withNote appends a text note to a tool result's content.
func withNote(result json.RawMessage, note string) json.RawMessage {
	var reply map[string]any
	if json.Unmarshal(result, &reply) != nil {
		return result
	}
	content, _ := reply["content"].([]any)
	reply["content"] = append(content, map[string]any{"type": "text", "text": note})
	encoded, _ := json.Marshal(reply)
	return encoded
}

// failed reports whether a driver result is an error.
func failed(result json.RawMessage) bool {
	var reply struct {
		IsError bool `json:"isError"`
	}
	return json.Unmarshal(result, &reply) != nil || reply.IsError
}

func (c *cuaSession) requirePermissions(ctx context.Context) error {
	c.mu.Lock()
	permitted := c.permitted
	c.mu.Unlock()
	if permitted {
		return nil
	}
	permissions, err := c.permissions(ctx)
	if err != nil {
		return err
	}
	var permission cuaResult
	if json.Unmarshal(permissions, &permission) == nil && cuaPermissionsGranted(permission, c.op.manager.options.CuaEmbedded) {
		if runtime.GOOS == "windows" {
			c.mu.Lock()
			c.permitted = true
			c.mu.Unlock()
		}
		return nil
	}
	if runtime.GOOS == "windows" {
		return errors.New("COMPUTER_PERMISSION_REQUIRED: Windows UI Automation is unavailable to the Computer; it never elevates itself")
	}
	owner := "the signed CuaDriver application"
	if c.op.manager.options.CuaEmbedded {
		owner = "Linger"
	}
	return errors.New("COMPUTER_PERMISSION_REQUIRED: " + owner + " lacks Accessibility or Screen Recording. Run `teamhub computer permissions request --for computer-use --permissions accessibility,screen_recording` to post a permission card for the user, then end your turn; the card wakes you once they grant them. Never operate System Settings or privacy prompts yourself")
}

// desktopScoped tools read or move across the whole screen. They run in the
// desktop session; everything else stays window-scoped.
func desktopScoped(name string, arguments map[string]any) bool {
	return name == "get_desktop_state" || name == "get_screen_size" || name == "get_cursor_position" || (name == "move_cursor" && arguments["scope"] == "desktop")
}

func (c *cuaSession) drain() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ended {
		return nil
	}
	ctx, cancel := cleanupContext()
	defer cancel()
	for _, session := range []struct {
		label   string
		started *bool
	}{{c.label, &c.started}, {c.desktopLabel(), &c.desktop}} {
		if *session.started {
			if err := c.endSession(ctx, session.label); err != nil {
				return err
			}
			*session.started = false
		}
	}
	if err := c.unknown.finish(true); err != nil {
		return errors.Join(mcpproxy.ErrCleanupUnconfirmed, err)
	}
	c.unknown = nil
	c.ended = true
	return nil
}

func (c *cuaSession) desktopLabel() string { return c.label + "-desktop" }

func (c *cuaSession) endSession(ctx context.Context, label string) error {
	for {
		result, err := c.client.request(ctx, "tools/call", map[string]any{"name": "end_session", "arguments": map[string]string{"session": label}})
		if err != nil {
			return errors.Join(mcpproxy.ErrCleanupUnconfirmed, err)
		}
		var reply cuaResult
		if json.Unmarshal(result, &reply) != nil {
			return mcpproxy.ErrCleanupUnconfirmed
		}
		if !reply.IsError && reply.Structured.Session == label && reply.Structured.Active != nil && !*reply.Structured.Active {
			return nil
		}
		if reply.Structured.Code != "session_cleanup_pending" && reply.Structured.Code != "session_cleanup_partial" {
			return mcpproxy.ErrCleanupUnconfirmed
		}
		select {
		case <-ctx.Done():
			return mcpproxy.ErrCleanupUnconfirmed
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func (c *cuaSession) close() error {
	err := c.drain()
	if err == nil {
		err = c.client.close()
	}
	return err
}

func sleepContext(ctx context.Context, wait time.Duration) error {
	select {
	case <-ctx.Done():
		return context.Cause(ctx)
	case <-time.After(wait):
		return nil
	}
}
