// Package localmodels runs the installer's localmodels tool for the Daemon.
// It reads `library status`, starts the library actions a Computer owner
// chose, supervises the long ones (download, load), and maps the tool's
// localmodels.library-status/v1 into the Runner Gateway LocalModelsSnapshot.
// It never chooses a model: every action names the model the owner picked.
package localmodels

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/platform/privatefs"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/process"
	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/workspace"
)

const (
	defaultBifrostHost = "127.0.0.1"
	defaultBifrostPort = 18480
	defaultBifrostAddr = "127.0.0.1:18480"
	maxOwnedFileBytes  = 1 << 20
	maxAddrFileBytes   = 256
)

var (
	bifrostAddrMu   sync.Mutex
	bifrostPortFree = loopbackPortFree
	bifrostPickPort = allocateBifrostPort
)

// HarnessRoot returns the shared runtime/harness directory sibling to a
// localmodels StateDirectory, or an empty string when stateDir is unset.
func HarnessRoot(stateDir string) string {
	if stateDir == "" {
		return ""
	}
	return filepath.Clean(filepath.Join(stateDir, "..", "..", "harness"))
}

// ToolsDirectory returns the localmodels tools directory sibling to a
// localmodels StateDirectory, or an empty string when stateDir is unset.
func ToolsDirectory(stateDir string) string {
	if stateDir == "" {
		return ""
	}
	return filepath.Clean(filepath.Join(stateDir, "..", "tools"))
}

// BifrostDirectory returns the Bifrost application directory sibling to a
// localmodels StateDirectory, or an empty string when stateDir is unset.
func BifrostDirectory(stateDir string) string {
	if stateDir == "" {
		return ""
	}
	return filepath.Clean(filepath.Join(stateDir, "..", "bifrost"))
}

// BifrostAddrFile returns the persisted loopback Bifrost address file sibling
// to a localmodels StateDirectory, or an empty string when stateDir is unset.
func BifrostAddrFile(stateDir string) string {
	if stateDir == "" {
		return ""
	}
	return filepath.Clean(filepath.Join(stateDir, "..", "bifrost-addr"))
}

// Tool is where the installer put the localmodels tool and its state, as
// the Computer config records it.
type Tool struct {
	Python          string
	ModuleDirectory string
	StateDirectory  string
	BaseDirectory   string
}

// Action is one owner-chosen library action. Model is empty only for
// refresh; UnloadFirst is only for load.
type Action struct {
	Name        string
	Model       string
	UnloadFirst []string
}

// Action names, as the Runner Gateway sends them.
const (
	ActionDownload = "download"
	ActionCancel   = "cancel"
	ActionLoad     = "load"
	ActionUnload   = "unload"
	ActionRemove   = "remove"
	ActionRefresh  = "refresh"
)

// arguments are the `library` arguments of one call. Model ids are validated
// by the caller, so none starts with "-".
func (t Tool) arguments(action Action) []string {
	args := []string{"-P", "-s", "-m", "localmodels", "library"}
	switch action.Name {
	case ActionRefresh:
		return append(args, "status", "--base-dir", t.BaseDirectory, "--json")
	case ActionDownload:
		return append(args, "download", action.Model, "--base-dir", t.BaseDirectory, "--jsonl")
	case ActionLoad:
		args = append(args, "load", action.Model)
		for _, other := range action.UnloadFirst {
			args = append(args, "--unload", other)
		}
		return append(args, "--base-dir", t.BaseDirectory, "--jsonl")
	default:
		return append(args, action.Name, action.Model, "--base-dir", t.BaseDirectory, "--json")
	}
}

// command builds one library invocation for the tool.
func (t Tool) command(environment map[string]string, action Action) *exec.Cmd {
	return t.commandArgs(environment, t.arguments(action))
}

