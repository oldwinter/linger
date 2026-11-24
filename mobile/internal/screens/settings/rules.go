package settings

import (
	"context"
	"fmt"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
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
		ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
			if s.ruleError != "" {
				components.StatusBanner(c, components.ToneDanger, s.ruleError, "Dismiss", func() {
					s.ruleError = ""
				})
			}

			// Shadow Rule Review
			if len(shadowRules) > 0 || len(book.Divergences) > 0 {
				components.SectionCard(c, fmt.Sprintf("Shadow Review (%d)", len(shadowRules)),
					"Learned rules awaiting promotion", func() {
						components.StatusPill(c, "Review", components.ToneWarning)
					}, func() {
						for _, sr := range shadowRules {
							sr := sr
							busy := s.ruleBusyID == sr.ID
							ui.Column(c.Key("sh:" + sr.ID)).FillWidth().Padding(10, 10).Gap(8).
								Radius(10).Background(theme.Extra(t).WarnTint).Border(1, t.Warning.Alpha(0.35)).Children(func() {
								ui.Text(c, sr.Text).FontSize(14).FontWeight(600).TextColor(t.Text)
								for _, d := range book.Divergences {
									if d.RuleID == sr.ID {
										ui.Text(c, fmt.Sprintf("Divergence on %q: took %s vs shadow %s",
											d.Matter, d.TakenAction, d.ShadowAction)).
											FontSize(12).TextColor(t.TextMuted)
									}
								}
								ui.Row(c).FillWidth().Gap(8).Children(func() {
									promBtn := components.PrimaryTouchButton(c, "Promote", busy)
									promBtn.Grow(1).Basis(0)
									if promBtn.Clicked() {
										s.promoteRuleAsync(sr.ID)
									}
									disBtn := components.DangerTouchButton(c, "Dismiss", busy)
									if disBtn.Clicked() {
										s.deleteRuleAsync(sr.ID)
									}
								})
							})
						}
					})
			}

			// Active Rules
			components.SectionCard(c, fmt.Sprintf("Active Rules (%d)", len(activeRules)),
				"Pin, mandate, edit, or delete proactive guidelines", nil, func() {
					if len(activeRules) == 0 {
						ui.Text(c, "No active proactive rules yet. Another Me proposes shadow rules as it learns your preferences.").
							FontSize(13).TextColor(t.TextMuted)
						return
					}
					ui.Column(c).FillWidth().Gap(10).Children(func() {
						for _, r := range activeRules {
							r := r
							busy := s.ruleBusyID == r.ID
							ui.Column(c.Key("act:" + r.ID)).FillWidth().Padding(10, 12).Gap(8).
								Radius(10).Background(theme.Extra(t).MutedBg).Border(1, t.Border).Children(func() {
								ui.Text(c, r.Text).FontSize(14).FontWeight(600).TextColor(t.Text)
								ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
									components.StatusPill(c, "Source: "+r.Source, components.ToneNeutral)
									mandateLbl := r.Mandate
									if mandateLbl == "" {
										mandateLbl = "none"
									}
									components.StatusPill(c, "Mandate: "+mandateLbl, components.ToneInfo)
									if r.Pinned {
										components.StatusPill(c, "Pinned", components.ToneSuccess)
									}
								})
								ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
									pinLbl := "Pin"
									if r.Pinned {
										pinLbl = "Unpin"
									}
									pinBtn := components.SecondaryTouchButton(c, pinLbl, busy)
									if pinBtn.Clicked() {
										s.pinRuleAsync(r.ID, !r.Pinned)
									}
									mBtn := components.SecondaryTouchButton(c, "Mandate", busy)
									if mBtn.Clicked() {
										cp := r
										s.ruleMandateItem = &cp
										s.ruleMandateSheet = true
									}
									eBtn := components.SecondaryTouchButton(c, "Edit", busy)
									if eBtn.Clicked() {
										s.ruleEditID = r.ID
										s.ruleEditText = r.Text
										s.ruleEditErr = ""
										s.ruleEditOpen = true
									}
									dBtn := components.DangerTouchButton(c, "Delete", busy)
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
				s.ruleError = err.Error()
				return
			}
			s.mu.Lock()
			s.ruleBook = book
			s.mu.Unlock()
			s.toast("Rule promoted to active")
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
				s.ruleError = err.Error()
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
				s.ruleError = err.Error()
				return
			}
			s.mu.Lock()
			s.ruleBook = book
			s.mu.Unlock()
			s.toast("Updated rule mandate")
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
				s.ruleError = err.Error()
				return
			}
			s.mu.Lock()
			s.ruleBook = book
			s.mu.Unlock()
			s.toast("Rule removed")
		})
	}()
}

func (s *Screen) viewRuleEditSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.ruleEditOpen, mobile.SheetOptions{
		Detents: []float32{0.52},
		Label:   "Edit Proactive Rule",
	}, func() {
		ui.Column(c).FillWidth().Padding(14, 16, 24, 16).Gap(12).Children(func() {
			ui.Text(c, "Edit Rule").FontSize(18).Bold().TextColor(t.Text)
			if s.ruleEditErr != "" {
				components.StatusBanner(c, components.ToneDanger, s.ruleEditErr, "Dismiss", func() {
					s.ruleEditErr = ""
				})
			}
			ui.TextArea(c, &s.ruleEditText).FillWidth().MinHeight(88).Label("Rule Text")
			saveLbl := "Save Rule"
			if s.ruleEditBusy {
				saveLbl = "Saving..."
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
				s.ruleEditErr = err.Error()
				return
			}
			s.mu.Lock()
			s.ruleBook = book
			s.mu.Unlock()
			s.ruleEditOpen = false
			s.toast("Rule updated")
		})
	}()
}

func (s *Screen) viewRuleMandateSheet(c *ui.Context) {
	r := s.ruleMandateItem
	if r == nil {
		s.ruleMandateSheet = false
		return
	}
	mobile.ActionSheet(c, &s.ruleMandateSheet, mobile.ActionSheetOptions{
		Title:   "Select Rule Mandate",
		Message: r.Text,
		Cancel:  "Cancel",
	},
		mobile.Action{
			Label: "None (Remind Only)",
			OnTap: func() { s.setRuleMandateAsync(r.ID, "none") },
		},
		mobile.Action{
			Label: "Create Work Item",
			OnTap: func() { s.setRuleMandateAsync(r.ID, "create") },
		},
		mobile.Action{
			Label: "Create & Delegate Task",
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
	mobile.ActionSheet(c, &s.ruleDeleteSheet, mobile.ActionSheetOptions{
		Title:   "Delete Rule?",
		Message: r.Text,
		Cancel:  "Cancel",
	}, mobile.Action{
		Label:       "Delete Rule",
		Destructive: true,
		OnTap:       func() { s.deleteRuleAsync(r.ID) },
	})
}
