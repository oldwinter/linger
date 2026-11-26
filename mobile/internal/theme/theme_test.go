package theme

import (
	"testing"

	"github.com/egoist/mygo"
	"github.com/oldwinter/linger/mobile/internal/config"
)

func TestResolveAndAppearanceTokens(t *testing.T) {
	if Resolve(config.ThemeLight, true).Dark {
		t.Fatal("ThemeLight with systemDark=true should not be dark")
	}
	if !Resolve(config.ThemeDark, false).Dark {
		t.Fatal("ThemeDark with systemDark=false should be dark")
	}
	if Resolve(config.ThemeSystem, false).Dark {
		t.Fatal("ThemeSystem with systemDark=false should resolve light")
	}
	if !Resolve(config.ThemeSystem, true).Dark {
		t.Fatal("ThemeSystem with systemDark=true should resolve dark")
	}

	lightExtra := Extra(TownLight())
	darkExtra := Extra(TownDark())
	if lightExtra.OnAvatar == (TownLight().Background) || lightExtra.OnAvatar.A == 0 {
		t.Fatalf("unexpected light OnAvatar token: %+v", lightExtra.OnAvatar)
	}
	if darkExtra.OnAvatar == (TownDark().Background) || darkExtra.OnAvatar.A == 0 {
		t.Fatalf("unexpected dark OnAvatar token: %+v", darkExtra.OnAvatar)
	}

	if got := BackgroundHex(config.ThemeLight, true); got != "#F5F4EF" {
		t.Fatalf("BackgroundHex light = %q, want #F5F4EF", got)
	}
	if got := BackgroundHex(config.ThemeDark, false); got != "#11110F" {
		t.Fatalf("BackgroundHex dark = %q, want #11110F", got)
	}
	if got := BackgroundHex(config.ThemeSystem, true); got != "#11110F" {
		t.Fatalf("BackgroundHex system dark = %q, want #11110F", got)
	}
}

func TestMyGoThemeAndSystemBarMapping(t *testing.T) {
	if got := ToMyGoSource(config.ThemeSystem); got != mygo.ThemeSystem {
		t.Fatalf("ToMyGoSource(system) = %q, want %q", got, mygo.ThemeSystem)
	}
	if got := ToMyGoSource(config.ThemeLight); got != mygo.ThemeLight {
		t.Fatalf("ToMyGoSource(light) = %q, want %q", got, mygo.ThemeLight)
	}
	if got := ToMyGoSource(config.ThemeDark); got != mygo.ThemeDark {
		t.Fatalf("ToMyGoSource(dark) = %q, want %q", got, mygo.ThemeDark)
	}

	if got := ToSystemBarStyle(config.ThemeSystem); got != mygo.BarStyleAuto {
		t.Fatalf("ToSystemBarStyle(system) = %q, want %q", got, mygo.BarStyleAuto)
	}
	if got := ToSystemBarStyle(config.ThemeLight); got != mygo.BarStyleDark {
		t.Fatalf("ToSystemBarStyle(light) = %q, want %q", got, mygo.BarStyleDark)
	}
	if got := ToSystemBarStyle(config.ThemeDark); got != mygo.BarStyleLight {
		t.Fatalf("ToSystemBarStyle(dark) = %q, want %q", got, mygo.BarStyleLight)
	}
}
