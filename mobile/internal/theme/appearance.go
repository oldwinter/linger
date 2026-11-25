package theme

import (
	"fmt"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/config"
)

// BackgroundHex returns the window background hex string matching TownLight or TownDark.
func BackgroundHex(pref config.ThemePreference, systemDark bool) string {
	return BackgroundHexForTheme(Resolve(pref, systemDark))
}

// BackgroundHexForTheme returns the window background hex string derived from TownLight or TownDark tokens.
func BackgroundHexForTheme(t *ui.Theme) string {
	base := TownLight()
	if t != nil && t.Dark {
		base = TownDark()
	}
	c := base.Background.SRGB()
	return fmt.Sprintf("#%02X%02X%02X", c.R, c.G, c.B)
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
