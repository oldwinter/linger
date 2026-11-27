// Package herdrcore is the Local Computer's client for herdr-core (hc), the
// cross-platform persistent terminal and remote execution runtime.
//
// It speaks herdr-core's JSON-RPC 2.0 OpenRPC protocol (generation 1) in both
// newline-delimited mode and multiplexed framed binary mode over either the
// local Unix domain socket or `hc connect` stdio tunneling, exposes a framed
// PTY attach session, watches ordered `events.subscribe` streams for blocked,
// finished, and errored agents, and delivers pre-checked answers to blocked
// terminals.
package herdrcore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// DefaultSession is the session name herdr-core uses when HC_SESSION is unset.
const DefaultSession = "default"

// TransportKind identifies how Client connects to herdr-core.
type TransportKind string

const (
	// TransportUnixSocket dials herdr-core's local Unix domain socket directly.
	TransportUnixSocket TransportKind = "unix"
	// TransportConnectStdio tunnels the protocol through `hc connect` stdin/stdout,
	// used on Windows and in environments without a local Unix socket path.
	TransportConnectStdio TransportKind = "connect_stdio"
)

// Installation describes a discovered herdr-core (hc) binary and its default
// session transport.
type Installation struct {
	Executable string
	Socket     string
	Session    string
	Transport  TransportKind
}

// Locate finds hc or herdr-core on the user's terminal PATH and resolves its
// session and transport. environment must already carry the user's terminal
// PATH; nothing comes from a wire request.
func Locate(environment map[string]string) (Installation, bool) {
	return locateForOS(runtime.GOOS, environment)
}

func locateForOS(goos string, environment map[string]string) (Installation, bool) {
	pathValue := lookupEnv(goos, environment, "PATH")
	executable := findExecutable(goos, pathValue)
	if executable == "" {
		return Installation{}, false
	}
	session := SessionName(environment)
	if goos == "windows" {
		return Installation{
			Executable: executable,
			Session:    session,
			Transport:  TransportConnectStdio,
		}, true
	}
	socket := SocketPath(environment)
	transport := TransportUnixSocket
	if socket == "" {
		transport = TransportConnectStdio
	}
	return Installation{
		Executable: executable,
		Socket:     socket,
		Session:    session,
		Transport:  transport,
	}, true
}

// SessionName returns the herdr-core session selected by HC_SESSION, falling
// back to DefaultSession.
func SessionName(environment map[string]string) string {
	if session := strings.TrimSpace(environment["HC_SESSION"]); session != "" {
		return session
	}
	return DefaultSession
}

// SocketPath returns herdr-core's Unix socket path from HC_SOCKET, else
// $XDG_STATE_HOME/herdr-core/<session>/<session>.sock, else
// $HOME/.local/state/herdr-core/<session>/<session>.sock.
func SocketPath(environment map[string]string) string {
	if path := strings.TrimSpace(environment["HC_SOCKET"]); filepath.IsAbs(path) {
		return path
	}
	session := SessionName(environment)
	if state := strings.TrimSpace(environment["XDG_STATE_HOME"]); filepath.IsAbs(state) {
		return filepath.Join(state, "herdr-core", session, session+".sock")
	}
	if home := strings.TrimSpace(environment["HOME"]); filepath.IsAbs(home) {
		return filepath.Join(home, ".local", "state", "herdr-core", session, session+".sock")
	}
	return ""
}

// Version runs the read-only `hc --version` (or `herdr-core --version`) probe.
func (i Installation) Version(ctx context.Context) string {
	if i.Executable == "" {
		return ""
	}
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(probeCtx, i.Executable, "--version").Output()
	if err != nil {
		return ""
	}
	text := strings.TrimSpace(string(output))
	text = strings.TrimPrefix(text, "herdr-core")
	text = strings.TrimPrefix(text, "hc")
	return strings.TrimSpace(text)
}

// Running reports whether a Unix-socket herdr-core server socket currently
// exists on disk. For TransportConnectStdio installations (such as Windows),
// use ProbeStatus so no core is accidentally started.
func (i Installation) Running() bool {
	if i.Transport != TransportUnixSocket || i.Socket == "" {
		return false
	}
	info, err := os.Stat(i.Socket)
	return err == nil && info.Mode()&os.ModeSocket != 0
}

// ProbeStatus queries server.status without starting a stopped core. On Unix
// sockets it checks socket presence before dialing; on connect_stdio (Windows)
// it runs the read-only `hc server status --json`, which never starts a core.
func (i Installation) ProbeStatus(ctx context.Context) (*StatusResult, error) {
	if i.Transport == TransportUnixSocket {
		if !i.Running() {
			return nil, os.ErrNotExist
		}
		status, err := i.Client().ServerStatus(ctx)
		if err != nil {
			return nil, err
		}
		return &status, nil
	}
	if i.Executable == "" {
		return nil, errors.New("herdr-core executable is not configured")
	}
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, i.Executable, "server", "status", "--json")
	if i.Session != "" && i.Session != DefaultSession {
		cmd.Env = append(os.Environ(), "HC_SESSION="+i.Session)
	}
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("probe herdr-core status: %w", err)
	}
	var status StatusResult
	if err := json.Unmarshal(output, &status); err != nil {
		return nil, fmt.Errorf("decode herdr-core status: %w", err)
	}
	return &status, nil
}

// Client returns a Client configured to talk to this Installation.
func (i Installation) Client() *Client {
	return &Client{
		Socket:          i.Socket,
		Executable:      i.Executable,
		Session:         i.Session,
		UseConnectStdio: i.Transport == TransportConnectStdio,
	}
}

func findExecutable(goos, pathEnv string) string {
	names := []string{"hc", "herdr-core"}
	if goos == "windows" {
		names = []string{"hc.exe", "herdr-core.exe", "hc", "herdr-core"}
	}
	for _, directory := range splitPathList(goos, pathEnv) {
		if !isAbsForOS(goos, directory) {
			continue
		}
		for _, name := range names {
			candidate := filepath.Join(directory, name)
			info, err := os.Stat(candidate)
			if err != nil || !info.Mode().IsRegular() {
				continue
			}
			if goos != "windows" && info.Mode().Perm()&0o111 == 0 {
				continue
			}
			return candidate
		}
	}
	return ""
}

func lookupEnv(goos string, environment map[string]string, key string) string {
	if value, ok := environment[key]; ok {
		return value
	}
	if goos != "windows" {
		return ""
	}
	for name, value := range environment {
		if strings.EqualFold(name, key) {
			return value
		}
	}
	return ""
}

func splitPathList(goos, pathEnv string) []string {
	if pathEnv == "" {
		return nil
	}
	if goos == "windows" {
		return strings.Split(pathEnv, ";")
	}
	return strings.Split(pathEnv, ":")
}

func isAbsForOS(goos, path string) bool {
	if path == "" {
		return false
	}
	if goos == "windows" {
		if len(path) >= 3 && ((path[0] >= 'a' && path[0] <= 'z') || (path[0] >= 'A' && path[0] <= 'Z')) && path[1] == ':' && (path[2] == '\\' || path[2] == '/') {
			return true
		}
		if strings.HasPrefix(path, `\\`) {
			return true
		}
		return filepath.IsAbs(path)
	}
	return filepath.IsAbs(path)
}
