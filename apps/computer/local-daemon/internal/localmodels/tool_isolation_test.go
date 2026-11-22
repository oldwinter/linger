package localmodels

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/platform/privatefs"
)

func envEntries(env []string) map[string][]string {
	entries := make(map[string][]string, len(env))
	for _, item := range env {
		key, value, ok := strings.Cut(item, "=")
		if !ok {
			continue
		}
		entries[key] = append(entries[key], value)
	}
	return entries
}

func envValue(t *testing.T, env []string, key string) string {
	t.Helper()
	entries := envEntries(env)
	values := entries[key]
	if len(values) != 1 {
		t.Fatalf("%s occurrences = %v, want exactly 1", key, values)
	}
	return values[0]
}

func listenLoopbackTest(t *testing.T) (int, func()) {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	cleanup := func() { _ = listener.Close() }
	t.Cleanup(cleanup)
	return port, cleanup
}

func TestDerivedLocalmodelsSiblingPaths(t *testing.T) {
	if ToolsDirectory("") != "" || BifrostDirectory("") != "" || BifrostAddrFile("") != "" {
		t.Fatal("empty stateDir must return empty sibling paths")
	}
	stateDir := filepath.Join(t.TempDir(), "runtime", "localmodels", "state")
	parent := filepath.Dir(stateDir)
	if got := ToolsDirectory(stateDir); got != filepath.Join(parent, "tools") {
		t.Fatalf("ToolsDirectory = %q, want %q", got, filepath.Join(parent, "tools"))
	}
	if got := BifrostDirectory(stateDir); got != filepath.Join(parent, "bifrost") {
		t.Fatalf("BifrostDirectory = %q, want %q", got, filepath.Join(parent, "bifrost"))
	}
	if got := BifrostAddrFile(stateDir); got != filepath.Join(parent, "bifrost-addr") {
		t.Fatalf("BifrostAddrFile = %q, want %q", got, filepath.Join(parent, "bifrost-addr"))
	}
}

func TestCommandArgsIsolatesLocalmodelsPathsAndStripsAmbientEnvCaseInsensitively(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(root, "runtime", "localmodels", "state")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	tool := Tool{
		Python:          filepath.Join(root, "python"),
		ModuleDirectory: filepath.Join(root, "modules"),
		StateDirectory:  stateDir,
		BaseDirectory:   filepath.Join(root, "runtime", "localmodels", "models"),
	}
	ambient := map[string]string{
		"PATH":                     "/usr/bin",
		"localmodels_state":        "/foreign/state",
		"LOCALMODELS_TOOLS_DIR":    "/foreign/tools",
		"localmodels_tools_dir":    "/foreign/tools-lower",
		"Localmodels_Bifrost_Dir":  "/foreign/bifrost",
		"LOCALMODELS_BIFROST_ADDR": "127.0.0.1:19999",
		"localmodels_bifrost_addr": "127.0.0.1:20000",
		"pythonhome":               "/foreign/python",
	}

	cmd := tool.commandArgs(ambient, []string{"-P", "-s", "-m", "localmodels", "library", "status", "--json"})
	entries := envEntries(cmd.Env)

	for _, stripped := range []string{
		"localmodels_state",
		"localmodels_tools_dir",
		"Localmodels_Bifrost_Dir",
		"localmodels_bifrost_addr",
		"pythonhome",
		"PYTHONHOME",
	} {
		if _, found := entries[stripped]; found {
			t.Fatalf("ambient key %q leaked into cmd.Env: %v", stripped, entries[stripped])
		}
	}
	if got := envValue(t, cmd.Env, "LOCALMODELS_STATE"); got != stateDir {
		t.Fatalf("LOCALMODELS_STATE = %q, want %q", got, stateDir)
	}
	if got := envValue(t, cmd.Env, "LOCALMODELS_TOOLS_DIR"); got != ToolsDirectory(stateDir) {
		t.Fatalf("LOCALMODELS_TOOLS_DIR = %q, want %q", got, ToolsDirectory(stateDir))
	}
	if got := envValue(t, cmd.Env, "LOCALMODELS_BIFROST_DIR"); got != BifrostDirectory(stateDir) {
		t.Fatalf("LOCALMODELS_BIFROST_DIR = %q, want %q", got, BifrostDirectory(stateDir))
	}
	if got := envValue(t, cmd.Env, "LOCALMODELS_BIFROST_ADDR"); got != defaultBifrostAddr {
		t.Fatalf("LOCALMODELS_BIFROST_ADDR = %q, want %q", got, defaultBifrostAddr)
	}
	if runtime.GOOS != "windows" {
		for _, dir := range []string{ToolsDirectory(stateDir), BifrostDirectory(stateDir)} {
			info, err := os.Stat(dir)
			if err != nil {
				t.Fatalf("expected private sibling dir %q: %v", dir, err)
			}
			if perm := info.Mode().Perm(); perm != 0o700 {
				t.Fatalf("dir %q perm = %o, want 700", dir, perm)
			}
		}
	}
	if _, err := os.Stat(BifrostAddrFile(stateDir)); !os.IsNotExist(err) {
		t.Fatalf("read-only library status must not create bifrost-addr, err = %v", err)
	}

	// An unset StateDirectory still strips inherited LOCALMODELS_* values without setting relative paths.
	emptyTool := Tool{Python: tool.Python, ModuleDirectory: tool.ModuleDirectory}
	emptyCmd := emptyTool.commandArgs(ambient, []string{"-P", "-s", "-m", "localmodels", "library", "status"})
	emptyEntries := envEntries(emptyCmd.Env)
	for _, key := range []string{"LOCALMODELS_TOOLS_DIR", "LOCALMODELS_BIFROST_DIR", "LOCALMODELS_BIFROST_ADDR"} {
		if _, found := emptyEntries[key]; found {
			t.Fatalf("empty StateDirectory set %q = %v", key, emptyEntries[key])
		}
	}
}

