package localmodels

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/process"
	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

// Defaults for Options left zero.
const (
	defaultProgressInterval      = 2 * time.Second
	defaultStatusTimeout         = 2 * time.Minute
	defaultActionTimeout         = 15 * time.Minute
	defaultEnsurePiTimeout       = 24 * time.Minute
	defaultEnsurePiRetryInterval = 30 * time.Second
	maxEnsurePiRetryInterval     = 5 * time.Minute
	// maxRereadInterval bounds the backoff of status reads after failures.
	maxRereadInterval = time.Minute
	tailPollInterval  = 100 * time.Millisecond
	maxEventLine      = 1 << 20
)

// Options configures a Library.
type Options struct {
	// Tool is nil on a Computer the installer gave no localmodels tool.
	Tool *Tool
	// Environment is the base process environment of every tool call.
	Environment map[string]string
	// JobDirectory holds the output file of each running download or load.
	JobDirectory string
	// HarnessDirectory holds the on-demand Pi runtime provisioned when a
	// local model is loaded on a Computer without Pi.
	HarnessDirectory string
	// NodePath is an optional local Node executable passed via --node to harness plan.
	NodePath string
	// Publish receives every new snapshot, in order. It is called only from
	// Act and Refresh and the jobs they start.
	Publish func(wire.LocalModelsSnapshot)
	// RuntimeChanged is told that a model was loaded or unloaded, which
	// changes the model list Pi reports.
	RuntimeChanged func()
	// ProgressInterval bounds how often job progress is published.
	ProgressInterval      time.Duration
	StatusTimeout         time.Duration
	ActionTimeout         time.Duration
	EnsurePiTimeout       time.Duration
	EnsurePiRetryInterval time.Duration
}

// Library runs the localmodels tool for one Computer.
//
// Acknowledgement: an action is refused when the tool refuses it, and the
// tool validates every precondition before it starts work. A download or
// load therefore runs as a child process whose first event line decides the
// answer: a progress or result line means the tool passed validation and
// recorded its job (accepted); an error line before any progress is the
// refusal, with the tool's code and structured fields; an exit without any
// event is TOOL_FAILED. unload, remove and cancel are answered when the tool
// finishes. When the command's expiry passes before the tool decides, the
// Library gives no answer (the requester reports the action as unconfirmed)
// and the outcome reaches the owner only through snapshots.
//
// Jobs outlive the Daemon: the child runs in its own process group and
// writes to a file, not a pipe, so a Daemon restart neither signals it nor
// breaks its output. A restarted Daemon trusts `library status`, which
// reads the job records localmodels keeps on disk, and polls it while a job
// it did not start is running.
type Library struct {
	tool                  *Tool
	environment           map[string]string
	jobDirectory          string
	harnessDirectory      string
	nodePath              string
	publish               func(wire.LocalModelsSnapshot)
	runtimeChanged        func()
	progressInterval      time.Duration
	statusTimeout         time.Duration
	actionTimeout         time.Duration
	ensurePiTimeout       time.Duration
	ensurePiRetryInterval time.Duration
	now                   func() time.Time
	ctx                   context.Context
	stop                  context.CancelFunc

	// refreshMu serializes status reads so an older read never replaces a
	// newer one.
	refreshMu sync.Mutex
	// publishMu orders updates of current with their Publish calls.
	publishMu sync.Mutex
	piWg      sync.WaitGroup
	mu        sync.Mutex
	closed    bool
	current   *wire.LocalModelsSnapshot
	// loaded identifies the loaded models of the last status read; nil
	// before the first one.
	loaded       *string
	piExecutable string
	piEnsuring   bool
	piFailures   int
	piRetryAt    time.Time
	jobs         map[string]*job
	// causes holds, by model, the cause the last job's error line gave. The
	// tool's status keeps only the code, so each read puts the cause back on
	// a row that still fails with that code.
	causes        map[string]*wire.LocalModelError
	lastProgress  time.Time
	progressTimer *time.Timer
	// progressTimerID tells a timer callback that already fired whether it
	// is still the pending one.
	progressTimerID uint64
	polling         bool
}