// commandArgs builds one tool invocation the way the installer runs it: the
// sealed kit on PYTHONPATH and as the working directory, no user site
// packages, no bytecode writes into the sealed kit, forced UTF-8 mode so Python
// never falls back to a legacy Windows ANSI code page, and PI_CODING_AGENT_DIR
// resolved through OverlayEnvironment and workspace.PiSourceEnvironment so
// localmodels reads and writes the same Pi profile the Daemon probes and runs.
func (t Tool) commandArgs(environment map[string]string, args []string) *exec.Cmd {
	cmd := exec.Command(t.Python, args...)
	cmd.Dir = t.ModuleDirectory
	cleaned := make(map[string]string, len(environment))
	for key, value := range environment {
		switch strings.ToUpper(key) {
		case "PYTHONHOME", "PYTHONSTARTUP", "PYTHONINSPECT", "PYTHONPATH",
			"PYTHONUTF8", "PYTHONIOENCODING",
			"LOCALMODELS_STATE", "LOCALMODELS_TOOLS_DIR", "LOCALMODELS_BIFROST_DIR", "LOCALMODELS_BIFROST_ADDR":
			continue
		case "PI_CODING_AGENT_DIR":
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				cleaned["PI_CODING_AGENT_DIR"] = trimmed
			}
			continue
		}
		cleaned[key] = value
	}
	effective := OverlayEnvironment(cleaned, t.StateDirectory)
	if piEnv, err := workspace.PiSourceEnvironment(effective); err == nil && piEnv["PI_CODING_AGENT_DIR"] != "" {
		effective["PI_CODING_AGENT_DIR"] = piEnv["PI_CODING_AGENT_DIR"]
	}
	effective["PYTHONPATH"] = t.ModuleDirectory
	effective["LOCALMODELS_STATE"] = t.StateDirectory
	if t.StateDirectory != "" {
		toolsDir := ToolsDirectory(t.StateDirectory)
		bifrostDir := BifrostDirectory(t.StateDirectory)
		ensureSiblingDirectories(t.StateDirectory, toolsDir, bifrostDir)
		effective["LOCALMODELS_TOOLS_DIR"] = toolsDir
		effective["LOCALMODELS_BIFROST_DIR"] = bifrostDir
		effective["LOCALMODELS_BIFROST_ADDR"] = resolveBifrostAddr(
			t.StateDirectory,
			toolsDir,
			!isReadOnlyOrStopSubcommand(args),
		)
	}
	effective["PYTHONNOUSERSITE"] = "1"
	effective["PYTHONDONTWRITEBYTECODE"] = "1"
	effective["PYTHONUTF8"] = "1"
	effective["PYTHONIOENCODING"] = "utf-8"
	cmd.Env = make([]string, 0, len(effective))
	for key, value := range effective {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	return cmd
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func ensureSiblingDirectories(stateDir, toolsDir, bifrostDir string) {
	parentDir := filepath.Dir(filepath.Clean(stateDir))
	if !dirExists(parentDir) {
		return
	}
	_ = privatefs.EnsureDir(parentDir)
	_ = privatefs.EnsureDir(toolsDir)
	_ = privatefs.EnsureDir(bifrostDir)
}

func localmodelsSubcommand(args []string) []string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "-m" && args[i+1] == "localmodels" {
			return args[i+2:]
		}
	}
	return args
}

func isReadOnlyOrStopSubcommand(args []string) bool {
	sub := localmodelsSubcommand(args)
	if len(sub) == 0 {
		return true
	}
	group := sub[0]
	verb := ""
	if len(sub) > 1 {
		verb = sub[1]
	}
	switch group {
	case "harness", "debug":
		return true
	case "stack":
		return verb == "down" || verb == "remove"
	case "library":
		return verb == "status" || verb == "unload" || verb == "remove" || verb == "cancel"
	case "foundations":
		return verb == "stop"
	case "gateway":
		return verb == "stop"
	case "source":
		return verb == "status" || verb == "check" || verb == "models"
	case "setup":
		return verb == "inspect" || verb == "review" || verb == "binding"
	default:
		return false
	}
}

func parseLoopbackBifrostAddr(raw string) (string, int, bool) {
	trimmed := strings.TrimSpace(raw)
	portStr, ok := strings.CutPrefix(trimmed, defaultBifrostHost+":")
	if !ok || portStr == "" || len(portStr) > 5 || portStr[0] == '0' {
		return "", 0, false
	}
	for i := range len(portStr) {
		if portStr[i] < '0' || portStr[i] > '9' {
			return "", 0, false
		}
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return "", 0, false
	}
	return fmt.Sprintf("%s:%d", defaultBifrostHost, port), port, true
}

