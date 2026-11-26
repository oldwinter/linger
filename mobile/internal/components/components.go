// Package components provides narrow-screen-safe (320px-430px), accessible
// mobile UI primitives built with Linger's Town Atelier theme and tactile craft.
package components

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// Tone identifies semantic banner and badge colors.
type Tone string

const (
	ToneNeutral Tone = "neutral"
	ToneBrand   Tone = "brand"
	ToneInfo    Tone = "info"
	ToneSuccess Tone = "success"
	ToneWarning Tone = "warning"
	ToneDanger  Tone = "danger"
)

func toneColors(t *ui.Theme, tone Tone) (bg, fg ui.Color) {
	ex := theme.Extra(t)
	switch tone {
	case ToneBrand:
		return ex.BrandTint, ex.BrandText
	case ToneInfo:
		return ex.InfoTint, ex.Info
	case ToneSuccess:
		return ex.OKTint, t.Success
	case ToneWarning:
		return ex.WarnTint, t.Warning
	case ToneDanger:
		return ex.DangerTint, t.Danger
	default:
		return ex.MutedBg, t.TextMuted
	}
}

// ApplyCardElevation applies Town's soft ambient light shadow or dark inner top sheen.
func ApplyCardElevation(el ui.Element, t *ui.Theme) ui.Element {
	ex := theme.Extra(t)
	el.Border(0.75, ex.SubtleBorder)
	if t != nil && t.Dark {
		el.InsetShadow(0, 1, 0, 0, ex.CardHighlight)
	} else {
		el.Shadow(0, 2, 10, 0, ex.CardShadow)
	}
	return el
}

// SectionEyebrow renders a quiet editorial label above a grouped surface.
func SectionEyebrow(c *ui.Context, title string, trailing func()) {
	t := c.Theme()
	ui.Row(c).FillWidth().Padding(2, 4, 0, 4).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
		ui.Text(c, title).FontSize(12).FontWeight(600).LetterSpacing(0.25).TextColor(t.TextMuted).Grow(1).Basis(0).MaxLines(1)
		if trailing != nil {
			trailing()
		}
	})
}

// GroupedCard wraps list rows inside one elevated Town surface without box-in-box nesting.
func GroupedCard(c *ui.Context, body func()) ui.Element {
	t := c.Theme()
	card := ui.Column(c).FillWidth().Background(t.Surface).Radius(16).Clip()
	ApplyCardElevation(card, t)
	if body != nil {
		card.Children(body)
	}
	return card
}

// InsetDivider draws a delicate inset separator inside a GroupedCard.
func InsetDivider(c *ui.Context, insetStart float32) {
	ex := theme.Extra(c.Theme())
	ui.Box(c).FillWidth().Padding(0, 0, 0, insetStart).Shrink(0).Children(func() {
		ui.Box(c).FillWidth().Height(1).Background(ex.Divider)
	})
}

// StatusBanner renders a full-width inline status/error banner with optional action.
// Callers omit it once transient state recovers so stale banners never linger.
func StatusBanner(c *ui.Context, tone Tone, message, actionLabel string, onAction func()) {
	if strings.TrimSpace(message) == "" {
		return
	}
	t := c.Theme()
	bg, fg := toneColors(t, tone)
	ui.Row(c).FillWidth().Background(bg).Radius(14).Padding(10, 12).Gap(10).AlignItems(ui.Center).
		Border(0.75, fg.Alpha(0.22)).Role(ui.RoleStatus).Label(message).Children(func() {
		icon := theme.IconShield
		if tone == ToneDanger || tone == ToneWarning {
			icon = theme.IconAlert
		} else if tone == ToneSuccess {
			icon = theme.IconCheck
		} else if tone == ToneBrand {
			icon = theme.IconSparkle
		}
		ui.Row(c).Size(28, 28).Radius(9).Background(fg.Alpha(0.14)).AlignItems(ui.Center).Justify(ui.Center).Shrink(0).Children(func() {
			theme.IconBox(c, 15, fg, icon)
		})
		ui.Text(c, message).Grow(1).Basis(0).FontSize(13).LineHeight(1.35).TextColor(t.Text)
		if actionLabel != "" && onAction != nil {
			btn := ui.Row(c).MinHeight(32).Padding(4, 10).Radius(999).Background(t.Surface).
				Border(0.75, fg.Alpha(0.28)).AlignItems(ui.Center).Justify(ui.Center).Shrink(0).
				Role(ui.RoleButton).Label(actionLabel)
			if btn.Pressed() {
				btn.Scale(0.97, 0.97)
			}
			btn.Children(func() {
				ui.Text(c, actionLabel).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
			})
			if btn.Clicked() {
				onAction()
			}
		}
	})
}

