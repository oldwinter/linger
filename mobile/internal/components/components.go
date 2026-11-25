// Package components provides narrow-screen-safe (320px-430px), accessible
// mobile UI primitives built with Linger's Town theme and >=44pt touch targets.
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
	ToneInfo    Tone = "info"
	ToneSuccess Tone = "success"
	ToneWarning Tone = "warning"
	ToneDanger  Tone = "danger"
)

func toneColors(t *ui.Theme, tone Tone) (bg, fg ui.Color) {
	ex := theme.Extra(t)
	switch tone {
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

// StatusBanner renders a full-width inline status/error banner with optional action.
// Callers omit it once transient state recovers so stale banners never linger.
func StatusBanner(c *ui.Context, tone Tone, message, actionLabel string, onAction func()) {
	if strings.TrimSpace(message) == "" {
		return
	}
	t := c.Theme()
	bg, fg := toneColors(t, tone)
	ui.Row(c).FillWidth().Background(bg).Radius(10).Padding(10, 12).Gap(10).AlignItems(ui.Center).
		Border(1, fg.Alpha(0.28)).Role(ui.RoleStatus).Label(message).Children(func() {
		icon := theme.IconShield
		if tone == ToneDanger || tone == ToneWarning {
			icon = theme.IconAlert
		} else if tone == ToneSuccess {
			icon = theme.IconCheck
		}
		theme.IconBox(c, 18, fg, icon)
		ui.Text(c, message).Grow(1).Basis(0).FontSize(13).TextColor(t.Text)
		if actionLabel != "" && onAction != nil {
			btn := ui.Row(c).MinHeight(36).PaddingX(10).Radius(8).Background(t.Surface).
				Border(1, fg.Alpha(0.35)).AlignItems(ui.Center).Justify(ui.Center).
				Role(ui.RoleButton).Label(actionLabel)
			btn.Children(func() {
				ui.Text(c, actionLabel).FontSize(12).Bold().TextColor(fg).NoWrap()
			})
			if btn.Clicked() {
				onAction()
			}
		}
	})
}

// StatusPill renders a compact semantic pill tag that never overflows narrow viewports.
func StatusPill(c *ui.Context, label string, tone Tone) ui.Element {
	t := c.Theme()
	bg, fg := toneColors(t, tone)
	return ui.Row(c).Padding(3, 8).Radius(999).Background(bg).AlignItems(ui.Center).Shrink(0).
		Role(ui.RoleStatus).Label(label).Children(func() {
		ui.Text(c, label).FontSize(11).FontWeight(600).TextColor(fg).NoWrap()
	})
}

// SectionCard wraps related content in a clean Town Light/Dark surface card.
func SectionCard(c *ui.Context, title, subtitle string, trailing func(), body func()) ui.Element {
	t := c.Theme()
	card := ui.Column(c).FillWidth().Background(t.Surface).Radius(12).
		Border(1, t.Border).Padding(14, 14).Gap(10)
	card.Children(func() {
		if title != "" || trailing != nil {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
					if title != "" {
						ui.Text(c, title).FontSize(15).FontWeight(600).TextColor(t.Text)
					}
					if subtitle != "" {
						ui.Text(c, subtitle).FontSize(12).TextColor(t.TextMuted)
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

// EmptyState renders a centered placeholder with vector icon, title, subtitle, and optional CTA.
func EmptyState(c *ui.Context, icon theme.IconFunc, title, subtitle, actionLabel string, onAction func()) {
	t := c.Theme()
	ex := theme.Extra(t)
	ui.Column(c).FillWidth().Padding(24, 16).AlignItems(ui.Center).Gap(10).Children(func() {
		ui.Row(c).Size(52, 52).Radius(26).Background(ex.MutedBg).AlignItems(ui.Center).Justify(ui.Center).Children(func() {
			theme.IconBox(c, 26, t.TextMuted, icon)
		})
		ui.Text(c, title).FontSize(16).FontWeight(600).TextColor(t.Text).TextAlign(ui.Center)
		if subtitle != "" {
			ui.Text(c, subtitle).FontSize(13).TextColor(t.TextMuted).TextAlign(ui.Center)
		}
		if actionLabel != "" && onAction != nil {
			if PrimaryTouchButton(c, actionLabel, false).Clicked() {
				onAction()
			}
		}
	})
}

// SegmentedControl renders a horizontally safe segmented tab selector with >=44pt tap height.
func SegmentedControl(c *ui.Context, selected *int, labels ...string) bool {
	t := c.Theme()
	ex := theme.Extra(t)
	changed := false
	padX := float32(12)
	fontSize := float32(13)
	if len(labels) >= 5 {
		padX = 9
		fontSize = 12
	}
	ui.ScrollHorizontal(c).FillWidth().Shrink(0).Children(func() {
		ui.Row(c).Background(ex.MutedBg).Radius(10).Padding(3, 3).Gap(4).Role(ui.RoleTabList).Children(func() {
			for i, label := range labels {
				on := i == *selected
				bg := ui.Transparent
				fg := t.TextMuted
				if on {
					bg = t.Surface
					fg = t.Text
				}
				seg := ui.Row(c.Key(i)).MinHeight(38).PaddingX(padX).Radius(8).Background(bg).
					AlignItems(ui.Center).Justify(ui.Center).Shrink(0).
					Role(ui.RoleTab).Label(label).Checked(on)
				if on {
					seg.Border(1, t.Border)
				}
				seg.Children(func() {
					txt := ui.Text(c, label).FontSize(fontSize).TextColor(fg).NoWrap()
					if on {
						txt.FontWeight(600)
					}
				})
				if seg.Clicked() && !on {
					*selected = i
					changed = true
				}
			}
		})
	})
	return changed
}

// AvatarBadge renders a circular Nature-colored avatar with 1-2 initials.
func AvatarBadge(c *ui.Context, name string, size float32) ui.Element {
	if size <= 0 {
		size = 36
	}
	initials := avatarInitials(name)
	bg := theme.AvatarColor(name)
	return ui.Row(c).Size(size, size).Radius(size / 2).Background(bg).Shrink(0).
		AlignItems(ui.Center).Justify(ui.Center).Label(name).Children(func() {
		ui.Text(c, initials).FontSize(size * 0.38).Bold().TextColor(theme.Extra(c.Theme()).OnAvatar).NoWrap()
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

// ConnectionHealthChip renders a compact, tappable connection status pill
// showing host transport security (TLS Pinned vs Plain HTTP), SSE state, and RTT.
func ConnectionHealthChip(c *ui.Context, hostName string, connected, tlsPinned, plainHTTP bool, rttMs int, onTap func()) ui.Element {
	t := c.Theme()
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
	bg, fg := toneColors(t, tone)
	chip := ui.Row(c).MinHeight(32).Padding(4, 10).Radius(999).Background(bg).
		Border(1, fg.Alpha(0.28)).AlignItems(ui.Center).Gap(6).Shrink(0).
		Role(ui.RoleButton).Label(i18n.Tf("conn.badge.a11y", map[string]any{"label": label}))
	chip.Children(func() {
		ui.Box(c).Size(7, 7).Radius(4).Background(fg).Shrink(0)
		ui.Text(c, label).FontSize(11).FontWeight(600).TextColor(fg).NoWrap()
	})
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

// LoadingSkeleton renders subtle warm Town shimmer-style placeholder blocks.
func LoadingSkeleton(c *ui.Context, rows int) {
	if rows <= 0 {
		rows = 3
	}
	ex := theme.Extra(c.Theme())
	ui.Column(c).FillWidth().Gap(10).Role(ui.RoleStatus).Label(i18n.T("common.loading")).Children(func() {
		for i := range rows {
			ui.Column(c.Key(i)).FillWidth().Background(c.Theme().Surface).Radius(12).
				Border(1, c.Theme().Border).Padding(14, 14).Gap(8).Children(func() {
				ui.Box(c).Width(160).Height(14).Radius(6).Background(ex.MutedBg)
				ui.Box(c).FillWidth().Height(11).Radius(5).Background(ex.MutedBg)
			})
		}
	})
}

// PrimaryTouchButton renders a full-touch-height (>=44pt) primary CTA button.
func PrimaryTouchButton(c *ui.Context, label string, disabled bool) ui.Element {
	t := c.Theme()
	bg := t.Accent
	if disabled {
		bg = t.Border
	}
	btn := ui.Row(c).MinHeight(44).Padding(10, 16).Radius(10).Background(bg).
		AlignItems(ui.Center).Justify(ui.Center).Role(ui.RoleButton).Label(label).Disabled(disabled)
	if !disabled && btn.Pressed() {
		btn.Background(t.AccentPressed)
	}
	btn.Children(func() {
		fg := t.AccentText
		if disabled {
			fg = t.TextMuted
		}
		ui.Text(c, label).FontSize(14).FontWeight(600).TextColor(fg).NoWrap()
	})
	return btn
}

// SecondaryTouchButton renders a full-touch-height (>=44pt) outlined button.
func SecondaryTouchButton(c *ui.Context, label string, disabled bool) ui.Element {
	t := c.Theme()
	btn := ui.Row(c).MinHeight(44).Padding(10, 14).Radius(10).Background(t.Surface).
		Border(1, t.Border).AlignItems(ui.Center).Justify(ui.Center).
		Role(ui.RoleButton).Label(label).Disabled(disabled)
	if !disabled && btn.Pressed() {
		btn.Background(t.SurfacePressed)
	}
	btn.Children(func() {
		fg := t.Text
		if disabled {
			fg = t.TextMuted
		}
		ui.Text(c, label).FontSize(14).FontWeight(500).TextColor(fg).NoWrap()
	})
	return btn
}

// DangerTouchButton renders a full-touch-height (>=44pt) destructive action button.
func DangerTouchButton(c *ui.Context, label string, disabled bool) ui.Element {
	t := c.Theme()
	ex := theme.Extra(t)
	fg := t.Danger
	borderCol := t.Danger.Alpha(0.42)
	if disabled {
		fg = t.Danger.Alpha(0.55)
		borderCol = t.Danger.Alpha(0.22)
	}
	btn := ui.Row(c).MinHeight(44).Padding(10, 14).Radius(10).Background(ex.DangerTint).
		Border(1, borderCol).AlignItems(ui.Center).Justify(ui.Center).
		Role(ui.RoleButton).Label(label).Disabled(disabled)
	btn.Children(func() {
		ui.Text(c, label).FontSize(14).FontWeight(600).TextColor(fg).NoWrap()
	})
	return btn
}

// Plural formats a count with grammatically correct singular or plural noun.
func Plural(n int64, singular, plural string) string {
	if n == 1 || n == -1 {
		return fmt.Sprintf("%d %s", n, singular)
	}
	return fmt.Sprintf("%d %s", n, plural)
}

// PluralInt formats an int count with grammatically correct singular or plural noun.
func PluralInt(n int, singular, plural string) string {
	return Plural(int64(n), singular, plural)
}

// FormField renders a labeled single-line mobile text input with >=44pt touch target.
func FormField(c *ui.Context, label, placeholder string, value *string, secret bool) ui.Element {
	t := c.Theme()
	var input ui.Element
	ui.Column(c).FillWidth().Gap(4).Children(func() {
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

// TopBarIconButton renders a >=44x44 accessible icon button for mobile.TopBar slots.
func TopBarIconButton(c *ui.Context, label string, icon theme.IconFunc, color ui.Color) ui.Element {
	btn := ui.Row(c).Size(44, 44).Radius(22).AlignItems(ui.Center).Justify(ui.Center).
		Role(ui.RoleButton).Label(label)
	if btn.Pressed() {
		btn.Background(c.Theme().SurfacePressed)
	}
	btn.Children(func() {
		theme.IconBox(c, 22, color, icon)
	})
	return btn
}
