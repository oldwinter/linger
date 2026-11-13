// Package herdr is the Local Computer's bridge to the user's herdr terminal
// workspace: it watches the coding agents herdr runs for moments that need the
// user, and types the user's own answer into a blocked agent pane.
//
// It speaks herdr's local socket API (newline-delimited JSON requests and
// responses, protocol 22) and never starts, splits or closes panes or agents.
package herdr

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode"
)

// Installation is a herdr found the way the user's terminal would find it.
type Installation struct {
	Executable string
	Socket     string
}

// Locate finds herdr on the user's terminal PATH and the socket its CLI would
// use. environment must already carry the terminal PATH; nothing comes from a
// wire request. Windows is not supported.
func Locate(environment map[string]string) (Installation, bool) {
	if runtime.GOOS == "windows" {
		return Installation{}, false
	}
	executable := lookPath("herdr", environment["PATH"])
	socket := SocketPath(environment)
	if executable == "" || socket == "" {
		return Installation{}, false
	}
	return Installation{Executable: executable, Socket: socket}, true
}

// SocketPath is the herdr CLI's own default: HERDR_SOCKET_PATH, else the
// herdr directory under the XDG config home.
func SocketPath(environment map[string]string) string {
	if path := environment["HERDR_SOCKET_PATH"]; filepath.IsAbs(path) {
		return path
	}
	if config := environment["XDG_CONFIG_HOME"]; filepath.IsAbs(config) {
		return filepath.Join(config, "herdr", "herdr.sock")
	}
	if home := environment["HOME"]; filepath.IsAbs(home) {
		return filepath.Join(home, ".config", "herdr", "herdr.sock")
	}
	return ""
}

// Version runs the read-only `herdr --version`.
func (i Installation) Version(ctx context.Context) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, i.Executable, "--version").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(output)), "herdr"))
}

// Running reports whether the herdr server's socket exists.
func (i Installation) Running() bool {
	info, err := os.Stat(i.Socket)
	return err == nil && info.Mode()&os.ModeSocket != 0
}

func lookPath(name, path string) string {
	for _, directory := range filepath.SplitList(path) {
		if !filepath.IsAbs(directory) {
			continue
		}
		candidate := filepath.Join(directory, name)
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0 {
			return candidate
		}
	}
	return ""
}

// Agent is one coding agent herdr recognizes in a pane.
type Agent struct {
	PaneID         string `json:"pane_id"`
	Name           string `json:"name"`
	Agent          string `json:"agent"`
	DisplayAgent   string `json:"display_agent"`
	Status         string `json:"agent_status"`
	Cwd            string `json:"cwd"`
	ForegroundCwd  string `json:"foreground_cwd"`
	Title          string `json:"title"`
	TerminalTitle  string `json:"terminal_title_stripped"`
	StateChangeSeq uint64 `json:"state_change_seq"`
	// CompletionSeq is set while the current idle state ended a piece of
	// work, and changes with each completion.
	CompletionSeq *uint64 `json:"completion_seq"`
}

// Error is a failure herdr itself answered with.
type Error struct{ Code, Message string }

func (e *Error) Error() string { return "herdr " + e.Code + ": " + e.Message }

// Client calls one herdr server over its socket, one connection per request
// like the herdr CLI.
type Client struct {
	Socket string
	nextID atomic.Uint64
}

const maxResponseBytes = 4 << 20

func (c *Client) dial(ctx context.Context) (net.Conn, error) {
	var dialer net.Dialer
	connection, err := dialer.DialContext(ctx, "unix", c.Socket)
	if err != nil {
		return nil, err
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	}
	return connection, nil
}

func (c *Client) request(method string, params any) ([]byte, string, error) {
	id := "linger:" + strconv.FormatUint(c.nextID.Add(1), 10)
	encoded, err := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	return append(encoded, '\n'), id, err
}

// call sends one request and decodes its result into result.
func (c *Client) call(ctx context.Context, method string, params, result any) error {
	connection, err := c.dial(ctx)
	if err != nil {
		return err
	}
	defer connection.Close()
	stop := context.AfterFunc(ctx, func() { _ = connection.Close() })
	defer stop()
	request, id, err := c.request(method, params)
	if err != nil {
		return err
	}
	if _, err := connection.Write(request); err != nil {
		return err
	}
	reader := bufio.NewReaderSize(connection, 64<<10)
	for {
		line, err := readLine(reader)
		if err != nil {
			return err
		}
		var response struct {
			ID     string          `json:"id"`
			Result json.RawMessage `json:"result"`
			Error  *Error          `json:"error"`
		}
		if json.Unmarshal(line, &response) != nil || response.ID != id {
			continue
		}
		if response.Error != nil {
			return response.Error
		}
		if result == nil {
			return nil
		}
		return json.Unmarshal(response.Result, result)
	}
}

