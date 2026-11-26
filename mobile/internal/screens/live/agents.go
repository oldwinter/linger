package live

import (
	"context"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func (ctl *Controller) viewAgents(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ex := theme.Extra(t)

	components.SectionEyebrow(c, i18n.Tf("live.agents.title", map[string]any{"count": len(snap.Agents)}), func() {
		createBtn := components.CompactPrimaryButton(c, i18n.T("live.agents.create_btn"), theme.IconPlus, snap.ActiveHost == nil)
		if createBtn.Clicked() {
			ctl.mu.Lock()
			ctl.newAgentName = ""
			ctl.newAgentDesc = ""
			ctl.newAgentInstr = ""
			ctl.newAgentModel = ""
			ctl.newAgentTemplate = ""
			ctl.createAgentOpen = true
			ctl.mu.Unlock()
		}
	})

	if len(snap.Agents) == 0 {
		components.EmptyState(c, theme.IconHost, i18n.T("live.agents.empty_title"),
			i18n.T("live.agents.empty_body"), i18n.T("live.agents.create_btn"), func() {
				ctl.mu.Lock()
				ctl.createAgentOpen = true
				ctl.mu.Unlock()
			})
		return
	}

	components.GroupedCard(c, func() {
		for idx, ag := range snap.Agents {
			ag := ag
			if idx > 0 {
				components.InsetDivider(c, 68)
			}
			avail, hasAvail := snap.AgentAvailability[ag.Actor.ID]
			statusText := "ready"
			statusTone := components.ToneSuccess
			if hasAvail {
				statusText = avail.Availability.Status
				switch strings.ToLower(statusText) {
				case "working", "busy":
					statusTone = components.ToneBrand
				case "offline", "unavailable", "error":
					statusTone = components.ToneWarning
				}
			}

			mobile.SwipeRow(c.Key("ag_"+ag.Actor.ID), ctl.swipeStateFor("ag_"+ag.Actor.ID), mobile.SwipeOptions{
				Trailing: []mobile.SwipeAction{
					{
						Label: i18n.T("live.agents.dm_btn"),
						OnTap: func() {
							ctl.openDirectAgentChat(ag.Actor.ID)
						},
					},
				},
			}, func() {
				row := ui.Row(c).FillWidth().MinHeight(70).Padding(12, 14).Gap(12).
					Background(t.Surface).AlignItems(ui.Center).
					Role(ui.RoleButton).Label(i18n.Tf("live.agents.a11y_prefix", map[string]any{"name": ag.Actor.DisplayName}))
				if row.Pressed() {
					row.Background(t.SurfacePressed)
				}
				row.Children(func() {
					components.AvatarBadge(c, ag.Actor.DisplayName, 42)
					ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
						ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
							ui.Text(c, ag.Actor.DisplayName).FontSize(15).FontWeight(600).LetterSpacing(-0.15).TextColor(t.Text).MaxLines(1)
							components.StatusDotPill(c, i18n.StatusLabel(statusText), statusTone)
						})
						if ag.Description != "" {
							ui.Text(c, ag.Description).FontSize(12.5).TextColor(t.TextMuted).MaxLines(1)
						}
						var metaParts []string
						if ag.Runtime.Model != "" {
							metaParts = append(metaParts, ag.Runtime.Model)
						}
						if len(ag.SkillBindings) > 0 {
							metaParts = append(metaParts, i18n.Tf("live.agents.skills_count", map[string]any{"count": len(ag.SkillBindings)}))
						}
						if len(metaParts) > 0 {
							ui.Text(c, strings.Join(metaParts, " · ")).FontSize(11.5).TextColor(ex.TextSubtle).MaxLines(1)
						}
					})
					theme.IconBox(c, 16, ex.TextSubtle, theme.IconChevronRight)
				})
				if row.Clicked() {
					ctl.openAgentDetail(ag, snap.TenantID)
				}
			})
		}
	})

	if len(snap.AgentTemplates) > 0 {
		components.SectionCard(c, i18n.Tf("live.agents.templates_title", map[string]any{"count": len(snap.AgentTemplates)}), i18n.T("live.agents.templates_subtitle"), nil, func() {
			for idx, tpl := range snap.AgentTemplates {
				tpl := tpl
				if idx > 0 {
					components.InsetDivider(c, 0)
				}
				ui.Row(c.Key("tpl_" + tpl.TemplateID)).FillWidth().MinHeight(50).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(10).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, tpl.Name).FontSize(14).FontWeight(600).TextColor(t.Text)
						ui.Text(c, tpl.Description).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
					})
					useBtn := components.CompactSecondaryButton(c, i18n.T("live.agents.use_btn"), nil, false)
					if useBtn.Clicked() {
						ctl.mu.Lock()
						ctl.newAgentName = tpl.Name
						ctl.newAgentDesc = tpl.Description
						ctl.newAgentInstr = tpl.Instructions
						ctl.newAgentTemplate = tpl.TemplateID
						ctl.createAgentOpen = true
						ctl.mu.Unlock()
					}
				})
			}
		})
	}
}

