package live

import (
	"context"
	"fmt"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func (ctl *Controller) viewAgents(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()

	ui.Row(c).FillWidth().Justify(ui.SpaceBetween).AlignItems(ui.Center).Gap(8).Children(func() {
		ui.Text(c, fmt.Sprintf("Tenant Agents (%d)", len(snap.Agents))).FontSize(15).FontWeight(600).TextColor(t.Text)
		createBtn := components.PrimaryTouchButton(c, "Create Agent", snap.ActiveHost == nil)
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
		components.EmptyState(c, theme.IconHost, "No Agents configured",
			"Create an Agent from scratch or from a Template.", "Create Agent", func() {
				ctl.mu.Lock()
				ctl.createAgentOpen = true
				ctl.mu.Unlock()
			})
		return
	}

	for _, ag := range snap.Agents {
		ag := ag
		avail, hasAvail := snap.AgentAvailability[ag.Actor.ID]
		statusText := "ready"
		statusTone := components.ToneSuccess
		if hasAvail {
			statusText = avail.Availability.Status
			switch strings.ToLower(statusText) {
			case "working", "busy":
				statusTone = components.ToneInfo
			case "offline", "unavailable", "error":
				statusTone = components.ToneWarning
			}
		}

		mobile.SwipeRow(c.Key("ag_"+ag.Actor.ID), ctl.swipeStateFor("ag_"+ag.Actor.ID), mobile.SwipeOptions{
			Trailing: []mobile.SwipeAction{
				{
					Label: "DM",
					OnTap: func() {
						ctl.openDirectAgentChat(ag.Actor.ID)
					},
				},
			},
		}, func() {
			row := ui.Row(c).FillWidth().MinHeight(64).Padding(10, 12).Gap(10).
				Radius(12).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
				Role(ui.RoleButton).Label("Agent " + ag.Actor.DisplayName)
			row.Children(func() {
				components.AvatarBadge(c, ag.Actor.DisplayName, 40)
				ui.Column(c).Grow(1).Basis(0).Gap(3).Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
						ui.Text(c, ag.Actor.DisplayName).FontSize(15).FontWeight(600).TextColor(t.Text).MaxLines(1)
						components.StatusPill(c, statusText, statusTone)
					})
					if ag.Description != "" {
						ui.Text(c, ag.Description).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
					}
					ui.Row(c).Wrap().Gap(4).Children(func() {
						if ag.Runtime.Model != "" {
							components.StatusPill(c, ag.Runtime.Model, components.ToneNeutral)
						}
						if len(ag.SkillBindings) > 0 {
							components.StatusPill(c, fmt.Sprintf("%d skills", len(ag.SkillBindings)), components.ToneInfo)
						}
					})
				})
				ui.Text(c, "›").FontSize(20).TextColor(t.TextMuted)
			})
			if row.Clicked() {
				ctl.openAgentDetail(ag, snap.TenantID)
			}
		})
	}

	if len(snap.AgentTemplates) > 0 {
		components.SectionCard(c, fmt.Sprintf("Templates (%d)", len(snap.AgentTemplates)), "Tap to create a new Agent from a template", nil, func() {
			for _, tpl := range snap.AgentTemplates {
				tpl := tpl
				ui.Row(c.Key("tpl_"+tpl.TemplateID)).FillWidth().MinHeight(48).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, tpl.Name).FontSize(14).FontWeight(600).TextColor(t.Text)
						ui.Text(c, tpl.Description).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
					})
					useBtn := components.SecondaryTouchButton(c, "Use", false)
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
		Label:   "Agent Editor",
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
					dmBtn := components.PrimaryTouchButton(c, "Direct Chat", busy)
					if dmBtn.Clicked() {
						ctl.agentSheetOpen = false
						ctl.openDirectAgentChat(ag.Actor.ID)
					}
				})

				components.FormField(c, "Name", "Agent name", &ctl.agentEditName, false)
				components.FormField(c, "Description", "Short role summary", &ctl.agentEditDesc, false)
				components.FormField(c, "Runtime Model", "e.g. localmodels/qwen3-4b:Q4_K_M", &ctl.agentEditModel, false)
				ui.Text(c, "Instructions").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				ui.TextArea(c, &ctl.agentEditInstr).FillWidth().MinHeight(88).Placeholder("System prompt instructions").Label("Instructions")

				saveBtn := components.PrimaryTouchButton(c, func() string {
					if busy {
						return "Saving..."
					}
					return "Save Agent Changes"
				}(), busy || strings.TrimSpace(ctl.agentEditName) == "")
				saveBtn.FillWidth()
				if saveBtn.Clicked() {
					ctl.saveAgentChangesAsync(snap.TenantID, *ag)
				}

				// Skill Bindings manager against tenant skill-manifests
				components.SectionCard(c, fmt.Sprintf("Skill Bindings (%d available)", len(snap.SkillManifests)), "Toggle skills bound to this Agent", nil, func() {
					if len(snap.SkillManifests) == 0 {
						ui.Text(c, "No skill manifests found in this workspace.").FontSize(12).TextColor(t.TextMuted)
					}
					for _, sk := range snap.SkillManifests {
						sk := sk
						on := boundByID[sk.SkillID]
						ui.Row(c.Key("sb_"+sk.SkillID)).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
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

				delBtn := components.DangerTouchButton(c, "Delete Agent", busy)
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
		Label:   "Create Agent",
	}, func() {
		ctl.mu.Lock()
		busy := ctl.agentBusy
		ctl.mu.Unlock()
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, "Create New Agent").FontSize(18).Bold().TextColor(t.Text)
				components.FormField(c, "Name", "e.g. Release Reviewer", &ctl.newAgentName, false)
				components.FormField(c, "Description", "What this agent helps with", &ctl.newAgentDesc, false)
				components.FormField(c, "Model (optional)", "localmodels/qwen3-4b:Q4_K_M", &ctl.newAgentModel, false)
				ui.Text(c, "Instructions").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				ui.TextArea(c, &ctl.newAgentInstr).FillWidth().MinHeight(88).Placeholder("Agent system instructions").Label("New Agent Instructions")

				canCreate := !busy && strings.TrimSpace(ctl.newAgentName) != "" && strings.TrimSpace(ctl.newAgentInstr) != ""
				btn := components.PrimaryTouchButton(c, func() string {
					if busy {
						return "Creating..."
					}
					return "Create Agent"
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
	name := "Agent"
	if ag != nil {
		name = ag.Actor.DisplayName
	}
	mobile.ActionSheet(c, &ctl.deleteAgentOpen, mobile.ActionSheetOptions{
		Title:   "Delete " + name + "?",
		Message: "This removes the Agent from the workspace.",
		Cancel:  "Cancel",
	}, mobile.Action{
		Label:       "Delete Agent",
		Destructive: true,
		OnTap: func() {
			if ag == nil {
				return
			}
			mygo.Haptics.Warning()
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
					ctl.setNotice("Deleted agent " + name)
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
				ctl.setNotice("Saved " + name)
			} else {
				ctl.store.SetTransientError(err.Error())
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
					ctl.setNotice("Created agent " + agentName)
				})
				return
			}
			ctl.store.SetTransientError(err.Error())
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