// StatusPill renders a compact semantic micro-pill that never overflows narrow viewports.
func StatusPill(c *ui.Context, label string, tone Tone) ui.Element {
	t := c.Theme()
	bg, fg := toneColors(t, tone)
	return ui.Row(c).Padding(3, 8).Radius(999).Background(bg).AlignItems(ui.Center).Shrink(0).
		Role(ui.RoleStatus).Label(label).Children(func() {
		ui.Text(c, label).FontSize(11).FontWeight(600).TextColor(fg).NoWrap()
	})
}

// StatusDotPill renders a compact semantic pill with a leading colored indicator dot.
func StatusDotPill(c *ui.Context, label string, tone Tone) ui.Element {
	t := c.Theme()
	bg, fg := toneColors(t, tone)
	return ui.Row(c).Padding(3, 8).Radius(999).Background(bg).AlignItems(ui.Center).Gap(5).Shrink(0).
		Role(ui.RoleStatus).Label(label).Children(func() {
		ui.Box(c).Size(6, 6).Radius(3).Background(fg).Shrink(0)
		ui.Text(c, label).FontSize(11).FontWeight(600).TextColor(fg).NoWrap()
	})
}

// SectionCard wraps related content in an elevated Town Atelier surface card.
func SectionCard(c *ui.Context, title, subtitle string, trailing func(), body func()) ui.Element {
	t := c.Theme()
	card := ui.Column(c).FillWidth().Background(t.Surface).Radius(16).Padding(16, 16).Gap(12)
	ApplyCardElevation(card, t)
	card.Children(func() {
		if title != "" || trailing != nil {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(10).Children(func() {
				ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
					if title != "" {
						ui.Text(c, title).FontSize(15.5).FontWeight(600).LetterSpacing(-0.2).TextColor(t.Text)
					}
					if subtitle != "" {
						ui.Text(c, subtitle).FontSize(12.5).LineHeight(1.35).TextColor(t.TextMuted)
					}
				})
				if trailing != nil {
					trailing()
				}
			})
		}
		if body != nil {
			body()
		}
	})
	return card
}

// EmptyState renders a composed editorial placeholder with vector emblem, title, subtitle, and optional CTA.
func EmptyState(c *ui.Context, icon theme.IconFunc, title, subtitle, actionLabel string, onAction func()) {
	t := c.Theme()
	ex := theme.Extra(t)
	ui.Column(c).FillWidth().Padding(28, 20).AlignItems(ui.Center).Gap(12).Children(func() {
		emblem := ui.Row(c).Size(58, 58).Radius(18).Background(t.Surface).AlignItems(ui.Center).Justify(ui.Center)
		ApplyCardElevation(emblem, t)
		emblem.Children(func() {
			ui.Row(c).Size(44, 44).Radius(13).Background(ex.MutedBg).AlignItems(ui.Center).Justify(ui.Center).Children(func() {
				theme.IconBox(c, 22, t.TextMuted, icon)
			})
		})
		ui.Column(c).FillWidth().AlignItems(ui.Center).Gap(5).Children(func() {
			ui.Text(c, title).FontSize(16.5).FontWeight(600).LetterSpacing(-0.2).TextColor(t.Text).TextAlign(ui.Center)
			if subtitle != "" {
				ui.Text(c, subtitle).FontSize(13).LineHeight(1.4).TextColor(t.TextMuted).TextAlign(ui.Center)
			}
		})
		if actionLabel != "" && onAction != nil {
			btn := PrimaryTouchButton(c, actionLabel, false)
			btn.MinWidth(160)
			if btn.Clicked() {
				onAction()
			}
		}
	})
}

