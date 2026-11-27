package components

import (
	"math"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// ActionSheet renders a Town Atelier bottom action/confirmation sheet built on
// mobile.Sheet so Title, full descriptive Message, destructive/standard actions,
// and an explicit Cancel button are rendered consistently across BOTH Cupertino
// (iOS/macOS) and Material (Android/Linux) styles.
func ActionSheet(c *ui.Context, open *bool, o mobile.ActionSheetOptions, actions ...mobile.Action) {
	cancelLabel := strings.TrimSpace(o.Cancel)
	if cancelLabel == "" {
		cancelLabel = i18n.T("common.cancel")
	}
	title := strings.TrimSpace(o.Title)
	message := strings.TrimSpace(o.Message)
	sheetLabel := title
	if sheetLabel == "" {
		sheetLabel = cancelLabel
	}

	t := c.Theme()
	winW, winH := c.Size()
	_, _, bottom, _ := c.SafeArea()

	cardMaxW := float32(480)
	availW := min(max(winW-20, 220), cardMaxW) - 32
	const (
		rowH    float32 = 52
		cancelH float32 = 52
	)

	headerH := float32(0)
	if title != "" || message != "" {
		headerH = 30
		if title != "" {
			headerH += float32(estimateSheetWrappedLines(title, availW, 14.5)) * 22
		}
		if message != "" {
			headerH += float32(estimateSheetWrappedLines(message, availW, 13)) * 20
		}
		if title != "" && message != "" {
			headerH += 4
		}
	}

	actionsH := rowH * float32(len(actions))
	if len(actions) > 1 {
		actionsH += float32(len(actions) - 1)
	}
	chromeH := float32(32) + bottom
	need := headerH + actionsH + cancelH + chromeH
	scrollable := need > winH*0.86
	detent := min(max(need/max(winH, 1), 0.22), 0.90)

	bg := ui.RGBA(0, 0, 0, 0)
	mobile.Sheet(c, open, mobile.SheetOptions{
		Detents:    []float32{detent},
		NoGrabber:  true,
		Background: &bg,
		Label:      sheetLabel,
	}, func() {
		outer := ui.Column(c).FillWidth().Grow(1).Padding(0, 10, 10, 10).Gap(8).Justify(ui.End)
		if winW > cardMaxW+20 {
			outer.MaxWidth(cardMaxW).AlignSelf(ui.Center)
		}
		outer.Children(func() {
			card := ui.Column(c).FillWidth().Background(t.Surface).Radius(16).Clip()
			ApplyCardElevation(card, t)
			if scrollable {
				card.Grow(1).Basis(0)
			}
			card.Children(func() {
				if title != "" || message != "" {
					ui.Column(c).FillWidth().Padding(14, 16).AlignItems(ui.Center).Gap(4).Shrink(0).Children(func() {
						if title != "" {
							ui.Text(c, title).FontSize(14.5).FontWeight(600).LineHeight(1.3).TextColor(t.Text).TextAlign(ui.Center)
						}
						if message != "" {
							ui.Text(c, message).FontSize(13).LineHeight(1.38).TextColor(t.TextMuted).TextAlign(ui.Center)
						}
					})
					InsetDivider(c, 0)
				}

				renderActions := func() {
					ui.Column(c).FillWidth().Children(func() {
						for i, a := range actions {
							if i > 0 {
								InsetDivider(c, 0)
							}
							renderActionSheetRow(c, i, a, open, rowH, t)
						}
					})
				}

				if scrollable {
					ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(renderActions)
				} else {
					renderActions()
				}
			})

			cancelCard := ui.Row(c).FillWidth().MinHeight(cancelH).Padding(8, 16).Radius(16).
				Background(t.Surface).AlignItems(ui.Center).Justify(ui.Center).Shrink(0).
				Role(ui.RoleButton).Label(cancelLabel)
			ApplyCardElevation(cancelCard, t)
			if mobile.Current() == mobile.Material {
				mobile.Ink(cancelCard)
			} else if cancelCard.Pressed() {
				cancelCard.Background(t.SurfacePressed)
			}
			cancelCard.Children(func() {
				ui.Text(c, cancelLabel).FontSize(16).FontWeight(600).TextColor(t.Text).NoWrap()
			})
			if cancelCard.Clicked() {
				*open = false
			}
		})
	})
}

func renderActionSheetRow(c *ui.Context, idx int, a mobile.Action, open *bool, minH float32, t *ui.Theme) {
	ex := theme.Extra(t)
	fg := t.Accent
	if a.Destructive {
		fg = t.Danger
	}
	if a.Disabled {
		fg = t.TextMuted
	}
	row := ui.Row(c.Key(idx)).FillWidth().MinHeight(minH).Padding(8, 16).
		AlignItems(ui.Center).Justify(ui.Center).
		Role(ui.RoleButton).Label(a.Label).Disabled(a.Disabled)
	if !a.Disabled {
		if mobile.Current() == mobile.Material {
			mobile.Ink(row)
		} else if row.Pressed() {
			if a.Destructive {
				row.Background(ex.DangerTint)
			} else {
				row.Background(t.SurfacePressed)
			}
		}
	}
	row.Children(func() {
		weight := 500
		if a.Destructive {
			weight = 600
		}
		ui.Text(c, a.Label).FontSize(16).FontWeight(weight).TextColor(fg).TextAlign(ui.Center)
	})
	if row.Clicked() && !a.Disabled {
		*open = false
		if a.OnTap != nil {
			a.OnTap()
		}
	}
}

func estimateSheetWrappedLines(text string, availWidth, fontSize float32) int {
	if strings.TrimSpace(text) == "" {
		return 0
	}
	maxW := max(availWidth, 160)
	total := 0
	for _, para := range strings.Split(text, "\n") {
		if para == "" {
			total++
			continue
		}
		est := float32(0)
		for _, r := range para {
			if r <= 0x7f {
				est += fontSize * 0.65
			} else {
				est += fontSize * 1.08
			}
		}
		// Add 15% safety margin for wider Linux/Android system fonts (DejaVu/Noto).
		lines := int(math.Ceil(float64(est*1.15) / float64(maxW)))
		if lines < 1 {
			lines = 1
		}
		total += lines
	}
	return total
}
