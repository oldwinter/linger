package state_test

import (
	"context"
	"strings"
	"testing"

	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestAppStorePairRotateDiagnosticsAndUnpair(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	dir := t.TempDir()
	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     dir,
	})
	defer store.Disconnect()

	// Probe TOFU and pair with 6-digit PIN over TLS 1.3.
	ctx := context.Background()
	tofu, err := store.ProbePINHost(ctx, srv.URL, false)
	if err != nil {
		t.Fatalf("ProbePINHost: %v", err)
	}
	if tofu.ShortCode != srv.ShortCode {
		t.Fatalf("ShortCode = %q, want %q", tofu.ShortCode, srv.ShortCode)
	}

	prof, err := store.PairWithPIN(ctx, srv.URL, srv.PairPIN, tofu.ObservedFingerprint, false)
	if err != nil {
		t.Fatalf("PairWithPIN: %v", err)
	}
	if prof.ID != srv.HostID || !prof.TLS {
		t.Fatalf("unexpected paired profile: %+v", prof)
	}

	snap := store.Snapshot()
	if snap.Phase != state.PhaseConnected || len(snap.Rooms) != 1 || len(snap.WorkItems) != 1 || len(snap.Documents) != 1 {
		t.Fatalf("expected hydrated live workspace, got phase=%s rooms=%d wi=%d docs=%d",
			snap.Phase, len(snap.Rooms), len(snap.WorkItems), len(snap.Documents))
	}

	// Diagnostics must never leak tokens or pairing codes.
	diag := store.DiagnosticsText()
	if !strings.Contains(diag, srv.ShortCode) {
		t.Fatalf("expected diagnostics to include short TLS fingerprint %q:\n%s", srv.ShortCode, diag)
	}
	if strings.Contains(diag, srv.ValidToken) || strings.Contains(diag, srv.PairPIN) || strings.Contains(diag, srv.PairCode) {
		t.Fatalf("diagnostics leaked sensitive secret:\n%s", diag)
	}

	// Rotate device token.
	if err := store.RotateActiveToken(ctx); err != nil {
		t.Fatalf("RotateActiveToken: %v", err)
	}
	rotatedSecret, err := cfgStore.LoadSecret(prof.ID)
	if err != nil || !strings.HasSuffix(rotatedSecret, "_rot") {
		t.Fatalf("expected rotated secret persisted, got %q (%v)", rotatedSecret, err)
	}

	// Unpair host removes profile and disconnects.
	if err := store.UnpairHost(ctx, prof.ID); err != nil {
		t.Fatalf("UnpairHost: %v", err)
	}
	if len(store.Snapshot().Hosts) != 0 || store.Snapshot().Phase != state.PhaseDisconnected {
		t.Fatalf("expected disconnected empty hosts after unpair, got %+v", store.Snapshot())
	}
}

func TestAppStoreDirectLoginAndOfflineCacheHydration(t *testing.T) {
	srv, err := testutil.NewFakeServer(false)
	if err != nil {
		t.Fatalf("NewFakeServer(false): %v", err)
	}
	defer srv.Close()

	dir := t.TempDir()
	prefs := config.NewMemoryPreferencesBackend()
	secrets := config.NewMemorySecretsBackend()
	store := state.NewAppStore(state.Options{
		ConfigStore: config.NewStore(prefs, secrets),
		DataDir:     dir,
	})
	prof, err := store.LoginDirect(context.Background(), srv.URL, "alex@linger.dev", "linger-pass", true)
	if err != nil {
		t.Fatalf("LoginDirect: %v", err)
	}
	if prof.Mode != config.HostModeDirect || len(store.Snapshot().Rooms) != 1 {
		t.Fatalf("expected direct host with synced rooms, got %+v", prof)
	}
	store.Disconnect()

	// Shut down server and reconnect with a new store -> offline SQLite cache must still hydrate rooms & work items!
	srv.Close()
	store2 := state.NewAppStore(state.Options{
		ConfigStore: config.NewStore(prefs, secrets),
		DataDir:     dir,
	})
	defer store2.Disconnect()
	_ = store2.ConnectHost(context.Background(), prof.ID)
	snap2 := store2.Snapshot()
	if len(snap2.Rooms) != 1 || len(snap2.WorkItems) != 1 {
		t.Fatalf("expected offline SQLite cache hydration after server closed, got rooms=%d wi=%d", len(snap2.Rooms), len(snap2.WorkItems))
	}
}