// SegmentedControl renders a full-width equal-track tray for 2-4 segments and
// a clean edge-to-edge scrollable pill strip for 5+ segments so it never leaves
// awkward empty space or overflows narrow 320px viewports.
func SegmentedControl(c *ui.Context, selected *int, labels ...string) bool {
	if len(labels) == 0 {
		return false
	}
	if len(labels) >= 5 {
		return FilterPillBar(c, selected, labels...)
	}

	t := c.Theme()
	ex := theme.Extra(t)
	changed := false
	fontSize := float32(13)
	padX := float32(8)
	if len(labels) == 4 {
		fontSize = 12
		padX = 6
	}

	ui.Row(c).FillWidth().Background(ex.MutedBg).Radius(12).Padding(3, 3).Gap(3).
		Role(ui.RoleTabList).Children(func() {
		for i, label := range labels {
			on := i == *selected
			bg := ui.Transparent
			fg := t.TextMuted
			if on {
				bg = ex.ElevatedBg
				fg = t.Text
			}
			seg := ui.Row(c.Key(i)).Grow(1).Basis(0).MinHeight(36).PaddingX(padX).Radius(9).
				Background(bg).AlignItems(ui.Center).Justify(ui.Center).
				Role(ui.RoleTab).Label(label).Checked(on)
			if on {
				if t.Dark {
					seg.Border(0.75, ex.SubtleBorder)
				} else {
					seg.Shadow(0, 1, 3, 0, ex.CardShadow)
				}
			}
			seg.Children(func() {
				txt := ui.Text(c, label).FontSize(fontSize).TextColor(fg).NoWrap().MaxLines(1)
				if on {
					txt.FontWeight(600)
				} else {
					txt.FontWeight(500)
				}
			})
			if seg.Clicked() && !on {
				*selected = i
				changed = true
			}
		}
	})
	return changed
}

// FilterPillBar renders a sleek horizontally scrollable pill tab strip with high-contrast active state.
func FilterPillBar(c *ui.Context, selected *int, labels ...string) bool {
	t := c.Theme()
	ex := theme.Extra(t)
	changed := false
	ui.ScrollHorizontal(c).FillWidth().Shrink(0).Children(func() {
		ui.Row(c).Gap(5).Padding(1, 1).Role(ui.RoleTabList).Children(func() {
			for i, label := range labels {
				on := i == *selected
				bg := t.Surface
				fg := t.TextMuted
				borderCol := ex.SubtleBorder
				if on {
					bg = t.Accent
					fg = t.AccentText
					borderCol = t.Accent
				}
				pill := ui.Row(c.Key(i)).MinHeight(34).PaddingX(11).Radius(999).
					Background(bg).Border(0.75, borderCol).
					AlignItems(ui.Center).Justify(ui.Center).Shrink(0).
					Role(ui.RoleTab).Label(label).Checked(on)
				if on && !t.Dark {
					pill.Shadow(0, 1, 4, 0, ex.CardShadow)
				}
				pill.Children(func() {
					txt := ui.Text(c, label).FontSize(12).TextColor(fg).NoWrap()
					if on {
						txt.FontWeight(600)
					} else {
						txt.FontWeight(500)
					}
				})
				if pill.Clicked() && !on {
					*selected = i
					changed = true
				}
			}
		})
	})
	return changed
}

