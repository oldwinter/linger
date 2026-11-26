package config

import (
	"path/filepath"
	"testing"
)

func TestPreferencesThemeAndLanguageNormalizationAndPersistence(t *testing.T) {
	dir := t.TempDir()
	prefsPath := filepath.Join(dir, "preferences.json")
	secretsPath := filepath.Join(dir, "secrets.json")

	store := NewStore(NewFilePreferencesBackend(prefsPath), NewFileSecretsBackend(secretsPath))

	got := store.Preferences()
	if got.Theme != ThemeSystem {
		t.Fatalf("default Theme = %q, want %q", got.Theme, ThemeSystem)
	}
	if got.Language != LanguageSystem {
		t.Fatalf("default Language = %q, want %q", got.Language, LanguageSystem)
	}

	if err := store.SetPreferences(AppPreferences{
		Theme:         ThemeDark,
		Language:      LanguageZhHans,
		BiometricLock: true,
		CompactMode:   true,
	}); err != nil {
		t.Fatalf("SetPreferences: %v", err)
	}

	reopened := NewStore(NewFilePreferencesBackend(prefsPath), NewFileSecretsBackend(secretsPath))
	reloaded := reopened.Preferences()
	if reloaded.Theme != ThemeDark {
		t.Fatalf("reloaded Theme = %q, want %q", reloaded.Theme, ThemeDark)
	}
	if reloaded.Language != LanguageZhHans {
		t.Fatalf("reloaded Language = %q, want %q", reloaded.Language, LanguageZhHans)
	}
	if !reloaded.BiometricLock || !reloaded.CompactMode {
		t.Fatalf("reloaded booleans lost: %+v", reloaded)
	}

	// Invalid values normalize cleanly to system defaults.
	if err := reopened.SetPreferences(AppPreferences{
		Theme:    ThemePreference("neon"),
		Language: LanguagePreference("klingon"),
	}); err != nil {
		t.Fatalf("SetPreferences invalid: %v", err)
	}
	norm := reopened.Preferences()
	if norm.Theme != ThemeSystem || norm.Language != LanguageSystem {
		t.Fatalf("invalid values not normalized: %+v", norm)
	}
}

func TestParseThemeAndLanguagePreference(t *testing.T) {
	themeCases := []struct {
		in   string
		want ThemePreference
		ok   bool
	}{
		{"", ThemeSystem, true},
		{"system", ThemeSystem, true},
		{"AUTO", ThemeSystem, true},
		{"light", ThemeLight, true},
		{"Dark", ThemeDark, true},
		{"sepia", ThemeSystem, false},
	}
	for _, tc := range themeCases {
		got, ok := ParseThemePreference(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("ParseThemePreference(%q) = (%q, %v), want (%q, %v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}

	langCases := []struct {
		in   string
		want LanguagePreference
		ok   bool
	}{
		{"", LanguageSystem, true},
		{"system", LanguageSystem, true},
		{"auto", LanguageSystem, true},
		{"en", LanguageEN, true},
		{"en-US", LanguageEN, true},
		{"zh", LanguageZhHans, true},
		{"zh-Hans", LanguageZhHans, true},
		{"zh_CN", LanguageZhHans, true},
		{"zh-TW", LanguageZhHans, true},
		{"zh-HK", LanguageZhHans, true},
		{"zh-Hant", LanguageZhHans, true},
		{"zh-Hant-TW", LanguageZhHans, true},
		{"fr-FR", LanguageSystem, false},
	}
	for _, tc := range langCases {
		got, ok := ParseLanguagePreference(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("ParseLanguagePreference(%q) = (%q, %v), want (%q, %v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}
