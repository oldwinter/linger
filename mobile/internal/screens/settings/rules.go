package settings

import (
	"context"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func (s *Screen) viewRulesSection(c *ui.Context) {
	t := c.Theme()

	s.mu.Lock()
	book := s.ruleBook
	s.mu.Unlock()

	var shadowRules []api.ProactiveRule
	var activeRules []api.ProactiveRule
	for _, r := range book.Rules {
		if r.Status == "shadow" {
			shadowRules = append(shadowRules, r)
		} else {
			activeRules = append(activeRules, r)
		}
	}

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SectionRules]).Children(func() {
		layout.ReadableWrap(c, layout.Of(c).ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				if s.ruleError != "" {
					components.StatusBanner(c, components.ToneDanger, s.ruleError, i18n.T("common.dismiss"), func() {
						s.ruleError = ""
					})
				}

				// Shadow Rule Review
				if len(shadowRules) > 0 || len(book.Divergences) > 0 {
					components.SectionCard(c, i18n.Tf("settings.rules.shadow_title", map[string]any{"count": len(shadowRules)}),
						i18n.T("settings.rules.shadow_sub"), func() {
							components.StatusPill(c, i18n.T("settings.rules.review_badge"), components.ToneWarning)
						}, func() {
							for _, sr := range shadowRules {
								sr := sr
								busy := s.ruleBusyID == sr.ID
								ui.Column(c.Key("sh:"+sr.ID)).FillWidth().Padding(12, 12).Gap(8).
									Radius(12).Background(theme.Extra(t).WarnTint).Border(0.75, t.Warning.Alpha(0.28)).Children(func() {
									ui.Text(c, sr.Text).FontSize(14).FontWeight(600).TextColor(t.Text)
									for _, d := range book.Divergences {
										if d.RuleID == sr.ID {
											ui.Text(c, i18n.Tf("settings.rules.divergence", map[string]any{
												"trigger": d.Matter,
												"actual":  d.TakenAction,
												"shadow":  d.ShadowAction,
											})).FontSize(12).TextColor(t.TextMuted)
										}
									}
									ui.Row(c).FillWidth().Gap(8).Children(func() {
										promBtn := components.PrimaryTouchButton(c, i18n.T("settings.rules.promote"), busy)
										promBtn.Grow(1).Basis(0)
										if promBtn.Clicked() {
											s.promoteRuleAsync(sr.ID)
										}
										disBtn := components.DangerTouchButton(c, i18n.T("common.dismiss"), busy)
										if disBtn.Clicked() {
											cp := sr
											s.ruleDismissItem = &cp
											s.ruleDismissSheet = true
										}
									})
								})
							}
						})
				}

				// Active Rules
				components.SectionCard(c, i18n.Tf("settings.rules.active_title", map[string]any{"count": len(activeRules)}),
					i18n.T("settings.rules.active_sub"), nil, func() {
						if len(activeRules) == 0 {
							ui.Text(c, i18n.T("settings.rules.active_empty")).
								FontSize(13).TextColor(t.TextMuted)
							return
						}
						ui.Column(c).FillWidth().Gap(10).Children(func() {
							for _, r := range activeRules {
								r := r
								busy := s.ruleBusyID == r.ID
								ui.Column(c.Key("act:"+r.ID)).FillWidth().Padding(12, 12).Gap(8).
									Radius(12).Background(theme.Extra(t).MutedBg).Border(0.75, theme.Extra(t).SubtleBorder).Children(func() {
									ui.Text(c, r.Text).FontSize(14).FontWeight(600).TextColor(t.Text)
									ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
										components.StatusPill(c, i18n.Tf("settings.rules.source_prefix", map[string]any{"src": i18n.RuleSourceLabel(r.Source)}), components.ToneNeutral)
										components.StatusPill(c, i18n.Tf("settings.rules.mandate_prefix", map[string]any{"mandate": i18n.RuleMandateLabel(r.Mandate)}), components.ToneInfo)
										if r.Pinned {
											components.StatusPill(c, i18n.T("settings.rules.pinned"), components.ToneSuccess)
										}
									})
									ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
										pinLbl := i18n.T("settings.rules.pin")
										if r.Pinned {
											pinLbl = i18n.T("settings.rules.unpin")
										}
										pinBtn := components.SecondaryTouchButton(c, pinLbl, busy)
										if pinBtn.Clicked() {
											s.pinRuleAsync(r.ID, !r.Pinned)
										}
										mBtn := components.SecondaryTouchButton(c, i18n.T("settings.rules.mandate_btn"), busy)
										if mBtn.Clicked() {
											cp := r
											s.ruleMandateItem = &cp
											s.ruleMandateSheet = true
										}
										eBtn := components.SecondaryTouchButton(c, i18n.T("common.edit"), busy)
										if eBtn.Clicked() {
											s.ruleEditID = r.ID
											s.ruleEditText = r.Text
											s.ruleEditErr = ""
											s.ruleEditOpen = true
										}
										dBtn := components.DangerTouchButton(c, i18n.T("common.delete"), busy)
										if dBtn.Clicked() {
											cp := r
											s.ruleDeleteItem = &cp
											s.ruleDeleteSheet = true
										}
									})
								})
							}
						})
					})
			})
		})
	})
}

