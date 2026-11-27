package localtools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// claimAgentChromeInput reports whether the call reaches the Computer's own
// Chrome and, if so, claims it for this Operation.
func (c *cuaSession) claimAgentChromeInput(ctx context.Context, name string, arguments map[string]any) (bool, error) {
	// The Computer's own browser takes input and window changes from one
	// Operation at a time. A script may reach any app from its body, and an
	// input without a pid may reach it by its element_token alone, so both
	// take the lease while that Chrome runs.
	agentChrome := false
	leased := inputTools[name] || windowTools[name]
	if _, pid := arguments["pid"]; runtime.GOOS == "darwin" && (name == "run_script" || leased && !pid) {
		own, err := c.agentChromeRunning(ctx)
		if err != nil {
			return false, err
		}
		agentChrome = own > 0
	} else if leased {
		var err error
		if agentChrome, err = c.isAgentChrome(ctx, arguments["pid"], arguments["window_id"]); err != nil {
			return false, err
		}
	}
	if agentChrome {
		if err := c.claimAgentChrome(); err != nil {
			return false, err
		}
	}
	if modifiers, _ := arguments["modifier"].([]any); agentChrome && len(modifiers) > 0 && arguments["delivery_mode"] != "foreground" {
		return false, fmt.Errorf("COMPUTER_INPUT_NOT_SENT: a click with modifier keys needs the window in front, and the Computer's own browser is never brought forward for it; click the link without modifier keys instead: %w", errNotSent)
	}
	return agentChrome, nil
}

// prepareInput resolves the call's target and defaults before any session
// starts. appKeys reports macOS keys that go to the app's focused field, and
// textRead a macOS window read the Computer turned into text.
func (c *cuaSession) prepareInput(ctx context.Context, name string, arguments map[string]any, agentChrome bool, scriptTarget map[string]any) (appKeys, textRead bool, err error) {
	modifiedClick(name, arguments)
	if name == "run_script" && agentChrome && scriptTarget != nil {
		if err := c.startSession(ctx, "auto"); err != nil {
			return false, false, err
		}
		if err := c.wakeAgentChrome(ctx, scriptTarget["pid"], scriptTarget["window_id"]); err != nil {
			return false, false, err
		}
	}
	if runtime.GOOS == "darwin" && located(name, arguments) {
		arguments["session"] = c.label
		if err := c.startSession(ctx, "auto"); err != nil {
			return false, false, err
		}
		if err := c.locate(ctx, name, arguments); err != nil {
			return false, false, err
		}
		delete(arguments, "session")
	}
	// On macOS, keys without an element or point go to the front app's
	// focused field through Cua's desktop session, as a person's keys do.
	// The Computer's own browser is never brought forward: its keys go to its
	// window in the background, which works while it is hidden.
	appKeys = runtime.GOOS == "darwin" && keyboardInput(name, arguments)
	if appKeys && agentChrome {
		if err := c.agentChromeKeys(ctx, arguments); err != nil {
			return false, false, err
		}
		appKeys = false
	}
	if agentChrome && name == "type_text" && arguments["delay_ms"] == nil {
		arguments["delay_ms"] = agentChromeTypeDelay
	}
	if pid, ok := arguments["pid"].(float64); ok && runtime.GOOS == "darwin" {
		if window, ok := arguments["window_id"].(float64); ok {
			c.mu.Lock()
			if c.named == nil {
				c.named = map[int]float64{}
			}
			c.named[int(pid)] = window
			c.mu.Unlock()
		}
	}
	// Like Codex's getAXState, a macOS read is text unless the Agent asks for
	// pixels. A window without a readable tree is read again with them.
	if name == "get_window_state" && runtime.GOOS == "darwin" {
		if _, ok := arguments["include_screenshot"]; !ok && arguments["include_accessibility_tree"] != false {
			arguments["include_screenshot"], textRead = false, true
		}
		// Cua stops at 250 nodes, which cuts a Finder list with its folders
		// expanded; the Agent then opens folders one by one to find a file.
		if _, ok := arguments["max_elements"]; !ok {
			arguments["max_elements"] = float64(500)
		}
		// Cua's 1000 ms walk budget cuts a browser page of a thousand nodes,
		// and a cut tree reads as degraded, so the read after every click on
		// such a page fell back to a screenshot the model then had to read
		// again as text.
		if _, ok := arguments["timeout_ms"]; !ok {
			arguments["timeout_ms"] = float64(windowReadTimeoutMs)
		}
	}
	if appKeys {
		if _, ok := arguments["scope"]; ok {
			return false, false, fmt.Errorf("COMPUTER_TARGET_REQUIRED: on macOS, keys go to the app named by pid, not to the desktop: %w", errNotSent)
		}
		if _, ok := arguments["target"]; ok {
			return false, false, fmt.Errorf("COMPUTER_TARGET_REQUIRED: on macOS, name the app with pid and optionally window_id, not target: %w", errNotSent)
		}
	}
	return appKeys, textRead, nil
}