func (ctl *Controller) openAgentDetail(ag api.TenantAgent, tenantID string) {
	cp := ag
	ctl.mu.Lock()
	ctl.selectedAgent = &cp
	ctl.agentEditName = ag.Actor.DisplayName
	ctl.agentEditDesc = ag.Description
	ctl.agentEditInstr = ag.Instructions
	ctl.agentEditModel = ag.Runtime.Model
	ctl.agentBindings = nil
	ctl.agentSheetOpen = true
	ctl.mu.Unlock()

	go func() {
		cl := ctl.store.Client()
		if cl == nil || tenantID == "" {
			return
		}
		if bindings, err := cl.ListAgentSkillBindings(context.Background(), tenantID, ag.Actor.ID); err == nil {
			ctl.mu.Lock()
			ctl.agentBindings = bindings
			ctl.mu.Unlock()
		}
	}()
}

func (ctl *Controller) viewAgentDetailSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.agentSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.78, 0.94},
		Label:   i18n.T("live.agents.editor_title"),
	}, func() {
		ctl.mu.Lock()
		ag := ctl.selectedAgent
		bindings := append([]api.AgentSkillBinding(nil), ctl.agentBindings...)
		busy := ctl.agentBusy
		ctl.mu.Unlock()
		if ag == nil {
			return
		}

		boundByID := map[string]bool{}
		for _, b := range bindings {
			if b.Enabled {
				boundByID[b.Skill.SkillID] = true
			}
		}
		for _, sb := range ag.SkillBindings {
			if sb.Enabled {
				boundByID[sb.SkillID] = true
			}
		}

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(12).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Text(c, ag.Actor.DisplayName).FontSize(18).Bold().TextColor(t.Text)
					dmBtn := components.PrimaryTouchButton(c, i18n.T("rooms.direct_chat_title"), busy)
					if dmBtn.Clicked() {
						ctl.agentSheetOpen = false
						ctl.openDirectAgentChat(ag.Actor.ID)
					}
				})

				components.FormField(c, i18n.T("live.agents.name_label"), i18n.T("live.agents.name_placeholder"), &ctl.agentEditName, false)
				components.FormField(c, i18n.T("live.agents.desc_label"), i18n.T("live.agents.desc_placeholder"), &ctl.agentEditDesc, false)
				components.FormField(c, i18n.T("live.agents.model_label"), i18n.T("live.agents.model_placeholder"), &ctl.agentEditModel, false)
				ui.Text(c, i18n.T("live.agents.instructions_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				ui.TextArea(c, &ctl.agentEditInstr).FillWidth().MinHeight(88).Placeholder(i18n.T("live.agents.instructions_placeholder")).Label(i18n.T("live.agents.instructions_label"))

				saveBtn := components.PrimaryTouchButton(c, func() string {
					if busy {
						return i18n.T("common.saving")
					}
					return i18n.T("live.agents.save_changes")
				}(), busy || strings.TrimSpace(ctl.agentEditName) == "")
				saveBtn.FillWidth()
				if saveBtn.Clicked() {
					ctl.saveAgentChangesAsync(snap.TenantID, *ag)
				}

				// Skill Bindings manager against tenant skill-manifests
				components.SectionCard(c, i18n.Tf("live.agents.skills_title", map[string]any{"count": len(snap.SkillManifests)}), i18n.T("live.agents.skills_subtitle"), nil, func() {
					if len(snap.SkillManifests) == 0 {
						ui.Text(c, i18n.T("live.agents.skills_empty")).FontSize(12).TextColor(t.TextMuted)
					}
					for _, sk := range snap.SkillManifests {
						sk := sk
						on := boundByID[sk.SkillID]
						ui.Row(c.Key("sb_" + sk.SkillID)).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
							ui.Column(c).Grow(1).Basis(0).Gap(1).Children(func() {
								ui.Text(c, sk.Name).FontSize(13).FontWeight(600).TextColor(t.Text)
								ui.Text(c, sk.Description).FontSize(11).TextColor(t.TextMuted).MaxLines(1)
							})
							sw := mobile.Switch(c, &on)
							if sw.Changed() {
								ctl.toggleAgentSkillAsync(snap.TenantID, ag.Actor.ID, sk, on)
							}
						})
					}
				})

				delBtn := components.DangerTouchButton(c, i18n.T("live.agents.delete_btn"), busy)
				delBtn.FillWidth()
				if delBtn.Clicked() {
					ctl.mu.Lock()
					ctl.deleteAgentOpen = true
					ctl.mu.Unlock()
				}
			})
		})
	})
}