type job struct {
	action Action
}

// New returns a Library. Close stops its supervision; jobs keep running.
func New(options Options) *Library {
	ctx, stop := context.WithCancel(context.Background())
	library := &Library{
		tool: options.Tool, environment: options.Environment, jobDirectory: options.JobDirectory,
		harnessDirectory: options.HarnessDirectory, nodePath: options.NodePath,
		publish: options.Publish, runtimeChanged: options.RuntimeChanged,
		progressInterval: options.ProgressInterval, statusTimeout: options.StatusTimeout, actionTimeout: options.ActionTimeout,
		ensurePiTimeout: options.EnsurePiTimeout, ensurePiRetryInterval: options.EnsurePiRetryInterval,
		now: time.Now, ctx: ctx, stop: stop, jobs: make(map[string]*job), causes: make(map[string]*wire.LocalModelError),
	}
	if library.progressInterval <= 0 {
		library.progressInterval = defaultProgressInterval
	}
	if library.statusTimeout <= 0 {
		library.statusTimeout = defaultStatusTimeout
	}
	if library.actionTimeout <= 0 {
		library.actionTimeout = defaultActionTimeout
	}
	if library.ensurePiTimeout <= 0 {
		library.ensurePiTimeout = defaultEnsurePiTimeout
	}
	if library.ensurePiRetryInterval <= 0 {
		library.ensurePiRetryInterval = defaultEnsurePiRetryInterval
	}
	if library.publish == nil {
		library.publish = func(wire.LocalModelsSnapshot) {}
	}
	if library.runtimeChanged == nil {
		library.runtimeChanged = func() {}
	}
	if library.jobDirectory != "" {
		// Output files of jobs a previous Daemon started are no longer read.
		_ = os.RemoveAll(library.jobDirectory)
	}
	return library
}

// Close stops reading job output and polling. Running jobs continue.
func (l *Library) Close() {
	l.stop()
	l.mu.Lock()
	l.closed = true
	if l.progressTimer != nil {
		l.progressTimer.Stop()
	}
	l.mu.Unlock()
	l.piWg.Wait()
}

// PiExecutable returns the managed Pi executable provisioned for local
// models, or an empty string when none has been resolved.
func (l *Library) PiExecutable() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.piExecutable
}

// PiProvisionFailed reports whether automatic Pi setup has failed and not yet
// recovered, so Runtime diagnostics can surface an error instead of leaving Pi
// in not_installed indefinitely.
func (l *Library) PiProvisionFailed() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.piExecutable == "" && !l.piEnsuring && l.piFailures > 0
}

func (l *Library) scheduleEnsurePi() {
	if l.harnessDirectory == "" || l.tool == nil || !l.tool.installed() {
		return
	}
	l.mu.Lock()
	now := l.now()
	if l.closed || l.ctx.Err() != nil || l.piExecutable != "" || l.piEnsuring || (!l.piRetryAt.IsZero() && now.Before(l.piRetryAt)) {
		l.mu.Unlock()
		return
	}
	l.piEnsuring = true
	l.piWg.Add(1)
	l.mu.Unlock()

	go func() {
		defer l.piWg.Done()
		ctx, cancel := context.WithTimeout(l.ctx, l.ensurePiTimeout)
		executable, err := l.tool.EnsurePi(ctx, l.environment, l.harnessDirectory, l.nodePath)
		cancel()

		l.mu.Lock()
		l.piEnsuring = false
		if l.closed || l.ctx.Err() != nil {
			l.mu.Unlock()
			return
		}
		if err == nil && executable != "" {
			l.piExecutable = executable
			l.piFailures = 0
			l.piRetryAt = time.Time{}
			l.mu.Unlock()
			slog.Info("local_models.pi_ready", "executable", executable)
			l.runtimeChanged()
			return
		}
		l.piFailures++
		firstFailure := l.piFailures == 1
		backoff := min(l.ensurePiRetryInterval<<min(l.piFailures-1, 4), maxEnsurePiRetryInterval)
		l.piRetryAt = l.now().Add(backoff)
		l.mu.Unlock()
		if err != nil {
			slog.Warn("local_models.pi_install_failed", "error", err, "retry_in", backoff)
		}
		if firstFailure {
			l.runtimeChanged()
		}
	}()
}

