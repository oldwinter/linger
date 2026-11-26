// Package herdr implements the Mobile Companion HTTP and streaming WebSocket
// client for herdr-core (hc) endpoints exposed via TeamHub and Desktop LAN
// Companion Gateway.
package herdr

import (
	"bytes"
	"encoding/json"
	"strings"
)

// OSCStatus represents structured OSC 7501 agent status reported by herdr-core.
// It unmarshals cleanly from either a JSON object ({state, msg, app, ...}) or a
// plain JSON status string ("blocked", "working", "idle", etc.).
type OSCStatus struct {
	State    string `json:"state,omitempty"`
	Msg      string `json:"msg,omitempty"`
	App      string `json:"app,omitempty"`
	Detail   string `json:"detail,omitempty"`
	Progress *int   `json:"progress,omitempty"`
}

// UnmarshalJSON accepts either an OSCStatus object or a bare status string.
func (s *OSCStatus) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*s = OSCStatus{}
		return nil
	}
	if trimmed[0] == '"' {
		var raw string
		if err := json.Unmarshal(trimmed, &raw); err != nil {
			return err
		}
		*s = OSCStatus{State: strings.TrimSpace(raw)}
		return nil
	}
	type oscAlias OSCStatus
	var decoded oscAlias
	if err := json.Unmarshal(trimmed, &decoded); err != nil {
		return err
	}
	*s = OSCStatus(decoded)
	return nil
}

// ForegroundProcess describes the currently running foreground process in a terminal.
type ForegroundProcess struct {
	PID  int      `json:"pid,omitempty"`
	Name string   `json:"name,omitempty"`
	Argv []string `json:"argv,omitempty"`
	Cwd  string   `json:"cwd,omitempty"`
}

// Terminal represents a live or finished herdr-core terminal (local or remote SSH).
type Terminal struct {
	Address       string             `json:"address"`
	Name          string             `json:"name,omitempty"`
	Machine       string             `json:"machine,omitempty"`
	Agent         string             `json:"agent,omitempty"`
	Template      string             `json:"template,omitempty"`
	Title         string             `json:"title,omitempty"`
	Where         string             `json:"where,omitempty"`
	Cwd           string             `json:"cwd,omitempty"`
	State         string             `json:"state"`
	Status        *OSCStatus         `json:"status,omitempty"`
	OSCStatus     *OSCStatus         `json:"osc_status,omitempty"`
	StatusMs      int64              `json:"status_ms,omitempty"`
	Turn          int                `json:"turn,omitempty"`
	PID           int                `json:"pid,omitempty"`
	Cols          int                `json:"cols,omitempty"`
	Rows          int                `json:"rows,omitempty"`
	Keep          bool               `json:"keep,omitempty"`
	Rm            bool               `json:"rm,omitempty"`
	Notify        bool               `json:"notify,omitempty"`
	DieWithParent bool               `json:"die_with_parent,omitempty"`
	Parent        string             `json:"parent,omitempty"`
	Argv          []string           `json:"argv,omitempty"`
	Labels        map[string]string  `json:"labels,omitempty"`
	Foreground    *ForegroundProcess `json:"foreground,omitempty"`
	ExitCode      *int               `json:"exit_code,omitempty"`
	Signal        string             `json:"signal,omitempty"`
	Reason        string             `json:"reason,omitempty"`
	CreatedMs     int64              `json:"created_ms,omitempty"`
	FinishedMs    *int64             `json:"finished_ms,omitempty"`
}

// EffectiveStatus returns the merged OSC 7501 status for the terminal, falling back
// to terminal lifecycle state ("done", "error", "idle") when OSC status is absent.
func (t Terminal) EffectiveStatus() OSCStatus {
	var out OSCStatus
	if t.Status != nil {
		out = *t.Status
	}
	if t.OSCStatus != nil {
		if out.State == "" {
			out.State = t.OSCStatus.State
		}
		if out.Msg == "" {
			out.Msg = t.OSCStatus.Msg
		}
		if out.App == "" {
			out.App = t.OSCStatus.App
		}
		if out.Detail == "" {
			out.Detail = t.OSCStatus.Detail
		}
		if out.Progress == nil {
			out.Progress = t.OSCStatus.Progress
		}
	}
	out.State = strings.ToLower(strings.TrimSpace(out.State))
	if out.State == "" {
		switch strings.ToLower(strings.TrimSpace(t.State)) {
		case "finished", "exited", "stopped":
			if (t.ExitCode != nil && *t.ExitCode != 0) || strings.TrimSpace(t.Signal) != "" {
				out.State = "error"
			} else {
				out.State = "done"
			}
		default:
			out.State = "idle"
		}
	}
	return out
}