// readOwnedBifrostAddr reads gateway.bifrost.addr from <toolsDir>/owned.json.
// localmodels writes owned.json under the process umask rather than 0600, so
// this checks for a regular non-symlink file inside the private tools dir.
func readOwnedBifrostAddr(toolsDir string) (string, int, bool) {
	if toolsDir == "" {
		return "", 0, false
	}
	ownedPath := filepath.Join(toolsDir, "owned.json")
	info, err := os.Lstat(ownedPath)
	if err != nil || !info.Mode().IsRegular() {
		return "", 0, false
	}
	raw, err := readBounded(ownedPath, maxOwnedFileBytes)
	if err != nil {
		return "", 0, false
	}
	var doc struct {
		Gateway struct {
			Bifrost *struct {
				Addr string `json:"addr"`
			} `json:"bifrost"`
		} `json:"gateway"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || doc.Gateway.Bifrost == nil {
		return "", 0, false
	}
	return parseLoopbackBifrostAddr(doc.Gateway.Bifrost.Addr)
}

func readSavedBifrostAddr(addrFile string) (string, int, bool) {
	if addrFile == "" {
		return "", 0, false
	}
	raw, err := privatefs.ReadFile(addrFile, maxAddrFileBytes)
	if err != nil {
		return "", 0, false
	}
	return parseLoopbackBifrostAddr(string(raw))
}

func resolveBifrostAddr(stateDir, toolsDir string, allocate bool) string {
	if allocate {
		bifrostAddrMu.Lock()
		defer bifrostAddrMu.Unlock()
	}
	if addr, _, ok := readOwnedBifrostAddr(toolsDir); ok {
		return addr
	}
	addrFile := BifrostAddrFile(stateDir)
	if addr, port, ok := readSavedBifrostAddr(addrFile); ok {
		if !allocate || bifrostPortFree(port) {
			return addr
		}
	}
	if !allocate {
		return defaultBifrostAddr
	}
	port, ok := bifrostPickPort(defaultBifrostPort)
	if !ok {
		return defaultBifrostAddr
	}
	addr := fmt.Sprintf("%s:%d", defaultBifrostHost, port)
	parentDir := filepath.Dir(filepath.Clean(stateDir))
	if dirExists(parentDir) {
		_ = privatefs.EnsureDir(parentDir)
		_ = privatefs.WriteFile(addrFile, []byte(addr+"\n"), false)
	}
	return addr
}

func allocateBifrostPort(preferred int) (int, bool) {
	if preferred >= 1024 && preferred <= 65535 && bifrostPortFree(preferred) {
		return preferred, true
	}
	for range 100 {
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			continue
		}
		addr, ok := listener.Addr().(*net.TCPAddr)
		_ = listener.Close()
		if !ok || addr.Port <= 0 {
			continue
		}
		if bifrostPortFree(addr.Port) {
			return addr.Port, true
		}
	}
	return 0, false
}

func loopbackPortFree(port int) bool {
	v4Addr := fmt.Sprintf("%s:%d", defaultBifrostHost, port)
	if !bindLoopbackFree("tcp4", v4Addr, false) {
		return false
	}
	v6Addr := fmt.Sprintf("[::1]:%d", port)
	if !bindLoopbackFree("tcp6", v6Addr, true) {
		return false
	}
	if loopbackAnswers("tcp4", v4Addr) || loopbackAnswers("tcp6", v6Addr) {
		return false
	}
	return true
}

func bindLoopbackFree(network, address string, allowMissingIPv6 bool) bool {
	listener, err := net.Listen(network, address)
	if err == nil {
		_ = listener.Close()
		return true
	}
	if !allowMissingIPv6 {
		return false
	}
	// When an ephemeral IPv6 loopback bind also fails, this host has no ::1.
	probe, probeErr := net.Listen("tcp6", "[::1]:0")
	if probeErr != nil {
		return true
	}
	_ = probe.Close()
	return false
}

func loopbackAnswers(network, address string) bool {
	conn, err := net.DialTimeout(network, address, 200*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// runBuffered executes localmodels with stdout and stderr redirected to
// temporary files (never pipes) so any background gateway child spawned by
// localmodels survives after the CLI process exits.
func (t Tool) runBuffered(
	ctx context.Context,
	environment map[string]string,
	tempDir, prefix string,
	maxBytes int64,
	args []string,
	stdin []byte,
) (stdoutBytes, stderrBytes []byte, exitCode int, err error) {
	if tempDir != "" {
		if mkErr := os.MkdirAll(tempDir, 0o700); mkErr != nil {
			return nil, nil, -1, mkErr
		}
	}
	stdout, err := os.CreateTemp(tempDir, prefix+"-*.out")
	if err != nil {
		return nil, nil, -1, err
	}
	defer func() { _ = os.Remove(stdout.Name()) }()
	stderr, err := os.CreateTemp(tempDir, prefix+"-*.err")
	if err != nil {
		_ = stdout.Close()
		return nil, nil, -1, err
	}
	defer func() { _ = os.Remove(stderr.Name()) }()

	cmd := t.commandArgs(environment, args)
	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	process.Prepare(cmd)
	startErr := cmd.Start()
	_ = stdout.Close()
	_ = stderr.Close()
	if startErr != nil {
		return nil, nil, -1, startErr
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	select {
	case <-exited:
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		<-exited
		return nil, nil, -1, context.Cause(ctx)
	}
	code := cmd.ProcessState.ExitCode()
	out, readErr := readBounded(stdout.Name(), maxBytes)
	var errOut []byte
	if code != 0 {
		if diagnostic, diagErr := readBounded(stderr.Name(), 4096); diagErr == nil {
			errOut = diagnostic
		}
	}
	return out, errOut, code, readErr
}

// installed reports whether the configured interpreter still exists.
func (t Tool) installed() bool {
	info, err := os.Stat(t.Python)
	return err == nil && info.Mode().IsRegular()
}