// Refresh reads the library now, publishes the snapshot and returns it.
func (l *Library) Refresh(ctx context.Context) wire.LocalModelsSnapshot {
	l.refreshMu.Lock()
	snapshot := l.read(ctx)
	if ctx.Err() != nil {
		// A read cut short by its caller says nothing about the library.
		l.refreshMu.Unlock()
		return snapshot
	}
	changed := false
	hasLoaded := false
	l.mu.Lock()
	if snapshot.Available {
		key := loadedKey(snapshot)
		hasLoaded = key != ""
		changed = l.loaded != nil && *l.loaded != key
		l.loaded = &key
	}
	l.mu.Unlock()
	l.commit(snapshot)
	// localmodels registers a loaded model with Pi and unregisters it on
	// unload; the Runtime diagnostics must be read again to list it.
	if changed {
		l.runtimeChanged()
	}
	l.reconcile(snapshot)
	l.refreshMu.Unlock()
	if hasLoaded {
		l.scheduleEnsurePi()
	}
	return cloneSnapshot(snapshot)
}

func (l *Library) read(ctx context.Context) wire.LocalModelsSnapshot {
	if l.tool == nil || !l.tool.installed() {
		return unavailable(CodeToolNotInstalled, "", l.now())
	}
	ctx, cancel := context.WithTimeout(ctx, l.statusTimeout)
	defer cancel()
	stdout, exitCode, err := l.runOnce(ctx, Action{Name: ActionRefresh})
	if err != nil || exitCode != 0 {
		slog.Warn("local_models.status_failed", "exit_code", exitCode, "error", err)
		return unavailable(CodeToolFailed, "localmodels did not report its library status", l.now())
	}
	snapshot, err := mapStatus(stdout, l.now())
	if err != nil {
		slog.Warn("local_models.status_invalid", "error", err)
		return unavailable(CodeToolFailed, "localmodels reported a library status outside its contract", l.now())
	}
	l.restoreCauses(&snapshot)
	return snapshot
}

// restoreCauses puts each kept cause back on its failed row, and forgets one
// whose row no longer fails with the code it came with.
func (l *Library) restoreCauses(snapshot *wire.LocalModelsSnapshot) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for id, cause := range l.causes {
		index := slices.IndexFunc(snapshot.Models, func(model wire.LocalModel) bool { return model.ID == id })
		if index < 0 || snapshot.Models[index].Error == nil || snapshot.Models[index].Error.Code != cause.Code {
			delete(l.causes, id)
			continue
		}
		snapshot.Models[index].Error.Cause, snapshot.Models[index].Error.Path = cause.Cause, cause.Path
	}
}

// loadedKey names the loaded models; a change means Pi's model list changed.
func loadedKey(snapshot wire.LocalModelsSnapshot) string {
	var loaded []string
	for _, model := range snapshot.Models {
		if model.State == "loaded" {
			loaded = append(loaded, model.ID)
		}
	}
	sort.Strings(loaded)
	return strings.Join(loaded, "\x01")
}

func (l *Library) commit(snapshot wire.LocalModelsSnapshot) {
	l.publishMu.Lock()
	defer l.publishMu.Unlock()
	l.mu.Lock()
	l.current = &snapshot
	l.mu.Unlock()
	// Progress lines edit current in place; receivers get their own copy.
	l.publish(cloneSnapshot(snapshot))
}