func (ctl *Controller) viewCreateAgentSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.createAgentOpen, mobile.SheetOptions{
		Detents: []float32{0.75, 0.92},
		Label:   i18n.T("live.agents.create_btn"),
	}, func() {
		ctl.mu.Lock()
		busy := ctl.agentBusy
		ctl.mu.Unlock()
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, i18n.T("live.agents.create_sheet_title")).FontSize(18).Bold().TextColor(t.Text)
				components.FormField(c, i18n.T("live.agents.name_label"), i18n.T("live.agents.create_name_placeholder"), &ctl.newAgentName, false)
				components.FormField(c, i18n.T("live.agents.desc_label"), i18n.T("live.agents.create_desc_placeholder"), &ctl.newAgentDesc, false)
				components.FormField(c, i18n.T("live.agents.create_model_label"), "localmodels/qwen3-4b:Q4_K_M", &ctl.newAgentModel, false)
				ui.Text(c, i18n.T("live.agents.instructions_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				ui.TextArea(c, &ctl.newAgentInstr).FillWidth().MinHeight(88).Placeholder(i18n.T("live.agents.create_instructions_placeholder")).Label(i18n.T("live.agents.instructions_label"))

				canCreate := !busy && strings.TrimSpace(ctl.newAgentName) != "" && strings.TrimSpace(ctl.newAgentInstr) != ""
				btn := components.PrimaryTouchButton(c, func() string {
					if busy {
						return i18n.T("common.creating")
					}
					return i18n.T("live.agents.create_btn")
				}(), !canCreate)
				btn.FillWidth()
				if btn.Clicked() {
					ctl.createAgentAsync(snap.TenantID)
				}
			})
		})
	})
}

func (ctl *Controller) viewDeleteAgentConfirm(c *ui.Context) {
	ctl.mu.Lock()
	ag := ctl.selectedAgent
	ctl.mu.Unlock()
	name := i18n.T("role.agent")
	if ag != nil {
		name = ag.Actor.DisplayName
	}
	mobile.ActionSheet(c, &ctl.deleteAgentOpen, mobile.ActionSheetOptions{
		Title:   i18n.Tf("live.agents.delete_title", map[string]any{"name": name}),
		Message: i18n.T("live.agents.delete_body"),
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("live.agents.delete_btn"),
		Destructive: true,
		OnTap: func() {
			if ag == nil {
				return
			}
			components.HapticWarning()
			tenantID := ctl.store.Snapshot().TenantID
			go func() {
				if cl := ctl.store.Client(); cl != nil && tenantID != "" {
					_ = cl.DeleteTenantAgent(context.Background(), tenantID, ag.Actor.ID)
					_ = ctl.store.RefreshActiveHost(context.Background())
				}
				ctl.store.EnqueueUI(func() {
					ctl.mu.Lock()
					ctl.agentSheetOpen = false
					ctl.selectedAgent = nil
					ctl.mu.Unlock()
					ctl.setNotice(i18n.Tf("live.agents.toast.deleted", map[string]any{"name": name}))
				})
			}()
		},
	})
}

func (ctl *Controller) openDirectAgentChat(actorID string) {
	go func() {
		rm, err := ctl.store.OpenDirectRoom(context.Background(), actorID)
		if err == nil && ctl.nav.OnOpenRoom != nil {
			roomID := rm.ID
			ctl.store.EnqueueUI(func() {
				ctl.nav.OnOpenRoom(roomID)
			})
		}
	}()
}

