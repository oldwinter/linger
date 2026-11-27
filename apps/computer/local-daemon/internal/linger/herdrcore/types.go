package herdrcore

import (
	"encoding/json"
	"errors"
	"fmt"
)

// ProtocolGeneration is the herdr-core OpenRPC protocol generation this client speaks.
const ProtocolGeneration uint32 = 1

// Terminal lifecycle states reported in Terminal.State.
const (
	TerminalStateLive     = "live"
	TerminalStateFinished = "finished"
)

// OSC 7501 root status words reported in Status.State.
const (
	StatusIdle    = "idle"
	StatusWorking = "working"
	StatusDone    = "done"
	StatusBlocked = "blocked"
	StatusError   = "error"
)

// OSC 7501 blocked kinds reported in Status.Kind when Status.State == StatusBlocked.
const (
	BlockedKindPermission = "permission"
	BlockedKindQuestion   = "question"
	BlockedKindAuth       = "auth"
)

// WaitChildrenMode selects how terminal.wait observes child terminals.
type WaitChildrenMode string

const (
	// WaitChildrenAny waits for the next child news or an incoming message.
	WaitChildrenAny WaitChildrenMode = "any"
	// WaitChildrenAll waits until no child terminal is working.
	WaitChildrenAll WaitChildrenMode = "all"
)

// SendCondition restricts terminal.send to run only when the terminal's OSC 7501
// status matches. In herdr-core v0.1.21 only "idle" and "working" are valid.
type SendCondition string

const (
	// SendIfIdle requires the terminal status to be "idle".
	SendIfIdle SendCondition = "idle"
	// SendIfWorking requires the terminal status to be "working".
	SendIfWorking SendCondition = "working"
)

// Stable JSON-RPC error data.kind values defined in herdr-core's OpenRPC schema.
const (
	ErrKindNotFound              = "not_found"
	ErrKindMachineUnknown        = "machine_unknown"
	ErrKindFinished              = "finished"
	ErrKindUnavailable           = "unavailable"
	ErrKindBlocked               = "blocked"
	ErrKindStatusMismatch        = "status_mismatch"
	ErrKindInvalidParams         = "invalid_params"
	ErrKindNeedsFramed           = "needs_framed"
	ErrKindNeedsTarget           = "needs_target"
	ErrKindNameTaken             = "name_taken"
	ErrKindAlreadyAdded          = "already_added"
	ErrKindUnreachable           = "unreachable"
	ErrKindHCMissing             = "hc_missing"
	ErrKindIncompatible          = "incompatible"
	ErrKindLive                  = "live"
	ErrKindEditFailed            = "edit_failed"
	ErrKindNotText               = "not_text"
	ErrKindIO                    = "io"
	ErrKindConflict              = "conflict"
	ErrKindConfig                = "config"
	ErrKindCancelled             = "cancelled"
	ErrKindSpawnFailed           = "spawn_failed"
	ErrKindInvalidTemplate       = "invalid_template"
	ErrKindNeedsUpdate           = "needs_update"
	ErrKindUnsupportedGeneration = "unsupported_generation"
	ErrKindInternal              = "internal"
)

// Error is a JSON-RPC 2.0 error returned by herdr-core, carrying its stable
// data.kind and optional data.hint.
type Error struct {
	Code    int
	Message string
	Kind    string
	Hint    string
	Data    json.RawMessage
}

// Error implements error.
func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Kind != "" && e.Message != "" && e.Message != e.Kind {
		return fmt.Sprintf("herdr-core %s (%d): %s", e.Kind, e.Code, e.Message)
	}
	if e.Kind != "" {
		return fmt.Sprintf("herdr-core %s (%d)", e.Kind, e.Code)
	}
	return fmt.Sprintf("herdr-core error (%d): %s", e.Code, e.Message)
}

// ErrorKind returns the stable herdr-core data.kind if err wraps an *Error.
func ErrorKind(err error) string {
	var hcErr *Error
	if errors.As(err, &hcErr) {
		return hcErr.Kind
	}
	return ""
}

// IsErrorKind reports whether err is a herdr-core *Error with the given kind.
func IsErrorKind(err error, kind string) bool {
	return ErrorKind(err) == kind
}