// Act starts one action and returns the tool's answer: accepted (nil) or
// its refusal. deadline is when the requester stops waiting. When it passes
// before the tool has decided, answered is false: the Daemon does not guess
// an answer, the requester reports the action as unconfirmed, and the
// outcome reaches the owner through the snapshots published once the tool
// decides.
func (l *Library) Act(ctx context.Context, action Action, deadline time.Time) (refusal *wire.LocalModelActionRefusal, answered bool) {
	if l.tool == nil || !l.tool.installed() {
		if action.Name == ActionRefresh {
			l.Refresh(ctx)
		}
		return &wire.LocalModelActionRefusal{Code: CodeToolNotInstalled}, true
	}
	switch action.Name {
	case ActionRefresh:
		if snapshot := l.Refresh(ctx); !snapshot.Available {
			return &wire.LocalModelActionRefusal{Code: snapshot.Reason.Code, Detail: snapshot.Reason.Detail}, true
		}
		return nil, true
	case ActionDownload, ActionLoad:
		l.mu.Lock()
		known := l.current != nil
		l.mu.Unlock()
		if !known {
			// Progress lines update the last snapshot; read one first.
			l.Refresh(ctx)
		}
		return l.startJob(ctx, action, deadline)
	case ActionUnload, ActionRemove, ActionCancel:
		return l.runAction(ctx, action, deadline)
	}
	return &wire.LocalModelActionRefusal{Code: CodeToolFailed, Detail: "unknown local model action"}, true
}

// runOnce runs a call that prints one JSON document and returns its stdout.
// Output goes to files and a timeout kills only the tool itself: a call may
// start or restart a long-lived server (the local model gateway) that
// inherits its output and process group, and that server must survive.
func (l *Library) runOnce(ctx context.Context, action Action) ([]byte, int, error) {
	output, stderrBytes, exitCode, err := l.tool.runBuffered(ctx, l.environment, l.jobDirectory, "job", maxEventLine, l.tool.arguments(action), nil)
	if exitCode != 0 && len(stderrBytes) > 0 {
		// Local diagnostics only: tool prose can name local paths.
		slog.Debug("local_models.tool_stderr", "action", action.Name, "stderr", string(stderrBytes))
	}
	return output, exitCode, err
}

func readBounded(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, limit))
}

// runAction answers unload, remove and cancel once the tool finishes.
func (l *Library) runAction(ctx context.Context, action Action, deadline time.Time) (*wire.LocalModelActionRefusal, bool) {
	answer := newPendingAnswer()
	go func() {
		runCtx, cancel := context.WithTimeout(l.ctx, l.actionTimeout)
		defer cancel()
		stdout, exitCode, err := l.runOnce(runCtx, action)
		refusal := documentRefusal(stdout, exitCode, err)
		answer.give(refusal)
		slog.Info("local_models.action_finished", "action", action.Name, "model", action.Model,
			"exit_code", exitCode, "refused", refusal != nil)
		switch {
		case refusal == nil:
			l.Refresh(l.ctx)
			if action.Name != ActionCancel {
				l.runtimeChanged()
			}
		case answer.missed():
			// Nobody heard the refusal; the snapshot is how the owner sees
			// that nothing changed.
			l.Refresh(l.ctx)
		}
	}()
	return answer.await(ctx, deadline)
}

// documentRefusal reads the one result or error document of a JSON call.
func documentRefusal(stdout []byte, exitCode int, err error) *wire.LocalModelActionRefusal {
	if err != nil {
		return &wire.LocalModelActionRefusal{Code: CodeToolFailed, Detail: "localmodels did not finish"}
	}
	event, ok := parseEvent(bytes.TrimSpace(stdout))
	switch {
	case ok && event.Event == "result" && exitCode == 0:
		return nil
	case ok && event.Event == "error":
		return event.refusal()
	}
	return &wire.LocalModelActionRefusal{Code: CodeToolFailed, Detail: "localmodels exited without a result"}
}

// pendingAnswer carries the tool's one answer to the requester, who waits
// until its deadline. Whether the answer missed it is recorded, so the side
// that produced the answer knows to make the outcome visible another way.
type pendingAnswer struct {
	answer chan *wire.LocalModelActionRefusal
	late   atomic.Bool
}