func (ctl *Controller) saveAgentChangesAsync(tenantID string, ag api.TenantAgent) {
	ctl.mu.Lock()
	ctl.agentBusy = true
	name := strings.TrimSpace(ctl.agentEditName)
	desc := strings.TrimSpace(ctl.agentEditDesc)
	instr := ctl.agentEditInstr
	model := strings.TrimSpace(ctl.agentEditModel)
	ctl.mu.Unlock()

	go func() {
		cl := ctl.store.Client()
		if cl != nil && tenantID != "" {
			body := map[string]any{
				"expected_configuration_revision": ag.ConfigurationRevision,
				"name":                            name,
				"description":                     desc,
				"instructions":                    instr,
			}
			if model != "" {
				body["runtime"] = map[string]any{"model": model}
			}
			updated, err := cl.UpdateTenantAgent(context.Background(), tenantID, ag.Actor.ID, body)
			if err == nil {
				_ = ctl.store.RefreshActiveHost(context.Background())
				ctl.mu.Lock()
				cp := updated
				ctl.selectedAgent = &cp
				ctl.mu.Unlock()
				ctl.setNotice(i18n.Tf("live.agents.toast.saved", map[string]any{"name": name}))
			} else {
				ctl.store.SetTransientError(api.PresentError(err))
			}
		}
		ctl.mu.Lock()
		ctl.agentBusy = false
		ctl.mu.Unlock()
	}()
}

func (ctl *Controller) createAgentAsync(tenantID string) {
	ctl.mu.Lock()
	ctl.agentBusy = true
	body := map[string]any{
		"name":         strings.TrimSpace(ctl.newAgentName),
		"description":  strings.TrimSpace(ctl.newAgentDesc),
		"instructions": strings.TrimSpace(ctl.newAgentInstr),
	}
	if m := strings.TrimSpace(ctl.newAgentModel); m != "" {
		body["runtime"] = map[string]any{"model": m}
	}
	if tpl := strings.TrimSpace(ctl.newAgentTemplate); tpl != "" {
		body["template_id"] = tpl
	}
	ctl.mu.Unlock()

	go func() {
		cl := ctl.store.Client()
		if cl != nil && tenantID != "" {
			ag, err := cl.CreateTenantAgent(context.Background(), tenantID, body)
			if err == nil {
				_ = ctl.store.RefreshActiveHost(context.Background())
				agentName := ag.Actor.DisplayName
				ctl.store.EnqueueUI(func() {
					ctl.mu.Lock()
					ctl.createAgentOpen = false
					ctl.agentBusy = false
					ctl.mu.Unlock()
					ctl.setNotice(i18n.Tf("live.agents.toast.created", map[string]any{"name": agentName}))
				})
				return
			}
			ctl.store.SetTransientError(api.PresentError(err))
		}
		ctl.store.EnqueueUI(func() {
			ctl.mu.Lock()
			ctl.agentBusy = false
			ctl.mu.Unlock()
		})
	}()
}

func (ctl *Controller) toggleAgentSkillAsync(tenantID, agentID string, sk api.SkillManifest, enable bool) {
	ctl.mu.Lock()
	var bindingVer int64 = 1
	for _, b := range ctl.agentBindings {
		if b.Skill.SkillID == sk.SkillID && b.BindingVersion >= 1 {
			bindingVer = b.BindingVersion
			break
		}
	}
	ctl.mu.Unlock()

	go func() {
		cl := ctl.store.Client()
		if cl == nil || tenantID == "" {
			return
		}
		if enable {
			_, _ = cl.PutAgentSkillBinding(context.Background(), tenantID, agentID, sk.SkillID, api.AgentSkillBindingPutRequest{
				Config:                 map[string]any{},
				Enabled:                true,
				ExpectedBindingVersion: bindingVer,
				ManifestVersion:        sk.ManifestVersion,
			})
		} else {
			_ = cl.DeleteAgentSkillBinding(context.Background(), tenantID, agentID, sk.SkillID, bindingVer)
		}
		if bindings, err := cl.ListAgentSkillBindings(context.Background(), tenantID, agentID); err == nil {
			ctl.mu.Lock()
			ctl.agentBindings = bindings
			ctl.mu.Unlock()
			ctl.store.Notify()
		}
	}()
}