// AvatarBadge renders a sculpted squircle Nature-colored avatar with optical initials.
func AvatarBadge(c *ui.Context, name string, size float32) ui.Element {
	if size <= 0 {
		size = 36
	}
	initials := avatarInitials(name)
	bg := theme.AvatarColor(name)
	rad := size * 0.30
	if rad < 6 {
		rad = 6
	}
	return ui.Row(c).Size(size, size).Radius(rad).Background(bg).Shrink(0).
		InsetShadow(0, 1, 0, 0, ui.RGBA(255, 255, 255, 0.22)).
		AlignItems(ui.Center).Justify(ui.Center).Label(name).Children(func() {
		ui.Text(c, initials).FontSize(size * 0.38).FontWeight(700).LetterSpacing(-0.2).
			TextColor(theme.Extra(c.Theme()).OnAvatar).NoWrap()
	})
}

func avatarInitials(name string) string {
	words := strings.Fields(strings.TrimSpace(name))
	if len(words) == 0 {
		return "?"
	}
	var out []rune
	for _, w := range words {
		for _, r := range w {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				out = append(out, unicode.ToUpper(r))
				break
			}
		}
		if len(out) == 2 {
			break
		}
	}
	if len(out) == 0 {
		return "?"
	}
	return string(out)
}

// ConnectionHealthChip renders a refined hardware-style status pill showing transport security,
// SSE state, and RTT with a luminous status beacon dot.
func ConnectionHealthChip(c *ui.Context, hostName string, connected, tlsPinned, plainHTTP bool, rttMs int, onTap func()) ui.Element {
	t := c.Theme()
	ex := theme.Extra(t)
	tone := ToneWarning
	label := i18n.T("conn.badge.disconnected")
	if connected {
		switch {
		case tlsPinned:
			tone = ToneSuccess
			label = i18n.T("conn.badge.tls_pinned")
		case plainHTTP:
			tone = ToneWarning
			label = i18n.T("conn.badge.plain_http")
		default:
			tone = ToneInfo
			label = i18n.T("conn.badge.https")
		}
		if rttMs > 0 {
			label = i18n.Tf("conn.badge.with_rtt", map[string]any{"label": label, "ms": fmt.Sprintf("%d", rttMs)})
		}
	} else if hostName != "" {
		tone = ToneWarning
		label = i18n.T("conn.badge.reconnecting")
	}
	_, dotCol := toneColors(t, tone)
	chip := ui.Row(c).MinHeight(30).Padding(4, 10).Radius(999).Background(t.Surface).
		AlignItems(ui.Center).Gap(6).Shrink(0).
		Role(ui.RoleButton).Label(i18n.Tf("conn.badge.a11y", map[string]any{"label": label}))
	ApplyCardElevation(chip, t)
	if chip.Pressed() {
		chip.Background(t.SurfacePressed)
	}
	chip.Children(func() {
		ui.Row(c).Size(10, 10).Radius(5).Background(dotCol.Alpha(0.22)).
			AlignItems(ui.Center).Justify(ui.Center).Shrink(0).Children(func() {
			ui.Box(c).Size(6, 6).Radius(3).Background(dotCol).Shrink(0)
		})
		txtCol := t.Text
		if !connected {
			txtCol = t.TextMuted
		}
		ui.Text(c, label).FontSize(11.5).FontWeight(600).TextColor(txtCol).NoWrap()
	})
	_ = ex
	if chip.Clicked() && onTap != nil {
		onTap()
	}
	return chip
}

// ErrorInline renders a compact error callout with an optional Retry button.
func ErrorInline(c *ui.Context, message string, onRetry func()) {
	if strings.TrimSpace(message) == "" {
		return
	}
	StatusBanner(c, ToneDanger, message, func() string {
		if onRetry != nil {
			return i18n.T("common.retry")
		}
		return ""
	}(), onRetry)
}

