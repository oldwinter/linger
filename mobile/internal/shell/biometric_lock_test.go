package shell

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestBiometricLockFailsClosedOnUnsupportedHardware(t *testing.T) {
	cfg := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	_ = cfg.SetPreferences(config.AppPreferences{BiometricLock: true})
	store := state.NewAppStore(state.Options{
		ConfigStore: cfg,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()

	appShell := New(store, func() bool { return false })
	defer appShell.Close()
	appShell.authenticateFn = func(_ context.Context, _ string) error {
		return errors.ErrUnsupported
	}

	tt := testutil.NewPhoneTester(appShell.View, testutil.StandardMobileViewports[1])
	tt.Frame()
	if !store.Snapshot().BiometricLocked {
		t.Fatal("expected shell to start locked when BiometricLock preference is enabled")
	}

	if err := tt.Click("Unlock"); err != nil {
		t.Fatalf("click Unlock: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		tt.Frame()
		if tt.HasText("Disable Biometric Lock") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Must remain LOCKED rather than failing open on ErrUnsupported!
	if !store.Snapshot().BiometricLocked {
		t.Fatal("expected BiometricLock to fail closed when biometrics returns ErrUnsupported")
	}
	if !tt.HasText("Disable Biometric Lock") {
		t.Fatalf("expected explicit recovery action when biometrics unsupported, texts=%v", tt.Texts())
	}

	// Explicit confirmation disables Biometric Lock and unlocks.
	if err := tt.Click("Disable Biometric Lock"); err != nil {
		t.Fatalf("click Disable Biometric Lock: %v", err)
	}
	tt.Frame()
	if store.Snapshot().BiometricLocked {
		t.Fatal("expected unlock after explicit Disable Biometric Lock confirmation")
	}
	if store.Snapshot().Prefs.BiometricLock {
		t.Fatal("expected BiometricLock preference persisted as false")
	}
}
