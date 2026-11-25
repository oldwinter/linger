// Package config stores saved host profiles, app preferences, and credential
// secrets through injectable storage backends.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/preferences"
)

const (
	prefsHostsKey = "linger.hosts.v1"
	prefsAppKey   = "linger.preferences.v1"
	secretService = "dev.oldwinter.lingerx.mobile"
)

// ErrSecretNotFound is returned when no secret is stored for a host.
var ErrSecretNotFound = errors.New("config: secret not found")

// HostMode distinguishes Companion Gateway hosts from direct TeamHub logins.
type HostMode string

const (
	// HostModeCompanion authenticates with a per-device Bearer token to Desktop's Companion Gateway.
	HostModeCompanion HostMode = "companion"
	// HostModeDirect authenticates directly to TeamHub with a session cookie.
	HostModeDirect HostMode = "direct"
)

// ThemePreference controls whether the app follows the OS theme or forces Light/Dark.
type ThemePreference string

const (
	ThemeSystem ThemePreference = "system"
	ThemeLight  ThemePreference = "light"
	ThemeDark   ThemePreference = "dark"
)

// HostProfile describes one saved Desktop Companion or direct TeamHub host.
type HostProfile struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Mode            HostMode  `json:"mode"`
	PrimaryURL      string    `json:"primary_url"`
	TailscaleURL    string    `json:"tailscale_url,omitempty"`
	TLS             bool      `json:"tls"`
	TLSFingerprint  string    `json:"tls_fingerprint,omitempty"`
	AllowPlainHTTP  bool      `json:"allow_plain_http,omitempty"`
	DeviceID        string    `json:"device_id,omitempty"`
	TenantID        string    `json:"tenant_id,omitempty"`
	SessionMode     string    `json:"session_mode,omitempty"`
	DesktopVersion  string    `json:"desktop_version,omitempty"`
	AccountEmail    string    `json:"account_email,omitempty"`
	AddedAt         time.Time `json:"added_at"`
	LastConnectedAt time.Time `json:"last_connected_at,omitempty"`
	LastRTTMs       int       `json:"last_rtt_ms,omitempty"`
}

// AppPreferences stores user-level mobile client settings.
type AppPreferences struct {
	Theme         ThemePreference    `json:"theme"`
	Language      LanguagePreference `json:"language"`
	BiometricLock bool               `json:"biometric_lock"`
	CompactMode   bool               `json:"compact_mode"`
	ActiveHostID  string             `json:"active_host_id,omitempty"`
}

// PreferencesBackend persists non-secret JSON values by key.
type PreferencesBackend interface {
	Get(key string, v any) bool
	Set(key string, v any) error
	Delete(key string) error
}

// SecretsBackend persists sensitive tokens and cookies by key.
type SecretsBackend interface {
	Get(key string) ([]byte, error)
	Set(key string, value []byte) error
	Delete(key string) error
}

// MyGoPreferencesBackend delegates to github.com/egoist/mygo/plugins/preferences.
type MyGoPreferencesBackend struct{}

func (MyGoPreferencesBackend) Get(key string, v any) bool  { return preferences.Get(key, v) }
func (MyGoPreferencesBackend) Set(key string, v any) error { return preferences.Set(key, v) }
func (MyGoPreferencesBackend) Delete(key string) error     { return preferences.Delete(key) }

// MyGoSecretsBackend delegates to OS-backed mygo.Secrets.
type MyGoSecretsBackend struct {
	Service string
}

func (b MyGoSecretsBackend) mod() mygo.SecretsModule {
	svc := b.Service
	if svc == "" {
		svc = secretService
	}
	return mygo.Secrets.Service(svc)
}

func (b MyGoSecretsBackend) Get(key string) ([]byte, error) {
	v, err := b.mod().Get(key)
	if errors.Is(err, mygo.ErrSecretNotFound) {
		return nil, ErrSecretNotFound
	}
	return v, err
}

func (b MyGoSecretsBackend) Set(key string, value []byte) error {
	return b.mod().Set(key, value)
}

func (b MyGoSecretsBackend) Delete(key string) error {
	return b.mod().Delete(key)
}

// FilePreferencesBackend stores preferences in a dedicated JSON file (used for
// desktop preview --data-dir isolation and tests).
type FilePreferencesBackend struct {
	mu     sync.Mutex
	path   string
	loaded bool
	values map[string]json.RawMessage
}

// NewFilePreferencesBackend creates a file-backed preferences store at path.
func NewFilePreferencesBackend(path string) *FilePreferencesBackend {
	return &FilePreferencesBackend{path: path}
}

func (f *FilePreferencesBackend) loadLocked() {
	if f.loaded {
		return
	}
	f.loaded = true
	f.values = map[string]json.RawMessage{}
	data, err := os.ReadFile(f.path)
	if err == nil {
		_ = json.Unmarshal(data, &f.values)
	}
}