func (s *Screen) promoteRuleAsync(ruleID string) {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" || s.ruleBusyID != "" {
		return
	}
	s.ruleBusyID = ruleID
	s.ruleError = ""
	go func() {
		book, err := client.PromoteProactiveRuleBook(context.Background(), tenantID, ruleID)
		s.enqueueUI(func() {
			s.ruleBusyID = ""
			if err != nil {
				s.ruleError = api.PresentError(err)
				return
			}
			s.mu.Lock()
			s.ruleBook = book
			s.mu.Unlock()
			s.toast(i18n.T("settings.rules.toast.promoted"))
		})
	}()
}

func (s *Screen) pinRuleAsync(ruleID string, pinned bool) {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" || s.ruleBusyID != "" {
		return
	}
	s.ruleBusyID = ruleID
	s.ruleError = ""
	go func() {
		book, err := client.SetProactiveRulePinBook(context.Background(), tenantID, ruleID, pinned)
		s.enqueueUI(func() {
			s.ruleBusyID = ""
			if err != nil {
				s.ruleError = api.PresentError(err)
				return
			}
			s.mu.Lock()
			s.ruleBook = book
			s.mu.Unlock()
		})
	}()
}

func (s *Screen) setRuleMandateAsync(ruleID, mandate string) {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" {
		return
	}
	s.ruleBusyID = ruleID
	s.ruleError = ""
	go func() {
		book, err := client.SetProactiveRuleMandateBook(context.Background(), tenantID, ruleID, mandate)
		s.enqueueUI(func() {
			s.ruleBusyID = ""
			if err != nil {
				s.ruleError = api.PresentError(err)
				return
			}
			s.mu.Lock()
			s.ruleBook = book
			s.mu.Unlock()
			s.toast(i18n.T("settings.rules.toast.mandate_updated"))
		})
	}()
}

func (s *Screen) deleteRuleAsync(ruleID string) {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" {
		return
	}
	s.ruleBusyID = ruleID
	s.ruleError = ""
	go func() {
		book, err := client.DeleteProactiveRuleBook(context.Background(), tenantID, ruleID)
		s.enqueueUI(func() {
			s.ruleBusyID = ""
			if err != nil {
				s.ruleError = api.PresentError(err)
				return
			}
			s.mu.Lock()
			s.ruleBook = book
			s.mu.Unlock()
			s.toast(i18n.T("settings.rules.toast.removed"))
		})
	}()
}