func newPendingAnswer() *pendingAnswer {
	return &pendingAnswer{answer: make(chan *wire.LocalModelActionRefusal, 1)}
}

func (p *pendingAnswer) give(refusal *wire.LocalModelActionRefusal) { p.answer <- refusal }

// missed reports whether the requester stopped waiting before the answer.
func (p *pendingAnswer) missed() bool { return p.late.Load() }

func (p *pendingAnswer) await(ctx context.Context, deadline time.Time) (*wire.LocalModelActionRefusal, bool) {
	timer := time.NewTimer(time.Until(deadline))
	defer timer.Stop()
	select {
	case refusal := <-p.answer:
		return refusal, true
	case <-timer.C:
	case <-ctx.Done():
	}
	p.late.Store(true)
	// An answer given at the same moment still counts.
	select {
	case refusal := <-p.answer:
		return refusal, true
	default:
		return nil, false
	}
}

// startJob starts a download or load and answers from its first event.
func (l *Library) startJob(ctx context.Context, action Action, deadline time.Time) (*wire.LocalModelActionRefusal, bool) {
	output, err := l.jobOutput()
	if err != nil {
		slog.Warn("local_models.job_output_failed", "error", err)
		return &wire.LocalModelActionRefusal{Code: CodeToolFailed, Detail: "the Computer could not start localmodels"}, true
	}
	cmd := l.tool.command(l.environment, action)
	cmd.Stdout, cmd.Stderr = output, output
	// Its own process group, outside any job object: the job must outlive
	// this Daemon.
	process.Prepare(cmd)
	if err := cmd.Start(); err != nil {
		_ = output.Close()
		_ = os.Remove(output.Name())
		slog.Warn("local_models.job_start_failed", "action", action.Name, "error", err)
		return &wire.LocalModelActionRefusal{Code: CodeToolFailed, Detail: "the Computer could not start localmodels"}, true
	}
	_ = output.Close()
	slog.Info("local_models.job_started", "action", action.Name, "model", action.Model, "pid", cmd.Process.Pid)
	exited := make(chan int, 1)
	go func() {
		_ = cmd.Wait()
		exited <- cmd.ProcessState.ExitCode()
	}()
	events := make(chan libraryEvent, 64)
	ended := make(chan int, 1)
	go func() { ended <- l.tail(output.Name(), exited, events) }()
	answer := newPendingAnswer()
	go l.superviseJob(action, events, ended, answer)
	return answer.await(ctx, deadline)
}

