// Package theme defines Linger's Town Light and Town Dark ui.Theme palettes,
// Nature semantic colors, elevation tokens, and crisp vector icons drawn with ui.Painter.
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

// ExtraTokens holds Town surface, elevation, brand spark, and chat tokens beyond ui.Theme.
type ExtraTokens struct {
	SidebarBg     ui.Color
	MutedBg       ui.Color
	ElevatedBg    ui.Color
	SubtleBorder  ui.Color
	Divider       ui.Color
	CardShadow    ui.Color
	CardHighlight ui.Color
	TextSubtle    ui.Color
	Brand         ui.Color
	BrandText     ui.Color
	BrandTint     ui.Color
	Info          ui.Color
	InfoTint      ui.Color
	DangerTint    ui.Color
	WarnTint      ui.Color
	OKTint        ui.Color
	OwnBubbleBg   ui.Color
	OwnBubbleText ui.Color
	PeerBubbleBg  ui.Color
	HeroGradFrom  ui.Color
	HeroGradTo    ui.Color
	OnAvatar      ui.Color
}

var (
	townLightExtra = ExtraTokens{
		SidebarBg:     ui.Hex("#EFECE5"),
		MutedBg:       ui.Hex("#EAE8E1"),
		ElevatedBg:    ui.Hex("#FFFFFF"),
		SubtleBorder:  ui.RGBA(23, 23, 20, 0.08),
		Divider:       ui.RGBA(23, 23, 20, 0.07),
		CardShadow:    ui.RGBA(22, 20, 16, 0.055),
		CardHighlight: ui.RGBA(255, 255, 255, 0.90),
		TextSubtle:    ui.Hex("#8E8C81"),
		Brand:         ui.Hex("#E58A28"),
		BrandText:     ui.Hex("#9B5309"),
		BrandTint:     ui.RGBA(229, 138, 40, 0.12),
		Info:          ui.Hex("#1B6DA3"),
		InfoTint:      ui.RGBA(27, 109, 163, 0.10),
		DangerTint:    ui.RGBA(196, 59, 31, 0.09),
		WarnTint:      ui.RGBA(180, 106, 0, 0.11),
		OKTint:        ui.RGBA(46, 122, 70, 0.10),
		OwnBubbleBg:   ui.Hex("#1A1A16"),
		OwnBubbleText: ui.Hex("#FAFAF6"),
		PeerBubbleBg:  ui.Hex("#FFFFFF"),
		HeroGradFrom:  ui.Hex("#FFFFFF"),
		HeroGradTo:    ui.Hex("#F7F5EE"),
		OnAvatar:      ui.Hex("#FFFFFF"),
	}
	townDarkExtra = ExtraTokens{
		SidebarBg:     ui.Hex("#161613"),
		MutedBg:       ui.Hex("#242420"),
		ElevatedBg:    ui.Hex("#23231E"),
		SubtleBorder:  ui.RGBA(243, 242, 235, 0.08),
		Divider:       ui.RGBA(243, 242, 235, 0.07),
		CardShadow:    ui.RGBA(0, 0, 0, 0.28),
		CardHighlight: ui.RGBA(255, 252, 242, 0.05),
		TextSubtle:    ui.Hex("#6E6C63"),
		Brand:         ui.Hex("#F5A442"),
		BrandText:     ui.Hex("#F7B45E"),
		BrandTint:     ui.RGBA(245, 164, 66, 0.16),
		Info:          ui.Hex("#6CB2EA"),
		InfoTint:      ui.RGBA(108, 178, 234, 0.15),
		DangerTint:    ui.RGBA(245, 131, 102, 0.15),
		WarnTint:      ui.RGBA(240, 170, 62, 0.16),
		OKTint:        ui.RGBA(100, 191, 122, 0.15),
		OwnBubbleBg:   ui.Hex("#EAE8DF"),
		OwnBubbleText: ui.Hex("#151512"),
		PeerBubbleBg:  ui.Hex("#1E1E1A"),
		HeroGradFrom:  ui.Hex("#21211C"),
		HeroGradTo:    ui.Hex("#181815"),
		OnAvatar:      ui.Hex("#F5F4EE"),
	}
)