func TestCommandArgsBifrostAddrDefaultFallbackPersistenceAndOwnedPrecedence(t *testing.T) {
	newTool := func(t *testing.T) (Tool, string) {
		t.Helper()
		root := t.TempDir()
		stateDir := filepath.Join(root, "runtime", "localmodels", "state")
		if err := os.MkdirAll(stateDir, 0o700); err != nil {
			t.Fatal(err)
		}
		return Tool{
			Python:          filepath.Join(root, "python"),
			ModuleDirectory: filepath.Join(root, "modules"),
			StateDirectory:  stateDir,
			BaseDirectory:   filepath.Join(root, "runtime", "localmodels", "models"),
		}, stateDir
	}

	t.Run("defaults to 127.0.0.1:18480 when free and persists bifrost-addr", func(t *testing.T) {
		prevFree, prevPick := bifrostPortFree, bifrostPickPort
		t.Cleanup(func() { bifrostPortFree, bifrostPickPort = prevFree, prevPick })
		bifrostPortFree = func(int) bool { return true }
		bifrostPickPort = allocateBifrostPort

		tool, stateDir := newTool(t)
		cmd := tool.commandArgs(nil, []string{"-P", "-s", "-m", "localmodels", "source", "apply", "--mode", "byok"})
		if got := envValue(t, cmd.Env, "LOCALMODELS_BIFROST_ADDR"); got != "127.0.0.1:18480" {
			t.Fatalf("LOCALMODELS_BIFROST_ADDR = %q, want 127.0.0.1:18480", got)
		}
		saved, err := privatefs.ReadFile(BifrostAddrFile(stateDir), maxAddrFileBytes)
		if err != nil {
			t.Fatalf("expected persisted bifrost-addr: %v", err)
		}
		if strings.TrimSpace(string(saved)) != "127.0.0.1:18480" {
			t.Fatalf("persisted bifrost-addr = %q, want 127.0.0.1:18480", string(saved))
		}
	})

	t.Run("allocates and reuses an ephemeral free port when 18480 is occupied", func(t *testing.T) {
		prevFree, prevPick := bifrostPortFree, bifrostPickPort
		t.Cleanup(func() { bifrostPortFree, bifrostPickPort = prevFree, prevPick })
		bifrostPortFree = func(port int) bool {
			return port != defaultBifrostPort && loopbackPortFree(port)
		}
		bifrostPickPort = allocateBifrostPort

		tool, stateDir := newTool(t)
		cmd := tool.commandArgs(nil, []string{"-P", "-s", "-m", "localmodels", "library", "load", "qwen3-4b:Q4_K_M"})
		allocated := envValue(t, cmd.Env, "LOCALMODELS_BIFROST_ADDR")
		if allocated == defaultBifrostAddr || !strings.HasPrefix(allocated, "127.0.0.1:") {
			t.Fatalf("allocated addr = %q, want non-18480 loopback addr", allocated)
		}
		saved, err := privatefs.ReadFile(BifrostAddrFile(stateDir), maxAddrFileBytes)
		if err != nil || strings.TrimSpace(string(saved)) != allocated {
			t.Fatalf("persisted bifrost-addr = %q (err=%v), want %q", string(saved), err, allocated)
		}
		// Read-only and subsequent allocating calls reuse the persisted address.
		statusCmd := tool.commandArgs(nil, []string{"-P", "-s", "-m", "localmodels", "source", "status"})
		if got := envValue(t, statusCmd.Env, "LOCALMODELS_BIFROST_ADDR"); got != allocated {
			t.Fatalf("status addr = %q, want %q", got, allocated)
		}
		applyCmd := tool.commandArgs(nil, []string{"-P", "-s", "-m", "localmodels", "source", "apply", "--mode", "byok"})
		if got := envValue(t, applyCmd.Env, "LOCALMODELS_BIFROST_ADDR"); got != allocated {
			t.Fatalf("second apply addr = %q, want %q", got, allocated)
		}
	})

	t.Run("moves away from a persisted bifrost-addr held by a real foreign listener", func(t *testing.T) {
		tool, stateDir := newTool(t)
		if err := privatefs.EnsureDir(filepath.Dir(stateDir)); err != nil {
			t.Fatal(err)
		}
		occupiedPort, _ := listenLoopbackTest(t)
		occupiedAddr := fmt.Sprintf("127.0.0.1:%d", occupiedPort)
		if err := privatefs.WriteFile(BifrostAddrFile(stateDir), []byte(occupiedAddr+"\n"), false); err != nil {
			t.Fatal(err)
		}
		cmd := tool.commandArgs(nil, []string{"-P", "-s", "-m", "localmodels", "source", "apply", "--mode", "byok"})
		moved := envValue(t, cmd.Env, "LOCALMODELS_BIFROST_ADDR")
		if moved == occupiedAddr || !strings.HasPrefix(moved, "127.0.0.1:") {
			t.Fatalf("moved addr = %q, want a free port other than %q", moved, occupiedAddr)
		}
		saved, err := privatefs.ReadFile(BifrostAddrFile(stateDir), maxAddrFileBytes)
		if err != nil || strings.TrimSpace(string(saved)) != moved {
			t.Fatalf("updated bifrost-addr = %q (err=%v), want %q", string(saved), err, moved)
		}
	})

	t.Run("prefers owned.json gateway.bifrost.addr even while its port is listening", func(t *testing.T) {
		tool, stateDir := newTool(t)
		livePort, _ := listenLoopbackTest(t)
		liveAddr := fmt.Sprintf("127.0.0.1:%d", livePort)
		toolsDir := ToolsDirectory(stateDir)
		if err := privatefs.EnsureDir(toolsDir); err != nil {
			t.Fatal(err)
		}
		// Match localmodels' default-umask owned.json (0644) and verify it beats bifrost-addr.
		ownedJSON := fmt.Sprintf(`{"schema":"localmodels.owned/v1","gateway":{"bifrost":{"addr":%q}}}`, liveAddr)
		if err := os.WriteFile(filepath.Join(toolsDir, "owned.json"), []byte(ownedJSON), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := privatefs.EnsureDir(filepath.Dir(stateDir)); err != nil {
			t.Fatal(err)
		}
		if err := privatefs.WriteFile(BifrostAddrFile(stateDir), []byte("127.0.0.1:49321\n"), false); err != nil {
			t.Fatal(err)
		}
		for _, args := range [][]string{
			{"-P", "-s", "-m", "localmodels", "source", "apply", "--mode", "byok"},
			{"-P", "-s", "-m", "localmodels", "library", "status"},
		} {
			cmd := tool.commandArgs(nil, args)
			if got := envValue(t, cmd.Env, "LOCALMODELS_BIFROST_ADDR"); got != liveAddr {
				t.Fatalf("args %v addr = %q, want owned %q", args, got, liveAddr)
			}
		}

		// Non-loopback owned.json addr is rejected and falls back to bifrost-addr.
		badOwned := `{"schema":"localmodels.owned/v1","gateway":{"bifrost":{"addr":"0.0.0.0:18480"}}}`
		if err := os.WriteFile(filepath.Join(toolsDir, "owned.json"), []byte(badOwned), 0o644); err != nil {
			t.Fatal(err)
		}
		statusCmd := tool.commandArgs(nil, []string{"-P", "-s", "-m", "localmodels", "source", "status"})
		if got := envValue(t, statusCmd.Env, "LOCALMODELS_BIFROST_ADDR"); got != "127.0.0.1:49321" {
			t.Fatalf("fallback addr = %q, want persisted 127.0.0.1:49321", got)
		}
	})
}