func (f *FilePreferencesBackend) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(f.path), 0o700); err != nil && !errors.Is(err, fs.ErrExist) {
		return err
	}
	data, err := json.MarshalIndent(f.values, "", "  ")
	if err != nil {
		return err
	}
	tmp := f.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, f.path)
}

func (f *FilePreferencesBackend) Get(key string, v any) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.loadLocked()
	raw, ok := f.values[key]
	if !ok {
		return false
	}
	return json.Unmarshal(raw, v) == nil
}

func (f *FilePreferencesBackend) Set(key string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.loadLocked()
	f.values[key] = raw
	return f.saveLocked()
}

func (f *FilePreferencesBackend) Delete(key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.loadLocked()
	delete(f.values, key)
	return f.saveLocked()
}

// FileSecretsBackend stores secrets in a mode-0600 file inside an explicit
// preview or test data directory. Never used when an OS keychain is expected.
type FileSecretsBackend struct {
	mu     sync.Mutex
	path   string
	loaded bool
	values map[string]string
}

// NewFileSecretsBackend creates a mode-0600 file-backed secrets store at path.
func NewFileSecretsBackend(path string) *FileSecretsBackend {
	return &FileSecretsBackend{path: path}
}

func (f *FileSecretsBackend) loadLocked() {
	if f.loaded {
		return
	}
	f.loaded = true
	f.values = map[string]string{}
	data, err := os.ReadFile(f.path)
	if err == nil {
		_ = json.Unmarshal(data, &f.values)
	}
}

func (f *FileSecretsBackend) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(f.path), 0o700); err != nil && !errors.Is(err, fs.ErrExist) {
		return err
	}
	data, err := json.MarshalIndent(f.values, "", "  ")
	if err != nil {
		return err
	}
	tmp := f.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, f.path)
}

func (f *FileSecretsBackend) Get(key string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.loadLocked()
	v, ok := f.values[key]
	if !ok {
		return nil, ErrSecretNotFound
	}
	return []byte(v), nil
}

func (f *FileSecretsBackend) Set(key string, value []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.loadLocked()
	f.values[key] = string(value)
	return f.saveLocked()
}

func (f *FileSecretsBackend) Delete(key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.loadLocked()
	delete(f.values, key)
	return f.saveLocked()
}

// MemoryPreferencesBackend is an in-memory PreferencesBackend for unit tests.
type MemoryPreferencesBackend struct {
	mu     sync.Mutex
	values map[string]json.RawMessage
}

func NewMemoryPreferencesBackend() *MemoryPreferencesBackend {
	return &MemoryPreferencesBackend{values: map[string]json.RawMessage{}}
}

func (m *MemoryPreferencesBackend) Get(key string, v any) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	raw, ok := m.values[key]
	if !ok {
		return false
	}
	return json.Unmarshal(raw, v) == nil
}

func (m *MemoryPreferencesBackend) Set(key string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.values[key] = raw
	return nil
}

func (m *MemoryPreferencesBackend) Delete(key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.values, key)
	return nil
}

// MemorySecretsBackend is an in-memory SecretsBackend for unit tests.
type MemorySecretsBackend struct {
	mu     sync.Mutex
	values map[string][]byte
}

func NewMemorySecretsBackend() *MemorySecretsBackend {
	return &MemorySecretsBackend{values: map[string][]byte{}}
}

func (m *MemorySecretsBackend) Get(key string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.values[key]
	if !ok {
		return nil, ErrSecretNotFound
	}
	return slices.Clone(v), nil
}

func (m *MemorySecretsBackend) Set(key string, value []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.values[key] = slices.Clone(value)
	return nil
}

func (m *MemorySecretsBackend) Delete(key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.values, key)
	return nil
}

// Store manages saved HostProfiles, AppPreferences, and host secrets.
type Store struct {
	mu      sync.RWMutex
	prefs   PreferencesBackend
	secrets SecretsBackend
	hosts   []HostProfile
	app     AppPreferences
}

// NewStore creates a Store backed by prefs and secrets and loads existing data.
func NewStore(prefs PreferencesBackend, secrets SecretsBackend) *Store {
	if prefs == nil {
		prefs = MyGoPreferencesBackend{}
	}
	if secrets == nil {
		secrets = MyGoSecretsBackend{Service: secretService}
	}
	s := &Store{
		prefs:   prefs,
		secrets: secrets,
		app:     AppPreferences{Theme: ThemeSystem, Language: LanguageSystem},
	}
	s.Load()
	return s
}

// Load reloads hosts and preferences from the underlying backend.
func (s *Store) Load() {
	s.mu.Lock()
	defer s.mu.Unlock()

	var hosts []HostProfile
	if s.prefs.Get(prefsHostsKey, &hosts) {
		s.hosts = hosts
	} else {
		s.hosts = nil
	}

	app := AppPreferences{Theme: ThemeSystem, Language: LanguageSystem}
	if s.prefs.Get(prefsAppKey, &app) {
		app.Theme = NormalizeThemePreference(string(app.Theme))
		app.Language = NormalizeLanguagePreference(string(app.Language))
	}
	s.app = app
}

