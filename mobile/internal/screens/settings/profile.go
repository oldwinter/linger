package settings

import (
	"context"
	"fmt"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func (s *Screen) viewProfileSection(c *ui.Context) {
	t := c.Theme()

	s.mu.Lock()
	acct := s.accountProfile
	pp := s.personalProfile
	insights := append([]api.PersonalInsight(nil), s.insights...)
	s.mu.Unlock()

	if !s.acctInitialized && acct != nil {
		s.acctName = acct.Name
		s.acctBio = acct.Bio
		s.acctOrg = acct.Organization
		s.acctInitialized = true
	}

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SectionProfile]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
			// Account Profile
			email := ""
			if acct != nil {
				email = acct.Email
			}
			components.SectionCard(c, "Account Profile", email, nil, func() {
				if s.acctErr != "" {
					components.StatusBanner(c, components.ToneDanger, s.acctErr, "Dismiss", func() {
						s.acctErr = ""
					})
				}
				if s.acctNotice != "" {
					components.StatusBanner(c, components.ToneSuccess, s.acctNotice, "OK", func() {
						s.acctNotice = ""
					})
				}

				components.FormField(c, "Display Name", "Your name", &s.acctName, false)
				components.FormField(c, "Organization", "Company or team", &s.acctOrg, false)
				ui.Column(c).FillWidth().Gap(4).Children(func() {
					ui.Text(c, "Bio").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.TextArea(c, &s.acctBio).FillWidth().MinHeight(72).Placeholder("Short bio").Label("Account Bio")
				})
				saveLbl := "Save Account Profile"
				if s.acctSaving {
					saveLbl = "Saving..."
				}
				saveBtn := components.PrimaryTouchButton(c, saveLbl, s.acctSaving)
				saveBtn.FillWidth()
				if saveBtn.Clicked() {
					s.saveAccountProfileAsync()
				}
			})

			// Personal Profile
			components.SectionCard(c, "Personal Profile", "How Another Me understands your working style", func() {
				lbl := "Edit"
				if s.ppEditing {
					lbl = "Cancel"
				}
				btn := components.SecondaryTouchButton(c, lbl, pp == nil || pp.Current == nil)
				btn.MinHeight(34).Padding(4, 10)
				if btn.Clicked() {
					s.ppEditing = !s.ppEditing
					if s.ppEditing && pp != nil && pp.Current != nil {
						s.ppMarkdownDraft = pp.Current.Markdown
					}
					s.ppErr = ""
				}
			}, func() {
				if s.ppErr != "" {
					components.StatusBanner(c, components.ToneDanger, s.ppErr, "Dismiss", func() {
						s.ppErr = ""
					})
				}
				if pp == nil || pp.Current == nil {
					ui.Text(c, "Personal Profile has not been generated yet.").FontSize(13).TextColor(t.TextMuted)
					return
				}
				if s.ppEditing {
					ui.TextArea(c, &s.ppMarkdownDraft).FillWidth().MinHeight(140).Label("Personal Profile Markdown")
					lbl := "Publish Profile Revision"
					if s.ppSaving {
						lbl = "Saving..."
					}
					saveBtn := components.PrimaryTouchButton(c, lbl, s.ppSaving || strings.TrimSpace(s.ppMarkdownDraft) == "")
					saveBtn.FillWidth()
					if saveBtn.Clicked() {
						s.savePersonalProfileAsync(pp.Current.ID, s.ppMarkdownDraft)
					}
				} else {
					markdown.View(c, pp.Current.Markdown, &s.mdOpts).FillWidth()
					if len(pp.History) > 0 {
						ui.Text(c, fmt.Sprintf("%d previous revisions", len(pp.History))).FontSize(11).TextColor(t.TextMuted)
					}
				}
			})

			// Personal Insights
			components.SectionCard(c, fmt.Sprintf("Personal Insights (%d)", len(insights)),
				"Learned patterns you can inspect and prune", nil, func() {
					if len(insights) == 0 {
						ui.Text(c, "No personal insights recorded yet.").FontSize(13).TextColor(t.TextMuted)
						return
					}
					ui.Column(c).FillWidth().Gap(8).Children(func() {
						for _, ins := range insights {
							ins := ins
							ui.Row(c.Key(ins.ID)).FillWidth().Padding(10, 10).Radius(10).Background(theme.Extra(t).MutedBg).
								AlignItems(ui.Center).Gap(8).Children(func() {
								ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
									components.StatusPill(c, ins.Dimension, components.ToneInfo)
									ui.Text(c, ins.Statement).FontSize(13).TextColor(t.Text)
								})
								delBtn := components.DangerTouchButton(c, "Prune", false)
								if delBtn.Clicked() {
									cp := ins
									s.insightDelItem = &cp
									s.insightDelSheet = true
								}
							})
						}
					})
				})
		})
	})
}

func (s *Screen) saveAccountProfileAsync() {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" || s.acctSaving {
		return
	}
	name := strings.TrimSpace(s.acctName)
	bio := strings.TrimSpace(s.acctBio)
	org := strings.TrimSpace(s.acctOrg)
	s.acctSaving = true
	s.acctErr = ""
	s.acctNotice = ""
	go func() {
		updated, err := client.PatchAccountProfile(context.Background(), tenantID, api.AccountProfilePatch{
			Name:         &name,
			Bio:          &bio,
			Organization: &org,
		})
		s.enqueueUI(func() {
			s.acctSaving = false
			if err != nil {
				s.acctErr = err.Error()
				return
			}
			s.mu.Lock()
			cp := updated
			s.accountProfile = &cp
			s.mu.Unlock()
			s.acctNotice = "Account profile saved"
		})
	}()
}

func (s *Screen) savePersonalProfileAsync(baseRevID, md string) {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" || s.ppSaving {
		return
	}
	s.ppSaving = true
	s.ppErr = ""
	go func() {
		rev, err := client.ReplacePersonalProfile(context.Background(), tenantID, baseRevID, md)
		s.enqueueUI(func() {
			s.ppSaving = false
			if err != nil {
				s.ppErr = err.Error()
				return
			}
			s.mu.Lock()
			if s.personalProfile == nil {
				s.personalProfile = &api.PersonalProfileC2{}
			}
			s.personalProfile.Current = &rev
			s.mu.Unlock()
			s.ppEditing = false
			s.toast("Personal profile updated")
		})
	}()
}

func (s *Screen) viewInsightDeleteSheet(c *ui.Context) {
	ins := s.insightDelItem
	if ins == nil {
		s.insightDelSheet = false
		return
	}
	mobile.ActionSheet(c, &s.insightDelSheet, mobile.ActionSheetOptions{
		Title:   "Prune Insight?",
		Message: ins.Statement,
		Cancel:  "Cancel",
	}, mobile.Action{
		Label:       "Delete Insight",
		Destructive: true,
		OnTap:       func() { s.deleteInsightAsync(ins.ID) },
	})
}

func (s *Screen) deleteInsightAsync(insightID string) {
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" {
		return
	}
	go func() {
		if err := client.DeletePersonalInsight(context.Background(), tenantID, insightID); err != nil {
			s.enqueueUI(func() { s.acctErr = err.Error() })
			return
		}
		s.enqueueUI(func() {
			s.mu.Lock()
			var filtered []api.PersonalInsight
			for _, it := range s.insights {
				if it.ID != insightID {
					filtered = append(filtered, it)
				}
			}
			s.insights = filtered
			s.mu.Unlock()
			s.insightDelItem = nil
			s.toast("Insight pruned")
		})
	}()
}
