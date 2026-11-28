package localtools

import "encoding/json"

// macKeyDescriptions replace Cua's descriptions of the macOS key tools,
// whose background and restore-the-previous-app delivery the Computer does
// not use.
var macKeyDescriptions = map[string]string{
	"press_key": "Press and release one key, with optional modifiers. Keys: return, tab, escape, up, down, left, right, space, delete, home, end, pageup, pagedown, f1-f12, any letter or digit.",
	"hotkey":    "Press a key combination such as [\"cmd\", \"s\"]: modifiers (cmd, shift, option, ctrl, fn) first, one other key last.",
	"type_text": "Type text. It does not press Return, Escape or arrows; use press_key for those.",
}

// MacToolGuide describes macOS targeting and permission requirements to the Runtime.
const MacToolGuide = `Use computer.ui_exec for desktop and browser interaction. Within the script use ui.window for a specific macOS window, ui.page for the managed browser, and ui.computer for native methods. Window actions use the latest observation and return the updated window. Use the full app name and the requested window title to discover the target.
Search with ` + "`teamhub web search`" + `; never open a search engine's results page with ui.page. When ui.page meets a CAPTCHA, a block page or a sign-in wall, read the humanlike-browse skill and open that site's home page in the Computer's own browser window with ui.computer.launch_app({agent_browser:true, urls:[homeURL]}). When a site in that window asks for a CAPTCHA, verification or login, reports a rate limit, or makes the requested item unavailable, call ui.computer.report_blocker({kind,url}) and stop. Keep the task on that window; respect its input pacing and limits. The user's everyday Chrome accepts no synthetic keys. For Save or Open sheets, read the app's focused window and use max_depth: 3.
macOS permissions: ui.page and ui.browser need none, so a browser script error is a script bug, not a permission problem. ui.window and ui.computer need CuaDriver's Accessibility and Screen Recording; shell screenshots need Linger's Screen Recording. Before the first shell screenshot, or when one fails or comes back blank, run ` + "`teamhub computer permissions status`" + `; if Linger lacks screen_recording, run ` + "`teamhub computer permissions request --for shell --permissions screen_recording`" + ` and end the turn for the owner's permission card. When ui.window or ui.computer reports a missing permission, run the computer-use request command that status prints and end the turn. Never tell the user to open System Settings and never operate privacy prompts yourself.
To connect the user's everyday signed-in Chrome, or when a browser call returns BROWSER_CONNECTION_REQUIRED or BROWSER_CONNECTION_INVALID, run ` + "`teamhub browser connect`" + ` to post a browser connection card and end the turn to wait for the result; never ask for the extension token in a message or ask to relaunch Chrome with --remote-debugging-port.`

// macCompactTool is the macOS shape of one Cua tool: the fields the Computer
// routes, without Cua's delivery modes, scopes and capture ids.
type macCompactTool struct {
	description string
	properties  map[string]any
	required    []string
}

func (t macCompactTool) schema() json.RawMessage {
	encoded, _ := json.Marshal(schema(t.properties, t.required...))
	return encoded
}

var (
	macPID      = map[string]any{"type": "integer"}
	macWindowID = map[string]any{"type": "integer", "description": "Omit to use the app's focused window."}
	macToken    = map[string]any{"type": "string", "description": "\"<snapshot_id>:N\" from the latest read."}
	macPixel    = map[string]any{"type": "number", "description": "Pixels of the window's latest screenshot."}
	macString   = map[string]any{"type": "string"}
)

// macLocator names an input's target by role and label instead of a token:
// Cua finds it when the input runs, so it outlives later reads.
var (
	macRole  = map[string]any{"type": "string", "description": "Instead of element_token: the element's role from a read, such as AXButton; found when the input runs, and the window needs window_id."}
	macLabel = map[string]any{"type": "string", "description": "With role: the element's exact label or value as the read shows it."}
	macNth   = map[string]any{"type": "integer", "description": "With role and name: which of several equal elements, from 0."}
)

var macPointer = map[string]any{"pid": macPID, "window_id": macWindowID, "element_token": macToken, "x": macPixel, "y": macPixel, "role": macRole, "name": macLabel, "nth": macNth,
	"modifier":      map[string]any{"type": "array", "items": macString, "description": "Keys held during the click, such as [\"cmd\"] to add a Finder row to the selection; needs window_id."},
	"action":        map[string]any{"type": "string", "description": "An accessibility action other than press, from the element's actions in the read, such as show_alternate_ui to reveal hover-only controls."},
	"delivery_mode": map[string]any{"type": "string", "enum": []string{"background", "foreground"}, "description": "Default background. foreground sends a real pointer click at x,y: the Computer brings the window to the front first and the pointer moves. Use it only where a background click had no effect, such as a web page control that reacts only to a real pointer; needs window_id."}}

