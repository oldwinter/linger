package theme

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/config"
)

const (
	townLightBgHex = "#FDFDFB"
	townDarkBgHex  = "#171714"
)

// BackgroundHex returns the window background hex string matching TownLight or TownDark.
func BackgroundHex(pref config.ThemePreference, systemDark bool) string {
	return BackgroundHexForTheme(Resolve(pref, systemDark))
}

// BackgroundHexForTheme returns the window background hex string for an already-resolved theme.
func BackgroundHexForTheme(t *ui.Theme) string {
	if t != nil && t.Dark {
		return townDarkBgHex
	}
	return townLightBgHex
}

// ToMyGoSource translates a persisted ThemePreference into mygo.ThemeSource.
func ToMyGoSource(pref config.ThemePreference) mygo.ThemeSource {
	switch config.NormalizeThemePreference(string(pref)) {
	case config.ThemeLight:
		return mygo.ThemeLight
	case config.ThemeDark:
		return mygo.ThemeDark
	default:
		return mygo.ThemeSystem
	}
}

// ToSystemBarStyle translates a persisted ThemePreference into the matching OS status-bar icon style.
func ToSystemBarStyle(pref config.ThemePreference) mygo.BarStyle {
	switch config.NormalizeThemePreference(string(pref)) {
	case config.ThemeLight:
		return mygo.BarStyleDark
	case config.ThemeDark:
		return mygo.BarStyleLight
	default:
		return mygo.BarStyleAuto
	}
}