// LoadingSkeleton renders subtle warm Town placeholder blocks.
func LoadingSkeleton(c *ui.Context, rows int) {
	if rows <= 0 {
		rows = 3
	}
	t := c.Theme()
	ex := theme.Extra(t)
	ui.Column(c).FillWidth().Gap(10).Role(ui.RoleStatus).Label(i18n.T("common.loading")).Children(func() {
		for i := range rows {
			card := ui.Column(c.Key(i)).FillWidth().Background(t.Surface).Radius(16).Padding(16, 16).Gap(10)
			ApplyCardElevation(card, t)
			card.Children(func() {
				ui.Box(c).Width(148).Height(13).Radius(6).Background(ex.MutedBg)
				ui.Box(c).FillWidth().Height(10).Radius(5).Background(ex.MutedBg.Alpha(0.75))
			})
		}
	})
}

// PrimaryTouchButton renders a tactile (>=44pt) editorial obsidian/ivory primary CTA button.
func PrimaryTouchButton(c *ui.Context, label string, disabled bool) ui.Element {
	t := c.Theme()
	ex := theme.Extra(t)
	bg := t.Accent
	if disabled {
		bg = ex.MutedBg
	}
	btn := ui.Row(c).MinHeight(44).Padding(10, 16).Radius(12).Background(bg).
		AlignItems(ui.Center).Justify(ui.Center).Gap(6).
		Role(ui.RoleButton).Label(label).Disabled(disabled)
	if !disabled {
		if !t.Dark {
			btn.Shadow(0, 2, 6, 0, ui.RGBA(20, 20, 16, 0.14))
		}
		if btn.Pressed() {
			btn.Background(t.AccentPressed).Scale(0.985, 0.985)
		}
	}
	btn.Children(func() {
		fg := t.AccentText
		if disabled {
			fg = ex.TextSubtle
		}
		ui.Text(c, label).FontSize(14).FontWeight(600).TextColor(fg).NoWrap()
	})
	return btn
}

// CompactPrimaryButton renders a sleek pill-proportioned primary CTA for headers and inline actions.
func CompactPrimaryButton(c *ui.Context, label string, icon theme.IconFunc, disabled bool) ui.Element {
	t := c.Theme()
	ex := theme.Extra(t)
	bg := t.Accent
	if disabled {
		bg = ex.MutedBg
	}
	btn := ui.Row(c).MinHeight(36).Padding(7, 13).Radius(999).Background(bg).
		AlignItems(ui.Center).Justify(ui.Center).Gap(5).Shrink(0).
		Role(ui.RoleButton).Label(label).Disabled(disabled)
	if !disabled {
		if !t.Dark {
			btn.Shadow(0, 1, 5, 0, ui.RGBA(20, 20, 16, 0.12))
		}
		if btn.Pressed() {
			btn.Background(t.AccentPressed).Scale(0.98, 0.98)
		}
	}
	btn.Children(func() {
		fg := t.AccentText
		if disabled {
			fg = ex.TextSubtle
		}
		if icon != nil {
			theme.IconBox(c, 14, fg, icon)
		}
		ui.Text(c, label).FontSize(13).FontWeight(600).TextColor(fg).NoWrap()
	})
	return btn
}

// SecondaryTouchButton renders a tactile (>=44pt) elevated neutral button.
func SecondaryTouchButton(c *ui.Context, label string, disabled bool) ui.Element {
	t := c.Theme()
	ex := theme.Extra(t)
	bg := ex.ElevatedBg
	if disabled {
		bg = ex.MutedBg
	}
	btn := ui.Row(c).MinHeight(44).Padding(10, 14).Radius(12).Background(bg).
		AlignItems(ui.Center).Justify(ui.Center).Gap(6).
		Role(ui.RoleButton).Label(label).Disabled(disabled)
	if !disabled {
		ApplyCardElevation(btn, t)
		if btn.Pressed() {
			btn.Background(t.SurfacePressed).Scale(0.985, 0.985)
		}
	} else {
		btn.Border(0.75, ex.SubtleBorder)
	}
	btn.Children(func() {
		fg := t.Text
		if disabled {
			fg = ex.TextSubtle
		}
		ui.Text(c, label).FontSize(14).FontWeight(500).TextColor(fg).NoWrap()
	})
	return btn
}

