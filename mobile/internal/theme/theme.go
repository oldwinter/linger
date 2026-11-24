// Package theme defines Linger's Town Light and Town Dark ui.Theme palettes,
// Nature semantic colors, and crisp vector icons drawn with ui.Painter.
package theme

import (
	"hash/fnv"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/config"
)

// NaturePalette holds Linger's 11 Nature semantic accents used for avatars,
// tags, room markers, and live activity indicators.
type NaturePalette struct {
	Sun       ui.Color
	Lichen    ui.Color
	Rain      ui.Color
	Butter    ui.Color
	Lake      ui.Color
	Bubblegum ui.Color
	Grass     ui.Color
	Lavender  ui.Color
	Acorn     ui.Color
	Bluebell  ui.Color
	Fawn      ui.Color
}

// Nature exposes the canonical Linger Nature palette from visual-theme.css.
var Nature = NaturePalette{
	Sun:       ui.Hex("#D95B31"),
	Lichen:    ui.Hex("#839127"),
	Rain:      ui.Hex("#4E9BA2"),
	Butter:    ui.Hex("#A08E00"),
	Lake:      ui.Hex("#509578"),
	Bubblegum: ui.Hex("#DF5583"),
	Grass:     ui.Hex("#5E9662"),
	Lavender:  ui.Hex("#A17CB9"),
	Acorn:     ui.Hex("#B88022"),
	Bluebell:  ui.Hex("#698CC7"),
	Fawn:      ui.Hex("#B07F77"),
}

// ExtraTokens holds Town surface/muted tokens beyond ui.Theme's core fields.
type ExtraTokens struct {
	SidebarBg  ui.Color
	MutedBg    ui.Color
	Info       ui.Color
	InfoTint   ui.Color
	DangerTint ui.Color
	WarnTint   ui.Color
	OKTint     ui.Color
}

var (
	townLightExtra = ExtraTokens{
		SidebarBg:  ui.Hex("#F6F7F2"),
		MutedBg:    ui.Hex("#F4F4EE"),
		Info:       ui.Hex("#0976CE"),
		InfoTint:   ui.RGBA(9, 118, 206, 0.10),
		DangerTint: ui.RGBA(198, 57, 11, 0.10),
		WarnTint:   ui.RGBA(199, 123, 0, 0.12),
		OKTint:     ui.RGBA(75, 132, 46, 0.12),
	}
	townDarkExtra = ExtraTokens{
		SidebarBg:  ui.Hex("#1C1C18"),
		MutedBg:    ui.Hex("#282822"),
		Info:       ui.Hex("#4DA3E8"),
		InfoTint:   ui.RGBA(77, 163, 232, 0.16),
		DangerTint: ui.RGBA(255, 133, 95, 0.18),
		WarnTint:   ui.RGBA(229, 160, 50, 0.16),
		OKTint:     ui.RGBA(117, 184, 83, 0.16),
	}
)

// TownLight returns Linger's warm paper Town Light ui.Theme matching apps/web/src/app/visual-theme.css.
func TownLight() *ui.Theme {
	return &ui.Theme{
		Dark:            false,
		Background:      ui.Hex("#FDFDFB"),
		Surface:         ui.Hex("#FFFFFF"),
		SurfaceHover:    ui.Hex("#F6F7F2"),
		SurfacePressed:  ui.Hex("#ECECE7"),
		Border:          ui.Hex("#ECECE7"),
		Text:            ui.Hex("#1A1A16"),
		TextMuted:       ui.Hex("#737166"),
		Accent:          ui.Hex("#0976CE"),
		AccentHover:     ui.Hex("#0763AE"),
		AccentPressed:   ui.Hex("#06508E"),
		AccentText:      ui.Hex("#FFFFFF"),
		InactiveAccent:  ui.Hex("#698CC7"),
		Danger:          ui.Hex("#C6390B"),
		Warning:         ui.Hex("#C77B00"),
		Success:         ui.Hex("#4B842E"),
		Selection:       ui.RGBA(9, 118, 206, 0.20),
		Focus:           ui.RGBA(9, 118, 206, 0.55),
		FocusRingWidth:  2,
		FocusRingOffset: 1,
		Inverse:         ui.Hex("#1A1A16"),
		InverseText:     ui.Hex("#FDFDFB"),
		Scrollbar:       ui.RGBA(26, 26, 22, 0.24),
		Radius:          10,
		Spacing:         4,
		FontSize:        15,
	}
}

// TownDark returns Linger's complementary warm dark stone Town Dark ui.Theme.
func TownDark() *ui.Theme {
	return &ui.Theme{
		Dark:            true,
		Background:      ui.Hex("#171714"),
		Surface:         ui.Hex("#22221D"),
		SurfaceHover:    ui.Hex("#2B2B25"),
		SurfacePressed:  ui.Hex("#34342D"),
		Border:          ui.Hex("#36362F"),
		Text:            ui.Hex("#F5F4EE"),
		TextMuted:       ui.Hex("#A3A195"),
		Accent:          ui.Hex("#4DA3E8"),
		AccentHover:     ui.Hex("#6CB5EE"),
		AccentPressed:   ui.Hex("#358CD3"),
		AccentText:      ui.Hex("#0E151C"),
		InactiveAccent:  ui.Hex("#698CC7"),
		Danger:          ui.Hex("#FF855F"),
		Warning:         ui.Hex("#E5A032"),
		Success:         ui.Hex("#75B853"),
		Selection:       ui.RGBA(77, 163, 232, 0.30),
		Focus:           ui.RGBA(77, 163, 232, 0.65),
		FocusRingWidth:  2,
		FocusRingOffset: 1,
		Inverse:         ui.Hex("#F5F4EE"),
		InverseText:     ui.Hex("#171714"),
		Scrollbar:       ui.RGBA(245, 244, 238, 0.28),
		Radius:          10,
		Spacing:         4,
		FontSize:        15,
	}
}

// Extra returns supplementary Town tokens matching t.Dark.
func Extra(t *ui.Theme) ExtraTokens {
	if t != nil && t.Dark {
		return townDarkExtra
	}
	return townLightExtra
}

// Resolve picks TownLight or TownDark according to user preference and system appearance.
func Resolve(pref config.ThemePreference, systemDark bool) *ui.Theme {
	switch pref {
	case config.ThemeLight:
		return TownLight()
	case config.ThemeDark:
		return TownDark()
	default:
		if systemDark {
			return TownDark()
		}
		return TownLight()
	}
}

var avatarSwatches = []ui.Color{
	Nature.Sun,
	Nature.Lichen,
	Nature.Rain,
	Nature.Lake,
	Nature.Bubblegum,
	Nature.Grass,
	Nature.Lavender,
	Nature.Acorn,
	Nature.Bluebell,
	Nature.Fawn,
}

// AvatarColor deterministically maps any entity name to a Nature palette swatch.
func AvatarColor(key string) ui.Color {
	h := fnv.New32a()
	_, _ = h.Write([]byte(key))
	return avatarSwatches[int(h.Sum32())%len(avatarSwatches)]
}
