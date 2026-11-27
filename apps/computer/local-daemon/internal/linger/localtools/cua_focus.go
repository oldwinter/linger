package localtools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"time"
)

// locatorTools take a role and label target on macOS.
var locatorTools = map[string]bool{"click": true, "double_click": true, "right_click": true, "scroll": true, "type_text": true}

// locate replaces an input's role and label target with the token of the one
// element that has exactly that role and label, or value, in a fresh read of
// its window, so the target stays valid across the Agent's reads. A label
// that matches only part of another element's never counts: a vanished
// Delete must not become Delete all. Several matches need nth.
func (c *cuaSession) locate(ctx context.Context, name string, arguments map[string]any) error {
	if !locatorTools[name] {
		return fmt.Errorf("COMPUTER_TARGET_REQUIRED: %s takes no role and name target: %w", name, errNotSent)
	}
	if _, token := arguments["element_token"]; token {
		return fmt.Errorf("COMPUTER_TARGET_REQUIRED: name the target by element_token or by role and name, not both: %w", errNotSent)
	}
	role, _ := arguments["role"].(string)
	label, _ := arguments["name"].(string)
	// A name of only white space would match every element without a label.
	label = sameSpaces(label)
	if role == "" || label == "" || arguments["pid"] == nil || arguments["window_id"] == nil {
		return fmt.Errorf("COMPUTER_TARGET_REQUIRED: a role and name target needs pid, window_id, role and name: %w", errNotSent)
	}
	read, err := c.client.request(ctx, "tools/call", map[string]any{"name": "get_window_state", "arguments": map[string]any{
		"pid": arguments["pid"], "window_id": arguments["window_id"], "tree_format": "elements", "include_screenshot": false,
		"max_elements": 6000, "timeout_ms": float64(windowReadTimeoutMs), "session": arguments["session"]}})
	if err != nil {
		return err
	}
	var state struct {
		Structured struct {
			// elements_complete is false for every browser window, whose
			// toolbar Cua cannot prove whole, so only these two count.
			Truncated bool `json:"truncated"`
			Returned  *int `json:"returned_element_count"`
			Total     *int `json:"total_element_count"`
			Elements  []struct {
				Token string `json:"element_token"`
				Role  string `json:"role"`
				Label string `json:"label"`
				Value any    `json:"value"`
			} `json:"elements"`
		} `json:"structuredContent"`
	}
	_ = json.Unmarshal(read, &state)
	if state.Structured.Truncated || state.Structured.Returned != nil && state.Structured.Total != nil && *state.Structured.Returned < *state.Structured.Total {
		// An element left out of the read could be a second match.
		return fmt.Errorf("COMPUTER_TARGET_UNREADABLE: window %v was read only in part, so a %s labeled %q cannot be proven to be the only one; use an element_token from a read: %w", arguments["window_id"], role, label, errNotSent)
	}
	var matches []string
	for _, element := range state.Structured.Elements {
		value, _ := element.Value.(string)
		if element.Role == role && (sameSpaces(element.Label) == label || sameSpaces(value) == label) {
			matches = append(matches, element.Token)
		}
	}
	nth, hasNth := arguments["nth"].(float64)
	switch {
	case len(matches) == 0:
		return fmt.Errorf("COMPUTER_TARGET_NOT_FOUND: window %v shows no %s with exactly the label %q: %w", arguments["window_id"], role, label, errNotSent)
	case !hasNth && len(matches) > 1:
		return fmt.Errorf("COMPUTER_TARGET_AMBIGUOUS: window %v shows %d %s elements labeled %q; pass nth, from 0, or an element_token: %w", arguments["window_id"], len(matches), role, label, errNotSent)
	case hasNth && (nth < 0 || int(nth) >= len(matches)):
		return fmt.Errorf("COMPUTER_TARGET_NOT_FOUND: window %v shows %d %s elements labeled %q, so nth %v is out of range: %w", arguments["window_id"], len(matches), role, label, nth, errNotSent)
	}
	arguments["element_token"] = matches[int(nth)]
	delete(arguments, "role")
	delete(arguments, "name")
	delete(arguments, "nth")
	return nil
}