// CoreInfo identifies one herdr-core daemon instance.
type CoreInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// LoginSession describes the OS login session inherited by a core.
type LoginSession struct {
	GUI  *bool  `json:"gui,omitempty"`
	ID   uint32 `json:"id"`
	User uint32 `json:"user"`
}

// HolderInfo describes one PTY holder process managed by the core.
type HolderInfo struct {
	Current   bool   `json:"current"`
	Instance  string `json:"instance"`
	PID       uint32 `json:"pid"`
	Terminals uint   `json:"terminals"`
}

// Display reports a viewer's own terminal colors and cell geometry.
type Display struct {
	BG     *string    `json:"bg,omitempty"`
	Cell   *[2]uint32 `json:"cell,omitempty"`
	Cursor *string    `json:"cursor,omitempty"`
	FG     *string    `json:"fg,omitempty"`
}

// InitialSize sets a terminal's initial columns and rows before start.
type InitialSize struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// Foreground describes the process currently in the terminal's foreground.
type Foreground struct {
	Argv []string `json:"argv"`
	Cwd  string   `json:"cwd"`
	Name string   `json:"name"`
	PID  int32    `json:"pid"`
}

// FirstMessage reports whether a template's initial task message was delivered.
type FirstMessage struct {
	Reason  *string `json:"reason,omitempty"`
	Sent    bool    `json:"sent"`
	Started *bool   `json:"started,omitempty"`
	Turn    *uint64 `json:"turn,omitempty"`
}

// Status is one OSC 7501 status record reported by a program.
type Status struct {
	App      string  `json:"app,omitempty"`
	Kind     *string `json:"kind,omitempty"`
	Msg      string  `json:"msg,omitempty"`
	Progress *uint8  `json:"progress,omitempty"`
	State    string  `json:"state"`
	Title    string  `json:"title,omitempty"`
}

// Terminal holds the full facts of one local or remote terminal.
type Terminal struct {
	Address       string            `json:"address"`
	Argv          []string          `json:"argv"`
	Cols          uint16            `json:"cols"`
	CreatedMS     uint64            `json:"created_ms"`
	Cwd           string            `json:"cwd"`
	DieWithParent bool              `json:"die_with_parent,omitempty"`
	ExitCode      *int32            `json:"exit_code,omitempty"`
	FinishedMS    *uint64           `json:"finished_ms,omitempty"`
	FirstMessage  *FirstMessage     `json:"first_message,omitempty"`
	Foreground    *Foreground       `json:"foreground,omitempty"`
	Identity      string            `json:"identity,omitempty"`
	Keep          bool              `json:"keep,omitempty"`
	Labels        map[string]string `json:"labels"`
	Name          *string           `json:"name,omitempty"`
	Notify        bool              `json:"notify,omitempty"`
	Parent        *string           `json:"parent,omitempty"`
	PasteGapMS    *uint64           `json:"paste_gap_ms,omitempty"`
	PID           *uint32           `json:"pid,omitempty"`
	Reason        *string           `json:"reason,omitempty"`
	Records       map[string]Status `json:"records,omitempty"`
	Reported      bool              `json:"reported,omitempty"`
	RM            bool              `json:"rm,omitempty"`
	Rows          uint16            `json:"rows"`
	Screen        string            `json:"screen"`
	Signal        *int32            `json:"signal,omitempty"`
	State         string            `json:"state"`
	Status        *Status           `json:"status,omitempty"`
	StatusMS      *uint64           `json:"status_ms,omitempty"`
	Stop          *string           `json:"stop,omitempty"`
	Submit        *string           `json:"submit,omitempty"`
	Template      *string           `json:"template,omitempty"`
	Title         string            `json:"title,omitempty"`
	Turn          uint64            `json:"turn,omitempty"`
}

// Machine describes a saved remote machine profile.
type Machine struct {
	Host                    string  `json:"host"`
	ID                      string  `json:"id"`
	KeepsRunningAfterLogout *bool   `json:"keeps_running_after_logout,omitempty"`
	LogoutLingerUser        *string `json:"logout_linger_user,omitempty"`
	Name                    string  `json:"name"`
	Session                 *string `json:"session,omitempty"`
	Target                  string  `json:"target"`
	Temporary               bool    `json:"temporary,omitempty"`
	Version                 string  `json:"version"`
	Via                     bool    `json:"via,omitempty"`
}

