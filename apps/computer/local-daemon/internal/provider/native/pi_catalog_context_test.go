package native

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

type triggeredDeadlineContext struct {
	context.Context
	mu     sync.Mutex
	done   chan struct{}
	closed bool
	cause  error
}

func newTriggeredDeadlineContext(parent context.Context, cause error) *triggeredDeadlineContext {
	return &triggeredDeadlineContext{
		Context: parent,
		done:    make(chan struct{}),
		cause:   cause,
	}
}

func (c *triggeredDeadlineContext) trigger() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.done)
	}
}

func (c *triggeredDeadlineContext) Done() <-chan struct{} {
	return c.done
}

func (c *triggeredDeadlineContext) Err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return c.cause
	}
	return c.Context.Err()
}

func TestPiCatalogPreservesContextCauseAfterChildCleanup(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses a POSIX shell")
	}
	for _, kind := range []string{"deadline", "cancel"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			program := filepath.Join(root, "pi")
			pidFile := filepath.Join(root, "pid")
			script := "#!/bin/sh\necho $$ > \"$HOME/pid.tmp\" && mv \"$HOME/pid.tmp\" \"$HOME/pid\"\nexec /bin/sleep 60\n"
			if err := os.WriteFile(program, []byte(script), 0700); err != nil {
				t.Fatal(err)
			}
			var runCtx context.Context
			var trigger func()
			want := context.DeadlineExceeded
			if kind == "cancel" {
				want = context.Canceled
				ctx, cancel := context.WithCancelCause(t.Context())
				defer cancel(nil)
				runCtx = ctx
				trigger = func() { cancel(errors.New("secret-cancel-cause")) }
			} else {
				ctx := newTriggeredDeadlineContext(t.Context(), fmt.Errorf("%w: secret-deadline-cause", context.DeadlineExceeded))
				runCtx = ctx
				trigger = ctx.trigger
			}
			done := make(chan error, 1)
			go func() {
				_, err := DiscoverPiModels(runCtx, NewInvocation(program, nil).WithEnvironment(map[string]string{"HOME": root}))
				done <- err
			}()
			var encoded []byte
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				if data, err := os.ReadFile(pidFile); err == nil && strings.HasSuffix(string(data), "\n") {
					encoded = data
					break
				}
				select {
				case err := <-done:
					t.Fatalf("catalog child exited before starting: %v", err)
				case <-time.After(5 * time.Millisecond):
				}
			}
			if len(encoded) == 0 {
				t.Fatal("catalog child did not start")
			}
			trigger()
			err := <-done
			if !errors.Is(err, want) || strings.Contains(err.Error(), "secret") {
				t.Fatalf("context cause lost or disclosed: %v", err)
			}
			pid, err := strconv.Atoi(strings.TrimSpace(string(encoded)))
			if err != nil {
				t.Fatal(err)
			}
			child, err := os.FindProcess(pid)
			if err != nil {
				t.Fatal(err)
			}
			defer child.Release()
			if child.Signal(syscall.Signal(0)) == nil {
				t.Fatal("catalog child survived cancellation")
			}
		})
	}
}

func TestPiCatalogMasksNonContextFailure(t *testing.T) {
	inv := fixtureInvocation(t, "print", map[string]string{"FIXTURE_STDOUT": "secret-output", "FIXTURE_EXIT": "1"})
	_, err := DiscoverPiModels(t.Context(), inv)
	if !errors.Is(err, errPiNoModels) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("unsafe catalog failure: %v", err)
	}
}