// sameSpaces writes every run of white space as one space: a page label may
// hold a no-break space, which reads the same as the space the Agent writes.
func sameSpaces(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

// listedWindow is one window from Cua list_windows.
type listedWindow struct {
	WindowID   float64 `json:"window_id"`
	Title      string  `json:"title"`
	AppName    string  `json:"app_name"`
	Layer      int     `json:"layer"`
	ZIndex     int     `json:"z_index"`
	IsOnScreen bool    `json:"is_on_screen"`
	// OnCurrentSpace is false for a window on another Space than the one
	// the user is on; Cua leaves it out when it cannot tell.
	OnCurrentSpace *bool `json:"on_current_space"`
	Bounds         struct {
		Width  float64 `json:"width"`
		Height float64 `json:"height"`
	} `json:"bounds"`
}

// frontmostPID returns the pid of the macOS front application.
var frontmostPID = func(ctx context.Context) (int, error) {
	front, err := exec.CommandContext(ctx, "/usr/bin/lsappinfo", "front").Output()
	if err != nil {
		return 0, err
	}
	return lsappPID(ctx, strings.TrimSpace(string(front)))
}

// lsappPID returns the pid of a running application, named by bundle id,
// name or Launch Services ASN.
func lsappPID(ctx context.Context, app string) (int, error) {
	info, err := exec.CommandContext(ctx, "/usr/bin/lsappinfo", "info", "-only", "pid", app).Output()
	if err != nil {
		return 0, err
	}
	_, value, _ := strings.Cut(strings.TrimSpace(string(info)), "=")
	pid, err := strconv.Atoi(strings.TrimSpace(value))
	if err == nil && pid > 0 {
		return pid, nil
	}
	// lsappinfo resolves a bundle id or name only while one instance runs.
	// With a second instance, such as a test Chrome with its own profile,
	// the first registered one is the instance Launch Services opens URLs in.
	for _, key := range []string{"bundleid", "name"} {
		found, findErr := exec.CommandContext(ctx, "/usr/bin/lsappinfo", "find", key+"="+app).Output()
		asn, _, _ := strings.Cut(strings.TrimSpace(string(found)), " ")
		if findErr != nil || !strings.HasPrefix(asn, "ASN:") {
			continue
		}
		return lsappPID(ctx, strings.TrimSuffix(asn, ":"))
	}
	if list, listErr := exec.CommandContext(ctx, "/usr/bin/lsappinfo", "list").Output(); listErr == nil {
		if pid := lsappListPID(string(list), app); pid > 0 {
			return pid, nil
		}
	}
	return 0, fmt.Errorf("%s is not running", app)
}

// topWindow returns the app's key window: the recorded key window, or a
// window opened in front of it since; without a record, the front window by
// z_index. It returns nil when the app shows no window.
func (c *cuaSession) topWindow(ctx context.Context, pid any) (*listedWindow, error) {
	_, top, err := c.focusedWindow(ctx, pid)
	return top, err
}

// focusedWindow is topWindow that also returns the app's windows.
func (c *cuaSession) focusedWindow(ctx context.Context, pid any) ([]listedWindow, *listedWindow, error) {
	windows, err := c.appWindows(ctx, pid)
	if err != nil || len(windows) == 0 {
		return nil, nil, err
	}
	number, _ := pid.(float64)
	c.mu.Lock()
	record, ok := c.focus[int(number)]
	c.mu.Unlock()
	if !ok {
		return windows, &windows[0], nil
	}
	// A recorded window that closed or was minimized no longer holds the keys.
	index := slices.IndexFunc(windows, func(item listedWindow) bool { return item.WindowID == record.window && item.IsOnScreen })
	if index < 0 {
		return windows, &windows[0], nil
	}
	key, base, opened := &windows[index], windows[index].ZIndex, false
	for i := range windows {
		// An off-screen helper window, such as a Save panel's accessory
		// view, never holds the keys. A titled window opened since the
		// record wins even below it: Cua ranks a new TextEdit document under
		// the documents TextEdit restored. An untitled one, such as a sheet,
		// must rank above it, since Finder shows short-lived untitled windows.
		w := windows[i]
		if w.IsOnScreen && !record.known[w.WindowID] && (w.ZIndex > base || w.Title != "") && (!opened || w.ZIndex > key.ZIndex) {
			key, opened = &windows[i], true
		}
	}
	return windows, key, nil
}

// remember records window as the key window of the front app pid.
func (c *cuaSession) remember(ctx context.Context, pid int, window float64) {
	windows, err := c.appWindows(ctx, float64(pid))
	if err != nil {
		return
	}
	c.record(pid, window, windows)
}

// record sets window as the key window of app pid, with windows as the
// windows the app showed then.
func (c *cuaSession) record(pid int, window float64, windows []listedWindow) {
	known := map[float64]bool{}
	for _, item := range windows {
		known[item.WindowID] = true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.focus == nil {
		c.focus = map[int]focusRecord{}
	}
	c.focus[pid] = focusRecord{window: window, known: known}
}

// errNotSent marks an input the Computer refused before any of it reached
// the driver, so resending it after a fix cannot repeat an effect.
var errNotSent = errors.New("nothing was sent")

// focusApp puts the app of a macOS key or foreground input in front and
// leaves it there, so the input reaches the app's focused field.
//
// It brings an app forward only on the Operation's first input or from the
// Computer's own previous app: when the user has brought another app to the
// front since, the user has taken over and nothing is sent. It never fronts
// a window of an app that is already in front, which would end a rename
// field or close a menu, and never redirects input to another window.
func (c *cuaSession) focusApp(ctx context.Context, name string, arguments map[string]any) error {
	pid, window := arguments["pid"], arguments["window_id"]
	number, ok := pid.(float64)
	if !ok {
		return fmt.Errorf("COMPUTER_TARGET_REQUIRED: keys and foreground input need the pid of the app: %w", errNotSent)
	}
	if _, ok := window.(float64); window != nil && !ok {
		return fmt.Errorf("COMPUTER_TARGET_REQUIRED: window_id must be a number: %w", errNotSent)
	}
	if window == nil && !keyboardInput(name, arguments) {
		return fmt.Errorf("COMPUTER_TARGET_REQUIRED: foreground input at an element or point needs pid and window_id: %w", errNotSent)
	}
	// A modal dialog is in front of the app's ordinary windows without being
	// one of them, so the front-window check and bring_to_front do not know it.
	panel := window != nil && isModalPanel(ctx, pid, window)
	var fronted any
	for attempt := range 4 {
		front, err := c.checkFront(ctx, int(number))
		if err != nil {
			return err
		}
		if front == int(number) && fronted != nil {
			c.remember(ctx, front, fronted.(float64))
		}
		top, err := c.topWindow(ctx, pid)
		if err != nil {
			return err
		}
		if front == int(number) {
			if top != nil {
				c.mu.Lock()
				_, recorded := c.focus[front]
				c.mu.Unlock()
				if !recorded {
					c.remember(ctx, front, top.WindowID)
				}
			}
			if window != nil && !panel && (top == nil || top.WindowID != window) {
				above := "no window of this app is shown"
				if top != nil {
					above = fmt.Sprintf("window %v %q of this app is in front of it and would receive the input", top.WindowID, top.Title)
				}
				return fmt.Errorf("COMPUTER_INPUT_NOT_SENT: window %v is not the app's front window; %s: %w. To type into the app's focused field, pass only pid. To use window %v, call bring_to_front with it first", window, above, errNotSent, window)
			}
			c.mu.Lock()
			c.leased = front
			c.mu.Unlock()
			return nil
		}
		if attempt == 3 {
			return fmt.Errorf("COMPUTER_INPUT_NOT_SENT: the app with pid %v did not come to the front; the front app has pid %d: %w", pid, front, errNotSent)
		}
		if attempt > 0 {
			// macOS can refuse the first activation of a window that has just opened.
			if err := sleepContext(ctx, 300*time.Millisecond); err != nil {
				return err
			}
		}
		// A window the Agent named, or else the app's key window, comes
		// forward with the app.
		fronted = window
		if panel {
			fronted = nil
		} else if fronted == nil {
			c.mu.Lock()
			named, ok := c.named[int(number)]
			c.mu.Unlock()
			if ok && c.shows(ctx, pid, named) {
				fronted = named
			} else if top != nil {
				fronted = top.WindowID
			}
		}
		arguments := map[string]any{"pid": pid, "session": c.label}
		if fronted != nil {
			arguments["window_id"] = fronted
		}
		// Cua reports an activation it could not fully verify as an error,
		// although the app may have come to the front; the next pass checks.
		if _, err := c.client.request(ctx, "tools/call", map[string]any{"name": "bring_to_front", "arguments": arguments}); err != nil {
			return err
		}
	}
	return nil
}

// shows reports whether the app still shows window.
func (c *cuaSession) shows(ctx context.Context, pid any, window float64) bool {
	windows, err := c.appWindows(ctx, pid)
	return err == nil && slices.ContainsFunc(windows, func(item listedWindow) bool { return item.WindowID == window })
}

// checkFront returns the front app's pid, or refuses when the user has
// brought an app forward that is neither the target nor the Computer's own.
func (c *cuaSession) checkFront(ctx context.Context, target int) (int, error) {
	front, err := frontmostPID(ctx)
	if err != nil {
		return 0, err
	}
	c.mu.Lock()
	leased := c.leased
	c.mu.Unlock()
	if front != target && leased != 0 && front != leased {
		return 0, fmt.Errorf("COMPUTER_USER_TOOK_OVER: the user brought the app with pid %d to the front, so the Computer does not take the screen back by itself: %w. Ask the user, or call bring_to_front to continue", front, errNotSent)
	}
	return front, nil
}

// appWindows lists an app's ordinary windows, front first.
func (c *cuaSession) appWindows(ctx context.Context, pid any) ([]listedWindow, error) {
	result, err := c.client.request(ctx, "tools/call", map[string]any{"name": "list_windows", "arguments": map[string]any{"pid": pid, "session": c.label}})
	if err != nil {
		return nil, err
	}
	var listed struct {
		Structured struct {
			Windows []listedWindow `json:"windows"`
		} `json:"structuredContent"`
	}
	_ = json.Unmarshal(result, &listed)
	windows := slices.DeleteFunc(listed.Structured.Windows, func(item listedWindow) bool { return item.Layer != 0 })
	// A minimized window or one on another Space does not hold the keys.
	slices.SortStableFunc(windows, func(a, b listedWindow) int {
		if a.IsOnScreen != b.IsOnScreen {
			return map[bool]int{true: -1, false: 1}[a.IsOnScreen]
		}
		return b.ZIndex - a.ZIndex
	})
	return windows, nil
}
