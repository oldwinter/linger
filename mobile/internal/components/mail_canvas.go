package components

import (
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// MailCanvasCallbacks wires real TeamHub Mail Canvas actions (send/decline).
type MailCanvasCallbacks struct {
	OnSend    func(docID string, state api.MailCanvasState)
	OnDecline func(docID string, state api.MailCanvasState)
}

// MailCanvasCard renders a TeamHub Mail Canvas preview with Send / Send again / Don't send
// actions echoing SourceDigest so only the reviewed version is delivered.
func MailCanvasCard(c *ui.Context, docID string, mail api.MailCanvasState, busy bool, cb MailCanvasCallbacks) ui.Element {
	t := c.Theme()
	ex := theme.Extra(t)

	statusTone := ToneInfo
	railColor := ex.Info
	switch strings.ToLower(mail.Status) {
	case "sent":
		statusTone = ToneSuccess
		railColor = t.Success
	case "declined", "failed":
		statusTone = ToneDanger
		railColor = t.Danger
	case "sending":
		statusTone = ToneWarning
		railColor = t.Warning
	}

	card := ui.Column(c).FillWidth().Background(t.Surface).Radius(16).Clip().
		Padding(14, 15, 14, 18).Gap(10).Role(ui.RoleGroup).
		Label(i18n.Tf("mail.title", map[string]any{"subject": mail.Subject}))
	ApplyCardElevation(card, t)
	card.DrawOver(func(p *ui.Painter, r ui.Rect) {
		p.Fill(ui.Rect{X: r.X, Y: r.Y + 10, W: 3.5, H: r.H - 20}, railColor, 2)
	})

	return card.Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
			ui.Text(c, i18n.T("mail.draft_fallback")).FontSize(11.5).FontWeight(700).LetterSpacing(0.3).TextColor(t.TextMuted)
			StatusDotPill(c, i18n.StatusLabel(mail.Status), statusTone)
		})
		ui.Column(c).FillWidth().Gap(3).Children(func() {
			ui.Text(c, mail.Subject).FontSize(15.5).FontWeight(600).LetterSpacing(-0.2).TextColor(t.Text)
			if mail.To != "" {
				ui.Text(c, i18n.Tf("mail.to", map[string]any{"list": mail.To})).FontSize(12.5).TextColor(t.TextMuted)
			}
		})
		if strings.TrimSpace(mail.Body) != "" {
			ui.Column(c).FillWidth().Padding(10, 12).Radius(12).Background(ex.MutedBg).Children(func() {
				ui.Text(c, mail.Body).FontSize(13).LineHeight(1.45).TextColor(t.Text)
			})
		}
		if mail.Error != nil && *mail.Error != "" {
			ErrorInline(c, *mail.Error, nil)
		}
		if mail.SourceDigest != "" {
			shortDigest := mail.SourceDigest
			if len(shortDigest) > 18 {
				shortDigest = shortDigest[:18] + "..."
			}
			ui.Text(c, i18n.Tf("mail.digest", map[string]any{"digest": shortDigest})).FontSize(11).TextColor(ex.TextSubtle)
		}

		if mail.CanEdit && mail.Status != "declined" {
			sendLabel := i18n.T("mail.send")
			if mail.Status == "sent" || mail.Status == "failed" {
				sendLabel = i18n.T("mail.send_again")
			}
			if busy {
				sendLabel = i18n.T("mail.sending")
			}
			ui.Row(c).FillWidth().Gap(8).Children(func() {
				sendBtn := PrimaryTouchButton(c, sendLabel, busy)
				sendBtn.Grow(1).Basis(0)
				if sendBtn.Clicked() && cb.OnSend != nil {
					cb.OnSend(docID, mail)
				}
				declineBtn := SecondaryTouchButton(c, i18n.T("mail.dont_send"), busy)
				declineBtn.Grow(1).Basis(0)
				if declineBtn.Clicked() && cb.OnDecline != nil {
					cb.OnDecline(docID, mail)
				}
			})
		}
	})
}