func (l *Library) jobOutput() (*os.File, error) {
	if err := os.MkdirAll(l.jobDirectory, 0o700); err != nil {
		return nil, err
	}
	name := make([]byte, 12)
	if _, err := rand.Read(name); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(l.jobDirectory, hex.EncodeToString(name)+".jsonl"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
}

// tail reads event lines from the job's output file until the job exits,
// then returns its exit code. It closes events.
func (l *Library) tail(path string, exited <-chan int, events chan<- libraryEvent) int {
	defer close(events)
	defer func() { _ = os.Remove(path) }()
	file, err := os.Open(path)
	if err != nil {
		return <-exited
	}
	defer file.Close()
	reader := bufio.NewReader(file)
	var pending []byte
	drain := func() {
		for {
			chunk, err := reader.ReadBytes('\n')
			pending = append(pending, chunk...)
			if len(pending) > maxEventLine {
				pending = nil
			}
			if err != nil {
				return
			}
			if event, ok := parseEvent(bytes.TrimSpace(pending)); ok {
				events <- event
			}
			pending = nil
		}
	}
	ticker := time.NewTicker(tailPollInterval)
	defer ticker.Stop()
	for {
		drain()
		select {
		case code := <-exited:
			drain()
			if event, ok := parseEvent(bytes.TrimSpace(pending)); ok {
				events <- event
			}
			return code
		case <-l.ctx.Done():
			return -1
		case <-ticker.C:
		}
	}
}

// superviseJob answers the action from its first event, then follows the
// job to its end.
func (l *Library) superviseJob(action Action, events <-chan libraryEvent, ended <-chan int, answer *pendingAnswer) {
	answered := false
	accepted := false
	reply := func(refusal *wire.LocalModelActionRefusal) {
		if !answered {
			answered, accepted = true, refusal == nil
			answer.give(refusal)
			if accepted {
				l.mu.Lock()
				l.jobs[action.Model] = &job{action: action}
				delete(l.causes, action.Model)
				l.mu.Unlock()
			}
		}
	}
	var final *libraryEvent
	phase := ""
	for event := range events {
		switch event.Event {
		case "progress":
			reply(nil)
			if event.Phase != phase {
				phase = event.Phase
				l.phaseStarted(event)
			} else {
				l.progress(event)
			}
		case "result":
			reply(nil)
			final = &event
		case "error":
			reply(event.refusal())
			final = &event
		}
	}
	exitCode := <-ended
	if l.ctx.Err() != nil {
		return
	}
	if !answered {
		slog.Warn("local_models.job_without_events", "action", action.Name, "model", action.Model, "exit_code", exitCode)
		reply(&wire.LocalModelActionRefusal{Code: CodeToolFailed, Detail: "localmodels exited without a result"})
	}
	outcome := "failed"
	if final != nil && final.Event == "result" {
		outcome = "succeeded"
	} else if final != nil {
		outcome = final.Code
	}
	slog.Info("local_models.job_finished", "action", action.Name, "model", action.Model,
		"exit_code", exitCode, "outcome", outcome, "accepted", accepted)
	if !accepted {
		if answer.missed() {
			// Nobody heard the refusal; the snapshot is how the owner sees
			// that nothing changed.
			l.Refresh(l.ctx)
		}
		return
	}
	l.mu.Lock()
	delete(l.jobs, action.Model)
	if final != nil && final.Event == "error" {
		if cause := final.cause(); cause != nil {
			l.causes[action.Model] = cause
		}
	}
	l.mu.Unlock()
	l.Refresh(l.ctx)
	if action.Name == ActionLoad {
		l.runtimeChanged()
	}
}

// phaseStarted rereads the library when a supervised job enters a phase.
// localmodels records what a phase reserves or frees (pool use and holders,
// the placement, models unloaded first) only in its status, which progress
// lines do not carry; the job's own line is newer than that status, so it is
// applied on top. A failed read keeps the last library with only the line
// applied, and hands the failed observation to reconcile, which rereads
// with backoff until a read succeeds: the job may stay in this phase for
// minutes, so recovery must not wait for its next phase.
func (l *Library) phaseStarted(event libraryEvent) {
	l.refreshMu.Lock()
	snapshot := l.read(l.ctx)
	l.refreshMu.Unlock()
	if l.ctx.Err() != nil {
		return
	}
	if !snapshot.Available {
		l.progress(event)
		l.reconcile(snapshot)
		return
	}
	applyProgress(&snapshot, event)
	l.publishMu.Lock()
	l.mu.Lock()
	key := loadedKey(snapshot)
	changed := l.loaded != nil && *l.loaded != key
	l.loaded = &key
	l.current = &snapshot
	l.publishThrottledLocked()
	l.mu.Unlock()
	l.publishMu.Unlock()
	// A model unloaded first leaves Pi's catalog.
	if changed {
		l.runtimeChanged()
	}
}

// progress applies a progress line to the current snapshot and publishes
// it, at most once per progress interval; the last line of a burst is
// published when the interval ends.
func (l *Library) progress(event libraryEvent) {
	l.publishMu.Lock()
	defer l.publishMu.Unlock()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.current == nil || !applyProgress(l.current, event) {
		return
	}
	l.publishThrottledLocked()
}

// publishThrottledLocked publishes current now, or when the progress
// interval since the last publish ends. It runs with publishMu and mu held.
func (l *Library) publishThrottledLocked() {
	wait := l.progressInterval - l.now().Sub(l.lastProgress)
	if wait <= 0 {
		l.publishProgressLocked()
		return
	}
	if l.progressTimer == nil {
		l.progressTimerID++
		id := l.progressTimerID
		l.progressTimer = time.AfterFunc(wait, func() { l.flushProgress(id) })
	}
}

func (l *Library) flushProgress(id uint64) {
	l.publishMu.Lock()
	defer l.publishMu.Unlock()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.ctx.Err() != nil || l.current == nil || l.progressTimer == nil || l.progressTimerID != id {
		return
	}
	l.publishProgressLocked()
}

// publishProgressLocked runs with publishMu and mu held.
func (l *Library) publishProgressLocked() {
	if l.progressTimer != nil {
		l.progressTimer.Stop()
		l.progressTimer = nil
	}
	l.lastProgress = l.now()
	snapshot := cloneSnapshot(*l.current)
	l.publish(snapshot)
}

// applyProgress moves the progress line's model into downloading or
// loading. It reports whether the snapshot changed.
func applyProgress(snapshot *wire.LocalModelsSnapshot, event libraryEvent) bool {
	id := event.modelID()
	for index := range snapshot.Models {
		model := &snapshot.Models[index]
		if model.ID != id {
			continue
		}
		switch event.Phase {
		case "download", "verify":
			progress := &wire.LocalModelDownloadProgress{
				Step: event.Phase, DoneBytes: bytesValue(event.Done), TotalBytes: bytesValue(event.Total),
			}
			if event.Phase == "download" {
				rate := bytesValue(event.BytesPerSecond)
				progress.BytesPerSecond = &rate
			}
			model.State, model.Download, model.Endpoint, model.Error, model.Note = "downloading", progress, nil, nil, nil
		case "load", "warm":
			model.State, model.Download, model.Endpoint, model.Error, model.Note = "loading", nil, nil, nil, nil
		default:
			return false
		}
		return true
	}
	return false
}

func cloneSnapshot(snapshot wire.LocalModelsSnapshot) wire.LocalModelsSnapshot {
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return snapshot
	}
	var clone wire.LocalModelsSnapshot
	if json.Unmarshal(encoded, &clone) != nil {
		return snapshot
	}
	return clone
}

