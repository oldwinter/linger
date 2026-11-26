package components

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// ThemeSegmentedSelector renders System / Town Light / Town Dark selector and invokes onChange when switched.
func ThemeSegmentedSelector(c *ui.Context, current config.ThemePreference, onChange func(config.ThemePreference)) {
	t := c.Theme()
	ui.Column(c).FillWidth().Gap(6).Children(func() {
		ui.Text(c, i18n.T("appearance.theme")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
		idx := 0
		switch config.NormalizeThemePreference(string(current)) {
		case config.ThemeLight:
			idx = 1
		case config.ThemeDark:
			idx = 2
		}
		if SegmentedControl(c, &idx,
			i18n.ThemeOptionLabel(config.ThemeSystem),
			i18n.ThemeOptionLabel(config.ThemeLight),
			i18n.ThemeOptionLabel(config.ThemeDark),
		) {
			next := config.ThemeSystem
			if idx == 1 {
				next = config.ThemeLight
			} else if idx == 2 {
				next = config.ThemeDark
			}
			mygo.Haptics.Light()
			if onChange != nil {
				onChange(next)
			}
		}
	})
}

// LanguageSegmentedSelector renders System / English / Simplified Chinese selector and invokes onChange when switched.
func LanguageSegmentedSelector(c *ui.Context, current config.LanguagePreference, onChange func(config.LanguagePreference)) {
	t := c.Theme()
	ui.Column(c).FillWidth().Gap(6).Children(func() {
		ui.Text(c, i18n.T("appearance.language")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
		idx := 0
		switch config.NormalizeLanguagePreference(string(current)) {
		case config.LanguageEN:
			idx = 1
		case config.LanguageZhHans:
			idx = 2
		}
		if SegmentedControl(c, &idx,
			i18n.LanguageOptionLabel(config.LanguageSystem),
			i18n.LanguageOptionLabel(config.LanguageEN),
			i18n.LanguageOptionLabel(config.LanguageZhHans),
		) {
			next := config.LanguageSystem
			if idx == 1 {
				next = config.LanguageEN
			} else if idx == 2 {
				next = config.LanguageZhHans
			}
			mygo.Haptics.Light()
			if onChange != nil {
				onChange(next)
			}
		}
	})
}

// AppearanceQuickCard renders an offline-ready compact Theme & Language quick switcher
// safe for 320px-430px Connect Hub viewports before any host is paired.
func AppearanceQuickCard(
	c *ui.Context,
	prefs config.AppPreferences,
	onTheme func(config.ThemePreference),
	onLang func(config.LanguagePreference),
	onOpenPrefs func(),
) {
	t := c.Theme()
	ex := theme.Extra(t)
	curTheme := config.NormalizeThemePreference(string(prefs.Theme))
	curLang := config.NormalizeLanguagePreference(string(prefs.Language))

	card := ui.Column(c).FillWidth().Background(t.Surface).Radius(16).Padding(12, 14).Gap(10).
		Role(ui.RoleGroup).Label(i18n.T("appearance.title"))
	ApplyCardElevation(card, t)
	card.Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
			ui.Row(c).AlignItems(ui.Center).Gap(6).Children(func() {
				theme.IconBox(c, 14, t.TextMuted, theme.IconSliders)
				ui.Text(c, i18n.T("appearance.title")).FontSize(12.5).FontWeight(600).TextColor(t.TextMuted).NoWrap()
			})
			if onOpenPrefs != nil {
				btn := ui.Row(c).MinHeight(28).Padding(3, 9).Radius(999).Background(ex.MutedBg).
					AlignItems(ui.Center).Gap(3).Role(ui.RoleButton).Label(i18n.T("appearance.all_prefs"))
				if btn.Pressed() {
					btn.Background(t.SurfacePressed)
				}
				btn.Children(func() {
					ui.Text(c, i18n.T("appearance.all_prefs")).FontSize(11.5).FontWeight(600).TextColor(t.Text).NoWrap()
					theme.IconBox(c, 11, t.TextMuted, theme.IconChevronRight)
				})
				if btn.Clicked() {
					onOpenPrefs()
				}
			}
		})

		// Row 1: Theme pills (Auto | Light | Dark)
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
			ui.Text(c, i18n.T("appearance.theme")).FontSize(13).FontWeight(500).TextColor(t.Text).NoWrap()
			ui.Row(c).Background(ex.MutedBg).Radius(10).Padding(2, 2).Gap(2).AlignItems(ui.Center).Children(func() {
				for _, opt := range []config.ThemePreference{config.ThemeSystem, config.ThemeLight, config.ThemeDark} {
					label := i18n.ThemePillLabel(opt)
					selected := curTheme == opt
					if quickPill(c, "th_"+string(opt), label, i18n.ThemeOptionLabel(opt), selected) {
						mygo.Haptics.Light()
						if onTheme != nil {
							onTheme(opt)
						}
					}
				}
			})
		})

		InsetDivider(c, 0)

		// Row 2: Language pills (Auto | EN | zh-Hans autonym)
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
			ui.Text(c, i18n.T("appearance.language")).FontSize(13).FontWeight(500).TextColor(t.Text).NoWrap()
			ui.Row(c).Background(ex.MutedBg).Radius(10).Padding(2, 2).Gap(2).AlignItems(ui.Center).Children(func() {
				for _, opt := range []config.LanguagePreference{config.LanguageSystem, config.LanguageEN, config.LanguageZhHans} {
					label := i18n.LanguagePillLabel(opt)
					selected := curLang == opt
					if quickPill(c, "lg_"+string(opt), label, i18n.LanguageOptionLabel(opt), selected) {
						mygo.Haptics.Light()
						if onLang != nil {
							onLang(opt)
						}
					}
				}
			})
		})
	})
}

func quickPill(c *ui.Context, key, label, a11yLabel string, active bool) bool {
	t := c.Theme()
	ex := theme.Extra(t)
	bg := ui.Transparent
	fg := t.TextMuted
	if active {
		bg = t.Accent
		fg = t.AccentText
	}
	pill := ui.Row(c.Key(key)).MinHeight(28).Padding(3, 10).Radius(8).
		Background(bg).AlignItems(ui.Center).Justify(ui.Center).
		Role(ui.RoleTab).Label(a11yLabel).Selected(active)
	if active && !t.Dark {
		pill.Shadow(0, 1, 3, 0, ex.CardShadow)
	}
	pill.Children(func() {
		txt := ui.Text(c, label).FontSize(11.5).TextColor(fg).NoWrap()
		if active {
			txt.FontWeight(600)
		} else {
			txt.FontWeight(500)
		}
	})
	return pill.Clicked()
}