// TownLight returns Linger's warm alabaster paper & editorial obsidian ink Town Light ui.Theme.
func TownLight() *ui.Theme {
	return &ui.Theme{
		Dark:            false,
		Background:      ui.Hex("#F5F4EF"),
		Surface:         ui.Hex("#FFFFFF"),
		SurfaceHover:    ui.Hex("#F2F1EC"),
		SurfacePressed:  ui.Hex("#E8E6DF"),
		Border:          ui.Hex("#E5E3DB"),
		Text:            ui.Hex("#171714"),
		TextMuted:       ui.Hex("#6A685E"),
		Accent:          ui.Hex("#181815"),
		AccentHover:     ui.Hex("#2C2C27"),
		AccentPressed:   ui.Hex("#0E0E0C"),
		AccentText:      ui.Hex("#FAFAF6"),
		InactiveAccent:  ui.Hex("#5C5A52"),
		Danger:          ui.Hex("#C43B1F"),
		Warning:         ui.Hex("#B46A00"),
		Success:         ui.Hex("#2E7A46"),
		Selection:       ui.RGBA(229, 138, 40, 0.22),
		Focus:           ui.RGBA(24, 24, 21, 0.35),
		FocusRingWidth:  2,
		FocusRingOffset: 1,
		Inverse:         ui.Hex("#181815"),
		InverseText:     ui.Hex("#FAFAF6"),
		Scrollbar:       ui.RGBA(23, 23, 20, 0.22),
		Radius:          12,
		Spacing:         4,
		FontSize:        15,
	}
}

// TownDark returns Linger's complementary warm obsidian & ivory Town Dark ui.Theme.
func TownDark() *ui.Theme {
	return &ui.Theme{
		Dark:            true,
		Background:      ui.Hex("#11110F"),
		Surface:         ui.Hex("#1B1B18"),
		SurfaceHover:    ui.Hex("#23231F"),
		SurfacePressed:  ui.Hex("#2C2C27"),
		Border:          ui.Hex("#2B2B25"),
		Text:            ui.Hex("#F3F2EB"),
		TextMuted:       ui.Hex("#9A988D"),
		Accent:          ui.Hex("#F2F0E6"),
		AccentHover:     ui.Hex("#FFFFFF"),
		AccentPressed:   ui.Hex("#DCD9CC"),
		AccentText:      ui.Hex("#141411"),
		InactiveAccent:  ui.Hex("#9A988D"),
		Danger:          ui.Hex("#F58366"),
		Warning:         ui.Hex("#F0AA3E"),
		Success:         ui.Hex("#64BF7A"),
		Selection:       ui.RGBA(245, 164, 66, 0.28),
		Focus:           ui.RGBA(242, 240, 230, 0.42),
		FocusRingWidth:  2,
		FocusRingOffset: 1,
		Inverse:         ui.Hex("#F2F0E6"),
		InverseText:     ui.Hex("#141411"),
		Scrollbar:       ui.RGBA(243, 242, 235, 0.24),
		Radius:          12,
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
	return ResolveWithDensity(pref, systemDark, false)
}

// ResolveWithDensity picks TownLight or TownDark and applies comfortable (Spacing=4) or compact (Spacing=2) density.
func ResolveWithDensity(pref config.ThemePreference, systemDark, compact bool) *ui.Theme {
	var t *ui.Theme
	switch pref {
	case config.ThemeLight:
		t = TownLight()
	case config.ThemeDark:
		t = TownDark()
	default:
		if systemDark {
			t = TownDark()
		} else {
			t = TownLight()
		}
	}
	if compact {
		t.Spacing = 2
	}
	return t
}

// IsCompact reports whether t is configured for compact layout density.
func IsCompact(t *ui.Theme) bool {
	return t != nil && t.Spacing > 0 && t.Spacing <= 2
}

var avatarSwatches = []ui.Color{
	Nature.Sun,
	Nature.Lake,
	Nature.Rain,
	Nature.Lavender,
	Nature.Acorn,
	Nature.Bluebell,
	Nature.Grass,
	Nature.Fawn,
	Nature.Bubblegum,
	Nature.Lichen,
}

// AvatarColor deterministically maps any entity name to a Nature palette swatch.
func AvatarColor(key string) ui.Color {
	h := fnv.New32a()
	_, _ = h.Write([]byte(key))
	return avatarSwatches[int(h.Sum32())%len(avatarSwatches)]
}
