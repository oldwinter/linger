package localmodels

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/platform/privatefs"
)

const (
	harnessStatusSchema  = "localmodels.harness-status/v1"
	harnessPlanSchema    = "localmodels.harness-plan/v1"
	maxHarnessOutput     = 4 << 20
	harnessStatusTimeout = 2 * time.Minute
	harnessPlanTimeout   = 2 * time.Minute
	harnessApplyTimeout  = 20 * time.Minute
)

var hex64Pattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type harnessStatusDoc struct {
	Schema   string `json:"schema"`
	Runtimes []struct {
		Runtime    string   `json:"runtime"`
		Installed  bool     `json:"installed"`
		Executable string   `json:"executable"`
		ArgvPrefix []string `json:"argvPrefix"`
	} `json:"runtimes"`
}

type harnessPlanDoc struct {
	Schema  string `json:"schema"`
	ID      string `json:"id"`
	Runtime string `json:"runtime"`
}

// InspectPi reports the verified Pi executable managed under harnessDir, or an
// empty string when Pi is not installed there yet.
func (t Tool) InspectPi(ctx context.Context, environment map[string]string, harnessDir string) (string, error) {
	if harnessDir == "" || !t.installed() {
		return "", nil
	}
	info, err := os.Stat(harnessDir)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("harness root is not a directory")
	}
	statusCtx, cancelStatus := context.WithTimeout(ctx, harnessStatusTimeout)
	defer cancelStatus()
	stdout, exitCode, err := t.runHarness(
		statusCtx,
		environment,
		[]string{"-P", "-s", "-m", "localmodels", "harness", "status", "--root", harnessDir, "--runtime", "pi", "--json"},
	)
	if err != nil {
		return "", err
	}
	if exitCode != 0 {
		return "", fmt.Errorf("harness status exited with code %d", exitCode)
	}
	return parsePiFromHarnessStatus(stdout)
}

// EnsurePi returns the Pi executable managed under harnessDir, installing the
// pinned Pi runtime through localmodels harness when it is not installed yet.
// When nodePath is non-empty and names an existing file, it is passed via --node
// so harness does not need to download a separate Node binary.
func (t Tool) EnsurePi(ctx context.Context, environment map[string]string, harnessDir, nodePath string) (string, error) {
	if harnessDir == "" || !t.installed() {
		return "", nil
	}
	if existing, err := t.InspectPi(ctx, environment, harnessDir); err == nil && existing != "" {
		return existing, nil
	}
	if err := privatefs.EnsureDir(harnessDir); err != nil {
		return "", err
	}
	planDir, err := os.MkdirTemp(harnessDir, ".pi-plan-*")
	if err != nil {
		return "", err
	}
	defer func() { _ = os.RemoveAll(planDir) }()
	if err := privatefs.EnsureDir(planDir); err != nil {
		return "", err
	}
	planPath := filepath.Join(planDir, "plan.json")
	planArgs := []string{"-P", "-s", "-m", "localmodels", "harness", "plan", "--runtime", "pi", "--root", harnessDir}
	if nodePath != "" {
		if info, statErr := os.Stat(nodePath); statErr == nil && !info.IsDir() {
			planArgs = append(planArgs, "--node", nodePath)
		}
	}
	planArgs = append(planArgs, "--out", planPath, "--json")
	planCtx, cancelPlan := context.WithTimeout(ctx, harnessPlanTimeout)
	_, planExitCode, err := t.runHarness(planCtx, environment, planArgs)
	cancelPlan()
	if err != nil {
		return "", err
	} else if planExitCode != 0 {
		return "", fmt.Errorf("harness plan exited with code %d", planExitCode)
	}
	encodedPlan, err := os.ReadFile(planPath)
	if err != nil {
		return "", err
	}
	var plan harnessPlanDoc
	if err := json.Unmarshal(encodedPlan, &plan); err != nil {
		return "", fmt.Errorf("decode harness plan: %w", err)
	}
	if plan.Schema != harnessPlanSchema || plan.Runtime != "pi" || !hex64Pattern.MatchString(plan.ID) {
		return "", errors.New("harness plan is outside the contract")
	}
	applyCtx, cancelApply := context.WithTimeout(ctx, harnessApplyTimeout)
	stdout, exitCode, err := t.runHarness(
		applyCtx,
		environment,
		[]string{"-P", "-s", "-m", "localmodels", "harness", "apply", planPath, "--approve", plan.ID, "--jsonl"},
	)
	cancelApply()
	if err != nil {
		return "", err
	}
	if exitCode != 0 {
		return "", fmt.Errorf("harness apply exited with code %d", exitCode)
	}
	if executable, parseErr := parseLastHarnessStatus(stdout); parseErr == nil && executable != "" {
		return executable, nil
	}
	return t.InspectPi(ctx, environment, harnessDir)
}

func (t Tool) runHarness(ctx context.Context, environment map[string]string, args []string) ([]byte, int, error) {
	stdout, stderrBytes, exitCode, err := t.runBuffered(ctx, environment, "", "localmodels-harness", maxHarnessOutput, args, nil)
	if exitCode != 0 && len(stderrBytes) > 0 {
		slog.Debug("local_models.harness_stderr", "stderr", string(stderrBytes))
	}
	return stdout, exitCode, err
}

func parseLastHarnessStatus(stdout []byte) (string, error) {
	lines := bytes.Split(stdout, []byte{'\n'})
	for index := len(lines) - 1; index >= 0; index-- {
		line := bytes.TrimSpace(lines[index])
		if len(line) == 0 {
			continue
		}
		return parsePiFromHarnessStatus(line)
	}
	return "", errors.New("harness output is empty")
}

func parsePiFromHarnessStatus(encoded []byte) (string, error) {
	var doc harnessStatusDoc
	if err := json.Unmarshal(bytes.TrimSpace(encoded), &doc); err != nil {
		return "", fmt.Errorf("decode harness status: %w", err)
	}
	if doc.Schema != harnessStatusSchema {
		return "", fmt.Errorf("harness status schema is %q", doc.Schema)
	}
	for _, row := range doc.Runtimes {
		if row.Runtime != "pi" {
			continue
		}
		if !row.Installed || len(row.ArgvPrefix) != 0 || !filepath.IsAbs(row.Executable) {
			return "", nil
		}
		return row.Executable, nil
	}
	return "", nil
}