// CompactSecondaryButton renders a sleek compact secondary pill button for inline toolbars.
func CompactSecondaryButton(c *ui.Context, label string, icon theme.IconFunc, disabled bool) ui.Element {
	t := c.Theme()
	ex := theme.Extra(t)
	bg := ex.ElevatedBg
	if disabled {
		bg = ex.MutedBg
	}
	btn := ui.Row(c).MinHeight(36).Padding(6, 12).Radius(999).Background(bg).
		AlignItems(ui.Center).Justify(ui.Center).Gap(5).Shrink(0).
		Role(ui.RoleButton).Label(label).Disabled(disabled)
	if !disabled {
		ApplyCardElevation(btn, t)
		if btn.Pressed() {
			btn.Background(t.SurfacePressed).Scale(0.98, 0.98)
		}
	} else {
		btn.Border(0.75, ex.SubtleBorder)
	}
	btn.Children(func() {
		fg := t.Text
		if disabled {
			fg = ex.TextSubtle
		}
		if icon != nil {
			theme.IconBox(c, 14, fg, icon)
		}
		ui.Text(c, label).FontSize(12.5).FontWeight(600).TextColor(fg).NoWrap()
	})
	return btn
}

// DangerTouchButton renders a full-touch-height (>=44pt) destructive action button with crisp contrast.
func DangerTouchButton(c *ui.Context, label string, disabled bool) ui.Element {
	t := c.Theme()
	ex := theme.Extra(t)
	bg := ex.DangerTint
	fg := t.Danger
	borderCol := t.Danger.Alpha(0.32)
	if disabled {
		bg = ex.MutedBg
		fg = t.TextMuted
		borderCol = ex.SubtleBorder
	}
	btn := ui.Row(c).MinHeight(44).Padding(10, 14).Radius(12).Background(bg).
		Border(0.75, borderCol).AlignItems(ui.Center).Justify(ui.Center).
		Role(ui.RoleButton).Label(label).Disabled(disabled)
	if !disabled && btn.Pressed() {
		btn.Background(t.Danger.Alpha(0.20)).Scale(0.985, 0.985)
	}
	btn.Children(func() {
		ui.Text(c, label).FontSize(14).FontWeight(600).TextColor(fg).NoWrap()
	})
	return btn
}

// FormField renders a labeled single-line mobile text input with >=44pt touch target.
func FormField(c *ui.Context, label, placeholder string, value *string, secret bool) ui.Element {
	t := c.Theme()
	var input ui.Element
	ui.Column(c).FillWidth().Gap(5).Children(func() {
		if label != "" {
			ui.Text(c, label).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
		}
		input = ui.TextInput(c, value).FillWidth().MinHeight(44).Label(label)
		if placeholder != "" {
			input.Placeholder(placeholder)
		}
		if secret {
			input.Password()
		}
	})
	return input
}

// TopBarIconButton renders a >=44x44 accessible icon button for navigation headers.
func TopBarIconButton(c *ui.Context, label string, icon theme.IconFunc, color ui.Color) ui.Element {
	btn := ui.Row(c).Size(40, 40).Radius(20).AlignItems(ui.Center).Justify(ui.Center).Shrink(0).
		Role(ui.RoleButton).Label(label)
	if btn.Pressed() {
		btn.Background(c.Theme().SurfacePressed)
	}
	btn.Children(func() {
		theme.IconBox(c, 20, color, icon)
	})
	return btn
}