// startInputSessions starts the Cua sessions the call needs and returns the
// session label its driver call names.
func (c *cuaSession) startInputSessions(ctx context.Context, name string, arguments map[string]any, appKeys bool) (string, error) {
	label, scope := c.label, "auto"
	if desktopScoped(name, arguments) {
		label, scope = c.desktopLabel(), "desktop"
	}
	scopes := []string{scope}
	if appKeys {
		// Focusing the app reads and fronts windows in the window session;
		// keys to the app's focus go through the desktop session.
		scopes = []string{"auto", "desktop"}
		// The Computer chooses the delivery of keys without an element.
		delete(arguments, "delivery_mode")
	}
	for _, scope := range scopes {
		if err := c.startSession(ctx, scope); err != nil {
			return "", err
		}
	}
	return label, nil
}

// pickFocusedWindow names the app's focused window for a macOS read without
// window_id. owner is the app's recorded key window when the read picked
// another one, such as a Save panel, whose controls macOS lists under the
// window it belongs to; picked lists the app's windows when the Computer
// chose the window. confirmed reports whether a failure left no unknown
// outcome.
func (c *cuaSession) pickFocusedWindow(ctx context.Context, name string, arguments map[string]any) (owner any, picked []listedWindow, confirmed bool, err error) {
	if _, ok := arguments["window_id"]; ok || name != "get_window_state" || runtime.GOOS != "darwin" || arguments["pid"] == nil {
		return nil, nil, true, nil
	}
	// Like Codex's getAXState, a read without a window reads the app's
	// focused window, where its keys go.
	number, _ := arguments["pid"].(float64)
	c.mu.Lock()
	sent := c.input[int(number)]
	c.mu.Unlock()
	if wait := time.Until(sent.Add(inputSettle)); wait > 0 {
		if err := sleepContext(ctx, wait); err != nil {
			return nil, nil, true, err
		}
	}
	windows, top, err := c.focusedWindow(ctx, arguments["pid"])
	if err != nil {
		return nil, nil, !errors.Is(err, errOutcomeUnknown), err
	}
	if top == nil {
		return nil, nil, true, fmt.Errorf("COMPUTER_WINDOW_NOT_FOUND: the app with pid %v shows no window", arguments["pid"])
	}
	arguments["window_id"] = top.WindowID
	c.mu.Lock()
	record, recorded := c.focus[int(number)]
	c.mu.Unlock()
	if recorded && record.window != top.WindowID {
		owner = record.window
	}
	return owner, windows, true, nil
}

// sendInput makes the driver call: keys to the app's focus, or the tool itself.
func (c *cuaSession) sendInput(ctx context.Context, name string, arguments map[string]any, appKeys, agentChrome bool) (json.RawMessage, error) {
	if appKeys {
		return c.sendKeys(ctx, name, arguments, int(arguments["pid"].(float64)))
	}
	if name == "bring_to_front" && isModalPanel(ctx, arguments["pid"], arguments["window_id"]) {
		// Cua fronts only ordinary windows. The dialog is already above the
		// app's other windows, so bringing the app forward puts it in front.
		window := arguments["window_id"]
		delete(arguments, "window_id")
		result, err := c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": arguments})
		if err == nil && !failed(result) {
			result = withNote(result, fmt.Sprintf("Window %v is this app's open dialog, which stays above its other windows, so the app was brought forward with it in front.", window))
		}
		return result, err
	}
	result, err := c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": arguments})
	if err == nil && runtime.GOOS == "darwin" && name == "double_click" && arguments["delivery_mode"] != "foreground" && !agentChrome && strings.Contains(string(result), "AXOpen returned -25205") {
		// Finder list rows refuse AXOpen, so nothing was sent. Open the
		// row as a person does: a double-click on the app in front.
		arguments["delivery_mode"] = "foreground"
		if err = c.focusApp(ctx, name, arguments); err == nil {
			result, err = c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": arguments})
		}
	}
	return result, err
}