// IsBlocked reports whether the terminal is waiting for human input or approval.
func (t Terminal) IsBlocked() bool {
	return t.EffectiveStatus().State == "blocked"
}

// IsWorking reports whether the terminal is actively executing work.
func (t Terminal) IsWorking() bool {
	st := t.EffectiveStatus().State
	return st == "working" || st == "running" || st == "busy"
}

// IsFinished reports whether the terminal program has ended.
func (t Terminal) IsFinished() bool {
	switch strings.ToLower(strings.TrimSpace(t.State)) {
	case "finished", "exited", "stopped":
		return true
	}
	st := t.EffectiveStatus().State
	return st == "done" || st == "error" || st == "failed"
}

// EffectiveMachine returns the remote machine name ("vps" for "vps/t7"),
// or an empty string for local terminals.
func (t Terminal) EffectiveMachine() string {
	m := strings.TrimSpace(t.Machine)
	if m != "" && !strings.EqualFold(m, "local") {
		return m
	}
	if idx := strings.IndexByte(t.Address, '/'); idx > 0 {
		return strings.TrimSpace(t.Address[:idx])
	}
	return ""
}

// DisplayName returns the terminal's human-friendly name or its address.
func (t Terminal) DisplayName() string {
	if strings.TrimSpace(t.Name) != "" {
		return strings.TrimSpace(t.Name)
	}
	return strings.TrimSpace(t.Address)
}

// EffectiveApp returns the best-known program or coding agent running inside the terminal.
func (t Terminal) EffectiveApp() string {
	st := t.EffectiveStatus()
	if strings.TrimSpace(st.App) != "" {
		return strings.TrimSpace(st.App)
	}
	if strings.TrimSpace(t.Agent) != "" {
		return strings.TrimSpace(t.Agent)
	}
	if t.Foreground != nil && strings.TrimSpace(t.Foreground.Name) != "" {
		return strings.TrimSpace(t.Foreground.Name)
	}
	if strings.TrimSpace(t.Template) != "" {
		return strings.TrimSpace(t.Template)
	}
	if len(t.Argv) > 0 && strings.TrimSpace(t.Argv[0]) != "" {
		return strings.TrimSpace(t.Argv[0])
	}
	return "shell"
}

// EffectiveCwd returns the active foreground working directory or initial cwd.
func (t Terminal) EffectiveCwd() string {
	if t.Foreground != nil && strings.TrimSpace(t.Foreground.Cwd) != "" {
		return strings.TrimSpace(t.Foreground.Cwd)
	}
	return strings.TrimSpace(t.Cwd)
}

// RoomLabel returns the linked Linger Room label (linger.room or linger.room_id), if present.
func (t Terminal) RoomLabel() string {
	if len(t.Labels) == 0 {
		return ""
	}
	if v := strings.TrimSpace(t.Labels["linger.room"]); v != "" {
		return v
	}
	return strings.TrimSpace(t.Labels["linger.room_id"])
}

// WorkItemLabel returns the linked Linger Work Item label (linger.work_item or linger.work_item_id), if present.
func (t Terminal) WorkItemLabel() string {
	if len(t.Labels) == 0 {
		return ""
	}
	if v := strings.TrimSpace(t.Labels["linger.work_item"]); v != "" {
		return v
	}
	return strings.TrimSpace(t.Labels["linger.work_item_id"])
}

// MachineView describes a local or SSH-connected remote machine managed by herdr-core.
type MachineView struct {
	Name                    string `json:"name"`
	ID                      string `json:"id,omitempty"`
	Host                    string `json:"host,omitempty"`
	Target                  string `json:"target,omitempty"`
	State                   string `json:"state"`
	Version                 string `json:"version,omitempty"`
	Via                     bool   `json:"via,omitempty"`
	Temporary               bool   `json:"temporary,omitempty"`
	KeepsRunningAfterLogout *bool  `json:"keeps_running_after_logout,omitempty"`
	Error                   string `json:"error,omitempty"`
	LiveCount               int    `json:"live_count,omitempty"`
	BlockedCount            int    `json:"blocked_count,omitempty"`
}