// MachineView combines a saved Machine profile with its live connection state.
type MachineView struct {
	Host                    string  `json:"host"`
	ID                      string  `json:"id"`
	KeepsRunningAfterLogout *bool   `json:"keeps_running_after_logout,omitempty"`
	LogoutLingerUser        *string `json:"logout_linger_user,omitempty"`
	Name                    string  `json:"name"`
	Session                 *string `json:"session,omitempty"`
	SinceMS                 *uint64 `json:"since_ms,omitempty"`
	State                   string  `json:"state"`
	Target                  string  `json:"target"`
	Temporary               bool    `json:"temporary,omitempty"`
	Version                 string  `json:"version"`
	Via                     bool    `json:"via,omitempty"`
	Why                     *string `json:"why,omitempty"`
}

// TemplateInfo describes one user-configured launch template.
type TemplateInfo struct {
	Command     string  `json:"command"`
	Description string  `json:"description"`
	Error       *string `json:"error,omitempty"`
	Name        string  `json:"name"`
}

// Edit is one exact search-and-replace operation for file.edit.
type Edit struct {
	Old string `json:"old"`
	New string `json:"new"`
}

// HelloParams are parameters for the `hello` handshake.
type HelloParams struct {
	CallsYou   *string   `json:"calls_you,omitempty"`
	Core       *CoreInfo `json:"core,omitempty"`
	Features   []string  `json:"features,omitempty"`
	Framed     bool      `json:"framed,omitempty"`
	Generation *uint32   `json:"generation,omitempty"`
}

// HelloResult is returned by `hello`.
type HelloResult struct {
	Core                    CoreInfo      `json:"core"`
	Features                []string      `json:"features"`
	Framed                  bool          `json:"framed"`
	Generation              uint32        `json:"generation"`
	KeepsRunningAfterLogout *bool         `json:"keeps_running_after_logout,omitempty"`
	LoginSession            *LoginSession `json:"login_session,omitempty"`
	LogoutLingerUser        *string       `json:"logout_linger_user,omitempty"`
	Methods                 []string      `json:"methods"`
	Version                 string        `json:"version"`
}

// StatusResult is returned by `server.status`.
type StatusResult struct {
	Core                    CoreInfo     `json:"core"`
	Finished                uint         `json:"finished"`
	Holder                  *HolderInfo  `json:"holder,omitempty"`
	Holders                 []HolderInfo `json:"holders"`
	InstalledBy             *string      `json:"installed_by,omitempty"`
	KeepsRunningAfterLogout *bool        `json:"keeps_running_after_logout,omitempty"`
	Live                    uint         `json:"live"`
	LogoutLingerUser        *string      `json:"logout_linger_user,omitempty"`
	PID                     uint32       `json:"pid"`
	UptimeMS                uint64       `json:"uptime_ms"`
	Version                 string       `json:"version"`
}

// StopResult is returned by `server.stop` and `server.restart`.
type StopResult struct {
	Stopped bool `json:"stopped"`
}

// ServerRestartParams are parameters for `server.restart`.
type ServerRestartParams struct {
	Environment map[string]string `json:"environment,omitempty"`
}

// TemplatesResult is returned by `templates.list`.
type TemplatesResult struct {
	Templates []TemplateInfo `json:"templates"`
}

// TerminalRunParams are parameters for `terminal.run`.
type TerminalRunParams struct {
	Argv          []string          `json:"argv,omitempty"`
	Caller        *string           `json:"caller,omitempty"`
	Cwd           *string           `json:"cwd,omitempty"`
	DieWithParent bool              `json:"die_with_parent,omitempty"`
	Display       *Display          `json:"display,omitempty"`
	Env           map[string]string `json:"env,omitempty"`
	Keep          bool              `json:"keep,omitempty"`
	Labels        map[string]string `json:"labels,omitempty"`
	Line          *string           `json:"line,omitempty"`
	Name          *string           `json:"name,omitempty"`
	NoNotify      bool              `json:"no_notify,omitempty"`
	NoParent      bool              `json:"no_parent,omitempty"`
	On            *string           `json:"on,omitempty"`
	OutliveParent bool              `json:"outlive_parent,omitempty"`
	Parent        *string           `json:"parent,omitempty"`
	RM            bool              `json:"rm,omitempty"`
	Size          *InitialSize      `json:"size,omitempty"`
	Timeout       *float64          `json:"timeout,omitempty"`
	Wait          bool              `json:"wait,omitempty"`
}