// Hosts returns a copy of all saved host profiles.
func (s *Store) Hosts() []HostProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return slices.Clone(s.hosts)
}

// Host returns a saved host profile by ID.
func (s *Store) Host(id string) (HostProfile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, h := range s.hosts {
		if h.ID == id {
			return h, true
		}
	}
	return HostProfile{}, false
}

// ActiveHost returns the currently active host profile, if any.
func (s *Store) ActiveHost() (HostProfile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.app.ActiveHostID == "" {
		return HostProfile{}, false
	}
	for _, h := range s.hosts {
		if h.ID == s.app.ActiveHostID {
			return h, true
		}
	}
	return HostProfile{}, false
}

// UpsertHost inserts or updates a host profile by ID.
func (s *Store) UpsertHost(profile HostProfile) error {
	profile.ID = strings.TrimSpace(profile.ID)
	profile.PrimaryURL = strings.TrimRight(strings.TrimSpace(profile.PrimaryURL), "/")
	profile.TailscaleURL = strings.TrimRight(strings.TrimSpace(profile.TailscaleURL), "/")
	if profile.ID == "" {
		return errors.New("config: host ID is required")
	}
	if profile.PrimaryURL == "" {
		return errors.New("config: primary URL is required")
	}
	if profile.Mode == "" {
		profile.Mode = HostModeCompanion
	}
	if profile.Name == "" {
		profile.Name = profile.ID
	}
	if profile.AddedAt.IsZero() {
		profile.AddedAt = time.Now().UTC()
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	updated := false
	for i := range s.hosts {
		if s.hosts[i].ID == profile.ID {
			if profile.AddedAt.IsZero() {
				profile.AddedAt = s.hosts[i].AddedAt
			}
			s.hosts[i] = profile
			updated = true
			break
		}
	}
	if !updated {
		s.hosts = append(s.hosts, profile)
	}
	return s.prefs.Set(prefsHostsKey, s.hosts)
}

// RemoveHost removes a host profile, clears active host if it matched, and deletes its secret.
func (s *Store) RemoveHost(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := make([]HostProfile, 0, len(s.hosts))
	for _, h := range s.hosts {
		if h.ID != id {
			filtered = append(filtered, h)
		}
	}
	s.hosts = filtered
	if err := s.prefs.Set(prefsHostsKey, s.hosts); err != nil {
		return err
	}
	if s.app.ActiveHostID == id {
		s.app.ActiveHostID = ""
		if len(s.hosts) > 0 {
			s.app.ActiveHostID = s.hosts[0].ID
		}
		if err := s.prefs.Set(prefsAppKey, s.app); err != nil {
			return err
		}
	}
	_ = s.secrets.Delete(secretKeyForHost(id))
	return nil
}

// SetActiveHost sets the active host ID and persists preferences.
func (s *Store) SetActiveHost(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id != "" {
		found := false
		for _, h := range s.hosts {
			if h.ID == id {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("config: host %q not found", id)
		}
	}
	s.app.ActiveHostID = id
	return s.prefs.Set(prefsAppKey, s.app)
}

// Preferences returns a copy of current app preferences.
func (s *Store) Preferences() AppPreferences {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.app
}

// SetPreferences validates and persists app preferences.
func (s *Store) SetPreferences(p AppPreferences) error {
	p.Theme = NormalizeThemePreference(string(p.Theme))
	p.Language = NormalizeLanguagePreference(string(p.Language))
	s.mu.Lock()
	defer s.mu.Unlock()
	s.app = p
	return s.prefs.Set(prefsAppKey, s.app)
}

// SaveSecret stores the auth secret (Companion Bearer token or Direct session cookie) for hostID.
func (s *Store) SaveSecret(hostID, secret string) error {
	if strings.TrimSpace(hostID) == "" {
		return errors.New("config: host ID is required for secret")
	}
	if secret == "" {
		return s.DeleteSecret(hostID)
	}
	return s.secrets.Set(secretKeyForHost(hostID), []byte(secret))
}

// LoadSecret loads the stored auth secret for hostID, or ErrSecretNotFound.
func (s *Store) LoadSecret(hostID string) (string, error) {
	if strings.TrimSpace(hostID) == "" {
		return "", ErrSecretNotFound
	}
	raw, err := s.secrets.Get(secretKeyForHost(hostID))
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// DeleteSecret removes the stored auth secret for hostID.
func (s *Store) DeleteSecret(hostID string) error {
	if strings.TrimSpace(hostID) == "" {
		return nil
	}
	return s.secrets.Delete(secretKeyForHost(hostID))
}

func secretKeyForHost(hostID string) string {
	return "host:" + strings.TrimSpace(hostID) + ":credential"
}