// reconcile rereads the library while the last read cannot be trusted to
// be followed by a report of its own: a download or load this Daemon is not
// supervising (one a previous Daemon started) runs, or the read failed. A
// failed read is retried with backoff instead of ending the watch; the loop
// ends only after a successful read with nothing to follow, or on Close.
func (l *Library) reconcile(snapshot wire.LocalModelsSnapshot) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.polling || !l.needsRereadLocked(snapshot) {
		return
	}
	l.polling = true
	go func() {
		delay := l.progressInterval
		for {
			select {
			case <-l.ctx.Done():
				return
			case <-time.After(delay):
			}
			next := l.Refresh(l.ctx)
			l.mu.Lock()
			if !l.needsRereadLocked(next) {
				l.polling = false
				l.mu.Unlock()
				return
			}
			l.mu.Unlock()
			if next.Available {
				delay = l.progressInterval
			} else {
				delay = min(2*delay, maxRereadInterval)
			}
		}
	}()
}

func (l *Library) needsRereadLocked(snapshot wire.LocalModelsSnapshot) bool {
	if !snapshot.Available {
		// A missing tool stays missing until the installer changes the
		// Computer config, which restarts the Daemon.
		return snapshot.Reason != nil && snapshot.Reason.Code == CodeToolFailed
	}
	return l.hasAdoptedJobLocked(snapshot)
}

func (l *Library) hasAdoptedJobLocked(snapshot wire.LocalModelsSnapshot) bool {
	for _, model := range snapshot.Models {
		if model.State != "downloading" && model.State != "loading" {
			continue
		}
		if _, supervised := l.jobs[model.ID]; !supervised {
			return true
		}
	}
	return false
}