// RunResult is returned by `terminal.run`.
type RunResult struct {
	Terminal
	Output *string     `json:"output,omitempty"`
	Wait   *WaitResult `json:"wait,omitempty"`
}

// TerminalListParams are parameters for `terminal.list`.
type TerminalListParams struct {
	All    bool              `json:"all,omitempty"`
	Labels map[string]string `json:"labels,omitempty"`
}

// ListResult is returned by `terminal.list`.
type ListResult struct {
	HiddenFinished uint          `json:"hidden_finished"`
	Machines       []MachineView `json:"machines"`
	Terminals      []Terminal    `json:"terminals"`
}

// TerminalGetParams are parameters for `terminal.get`.
type TerminalGetParams struct {
	Caller   *string `json:"caller,omitempty"`
	Terminal string  `json:"terminal"`
}

// TerminalKillParams are parameters for `terminal.kill`.
type TerminalKillParams struct {
	Caller   *string `json:"caller,omitempty"`
	Terminal string  `json:"terminal"`
}

// TerminalRemoveParams are parameters for `terminal.rm`.
type TerminalRemoveParams struct {
	Caller   *string `json:"caller,omitempty"`
	Terminal string  `json:"terminal"`
}

// RemoveResult is returned by `terminal.rm` and `machine.rm`.
type RemoveResult struct {
	Removed string `json:"removed"`
}

// TerminalKeepParams are parameters for `terminal.keep`.
type TerminalKeepParams struct {
	Keep     bool   `json:"keep"`
	Terminal string `json:"terminal"`
}

// TerminalLabelParams are parameters for `terminal.label`.
type TerminalLabelParams struct {
	Labels   map[string]string `json:"labels"`
	Terminal string            `json:"terminal"`
}

// TerminalReadParams are parameters for `terminal.read`.
type TerminalReadParams struct {
	Caller   *string `json:"caller,omitempty"`
	Lines    uint    `json:"lines,omitempty"`
	Terminal string  `json:"terminal"`
}

// ReadResult is returned by `terminal.read`.
type ReadResult struct {
	Complete bool    `json:"complete"`
	How      string  `json:"how"`
	Text     string  `json:"text"`
	Why      *string `json:"why,omitempty"`
}

// TerminalAttachParams are parameters for `terminal.attach`.
type TerminalAttachParams struct {
	Caller              *string  `json:"caller,omitempty"`
	Cols                uint16   `json:"cols"`
	Display             *Display `json:"display,omitempty"`
	History             uint     `json:"history,omitempty"`
	Observe             bool     `json:"observe,omitempty"`
	ResizeNotifications bool     `json:"resize_notifications,omitempty"`
	Resumed             bool     `json:"resumed,omitempty"`
	Rows                uint16   `json:"rows"`
	Terminal            string   `json:"terminal"`
}

// AttachResult is returned by `terminal.attach`.
type AttachResult struct {
	AutomaticInput      bool     `json:"automatic_input"`
	Channel             uint32   `json:"channel"`
	ResizeNotifications bool     `json:"resize_notifications"`
	Terminal            Terminal `json:"terminal"`
}

// TerminalSendParams are parameters for `terminal.send`.
type TerminalSendParams struct {
	Caller   *string        `json:"caller,omitempty"`
	Force    bool           `json:"force,omitempty"`
	If       *SendCondition `json:"if,omitempty"`
	Terminal string         `json:"terminal"`
	Text     string         `json:"text"`
	Timeout  *float64       `json:"timeout,omitempty"`
	Wait     bool           `json:"wait,omitempty"`
}

// SendResult is returned by `terminal.send`.
type SendResult struct {
	Started *bool       `json:"started,omitempty"`
	Status  *string     `json:"status,omitempty"`
	Turn    uint64      `json:"turn"`
	Wait    *WaitResult `json:"wait,omitempty"`
}

