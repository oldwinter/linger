package settings

import (
	"context"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
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
		layout.ReadableWrap(c, layout.Of(c).ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				// Account Profile
				email := ""
				if acct != nil {
					email = acct.Email
				}
				components.SectionCard(c, i18n.T("settings.profile.account_title"), email, nil, func() {
					if s.acctErr != "" {
						components.StatusBanner(c, components.ToneDanger, s.acctErr, i18n.T("common.dismiss"), func() {
							s.acctErr = ""
						})
					}
					if s.acctNotice != "" {
						components.StatusBanner(c, components.ToneSuccess, s.acctNotice, i18n.T("common.ok"), func() {
							s.acctNotice = ""
						})
					}

					components.FormField(c, i18n.T("settings.profile.display_name"), i18n.T("settings.profile.display_name_ph"), &s.acctName, false)
					components.FormField(c, i18n.T("settings.profile.org"), i18n.T("settings.profile.org_ph"), &s.acctOrg, false)
					ui.Column(c).FillWidth().Gap(4).Children(func() {
						ui.Text(c, i18n.T("settings.profile.bio")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
						ui.TextArea(c, &s.acctBio).FillWidth().MinHeight(72).Placeholder(i18n.T("settings.profile.bio_ph")).Label(i18n.T("settings.profile.bio"))
					})
					saveLbl := i18n.T("settings.profile.save_account")
					if s.acctSaving {
						saveLbl = i18n.T("common.saving")
					}
					saveBtn := components.PrimaryTouchButton(c, saveLbl, s.acctSaving)
					saveBtn.FillWidth()
					if saveBtn.Clicked() {
						s.saveAccountProfileAsync()
					}
				})

				// Personal Profile
				components.SectionCard(c, i18n.T("settings.profile.personal_title"), i18n.T("settings.profile.personal_sub"), func() {
					lbl := i18n.T("common.edit")
					if s.ppEditing {
						lbl = i18n.T("common.cancel")
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
						components.StatusBanner(c, components.ToneDanger, s.ppErr, i18n.T("common.dismiss"), func() {
							s.ppErr = ""
						})
					}
					if pp == nil || pp.Current == nil {
						ui.Text(c, i18n.T("settings.profile.personal_empty")).FontSize(13).TextColor(t.TextMuted)
						return
					}
					if s.ppEditing {
						ui.TextArea(c, &s.ppMarkdownDraft).FillWidth().MinHeight(140).Label(i18n.T("settings.profile.personal_title"))
						lbl := i18n.T("settings.profile.publish_revision")
						if s.ppSaving {
							lbl = i18n.T("common.saving")
						}
						saveBtn := components.PrimaryTouchButton(c, lbl, s.ppSaving || strings.TrimSpace(s.ppMarkdownDraft) == "")
						saveBtn.FillWidth()
						if saveBtn.Clicked() {
							s.savePersonalProfileAsync(pp.Current.ID, s.ppMarkdownDraft)
						}
					} else {
						markdown.View(c, pp.Current.Markdown, &s.mdOpts).FillWidth()
						if len(pp.History) > 0 {
							ui.Text(c, i18n.Tf("settings.profile.prev_revisions", map[string]any{"count": len(pp.History)})).FontSize(11).TextColor(t.TextMuted)
						}
					}
				})

				// Personal Insights
				components.SectionCard(c, i18n.Tf("settings.profile.insights_title", map[string]any{"count": len(insights)}),
					i18n.T("settings.profile.insights_sub"), nil, func() {
						if len(insights) == 0 {
							ui.Text(c, i18n.T("settings.profile.insights_empty")).FontSize(13).TextColor(t.TextMuted)
							return
						}
						ui.Column(c).FillWidth().Gap(8).Children(func() {
							for _, ins := range insights {
								ins := ins
								ui.Row(c.Key(ins.ID)).FillWidth().Padding(11, 12).Radius(12).Background(theme.Extra(t).MutedBg).
									Border(0.75, theme.Extra(t).SubtleBorder).
									AlignItems(ui.Center).Gap(8).Children(func() {
									ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
										components.StatusPill(c, ins.Dimension, components.ToneInfo)
										ui.Text(c, ins.Statement).FontSize(13).TextColor(t.Text)
									})
									delBtn := components.DangerTouchButton(c, i18n.T("settings.profile.prune"), false)
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
				s.acctErr = api.PresentError(err)
				return
			}
			s.mu.Lock()
			cp := updated
			s.accountProfile = &cp
			s.mu.Unlock()
			s.acctNotice = i18n.T("settings.profile.toast.account_saved")
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
				s.ppErr = api.PresentError(err)
				return
			}
			s.mu.Lock()
			if s.personalProfile == nil {
				s.personalProfile = &api.PersonalProfileC2{}
			}
			s.personalProfile.Current = &rev
			s.mu.Unlock()
			s.ppEditing = false
			s.toast(i18n.T("settings.profile.toast.personal_updated"))
		})
	}()
}

func (s *Screen) viewInsightDeleteSheet(c *ui.Context) {
	ins := s.insightDelItem
	if ins == nil {
		s.insightDelSheet = false
		return
	}
	components.ActionSheet(c, &s.insightDelSheet, mobile.ActionSheetOptions{
		Title:   i18n.T("settings.profile.prune_title"),
		Message: ins.Statement,
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("settings.profile.prune_btn"),
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
			s.enqueueUI(func() { s.acctErr = api.PresentError(err) })
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
			s.toast(i18n.T("settings.profile.toast.pruned"))
		})
	}()
}