// annotateInputResult adds the notes that tell the Agent why a sent call had
// no useful effect.
func (c *cuaSession) annotateInputResult(name string, result json.RawMessage) json.RawMessage {
	if (failed(result) || bytes.Contains(result, []byte(`"degraded_reason"`))) && c.checkDesktop() != nil {
		// The screen locked during the call, as during a long script.
		result = withNote(result, "COMPUTER_DESKTOP_LOCKED: the screen locked during this call, so the steps after that failed. Tell the user and stop until they unlock it; do not try other routes.")
	}
	if runtime.GOOS == "darwin" && name == "click" && strings.Contains(string(result), "AXMenuBarItem") {
		// An open menu bar menu holds the app's input until it closes, as
		// Finder did after the Agent opened File to reach Put Back.
		result = withNote(result, "This click opened a menu bar menu, and the app takes no other input until it closes: click a menu item from the latest read, or press_key escape with only pid.")
	}
	if runtime.GOOS == "darwin" && name == "click" {
		// TextEdit's text view refuses AXPress, and a menu item whose title
		// changed since the read is not found; the Agent retried both.
		if strings.Contains(string(result), "AXPress) returned -25206") {
			result = withNote(result, "This element does not take a press. To write in a text area, send type_text with only pid: it goes to the focused field.")
		} else if strings.Contains(string(result), "invoke_menu: path segment") {
			result = withNote(result, "The menu item was not found by its title. Send the item's keyboard shortcut instead, such as cmd+shift+t for Format > Make Plain Text in TextEdit.")
		}
	}
	return result
}

// rereadWindow reads a window again when the first read cannot stand: a
// rejected delta, a picked window that closed, an empty sheet, or a tree that
// was not readable in time.
func (c *cuaSession) rereadWindow(ctx context.Context, name string, arguments map[string]any, result json.RawMessage, err error, owner any, picked []listedWindow, textRead bool) (json.RawMessage, error) {
	var reply cuaResult
	since, _ := arguments["since"].(string)
	if err == nil && name == "get_window_state" && since != "" &&
		json.Unmarshal(result, &reply) == nil && reply.IsError &&
		reply.Structured.Tool == name && reply.Structured.Code == "typed_output_mismatch" &&
		reply.Structured.Detail == "returned_element_count does not match elements" {
		// Cua 0.35.4 can reject its own delta-tree count. Read the same window
		// once without the delta baseline; never replay an input or a lost call.
		delete(arguments, "since")
		result, err = c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": arguments})
	}
	if err == nil && picked != nil && cuaWindowNotFound(result) {
		// The picked window closed before the read, as a Go to Folder sheet
		// does after Return. Read the app's window again.
		if owner == nil {
			top, topErr := c.topWindow(ctx, arguments["pid"])
			if topErr == nil && top != nil && top.WindowID != arguments["window_id"] {
				owner = top.WindowID
			}
		}
		if owner != nil {
			arguments["window_id"] = owner
			result, err = c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": arguments})
			owner = nil
		}
	}
	var read cuaResult
	if err == nil && picked != nil && json.Unmarshal(result, &read) == nil && !read.IsError && read.Structured.Degraded == "" {
		// A readable focused window becomes the app's key window, so a later
		// empty sheet falls back to the document it belongs to, not to the
		// window that held the keys before cmd+n opened this one.
		c.record(int(arguments["pid"].(float64)), arguments["window_id"].(float64), picked)
	}
	read = cuaResult{}
	if err == nil && owner != nil && json.Unmarshal(result, &read) == nil && !read.IsError && read.Structured.Degraded != "" {
		arguments["window_id"] = owner
		result, err = c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": arguments})
		read = cuaResult{}
	}
	if err == nil && textRead && json.Unmarshal(result, &read) == nil && !read.IsError && read.Structured.Degraded != "" {
		// A tree that was only slow to walk, or not yet rebuilt after an
		// input, is still text: read it once more with a longer budget. Only
		// a window that is still unreadable then is shown as pixels.
		if sleepContext(ctx, windowRetryDelay) == nil {
			retry := maps.Clone(arguments)
			retry["timeout_ms"] = float64(windowRetryTimeoutMs)
			if again, againErr := c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": retry}); againErr == nil {
				var reread cuaResult
				if json.Unmarshal(again, &reread) == nil && !reread.IsError && reread.Structured.Degraded == "" {
					result, read = again, reread
				}
			}
		}
		if read.Structured.Degraded != "" {
			delete(arguments, "include_screenshot")
			result, err = c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": arguments})
		}
	}
	return result, err
}

