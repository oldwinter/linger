package localtools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"slices"
	"strings"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/permission"
)

// launchAppWait bounds how long a launched app may take to show a window.
var launchAppWait = 5 * time.Second

// reviewScope is the scope a reviewed Run's Skill script reviews belong to,
// or empty when the Run's calls are not reviewed. It uses the executor's own
// test, so it names the Reviewer's ScriptScope exactly when one exists.
func (c *cuaSession) reviewScope() string {
	if !c.op.spec.ReviewsPermissions() {
		return ""
	}
	return permission.ScriptScope(c.op.spec.AgentID, c.op.spec.ScopeID)
}

// launchApp opens a macOS app through Launch Services in the background, as
// `open -g` does, and returns its pid and windows. Cua launch_app keeps the
// app it starts from coming to the front, so later keys could not reach it.

func (c *cuaSession) launchApp(ctx context.Context, arguments map[string]any) (json.RawMessage, error) {
	bundle, _ := arguments["bundle_id"].(string)
	name, _ := arguments["name"].(string)
	urls, _ := arguments["urls"].([]any)
	var addresses []string
	for _, item := range urls {
		url, ok := item.(string)
		if !ok || url == "" || strings.HasPrefix(url, "-") {
			return nil, errors.New("launch_app urls must be paths or URLs")
		}
		addresses = append(addresses, url)
	}
	if own, _ := arguments["agent_browser"].(bool); own {
		b, err := pickAgentBrowser(bundle)
		if err != nil {
			return nil, err
		}
		return c.launchAgentChrome(ctx, b, addresses)
	}
	app, flag := bundle, "-b"
	if app == "" {
		app, flag = name, "-a"
	}
	if app == "" {
		return nil, errors.New("launch_app needs bundle_id or name")
	}
	open := append([]string{"-g", flag, app}, addresses...)
	if err := c.op.refuseOtherBrowserOnChromeSite(addresses); err != nil {
		return nil, err
	}
	// Launch Services may hand a URL to the Computer's own browser when it is
	// the instance it knows, so opening that browser app takes its lease.
	if agentBrowserApp(bundle, name) {
		own, err := c.agentChromeRunning(ctx)
		if err != nil {
			return nil, err
		}
		if own > 0 {
			if err := c.claimAgentChrome(); err != nil {
				return nil, err
			}
		}
	}
	before := map[float64]bool{}
	running := false
	if pid, err := lsappPID(ctx, app); err == nil {
		running = true
		windows, err := c.appWindows(ctx, pid)
		if err != nil {
			return nil, err
		}
		for _, item := range windows {
			before[item.WindowID] = true
		}
	}
	if output, err := exec.CommandContext(ctx, "/usr/bin/open", open...).CombinedOutput(); err != nil {
		// open -a knows an app by its file name only. A name the bundle
		// declares, such as "Bambu Studio" for BambuStudio.app, opens by path.
		path := ""
		if flag == "-a" && ctx.Err() == nil {
			path = appPathByName(ctx, app)
		}
		if path == "" {
			return nil, fmt.Errorf("launch_app: %s: %w", strings.TrimSpace(string(output)), err)
		}
		if output, err := exec.CommandContext(ctx, "/usr/bin/open", append([]string{"-g", "-a", path}, addresses...)...).CombinedOutput(); err != nil {
			return nil, fmt.Errorf("launch_app: %s: %w", strings.TrimSpace(string(output)), err)
		}
		// lsappinfo may not know the name as given, such as one in another
		// case, so the running app is found by the path that opened it.
		app = path
	}
	deadline := time.Now().Add(launchAppWait)
	if running && len(urls) > 0 {
		// A running app opens the URLs in a window it already shows, such as
		// a new tab in Chrome, so no new window will appear to wait for.
		if err := sleepContext(ctx, inputSettle); err != nil {
			return nil, err
		}
	}
	for {
		pid, pidErr := lsappPID(ctx, app)
		var windows []listedWindow
		if pidErr == nil {
			var err error
			if windows, err = c.appWindows(ctx, pid); err != nil {
				return nil, err
			}
		}
		opened := slices.ContainsFunc(windows, func(item listedWindow) bool { return !before[item.WindowID] })
		if pidErr == nil && (opened || (len(urls) == 0 || running) && len(windows) > 0) || time.Now().After(deadline) {
			if pidErr != nil {
				return nil, fmt.Errorf("launch_app: %s did not start", app)
			}
			text := fmt.Sprintf("Opened %s (pid %d) in the background.", app, pid)
			listed := []map[string]any{}
			for _, item := range windows {
				text += fmt.Sprintf("\n- %q [window_id: %v]", item.Title, item.WindowID)
				if !before[item.WindowID] {
					text += " new"
				}
				if !item.IsOnScreen {
					text += " not on this screen"
				}
				listed = append(listed, map[string]any{"window_id": item.WindowID, "title": item.Title, "new": !before[item.WindowID], "on_screen": item.IsOnScreen})
			}
			note := "Keys and text with only this pid go to the app's focused field; the Computer brings the app to the front first."
			if running && len(urls) > 0 {
				note = "The app was running, so it opened the URLs in its front window, the first one listed. " + note
			}
			text += "\n" + note
			return json.Marshal(map[string]any{"content": []any{map[string]string{"type": "text", "text": text}}, "structuredContent": map[string]any{"pid": pid, "windows": listed, "note": note}})
		}
		if err := sleepContext(ctx, 150*time.Millisecond); err != nil {
			return nil, err
		}
	}
}