var macCompactTools = map[string]macCompactTool{
	"click":        {"Click an element by element_token from the latest get_window_state read, by role and name, or a point x,y of the window's latest screenshot." + macInputResult, macPointer, []string{"pid"}},
	"double_click": {"Double-click an element by element_token, by role and name, or a point x,y of the window's latest screenshot." + macInputResult, macPointer, []string{"pid"}},
	"right_click":  {"Right-click an element by element_token, by role and name, or a point x,y, to open its context menu; read the window to see the menu." + macInputResult, macPointer, []string{"pid"}},
	"hotkey":       {macKeyDescriptions["hotkey"] + macKeyRouting + macInputResult, map[string]any{"pid": macPID, "keys": map[string]any{"type": "array", "items": macString}, "window_id": macWindowID}, []string{"pid", "keys"}},
	"press_key":    {macKeyDescriptions["press_key"] + macKeyRouting + macInputResult, map[string]any{"pid": macPID, "key": macString, "modifiers": map[string]any{"type": "array", "items": macString}, "window_id": macWindowID, "element_token": macToken}, []string{"pid", "key"}},
	"type_text":    {macKeyDescriptions["type_text"] + macKeyRouting + macInputResult, map[string]any{"pid": macPID, "text": macString, "window_id": macWindowID, "element_token": macToken, "role": macRole, "name": macLabel, "nth": macNth}, []string{"pid", "text"}},
	"scroll":       {"Scroll a window, or the element element_token, by amount lines in direction." + macInputResult, map[string]any{"pid": macPID, "window_id": macWindowID, "element_token": macToken, "role": macRole, "name": macLabel, "nth": macNth, "direction": map[string]any{"type": "string", "enum": []string{"up", "down", "left", "right"}}, "amount": map[string]any{"type": "integer"}}, []string{"pid", "direction"}},
	"get_window_state": {macWindowStateDescription, map[string]any{
		"pid": macPID, "window_id": macWindowID, "since": map[string]any{"type": "string", "description": "\"latest\" returns only what changed since your last read of this window."},
		"query": macString, "max_depth": map[string]any{"type": "integer"}, "max_elements": map[string]any{"type": "integer"},
		"timeout_ms": map[string]any{"type": "integer"}, "include_screenshot": map[string]any{"type": "boolean"},
	}, []string{"pid"}},
}

// macWindowStateDescription replaces Cua's, whose reads include a screenshot
// by default; on macOS the Computer reads text unless pixels are asked for.
const macWindowStateDescription = "Read a window as text: its accessibility tree as Markdown rows. Row [N] is addressed by element_token \"<snapshot_id>:N\", with snapshot_id from the response header. A read walks at most 500 nodes; narrow it with query (a case-insensitive substring) or raise max_elements. since:\"latest\" returns only what changed since your last read of this window, with a new snapshot_id. Without window_id, reads the app's focused window, including a sheet or panel that an input just opened. A Save or Open sheet shows its controls with max_depth:3; a deeper read also walks its file list and can run out of time. Each read replaces the window's snapshot and stales the old tokens. No screenshot is included; pass include_screenshot:true to see pixels, for example when the tree does not show what you need. A window without a readable tree is returned as a screenshot."

// macKeyRouting describes how the Computer delivers macOS keys.
const macKeyRouting = " The input goes to the focused field of the app with this pid, as a person's keys do: a sheet, panel or rename field that has focus receives it. Pass only pid to follow the app's focus; also pass window_id to require that this window holds the focus. The Computer first brings the app to the front and leaves it there; if the user has since brought another app forward, nothing is sent."

// macInputResult describes the readback for explicitly targeted input.
const macInputResult = " With pid and window_id, the result includes the changed window state and fresh element tokens. Without a window_id, read the focused window when you need the effect."

const maxBatchActions = 20

func schema(properties map[string]any, required ...string) json.RawMessage {
	if properties == nil {
		properties = map[string]any{}
	}
	value := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		value["required"] = required
	}
	data, _ := json.Marshal(value)
	return data
}