// finishInput records what the call changed and shapes its result for the
// Agent.
func (c *cuaSession) finishInput(ctx context.Context, name string, arguments map[string]any, appKeys, namedWindow bool, result json.RawMessage, err error) (json.RawMessage, error) {
	if (inputTools[name] || appKeys) && runtime.GOOS == "darwin" {
		c.stampInput(arguments["pid"])
	}
	if name == "bring_to_front" && runtime.GOOS == "darwin" && err == nil && !failed(result) {
		// The Agent chose this app; later inputs may bring their apps
		// forward from it.
		if front, frontErr := frontmostPID(ctx); frontErr == nil && arguments["pid"] == float64(front) {
			c.mu.Lock()
			c.leased = front
			c.mu.Unlock()
			if window, ok := arguments["window_id"].(float64); ok {
				c.remember(ctx, front, window)
			}
		}
	}
	if err == nil && name == "get_window_state" && arguments["include_accessibility_tree"] != false {
		c.op.reads.observe(result)
		c.readAgentChromeWindow(arguments["pid"], arguments["window_id"])
	}
	if err == nil && inputTools[name] && ctx.Value(cuaInternalInput{}) == nil && (runtime.GOOS != "darwin" || namedWindow) {
		result = c.withWindowState(ctx, arguments, result)
	}
	if err == nil && (name == "get_window_state" || name == "list_windows" || inputTools[name]) && ctx.Value(cuaInternalInput{}) == nil && !failed(result) {
		if note := modalPanelNote(ctx, arguments["pid"], arguments["window_id"]); note != "" {
			result = withNote(result, note)
		}
	}
	if err == nil && name == "run_script" {
		result = compactScriptResult(result)
	}
	if err == nil && textResultTools[name] {
		result = withoutStructured(result)
	}
	if err == nil {
		// Window reads, desktop reads and the read after a batch all carry
		// screenshots; results without one pass through unchanged.
		result = compactScreenshots(result)
	}
	return result, err
}

type cuaInternalInput struct{}

func (c *cuaSession) checkWindowToken(arguments map[string]any) error {
	if runtime.GOOS == "darwin" && arguments["window_id"] != nil && c.snapshots != nil && c.snapshots.staleWindowToken(arguments) {
		return fmt.Errorf("COMPUTER_STALE_SNAPSHOT: read the target window again before sending input: %w", errNotSent)
	}
	return nil
}