// TerminalWaitParams are parameters for `terminal.wait`.
type TerminalWaitParams struct {
	Caller   *string           `json:"caller,omitempty"`
	Children *WaitChildrenMode `json:"children,omitempty"`
	Output   *string           `json:"output,omitempty"`
	Terminal *string           `json:"terminal,omitempty"`
	Timeout  *float64          `json:"timeout,omitempty"`
}

// WaitResult is returned by `terminal.wait`, `terminal.run(wait:true)`, and `terminal.send(wait:true)`.
type WaitResult struct {
	Children []WaitResult `json:"children"`
	Ended    bool         `json:"ended"`
	ExitCode *int32       `json:"exit_code,omitempty"`
	From     *string      `json:"from,omitempty"`
	Reason   string       `json:"reason"`
	Signal   *int32       `json:"signal,omitempty"`
	Status   *string      `json:"status,omitempty"`
	Terminal string       `json:"terminal"`
	Turn     uint64       `json:"turn"`
}

// TerminalKeysParams are parameters for `terminal.keys`.
type TerminalKeysParams struct {
	Caller   *string  `json:"caller,omitempty"`
	Keys     []string `json:"keys"`
	Terminal string   `json:"terminal"`
}

// KeysResult is returned by `terminal.keys`.
type KeysResult struct {
	Status *string `json:"status,omitempty"`
	Turn   uint64  `json:"turn"`
}

// TerminalInterruptParams are parameters for `terminal.interrupt`.
type TerminalInterruptParams struct {
	Terminal string   `json:"terminal"`
	Timeout  *float64 `json:"timeout,omitempty"`
}

// InterruptResult is returned by `terminal.interrupt`.
type InterruptResult struct {
	Key     string `json:"key"`
	Outcome string `json:"outcome"`
}

// TerminalPutParams are parameters for `terminal.put`.
type TerminalPutParams struct {
	Data     string `json:"data"`
	Name     string `json:"name"`
	Terminal string `json:"terminal"`
}

// PutResult is returned by `terminal.put`.
type PutResult struct {
	Bytes uint   `json:"bytes"`
	Path  string `json:"path"`
}

