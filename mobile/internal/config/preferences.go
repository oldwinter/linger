package config

import "strings"

// LanguagePreference controls whether the app follows the OS language or forces a locale.
type LanguagePreference string

const (
	LanguageSystem LanguagePreference = "system"
	LanguageEN     LanguagePreference = "en"
	LanguageZhHans LanguagePreference = "zh-Hans"
)

// ParseThemePreference parses a user-supplied theme preference string.
func ParseThemePreference(raw string) (ThemePreference, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "system", "auto":
		return ThemeSystem, true
	case "light":
		return ThemeLight, true
	case "dark":
		return ThemeDark, true
	default:
		return ThemeSystem, false
	}
}

// NormalizeThemePreference normalizes any theme value to a valid ThemePreference.
func NormalizeThemePreference(raw string) ThemePreference {
	t, _ := ParseThemePreference(raw)
	return t
}

// ParseLanguagePreference parses a user-supplied language preference string.
func ParseLanguagePreference(raw string) (LanguagePreference, bool) {
	norm := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(raw, "_", "-")))
	switch norm {
	case "", "system", "auto":
		return LanguageSystem, true
	case "en":
		return LanguageEN, true
	case "zh", "zh-hans", "zh-cn", "zh-sg":
		return LanguageZhHans, true
	default:
		if strings.HasPrefix(norm, "en-") {
			return LanguageEN, true
		}
		if strings.HasPrefix(norm, "zh-hans-") {
			return LanguageZhHans, true
		}
		return LanguageSystem, false
	}
}

// NormalizeLanguagePreference normalizes any language value to a valid LanguagePreference.
func NormalizeLanguagePreference(raw string) LanguagePreference {
	lang, _ := ParseLanguagePreference(raw)
	return lang
}