// runActions sends inputs planned on one snapshot in order and reads the last
// window once. Each step is its own driver call: an input does not replace the
// snapshot, so later steps keep their tokens, and a token from an older read
// is refused instead of rebound to another element with the same label, as
// Cua run_steps would.
func (c *cuaSession) runActions(ctx context.Context, args json.RawMessage) (json.RawMessage, error) {
	var params struct {
		Actions []map[string]any `json:"actions"`
		Read    map[string]any   `json:"read"`
	}
	if json.Unmarshal(args, &params) != nil || len(params.Actions) == 0 || len(params.Actions) > maxBatchActions {
		return nil, fmt.Errorf("actions must list 1 to %d steps", maxBatchActions)
	}
	names := make([]string, len(params.Actions))
	for i, step := range params.Actions {
		names[i], _ = step["tool"].(string)
		if !inputTools[names[i]] {
			return nil, fmt.Errorf("step %d: tool must be one of the window input tools", i+1)
		}
		delete(step, "tool")
		for key := range step {
			if key == "session" || strings.HasPrefix(key, "_") {
				return nil, fmt.Errorf("step %d: %s is owned by the Computer", i+1, key)
			}
		}
		// All tokens in the batch were chosen before its first input.
		if err := c.checkWindowToken(step); err != nil {
			return nil, fmt.Errorf("step %d: batch was not sent: %w", i+1, err)
		}
	}
	internal := context.WithValue(ctx, cuaInternalInput{}, true)
	var reports []json.RawMessage
	first := 0
	total := len(params.Actions)
	// send runs steps first..last (0-based) as one driver call and keeps its
	// report. A failure names the completed prefix, the state of the failed
	// steps and the suffix that was never sent, so only inputs proven unsent
	// are resent.
	send := func(last int, name string, arguments any) (json.RawMessage, error) {
		encoded, _ := json.Marshal(arguments)
		result, err := c.call(internal, name, encoded)
		steps := fmt.Sprintf("Step %d", first+1)
		if last > first {
			steps = fmt.Sprintf("Steps %d-%d", first+1, last+1)
		}
		rest := ""
		if last+2 == total {
			rest = fmt.Sprintf(" Step %d was not sent.", total)
		} else if last+1 < total {
			rest = fmt.Sprintf(" Steps %d-%d were not sent.", last+2, total)
		}
		done := map[bool]string{true: "Step 1 completed. ", false: fmt.Sprintf("Steps 1-%d completed. ", first)}[first == 1]
		if first == 0 {
			done = ""
		}
		switch {
		case err == nil:
		case errors.Is(err, errNotSent):
			return nil, fmt.Errorf("%s%s was not sent: %w.%s", done, steps, err, rest)
		case errors.Is(err, errOutcomeUnknown):
			return nil, fmt.Errorf("%s%s has an unknown outcome: do not resend it. The Computer blocks further input in this task until the driver confirms its cleanup, so end the task and report what is known: %w.%s", done, steps, err, rest)
		default:
			return nil, fmt.Errorf("%s%s failed and may have taken effect: read the window before resending it: %w.%s", done, steps, err, rest)
		}
		var reply struct {
			IsError bool              `json:"isError"`
			Content []json.RawMessage `json:"content"`
		}
		if json.Unmarshal(result, &reply) == nil && reply.IsError {
			hint := ""
			if strings.Contains(string(result), "AXOpen returned -25205") {
				// Finder list rows refuse AXOpen, and the double-click in front
				// failed too; Codex opens them with keys.
				hint = " The element cannot be opened by double_click: click it, then send hotkey cmd+down, which opens the selected item in Finder."
			}
			note, _ := json.Marshal(map[string]string{"type": "text", "text": fmt.Sprintf("%s%s failed; the driver report below says which of them ran, and a failed step may have taken effect: read the window before resending it.%s%s", done, steps, rest, hint)})
			refused, _ := json.Marshal(map[string]any{"isError": true, "content": append(append(reports, note), reply.Content...)})
			return refused, nil
		}
		reports = append(reports, reply.Content...)
		first = last + 1
		return nil, nil
	}
	var target map[string]any
	for i, step := range params.Actions {
		if names[i] == "type_text" && i > 0 && (names[i-1] == "hotkey" || names[i-1] == "press_key") {
			// A shortcut such as cmd+shift+n or cmd+shift+g opens the field
			// the text is for a moment later; text sent before it lands in
			// the window, where a paste would drop copied files.
			if err := sleepContext(ctx, inputSettle); err != nil {
				return nil, fmt.Errorf("Steps 1-%d completed; steps %d-%d were not sent: %w", i, i+1, total, err)
			}
		}
		if refused, err := send(i, names[i], step); refused != nil || err != nil {
			return refused, err
		}
		if step["pid"] != nil {
			target = map[string]any{"pid": step["pid"], "window_id": step["window_id"], "session": c.label}
		}
	}
	if runtime.GOOS == "darwin" && params.Read == nil && target != nil {
		// Every input call ends with a read, as Codex's REPL ends a script
		// with getAXState, so the Agent never spends a turn only to look.
		params.Read = map[string]any{"pid": target["pid"], "since": "latest"}
		if target["window_id"] != nil {
			params.Read["window_id"] = target["window_id"]
		}
	}
	if runtime.GOOS == "darwin" && params.Read != nil {
		encoded, _ := json.Marshal(params.Read)
		read, err := c.call(ctx, "get_window_state", encoded)
		if err != nil {
			return nil, fmt.Errorf("Steps 1-%d completed; the read after them failed: %w", total, err)
		}
		var reply struct {
			Content []json.RawMessage `json:"content"`
		}
		if json.Unmarshal(read, &reply) == nil {
			reports = append(reports, reply.Content...)
		}
	}
	result, _ := json.Marshal(map[string]any{"content": reports})
	if target == nil || runtime.GOOS == "darwin" {
		// On macOS the read above already shows the effect.
		return result, nil
	}
	if target["window_id"] == nil {
		top, err := c.topWindow(ctx, target["pid"])
		if err != nil || top == nil {
			return result, nil //nolint:nilerr // the input was sent; a failed window lookup only skips the readback
		}
		target["window_id"] = top.WindowID
	}
	return c.withWindowState(ctx, target, result), nil
}

// inputTools change a window. Their results report delivery, and often an
// unverifiable effect, but not what the window shows afterwards.
var inputTools = map[string]bool{"click": true, "double_click": true, "right_click": true, "drag": true, "scroll": true, "type_text": true, "press_key": true, "hotkey": true}

// windowTools move or raise a window without sending it input.
var windowTools = map[string]bool{"bring_to_front": true, "set_window_frame": true}

// windowViewDelay lets an input's effect render before the read. Cua already
// waits for its own read-back after each input, so a short pause suffices.
var windowViewDelay = 100 * time.Millisecond