func (s *Screen) viewRuleEditSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.ruleEditOpen, mobile.SheetOptions{
		Detents: []float32{0.52},
		Label:   i18n.T("settings.rules.edit_a11y"),
	}, func() {
		ui.Column(c).FillWidth().Padding(14, 16, 24, 16).Gap(12).Children(func() {
			ui.Text(c, i18n.T("settings.rules.edit_title")).FontSize(18).Bold().TextColor(t.Text)
			if s.ruleEditErr != "" {
				components.StatusBanner(c, components.ToneDanger, s.ruleEditErr, i18n.T("common.dismiss"), func() {
					s.ruleEditErr = ""
				})
			}
			ui.TextArea(c, &s.ruleEditText).FillWidth().MinHeight(88).Label(i18n.T("settings.rules.rule_text_label"))
			saveLbl := i18n.T("settings.rules.save_rule")
			if s.ruleEditBusy {
				saveLbl = i18n.T("common.saving")
			}
			btn := components.PrimaryTouchButton(c, saveLbl, s.ruleEditBusy || strings.TrimSpace(s.ruleEditText) == "")
			btn.FillWidth()
			if btn.Clicked() {
				s.submitRuleEdit()
			}
		})
	})
}

func (s *Screen) submitRuleEdit() {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" || s.ruleEditBusy {
		return
	}
	id := s.ruleEditID
	text := strings.TrimSpace(s.ruleEditText)
	s.ruleEditBusy = true
	s.ruleEditErr = ""
	go func() {
		book, err := client.EditProactiveRuleBook(context.Background(), tenantID, id, text)
		s.enqueueUI(func() {
			s.ruleEditBusy = false
			if err != nil {
				s.ruleEditErr = api.PresentError(err)
				return
			}
			s.mu.Lock()
			s.ruleBook = book
			s.mu.Unlock()
			s.ruleEditOpen = false
			s.toast(i18n.T("settings.rules.toast.updated"))
		})
	}()
}

func (s *Screen) viewRuleMandateSheet(c *ui.Context) {
	r := s.ruleMandateItem
	if r == nil {
		s.ruleMandateSheet = false
		return
	}
	components.ActionSheet(c, &s.ruleMandateSheet, mobile.ActionSheetOptions{
		Title:   i18n.T("settings.rules.mandate_sheet_title"),
		Message: r.Text,
		Cancel:  i18n.T("common.cancel"),
	},
		mobile.Action{
			Label: i18n.T("settings.rules.mandate_none"),
			OnTap: func() { s.setRuleMandateAsync(r.ID, "none") },
		},
		mobile.Action{
			Label: i18n.T("settings.rules.mandate_create"),
			OnTap: func() { s.setRuleMandateAsync(r.ID, "create") },
		},
		mobile.Action{
			Label: i18n.T("settings.rules.mandate_delegate"),
			OnTap: func() { s.setRuleMandateAsync(r.ID, "create_and_delegate") },
		},
	)
}

func (s *Screen) viewRuleDeleteSheet(c *ui.Context) {
	r := s.ruleDeleteItem
	if r == nil {
		s.ruleDeleteSheet = false
		return
	}
	components.ActionSheet(c, &s.ruleDeleteSheet, mobile.ActionSheetOptions{
		Title:   i18n.T("settings.rules.delete_title"),
		Message: r.Text,
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("settings.rules.delete_btn"),
		Destructive: true,
		OnTap:       func() { s.deleteRuleAsync(r.ID) },
	})
}

func (s *Screen) viewRuleDismissSheet(c *ui.Context) {
	r := s.ruleDismissItem
	if r == nil {
		s.ruleDismissSheet = false
		return
	}
	components.ActionSheet(c, &s.ruleDismissSheet, mobile.ActionSheetOptions{
		Title:   i18n.T("settings.rules.dismiss_title"),
		Message: i18n.Tf("settings.rules.dismiss_body", map[string]any{"text": r.Text}),
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("settings.rules.dismiss_confirm"),
		Destructive: true,
		OnTap:       func() { s.deleteRuleAsync(r.ID) },
	})
}
