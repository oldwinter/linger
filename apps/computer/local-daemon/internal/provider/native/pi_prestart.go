package native

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"time"
)

const piAttachBudget = 15 * time.Second

// piSettledRun is a Run that never launched a turn: its events are closed and
// its single Outcome is ready.
func piSettledRun(outcome Outcome) *Run {
	events := make(chan Event)
	close(events)
	outcomes := make(chan Outcome, 1)
	outcomes <- outcome
	close(outcomes)
	return &Run{Events: events, Outcome: outcomes}
}

// prestart spawns Pi ahead of a Room-presence run, verifies its RPC session
// state and thinking level, and parks it for the Run to adopt. A prepare
// carries no Run, so its MCP set starts empty and the Run attaches its own
// servers when it adopts the process.
func (p *piRuntime) prestart(ctx context.Context, root string, plan piLaunchPlan) (*Run, error) {
	spec := plan.spec
	if !piResidents.enabled() || (spec.AssignSessionID == "" && spec.ResumeID == "") {
		return nil, errors.New("Pi provider prepare is not eligible")
	}
	mcpShape, _, eligible := residentMCPShape(spec.MCPServers)
	if !eligible {
		return nil, errors.New("Pi provider prepare is not eligible")
	}
	var err error
	plan.canSyncMCP = p.canSyncMCP()
	plan.shape, err = piShapeFor(plan.program, p.args(plan, piInstructionsName, plan.canSyncMCP), p.profile, spec, mcpShape)
	if err != nil {
		return nil, err
	}

	live, fields := piResidents.peek(plan.sessionDir, piMismatch(plan.shape, spec))
	if live && len(fields) == 0 {
		return piSettledRun(Outcome{Status: statusCompleted, SessionID: plan.sessionID}), nil
	}
	reason := "spawn"
	if live {
		reason = "incompatible"
	}
	stopped, err := piResidents.stopWhere(reason, func(proc *piProcess) bool { return proc.res.key == plan.sessionDir }, p.profile.Logger)
	for range stopped {
		spec.Readiness.recycled(reason, fields)
	}
	if err != nil {
		return nil, err
	}

	if _, err := piSessionFolder(root, plan.sessionID); err != nil {
		return nil, err
	}
	lock, err := piLockSession(plan.sessionDir)
	if err != nil {
		return nil, err
	}
	if spec.ResumeID != "" {
		if err := piValidateSession(plan.sessionDir, plan.sessionID, spec.Dir); err != nil {
			piReleaseLock(lock)
			return nil, err
		}
	}

	proc, err := p.launchProcess(plan, lock)
	if err != nil {
		return nil, err
	}
	proc.mu.Lock()
	proc.prestartCreated = spec.AssignSessionID != ""
	proc.mu.Unlock()
	spec.Readiness.spawned()
	spec.Readiness.session(spec.ResumeID != "")
	proc.run()

	initCtx, cancel := context.WithTimeout(ctx, piStartupBudget)
	state, err := proc.sessionState(initCtx)
	if err == nil {
		err = proc.applyThinkingLevel(initCtx, state, plan.thinking)
	}
	cancel()
	if err != nil {
		piResidents.retire(proc)
		return nil, fmt.Errorf("initialize Pi pre-start: %w", err)
	}
	if !piResidents.park(proc, plan.fence, true, p.profile.Logger, spec.Readiness) {
		piResidents.retire(proc)
		return nil, errors.New("Pi provider prepare could not park the process")
	}
	return piSettledRun(Outcome{Status: statusCompleted, SessionID: plan.sessionID, Parked: true}), nil
}

// attach gives a taken Pi process the Run's MCP servers without restarting Pi:
// a changed MCP set is rewritten behind a new resident front and synchronized
// through the managed extension before the prompt starts.
func (p *piRuntime) attach(ctx context.Context, proc *piProcess, plan piLaunchPlan) (err error) {
	if !proc.canSyncMCP {
		return errors.New("Pi process does not support dynamic MCP attachment")
	}
	var front *mcpFront
	config := json.RawMessage(`{"mcpServers":{}}`)
	if len(plan.targets) > 0 {
		if front, err = newMCPFront(); err != nil {
			return fmt.Errorf("Pi MCP front could not start: %w", err)
		}
		defer func() {
			if err != nil {
				front.Close()
			}
		}()
		if err = front.Bind(plan.targets); err != nil {
			return err
		}
		if config, err = front.Rewrite(plan.spec.MCPServers); err != nil {
			return err
		}
	}
	configPath := filepath.Join(proc.sessionDir, piMCPConfigName)
	if err = piWritePrivate(configPath, config); err != nil {
		return fmt.Errorf("managed Pi MCP configuration could not be written: %w", err)
	}
	if err = proc.syncMCP(ctx); err != nil {
		return err
	}
	previous := proc.front
	proc.shape = plan.shape
	proc.front = front
	proc.mcp.configPath = configPath
	previous.Close()
	return nil
}

// hasCommand checks whether Pi registered an extension command with name, so
// an unsupported command is never submitted as a user prompt to the model.
func (p *piProcess) hasCommand(ctx context.Context, name string) (bool, error) {
	reply, err := p.call(ctx, "get_commands", nil, nil)
	if err != nil {
		return false, fmt.Errorf("Pi get_commands failed: %w", err)
	}
	var data struct {
		Commands []struct {
			Name   string `json:"name"`
			Source string `json:"source"`
		} `json:"commands"`
	}
	if err := json.Unmarshal(reply.Data, &data); err != nil {
		return false, fmt.Errorf("Pi get_commands response invalid: %w", err)
	}
	for _, cmd := range data.Commands {
		if cmd.Name == name && cmd.Source == "extension" {
			return true, nil
		}
	}
	return false, nil
}

// syncMCP invokes the managed extension's sync command and waits for its
// structured verdict before returning.
func (p *piProcess) syncMCP(ctx context.Context) error {
	supported, err := p.hasCommand(ctx, piMCPSyncCommand)
	if err != nil {
		return err
	}
	if !supported {
		return errors.New("Pi managed MCP sync command is unavailable")
	}
	verdictCh := make(chan piMCPSyncVerdict, 1)
	p.syncMu.Lock()
	p.syncCh = verdictCh
	p.syncMu.Unlock()
	defer func() {
		p.syncMu.Lock()
		if p.syncCh == verdictCh {
			p.syncCh = nil
		}
		p.syncMu.Unlock()
	}()
	reply, err := p.call(ctx, "prompt", map[string]any{"message": "/" + piMCPSyncCommand}, nil)
	if err != nil {
		return fmt.Errorf("Pi MCP sync failed: %w", err)
	}
	var handled struct {
		Disposition string `json:"disposition"`
	}
	_ = json.Unmarshal(reply.Data, &handled)
	if handled.Disposition != "handled" {
		return fmt.Errorf("Pi MCP sync was not handled (disposition %q)", handled.Disposition)
	}
	select {
	case verdict := <-verdictCh:
		if !verdict.OK {
			if verdict.Error == "" {
				return errors.New("Pi MCP sync failed")
			}
			return fmt.Errorf("Pi MCP sync failed: %s", verdict.Error)
		}
		return nil
	default:
		return errors.New("Pi MCP sync completed without a verdict")
	}
}