// windowRetryDelay is how long a failed read waits before its one retry.
var windowRetryDelay = 400 * time.Millisecond

// windowReadTimeoutMs is the walk budget of a macOS text read that names no
// timeout_ms. Cua's own default of 1000 ms is enough for a native window and
// too little for a browser page of a thousand nodes.
const windowReadTimeoutMs = 4000

// windowRetryTimeoutMs is the budget of the one text re-read of a window
// whose first read came back degraded.
const windowRetryTimeoutMs = 6000

// withWindowState appends what an input changed in its window, as text, so
// the Agent sees the effect and the new element tokens without another model
// turn. Like any read, it replaces the window's snapshot. A window without a
// readable tree gets a display-only screenshot instead.
func (c *cuaSession) withWindowState(ctx context.Context, arguments map[string]any, result json.RawMessage) json.RawMessage {
	pid, window := arguments["pid"], arguments["window_id"]
	var reply struct {
		IsError bool              `json:"isError"`
		Content []json.RawMessage `json:"content"`
	}
	var merged map[string]json.RawMessage
	if pid == nil || window == nil || json.Unmarshal(result, &reply) != nil || reply.IsError || json.Unmarshal(result, &merged) != nil {
		return result
	}
	select {
	case <-ctx.Done():
		return result
	case <-time.After(windowViewDelay):
	}
	read := func(args map[string]any) []json.RawMessage {
		args["pid"], args["window_id"], args["session"] = pid, window, arguments["session"]
		data, err := c.client.request(ctx, "tools/call", map[string]any{"name": "get_window_state", "arguments": args})
		if err == nil && args["include_accessibility_tree"] != false {
			c.op.reads.observe(data)
		}
		var view struct {
			IsError    bool              `json:"isError"`
			Content    []json.RawMessage `json:"content"`
			Structured struct {
				Degraded string `json:"degraded_reason"`
			} `json:"structuredContent"`
		}
		if err != nil || json.Unmarshal(data, &view) != nil || view.IsError || view.Structured.Degraded != "" {
			return nil
		}
		return view.Content
	}
	// A macOS action returns a complete tree. A delta can omit unchanged
	// buttons that the next decision still needs to address by name.
	var added []json.RawMessage
	if runtime.GOOS != "darwin" {
		added = read(map[string]any{"since": "latest", "include_screenshot": false})
	}
	if added == nil {
		// Cua 0.35.4 can reject its own delta tree; a full read is still text.
		added = read(map[string]any{"include_screenshot": false})
	}
	if added == nil && sleepContext(ctx, windowRetryDelay) == nil {
		// A window that has just opened can be unreadable for a moment.
		added = read(map[string]any{"include_screenshot": false})
	}
	if added == nil {
		for _, item := range read(map[string]any{"include_accessibility_tree": false, "display_only": true}) {
			var kind struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(item, &kind) == nil && kind.Type == "image" {
				added = append(added, item)
			}
		}
	}
	if added == nil {
		// The input ran; only the read failed, so its effect is not known.
		note, _ := json.Marshal(map[string]string{"type": "text", "text": "COMPUTER_VIEW_UNAVAILABLE: the window could not be read after this input, so its effect is not shown; read it with get_window_state before relying on the effect."})
		added = []json.RawMessage{note}
	}
	merged["content"], _ = json.Marshal(append(reply.Content, added...))
	combined, _ := json.Marshal(merged)
	return compactScreenshots(combined)
}

// foregroundInputTools send real HID events in foreground mode.
var foregroundInputTools = map[string]bool{"click": true, "double_click": true, "right_click": true, "drag": true, "scroll": true, "type_text": true, "press_key": true, "hotkey": true}

// modifiedClick sends a click with modifier keys, such as a cmd-click that
// adds a Finder row to the selection, as a foreground event: Cua holds a
// modifier only for those.
func modifiedClick(name string, arguments map[string]any) {
	modifiers, _ := arguments["modifier"].([]any)
	if runtime.GOOS == "darwin" && len(modifiers) > 0 && (name == "click" || name == "double_click" || name == "right_click") {
		arguments["delivery_mode"] = "foreground"
	}
}

// foregroundInput reports whether a call asks Cua for real HID events.
func foregroundInput(name string, arguments map[string]any) bool {
	return foregroundInputTools[name] && arguments["delivery_mode"] == "foreground"
}

