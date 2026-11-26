package components_test

import (
	"math"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func compositeOver(fg, bg ui.Color) ui.Color {
	a := float64(fg.A) / 255.0
	if a >= 1 {
		return fg
	}
	blend := func(c1, c2 uint8) uint8 {
		v := float64(c1)*a + float64(c2)*(1-a)
		return uint8(math.Round(v))
	}
	return ui.Color{
		R: blend(fg.R, bg.R),
		G: blend(fg.G, bg.G),
		B: blend(fg.B, bg.B),
		A: 255,
	}
}

func relativeLuminance(c ui.Color) float64 {
	lin := func(v uint8) float64 {
		s := float64(v) / 255.0
		if s <= 0.03928 {
			return s / 12.92
		}
		return math.Pow((s+0.055)/1.055, 2.4)
	}
	return 0.2126*lin(c.R) + 0.7152*lin(c.G) + 0.0722*lin(c.B)
}

func contrastRatio(fg, bg ui.Color) float64 {
	l1 := relativeLuminance(fg)
	l2 := relativeLuminance(bg)
	if l1 < l2 {
		l1, l2 = l2, l1
	}
	return (l1 + 0.05) / (l2 + 0.05)
}

func TestDangerTouchButtonWCAGContrastLightAndDark(t *testing.T) {
	themes := []struct {
		name string
		th   *ui.Theme
	}{
		{"TownLight", theme.TownLight()},
		{"TownDark", theme.TownDark()},
	}
	for _, tc := range themes {
		for _, disabled := range []bool{false, true} {
			bg, fg, _ := components.DangerButtonColors(tc.th, disabled)
			// Composite translucent button surface over card surface, then foreground over that.
			effectiveBg := compositeOver(bg, tc.th.Surface)
			effectiveFg := compositeOver(fg, effectiveBg)
			ratio := contrastRatio(effectiveFg, effectiveBg)
			if ratio < 4.5 {
				t.Errorf("%s disabled=%v: DangerTouchButton contrast %.2f:1 < 4.5:1 (fg=%+v bg=%+v)",
					tc.name, disabled, ratio, effectiveFg, effectiveBg)
			}
		}
	}
}

func TestHapticsToggleState(t *testing.T) {
	t.Cleanup(func() { components.SetHapticsEnabled(true) })
	components.SetHapticsEnabled(false)
	if components.HapticsEnabled() {
		t.Fatal("expected HapticsEnabled() false after disable")
	}
	components.SetHapticsEnabled(true)
	if !components.HapticsEnabled() {
		t.Fatal("expected HapticsEnabled() true after enable")
	}
}
