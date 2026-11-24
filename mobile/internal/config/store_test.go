package config

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestStoreHostAndSecretLifecycle(t *testing.T) {
	prefs := NewMemoryPreferencesBackend()
	secrets := NewMemorySecretsBackend()
	store := NewStore(prefs, secrets)

	h1 := HostProfile{
		ID:             "host_macbook_01",
		Name:           "MacBook Pro",
		Mode:           HostModeCompanion,
		PrimaryURL:     "https://192.168.1.42:48210/",
		TailscaleURL:   "https://100.64.1.8:48210/",
		TLS:            true,
		TLSFingerprint: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
		DeviceID:       "dev_ios_1",
		TenantID:       "ten_1",
		SessionMode:    "dedicated",
		AddedAt:        time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC),
	}
	if err := store.UpsertHost(h1); err != nil {
		t.Fatalf("UpsertHost: %v", err)
	}
	if err := store.SaveSecret(h1.ID, "lmc_secret_token_abc"); err != nil {
		t.Fatalf("SaveSecret: %v", err)
	}
	if err := store.SetActiveHost(h1.ID); err != nil {
		t.Fatalf("SetActiveHost: %v", err)
	}

	got, ok := store.ActiveHost()
	if !ok {
		t.Fatal("expected active host")
	}
	if got.PrimaryURL != "https://192.168.1.42:48210" {
		t.Fatalf("expected trimmed PrimaryURL, got %q", got.PrimaryURL)
	}
	if got.TailscaleURL != "https://100.64.1.8:48210" {
		t.Fatalf("expected trimmed TailscaleURL, got %q", got.TailscaleURL)
	}

	tok, err := store.LoadSecret(h1.ID)
	if err != nil {
		t.Fatalf("LoadSecret: %v", err)
	}
	if tok != "lmc_secret_token_abc" {
		t.Fatalf("unexpected token: %q", tok)
	}

	// Reload from backend to verify persistence.
	reloaded := NewStore(prefs, secrets)
	if len(reloaded.Hosts()) != 1 {
		t.Fatalf("expected 1 host after reload, got %d", len(reloaded.Hosts()))
	}
	if ah, ok := reloaded.ActiveHost(); !ok || ah.ID != h1.ID {
		t.Fatalf("expected active host %q after reload, got %+v (%v)", h1.ID, ah, ok)
	}

	// Add a second host and remove the first; active host should move to second.
	h2 := HostProfile{
		ID:         "host_remote_02",
		Name:       "TeamHub Cloud",
		Mode:       HostModeDirect,
		PrimaryURL: "https://linger.example.com",
		TLS:        true,
	}
	if err := reloaded.UpsertHost(h2); err != nil {
		t.Fatalf("UpsertHost h2: %v", err)
	}
	if err := reloaded.RemoveHost(h1.ID); err != nil {
		t.Fatalf("RemoveHost h1: %v", err)
	}
	if _, err := reloaded.LoadSecret(h1.ID); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("expected ErrSecretNotFound after RemoveHost, got %v", err)
	}
	if ah, ok := reloaded.ActiveHost(); !ok || ah.ID != h2.ID {
		t.Fatalf("expected fallback active host %q, got %+v (%v)", h2.ID, ah, ok)
	}
}

func TestFileBackendsPersistence(t *testing.T) {
	dir := t.TempDir()
	prefs := NewFilePreferencesBackend(filepath.Join(dir, "preferences.json"))
	secrets := NewFileSecretsBackend(filepath.Join(dir, "secrets.json"))

	store := NewStore(prefs, secrets)
	if err := store.SetPreferences(AppPreferences{
		Theme:         ThemeDark,
		BiometricLock: true,
		CompactMode:   true,
	}); err != nil {
		t.Fatalf("SetPreferences: %v", err)
	}
	if err := store.UpsertHost(HostProfile{
		ID:         "host_file_1",
		Name:       "Office Mac",
		Mode:       HostModeCompanion,
		PrimaryURL: "https://10.0.0.5:48210",
		TLS:        true,
	}); err != nil {
		t.Fatalf("UpsertHost: %v", err)
	}
	if err := store.SaveSecret("host_file_1", "lmc_persisted"); err != nil {
		t.Fatalf("SaveSecret: %v", err)
	}

	// Open brand new backend instances against same files.
	store2 := NewStore(
		NewFilePreferencesBackend(filepath.Join(dir, "preferences.json")),
		NewFileSecretsBackend(filepath.Join(dir, "secrets.json")),
	)
	p := store2.Preferences()
	if p.Theme != ThemeDark || !p.BiometricLock || !p.CompactMode {
		t.Fatalf("unexpected reloaded preferences: %+v", p)
	}
	if _, ok := store2.Host("host_file_1"); !ok {
		t.Fatal("expected host_file_1 after file reload")
	}
	tok, err := store2.LoadSecret("host_file_1")
	if err != nil || tok != "lmc_persisted" {
		t.Fatalf("unexpected reloaded secret: %q (%v)", tok, err)
	}
}