func readLine(reader *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		chunk, prefix, err := reader.ReadLine()
		if err != nil {
			return nil, err
		}
		line = append(line, chunk...)
		if len(line) > maxResponseBytes {
			return nil, errors.New("herdr response is too large")
		}
		if !prefix {
			return line, nil
		}
	}
}

// Agents lists the agents herdr recognizes.
func (c *Client) Agents(ctx context.Context) ([]Agent, error) {
	var result struct {
		Agents []Agent `json:"agents"`
	}
	err := c.call(ctx, "agent.list", map[string]any{}, &result)
	return result.Agents, err
}

// Agent reads the agent in one pane.
func (c *Client) Agent(ctx context.Context, paneID string) (Agent, error) {
	var result struct {
		Agent Agent `json:"agent"`
	}
	err := c.call(ctx, "agent.get", map[string]any{"target": paneID}, &result)
	return result.Agent, err
}

// Tail reads the last lines of a pane as plain text.
func (c *Client) Tail(ctx context.Context, paneID string, lines int) (string, error) {
	var result struct {
		Read struct {
			Text string `json:"text"`
		} `json:"read"`
	}
	err := c.call(ctx, "pane.read", map[string]any{"pane_id": paneID, "source": "recent_unwrapped", "lines": lines, "format": "text", "strip_ansi": true}, &result)
	return result.Read.Text, err
}

// subscribe opens a stream of herdr events. It returns once herdr confirmed
// the subscription; each later line is passed to onEvent until the stream or
// ctx ends.
func (c *Client) subscribe(ctx context.Context, subscriptions []map[string]any, onEvent func()) error {
	connection, err := c.dial(ctx)
	if err != nil {
		return err
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Time{})
	stop := context.AfterFunc(ctx, func() { _ = connection.Close() })
	defer stop()
	request, id, err := c.request("events.subscribe", map[string]any{"subscriptions": subscriptions})
	if err != nil {
		return err
	}
	if _, err := connection.Write(request); err != nil {
		return err
	}
	reader := bufio.NewReaderSize(connection, 64<<10)
	started := false
	for {
		line, err := readLine(reader)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
		var frame struct {
			ID    string          `json:"id"`
			Event string          `json:"event"`
			Error *Error          `json:"error"`
			Data  json.RawMessage `json:"data"`
		}
		if json.Unmarshal(line, &frame) != nil {
			continue
		}
		switch {
		case frame.ID == id && frame.Error != nil:
			return frame.Error
		case frame.ID == id:
			started = true
		case frame.Event != "" && started:
			onEvent()
		}
	}
}

// SendAnswer types text and Enter into a pane in one ordered herdr input.
func (c *Client) SendAnswer(ctx context.Context, paneID, text string) error {
	return c.call(ctx, "pane.send_input", map[string]any{"pane_id": paneID, "text": text, "keys": []string{"enter"}}, nil)
}

// Answer statuses. Only AnswerSent means input reached the pane.
const (
	AnswerSent           = "ok"
	AnswerPaneClosed     = "pane_closed"
	AnswerPaneNotBlocked = "pane_not_blocked"
	AnswerUnavailable    = "herdr_unavailable"
	AnswerInvalid        = "invalid_answer"
)

// Answer types the user's answer into a pane that is still blocked in the
// state it was asked in. herdr's agent prompt refuses a blocked agent, so the
// answer goes to the pane's input; checking the state first keeps a late
// answer from landing in a different question. An error after the check means
// the answer may have been typed; the caller must not retry it.
func (c *Client) Answer(ctx context.Context, paneID string, stateChangeSeq uint64, text string) (string, error) {
	// A line break or escape would act as extra keys in the agent's UI.
	if strings.TrimSpace(text) == "" || strings.ContainsFunc(text, unicode.IsControl) {
		return AnswerInvalid, nil
	}
	agent, err := c.Agent(ctx, paneID)
	if status := unread(err); status != "" {
		return status, nil
	}
	if agent.Status != "blocked" || agent.StateChangeSeq != stateChangeSeq {
		return AnswerPaneNotBlocked, nil
	}
	if err := c.SendAnswer(ctx, paneID, text); err != nil {
		return "", fmt.Errorf("send herdr answer: %w", err)
	}
	return AnswerSent, nil
}

// unread is why a pane could not be read before answering: herdr has no
// agent in it, or herdr is not reachable. Nothing was typed either way.
func unread(err error) string {
	var herdrError *Error
	switch {
	case err == nil:
		return ""
	case errors.As(err, &herdrError):
		return AnswerPaneClosed
	default:
		return AnswerUnavailable
	}
}