// MachineExecParams are parameters for `machine.exec`.
type MachineExecParams struct {
	Argv    []string          `json:"argv,omitempty"`
	Cwd     *string           `json:"cwd,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	Input   *string           `json:"input,omitempty"`
	Line    *string           `json:"line,omitempty"`
	On      *string           `json:"on,omitempty"`
	Timeout *float64          `json:"timeout,omitempty"`
}

// ExecResult is returned by `machine.exec`. Stdout and Stderr are base64-encoded.
type ExecResult struct {
	Code      *int32 `json:"code,omitempty"`
	MS        uint64 `json:"ms"`
	Signal    *int32 `json:"signal,omitempty"`
	Stderr    string `json:"stderr"`
	Stdout    string `json:"stdout"`
	TimedOut  bool   `json:"timed_out"`
	Truncated bool   `json:"truncated"`
}

// FileReadParams are parameters for `file.read`.
type FileReadParams struct {
	Cwd    *string `json:"cwd,omitempty"`
	Limit  *uint   `json:"limit,omitempty"`
	Offset *uint   `json:"offset,omitempty"`
	On     *string `json:"on,omitempty"`
	Path   string  `json:"path"`
}

// FileReadResult is returned by `file.read`.
type FileReadResult struct {
	First uint   `json:"first"`
	Last  uint   `json:"last"`
	Lines uint   `json:"lines"`
	Text  string `json:"text"`
}

// FileWriteParams are parameters for `file.write`. Data is base64-encoded.
type FileWriteParams struct {
	Cwd  *string `json:"cwd,omitempty"`
	Data string  `json:"data"`
	On   *string `json:"on,omitempty"`
	Path string  `json:"path"`
}

// FileEditParams are parameters for `file.edit`.
type FileEditParams struct {
	Cwd   *string `json:"cwd,omitempty"`
	Edits []Edit  `json:"edits"`
	On    *string `json:"on,omitempty"`
	Path  string  `json:"path"`
}

// FileResult is returned by `file.write` and `file.edit`.
type FileResult struct {
	Bytes uint   `json:"bytes"`
	Path  string `json:"path"`
}

// DocGetParams are parameters for `doc.get`.
type DocGetParams struct {
	Name string  `json:"name"`
	On   *string `json:"on,omitempty"`
}

// DocGetResult is returned by `doc.get`.
type DocGetResult struct {
	Value   json.RawMessage `json:"value"`
	Version uint64          `json:"version"`
}

// DocSetParams are parameters for `doc.set`.
type DocSetParams struct {
	Name    string          `json:"name"`
	On      *string         `json:"on,omitempty"`
	Value   json.RawMessage `json:"value"`
	Version uint64          `json:"version"`
}

// DocSetResult is returned by `doc.set`.
type DocSetResult struct {
	Version uint64 `json:"version"`
}

// EventsSubscribeParams are parameters for `events.subscribe`.
type EventsSubscribeParams struct {
	ChildrenOf *string           `json:"children_of,omitempty"`
	Labels     map[string]string `json:"labels,omitempty"`
	Terminal   *string           `json:"terminal,omitempty"`
}

// SubscribeResult is returned by `events.subscribe`.
type SubscribeResult struct {
	Channel   *uint32    `json:"channel,omitempty"`
	Seq       uint64     `json:"seq"`
	Terminals []Terminal `json:"terminals"`
}

// MachineAddParams are parameters for `machine.add`.
type MachineAddParams struct {
	Name      *string `json:"name,omitempty"`
	Session   *string `json:"session,omitempty"`
	Target    *string `json:"target,omitempty"`
	Temporary bool    `json:"temporary,omitempty"`
	Via       *string `json:"via,omitempty"`
}

// MachineListResult is returned by `machine.list`.
type MachineListResult struct {
	Machines []MachineView `json:"machines"`
}

// MachineConnectParams are parameters for `machine.connect`.
type MachineConnectParams struct {
	Machine string `json:"machine"`
}

// MachineRenameParams are parameters for `machine.rename`.
type MachineRenameParams struct {
	Machine string `json:"machine"`
	NewName string `json:"new_name"`
}

// MachineRemoveParams are parameters for `machine.rm`.
type MachineRemoveParams struct {
	Machine string `json:"machine"`
}

// EventNotification is the payload of an `event` JSON-RPC notification from
// `events.subscribe`.
type EventNotification struct {
	Seq      uint64          `json:"seq"`
	Terminal string          `json:"terminal,omitempty"`
	Type     string          `json:"type"`
	Data     json.RawMessage `json:"data,omitempty"`
}

// MissedNotification is the payload of a `missed` notification from
// `events.subscribe` when a slow subscriber falls behind and receives a fresh
// snapshot.
type MissedNotification struct {
	Seq       uint64     `json:"seq"`
	Terminals []Terminal `json:"terminals,omitempty"`
	Dropped   uint64     `json:"dropped,omitempty"`
}

// StatusEventData is the `data` payload of a `status` event notification.
type StatusEventData struct {
	Records  map[string]Status `json:"records,omitempty"`
	Reported *bool             `json:"reported,omitempty"`
	Status   *Status           `json:"status"`
	StatusMS *uint64           `json:"status_ms,omitempty"`
}

// TurnEventData is the `data` payload of a `turn` event notification.
type TurnEventData struct {
	State string `json:"state,omitempty"`
	Turn  uint64 `json:"turn"`
}

// FinishedEventData is the `data` payload of a `finished` event notification.
type FinishedEventData struct {
	ExitCode   *int32  `json:"exit_code,omitempty"`
	FinishedMS *uint64 `json:"finished_ms,omitempty"`
	Reason     *string `json:"reason,omitempty"`
	Signal     *int32  `json:"signal,omitempty"`
}

// LabelsEventData is the `data` payload of a `labels` event notification.
type LabelsEventData struct {
	Labels map[string]string `json:"labels"`
}

// TitleEventData is the `data` payload of a `title` event notification.
type TitleEventData struct {
	Title string `json:"title"`
}

// SizeEventData is the `data` payload of a `size` event notification.
type SizeEventData struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// KeepEventData is the `data` payload of a `keep` event notification.
type KeepEventData struct {
	Keep bool `json:"keep"`
}

// DocEventData is the `data` payload of a `doc` event notification.
type DocEventData struct {
	Name    string `json:"name"`
	Version uint64 `json:"version"`
}