// TemplateInfo describes a reusable herdr-core launch template (~/.config/herdr-core/templates).
type TemplateInfo struct {
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Command     string            `json:"command,omitempty"`
	Argv        []string          `json:"argv,omitempty"`
	Line        string            `json:"line,omitempty"`
	Agent       string            `json:"agent,omitempty"`
	Cwd         string            `json:"cwd,omitempty"`
	Keep        bool              `json:"keep,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
}

// CoreStatus is returned by GET /api/v1/computers/{computerId}/herdr-core/status.
type CoreStatus struct {
	Available     bool          `json:"available"`
	Version       string        `json:"version,omitempty"`
	CoreID        string        `json:"core_id,omitempty"`
	CoreName      string        `json:"core_name,omitempty"`
	PID           int           `json:"pid,omitempty"`
	UptimeMs      int64         `json:"uptime_ms,omitempty"`
	LiveCount     int           `json:"live_count"`
	FinishedCount int           `json:"finished_count"`
	BlockedCount  int           `json:"blocked_count"`
	WorkingCount  int           `json:"working_count"`
	Machines      []MachineView `json:"machines,omitempty"`
	Reason        string        `json:"reason,omitempty"`
}

// ListTerminalsOptions filters GET /api/v1/computers/{computerId}/herdr-core/terminals.
type ListTerminalsOptions struct {
	All        bool
	Machine    string
	RoomID     string
	WorkItemID string
	Status     string
}

// ListTerminalsResult is returned by GET /api/v1/computers/{computerId}/herdr-core/terminals.
type ListTerminalsResult struct {
	Terminals []Terminal    `json:"terminals"`
	Machines  []MachineView `json:"machines,omitempty"`
}

// ReadResult is returned by GET /api/v1/computers/{computerId}/herdr-core/terminal/read.
type ReadResult struct {
	Text     string `json:"text"`
	Complete bool   `json:"complete"`
	How      string `json:"how,omitempty"`
	Why      string `json:"why,omitempty"`
}

// LaunchRequest is sent to POST /api/v1/computers/{computerId}/herdr-core/terminals.
type LaunchRequest struct {
	Argv     []string          `json:"argv,omitempty"`
	Line     string            `json:"line,omitempty"`
	Template string            `json:"template,omitempty"`
	Task     string            `json:"task,omitempty"`
	Name     string            `json:"name,omitempty"`
	Cwd      string            `json:"cwd,omitempty"`
	On       string            `json:"on,omitempty"`
	Keep     bool              `json:"keep,omitempty"`
	Labels   map[string]string `json:"labels,omitempty"`
	Parent   string            `json:"parent,omitempty"`
	Rm       bool              `json:"rm,omitempty"`
	NoNotify bool              `json:"no_notify,omitempty"`
}

// SendRequest is sent to POST /api/v1/computers/{computerId}/herdr-core/terminal/send.
type SendRequest struct {
	Address string `json:"address"`
	Text    string `json:"text"`
	If      string `json:"if,omitempty"`
	Force   bool   `json:"force,omitempty"`
	Wait    bool   `json:"wait,omitempty"`
	Timeout int    `json:"timeout,omitempty"`
}

// SendResult is returned by POST /api/v1/computers/{computerId}/herdr-core/terminal/send.
type SendResult struct {
	OK       bool   `json:"ok"`
	Sent     bool   `json:"sent,omitempty"`
	Address  string `json:"address,omitempty"`
	Status   string `json:"status,omitempty"`
	Turn     int    `json:"turn,omitempty"`
	Waited   bool   `json:"waited,omitempty"`
	TimedOut bool   `json:"timed_out,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

// KeysRequest is sent to POST /api/v1/computers/{computerId}/herdr-core/terminal/keys.
type KeysRequest struct {
	Address string   `json:"address"`
	Keys    []string `json:"keys"`
}

// KeysResult is returned by POST /api/v1/computers/{computerId}/herdr-core/terminal/keys.
type KeysResult struct {
	OK      bool     `json:"ok"`
	Address string   `json:"address,omitempty"`
	Keys    []string `json:"keys,omitempty"`
}

// InterruptRequest is sent to POST /api/v1/computers/{computerId}/herdr-core/terminal/interrupt.
type InterruptRequest struct {
	Address string `json:"address"`
	Timeout int    `json:"timeout,omitempty"`
}

// InterruptResult is returned by POST /api/v1/computers/{computerId}/herdr-core/terminal/interrupt.
type InterruptResult struct {
	OK      bool   `json:"ok"`
	Address string `json:"address,omitempty"`
	Effect  string `json:"effect,omitempty"`
	Status  string `json:"status,omitempty"`
	State   string `json:"state,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// KillRequest is sent to POST /api/v1/computers/{computerId}/herdr-core/terminal/kill.
type KillRequest struct {
	Address string `json:"address"`
}

// KillResult is returned by POST /api/v1/computers/{computerId}/herdr-core/terminal/kill.
type KillResult struct {
	OK       bool   `json:"ok"`
	Address  string `json:"address,omitempty"`
	State    string `json:"state,omitempty"`
	ExitCode *int   `json:"exit_code,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

// RemoveResult is returned by DELETE /api/v1/computers/{computerId}/herdr-core/terminal.
type RemoveResult struct {
	OK      bool   `json:"ok"`
	Address string `json:"address,omitempty"`
	Removed bool   `json:"removed,omitempty"`
}