// keyboardInput reports whether an input carries keys without an element or
// a screen point. On macOS such keys go to the focused field of the front
// app, as a person's keys do.
func keyboardInput(name string, arguments map[string]any) bool {
	_, token := arguments["element_token"]
	_, x := arguments["x"]
	return !token && !x && !located(name, arguments) && (name == "press_key" || name == "hotkey" || name == "type_text")
}

// located reports whether an input names its target by role and label
// instead of an element_token or a point. Only input tools take such a
// target; launch_app's name is an app name.
func located(name string, arguments map[string]any) bool {
	_, role := arguments["role"]
	_, label := arguments["name"]
	return inputTools[name] && (role || label)
}

// pasteboardScript keeps the pasteboard's items while text passes through
// it: "save" archives every item before it touches the pasteboard, puts the
// text there, marked transient for clipboard managers, and prints the change
// count and the archive; "restore <count>" puts the archive back unless the
// pasteboard changed since, so a file the Agent copied in Finder survives.
const pasteboardScript = `ObjC.import('AppKit');
function run(argv) {
	const pb = $.NSPasteboard.generalPasteboard;
	const input = $.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, $.NSUTF8StringEncoding);
	if (argv[0] === 'save') {
		const saved = $.NSMutableArray.array;
		const items = pb.pasteboardItems;
		for (let i = 0; i < items.count; i++) {
			const item = items.objectAtIndex(i);
			const kept = $.NSMutableDictionary.dictionary;
			for (let j = 0; j < item.types.count; j++) {
				const type = item.types.objectAtIndex(j);
				const data = item.dataForType(type);
				if (!data.isNil()) kept.setObjectForKey(data, type);
			}
			saved.addObject(kept);
		}
		const archived = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(saved, $.NSPropertyListBinaryFormat_v1_0, 0, null).base64EncodedStringWithOptions(0).js;
		pb.clearContents;
		pb.setStringForType(input, $.NSPasteboardTypeString);
		// Clipboard managers skip transient and concealed items.
		pb.setStringForType($(''), 'org.nspasteboard.TransientType');
		pb.setStringForType($(''), 'org.nspasteboard.ConcealedType');
		return pb.changeCount + '\n' + archived;
	}
	if (Number(pb.changeCount) !== Number(argv[1])) return 'changed';
	const data = $.NSData.alloc.initWithBase64EncodedStringOptions(input, 1);
	const saved = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, null);
	const items = $.NSMutableArray.array;
	for (let i = 0; i < saved.count; i++) {
		const kept = saved.objectAtIndex(i);
		const item = $.NSPasteboardItem.alloc.init;
		for (let j = 0; j < kept.allKeys.count; j++) {
			const type = kept.allKeys.objectAtIndex(j);
			item.setDataForType(kept.objectForKey(type), type);
		}
		items.addObject(item);
	}
	pb.clearContents;
	if (items.count > 0) pb.writeObjects(items);
	return 'restored';
}
`

// setClipboard puts text on the pasteboard and returns how to put the
// earlier items back. Saving and restoring run outside the call's context: a
// cancelled call must not leave the user's pasteboard half replaced.
var setClipboard = func(ctx context.Context, text string) (func(), error) {
	save, cancel := context.WithTimeout(context.WithoutCancel(ctx), pasteboardTimeout)
	defer cancel()
	command := exec.CommandContext(save, "/usr/bin/osascript", "-l", "JavaScript", "-e", pasteboardScript, "save")
	command.Stdin = strings.NewReader(text)
	output, err := command.Output()
	if err != nil {
		return nil, err
	}
	count, archive, _ := strings.Cut(strings.TrimSpace(string(output)), "\n")
	return func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), pasteboardTimeout)
		defer cancel()
		restore := exec.CommandContext(ctx, "/usr/bin/osascript", "-l", "JavaScript", "-e", pasteboardScript, "restore", count)
		restore.Stdin = strings.NewReader(archive)
		if err := restore.Run(); err != nil {
			slog.Warn("cua.pasteboard.restore_failed", "error", err)
		}
	}, nil
}

// pasteboardTimeout bounds one pasteboard save or restore.
const pasteboardTimeout = 5 * time.Second

// pasteSettle is how long an app gets to read the pasteboard after cmd+v
// before the earlier items go back.
var pasteSettle = 200 * time.Millisecond

// typedChunk is how many characters go to the front app between checks that
// the user has not brought another app forward.
const typedChunk = 16

// sendKeys sends macOS keys or text once the app is in front, checking the
// front app before each key and each chunk of text. Without a window the
// keys go to the front app's focused field through Cua's desktop session;
// with one, Cua delivers them to that exact window and refuses when it does
// not hold the focus.
func (c *cuaSession) sendKeys(ctx context.Context, name string, arguments map[string]any, pid int) (json.RawMessage, error) {
	keys := map[string]any{}
	for _, field := range []string{"key", "keys", "modifiers", "delay_ms"} {
		if value, ok := arguments[field]; ok {
			keys[field] = value
		}
	}
	if arguments["window_id"] == nil {
		keys["scope"], keys["session"] = "desktop", c.desktopLabel()
	} else {
		keys["pid"], keys["window_id"], keys["delivery_mode"], keys["session"] = arguments["pid"], arguments["window_id"], "foreground", c.label
	}
	text, _ := arguments["text"].(string)
	if name == "type_text" && arguments["window_id"] == nil {
		// Cua inserts text into the app's focused element through
		// accessibility: bound to the pid, atomic, and free of autocorrect.
		// It refuses before sending when it cannot tell which window has the
		// focus, as in Finder with several windows or an Open or Save panel;
		// the text is then typed to the front app.
		if front, err := c.checkFront(ctx, pid); err != nil || front != pid {
			if err == nil {
				err = fmt.Errorf("COMPUTER_INPUT_NOT_SENT: the app with pid %d is no longer in front: %w", pid, errNotSent)
			}
			return nil, err
		}
		result, err := c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": map[string]any{"pid": arguments["pid"], "text": text, "session": c.label}})
		if err != nil || !failed(result) || !axRefused(result) {
			return result, err
		}
		// Like Codex's paste, the text goes through the pasteboard in one
		// keystroke; typing it key by key takes seconds.
		if front, err := c.checkFront(ctx, pid); err != nil || front != pid {
			if err == nil {
				err = fmt.Errorf("COMPUTER_INPUT_NOT_SENT: the app with pid %d is no longer in front: %w", pid, errNotSent)
			}
			return nil, err
		}
		restore, err := setClipboard(ctx, text)
		if err != nil {
			return nil, fmt.Errorf("COMPUTER_INPUT_NOT_SENT: could not place the text on the pasteboard: %v: %w", err, errNotSent) //nolint:errorlint // the cause is detail; the call classifies as not sent only
		}
		// A cancelled request returns before the driver answers, and a cmd+v
		// it runs later would paste the restored pasteboard, so this one
		// request outlives a cancellation.
		paste, cancel := context.WithTimeout(context.WithoutCancel(ctx), pasteboardTimeout)
		result, err = c.client.request(paste, "tools/call", map[string]any{"name": "hotkey", "arguments": map[string]any{"keys": []string{"cmd", "v"}, "scope": "desktop", "session": c.desktopLabel()}})
		cancel()
		// Like Codex's paste, leave the pasteboard as it was, even when the
		// call is cancelled: the Agent or the user may paste it next.
		time.Sleep(pasteSettle)
		restore()
		if err != nil || failed(result) {
			return result, err
		}
		pasted, _ := json.Marshal(map[string]any{"content": []map[string]string{{"type": "text", "text": fmt.Sprintf("Pasted %d characters into the focused field of the front app.", len([]rune(text)))}}})
		return pasted, nil
	}
	runes := []rune(text)
	var result json.RawMessage
	for sent := 0; sent == 0 || sent < len(runes); {
		front, err := c.checkFront(ctx, pid)
		if err == nil && front != pid {
			err = fmt.Errorf("COMPUTER_INPUT_NOT_SENT: the app with pid %d is no longer in front: %w", pid, errNotSent)
		}
		if err != nil {
			if sent > 0 {
				return nil, fmt.Errorf("COMPUTER_INPUT_PARTIAL: typed the first %d of %d characters, then stopped: %v; read the field before typing the rest", sent, len(runes), err) //nolint:errorlint // a partial input must not inherit the cause's classification
			}
			return nil, err
		}
		end := len(runes)
		if name == "type_text" {
			end = min(sent+typedChunk, len(runes))
			keys["text"] = string(runes[sent:end])
		}
		if result, err = c.client.request(ctx, "tools/call", map[string]any{"name": name, "arguments": keys}); err != nil {
			if sent > 0 {
				err = fmt.Errorf("typed the first %d of %d characters before this failure: %w", sent, len(runes), err)
			}
			return nil, err
		}
		if failed(result) {
			if sent > 0 {
				return nil, fmt.Errorf("COMPUTER_INPUT_PARTIAL: typed the first %d of %d characters, then the driver refused the rest; read the field before typing the rest", sent, len(runes))
			}
			return result, nil
		}
		sent = max(end, 1)
	}
	return result, nil
}
