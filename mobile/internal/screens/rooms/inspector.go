package rooms

import (
	"context"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/state"
)

func (ctl *Controller) openInspector(roomID string, snap state.Snapshot) {
	name := roomTitle(snap, roomID)
	desc := ""
	for _, rm := range snap.Rooms {
		if rm.ID == roomID && rm.Description != nil {
			desc = *rm.Description
		}
	}
	ctl.mu.Lock()
	ctl.inspectorRoomID = roomID
	ctl.inspEditName = name
	ctl.inspEditDesc = desc
	ctl.inspectorOpen = true
	ctl.mu.Unlock()
	ctl.refreshInspectorData(roomID)
}

func (ctl *Controller) refreshInspectorData(roomID string) {
	go func() {
		cl := ctl.store.Client()
		if cl == nil {
			return
		}
		ctx := context.Background()
		members, _ := cl.ListRoomMembers(ctx, roomID)
		pins, _ := cl.ListMessagePins(ctx, roomID)
		docs, _ := cl.ListRoomDocuments(ctx, roomID, 50, "")
		shares, _ := cl.ListRoomHistoryShares(ctx, roomID)
		var teamDoc *api.TeamMdDocument
		if td, err := cl.GetRoomTeamMd(ctx, roomID); err == nil {
			teamDoc = &td
		}
		ctl.mu.Lock()
		if ctl.inspectorRoomID == roomID {
			ctl.inspMembers = members.Items
			ctl.inspPins = pins
			ctl.inspDocs = docs.Items
			ctl.inspTeamMd = teamDoc
			ctl.inspShares = shares
		}
		ctl.mu.Unlock()
		ctl.store.Notify()
	}()
}

func (ctl *Controller) viewInspectorSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.inspectorOpen, mobile.SheetOptions{
		Detents: []float32{0.55, 0.92},
		Label:   i18n.T("rooms.title.inspector"),
	}, func() {
		ctl.mu.Lock()
		tab := ctl.inspectorTab
		roomID := ctl.inspectorRoomID
		members := append([]api.RoomMember(nil), ctl.inspMembers...)
		pins := append([]api.Message(nil), ctl.inspPins...)
		docs := append([]api.Document(nil), ctl.inspDocs...)
		teamMd := ctl.inspTeamMd
		shares := append([]api.RoomHistoryShare(nil), ctl.inspShares...)
		busy := ctl.inspBusy
		ctl.mu.Unlock()

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, i18n.T("rooms.title.inspector")).FontSize(18).Bold().TextColor(t.Text)
				if components.SegmentedControl(c, &tab,
					i18n.T("inspector.tab.settings"),
					i18n.T("inspector.tab.members"),
					i18n.T("inspector.tab.pins_docs"),
					i18n.T("inspector.tab.team_md"),
				) {
					ctl.mu.Lock()
					ctl.inspectorTab = tab
					ctl.mu.Unlock()
				}

				switch tab {
				case 0:
					components.FormField(c, i18n.T("inspector.name_label"), i18n.T("inspector.name_label"), &ctl.inspEditName, false)
					components.FormField(c, i18n.T("inspector.desc_label"), i18n.T("inspector.desc_label"), &ctl.inspEditDesc, false)
					saveBtn := components.PrimaryTouchButton(c, i18n.T("inspector.save_btn"), busy || strings.TrimSpace(ctl.inspEditName) == "")
					saveBtn.FillWidth()
					if saveBtn.Clicked() {
						name := strings.TrimSpace(ctl.inspEditName)
						desc := strings.TrimSpace(ctl.inspEditDesc)
						ctl.mu.Lock()
						ctl.inspBusy = true
						ctl.mu.Unlock()
						go func() {
							if cl := ctl.store.Client(); cl != nil {
								_, _ = cl.UpdateRoom(context.Background(), roomID, &name, &desc)
								_ = ctl.store.RefreshActiveHost(context.Background())
							}
							ctl.mu.Lock()
							ctl.inspBusy = false
							ctl.mu.Unlock()
							ctl.store.Notify()
						}()
					}
					delBtn := components.DangerTouchButton(c, i18n.T("inspector.delete_btn"), busy)
					delBtn.FillWidth()
					if delBtn.Clicked() {
						mygo.Haptics.Warning()
						go func() {
							if cl := ctl.store.Client(); cl != nil {
								_ = cl.DeleteRoom(context.Background(), roomID)
								_ = ctl.store.RefreshActiveHost(context.Background())
							}
							ctl.store.EnqueueUI(func() {
								ctl.mu.Lock()
								ctl.inspectorOpen = false
								ctl.mu.Unlock()
								ctl.store.Routers[state.TabRooms].Replace("/rooms")
							})
						}()
					}

				case 1:
					components.SectionCard(c, i18n.Tf("inspector.members_title", map[string]any{"count": len(members)}), "", nil, func() {
						for idx, m := range members {
							m := m
							if idx > 0 {
								components.InsetDivider(c, 42)
							}
							ui.Row(c.Key(m.Actor.ID)).FillWidth().MinHeight(46).AlignItems(ui.Center).Gap(10).Children(func() {
								components.AvatarBadge(c, m.Actor.DisplayName, 32)
								ui.Column(c).Grow(1).Basis(0).Gap(1).Children(func() {
									ui.Text(c, m.Actor.DisplayName).FontSize(14).FontWeight(600).TextColor(t.Text)
									ui.Text(c, i18n.ActorRoleLabel(m.Actor.Kind)+" · "+i18n.ActorRoleLabel(m.Role)).FontSize(11.5).TextColor(t.TextMuted)
								})
								if m.Role != "owner" {
									rmBtn := components.DangerTouchButton(c, i18n.T("common.remove"), false)
									rmBtn.MinHeight(34)
									if rmBtn.Clicked() {
										go func() {
											if cl := ctl.store.Client(); cl != nil {
												_ = cl.DeleteRoomMember(context.Background(), roomID, m.Actor.ID)
												ctl.refreshInspectorData(roomID)
											}
										}()
									}
								}
							})
						}
					})
					// Quick-add from tenant actors not yet in room
					inRoom := map[string]bool{}
					for _, m := range members {
						inRoom[m.Actor.ID] = true
					}
					var candidates []api.Actor
					for _, act := range snap.Actors {
						if !inRoom[act.ID] {
							candidates = append(candidates, act)
						}
					}
					if len(candidates) > 0 {
						components.SectionCard(c, i18n.T("inspector.add_member_title"), "", nil, func() {
							for idx, act := range candidates {
								act := act
								if idx > 0 {
									components.InsetDivider(c, 0)
								}
								ui.Row(c.Key("add_" + act.ID)).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
									ui.Text(c, act.DisplayName+" ("+i18n.ActorRoleLabel(act.Kind)+")").FontSize(13.5).TextColor(t.Text)
									addBtn := components.CompactSecondaryButton(c, i18n.T("common.add"), nil, false)
									if addBtn.Clicked() {
										go func() {
											if cl := ctl.store.Client(); cl != nil {
												_, _ = cl.PutRoomMember(context.Background(), roomID, act.ID, "member")
												ctl.refreshInspectorData(roomID)
											}
										}()
									}
								})
							}
						})
					}

				case 2:
					components.SectionCard(c, i18n.Tf("inspector.pins_title", map[string]any{"count": len(pins)}), "", nil, func() {
						if len(pins) == 0 {
							ui.Text(c, i18n.T("inspector.pins_empty")).FontSize(13).TextColor(t.TextMuted)
						}
						for _, p := range pins {
							ui.Text(c.Key(p.ID), p.Author.DisplayName+": "+p.RawMessage).FontSize(13).TextColor(t.Text)
						}
					})
					components.SectionCard(c, i18n.Tf("inspector.docs_title", map[string]any{"count": len(docs)}), "", nil, func() {
						if len(docs) == 0 {
							ui.Text(c, i18n.T("inspector.docs_empty")).FontSize(13).TextColor(t.TextMuted)
						}
						for _, d := range docs {
							ui.Row(c.Key(d.ID)).FillWidth().Justify(ui.SpaceBetween).AlignItems(ui.Center).Children(func() {
								ui.Text(c, d.Title).FontSize(13).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
								components.StatusPill(c, i18n.DocKindLabel(d.Format), components.ToneNeutral)
							})
						}
					})
					components.SectionCard(c, i18n.Tf("inspector.routines_title", map[string]any{"count": len(snap.Routines)}), "", nil, func() {
						for _, rt := range snap.Routines {
							if rt.RoomID == roomID {
								ui.Text(c.Key(rt.ID), rt.Name).FontSize(13).TextColor(t.Text)
							}
						}
					})

				case 3:
					components.SectionCard(c, i18n.T("inspector.charter_title"), "", nil, func() {
						if teamMd == nil {
							ui.Text(c, i18n.T("inspector.charter_empty")).FontSize(13).TextColor(t.TextMuted)
						} else {
							ui.Text(c, i18n.Tf("inspector.charter_meta", map[string]any{"pattern": teamMd.CollaboratePattern, "goal": teamMd.TaskGoal})).FontSize(12).TextColor(t.TextMuted)
							markdown.View(c, teamMd.RawMarkdown, &markdown.Options{WrapCode: true})
						}
					})
					components.SectionCard(c, i18n.Tf("inspector.shares_title", map[string]any{"count": len(shares)}), "", func() {
						btn := components.SecondaryTouchButton(c, i18n.T("inspector.create_share"), false)
						if btn.Clicked() {
							go func() {
								if cl := ctl.store.Client(); cl != nil {
									_, _ = cl.CreateRoomHistoryShare(context.Background(), roomID, "")
									ctl.refreshInspectorData(roomID)
								}
							}()
						}
					}, func() {
						if len(shares) == 0 {
							ui.Text(c, i18n.T("inspector.shares_empty")).FontSize(13).TextColor(t.TextMuted)
						}
						for _, sh := range shares {
							sh := sh
							label := sh.RoomName
							if label == "" {
								label = sh.ID
							}
							if sh.Revoked {
								label += " (" + i18n.T("status.revoked") + ")"
							}
							ui.Row(c.Key(sh.ID)).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
								ui.Text(c, i18n.Tf("inspector.share_row", map[string]any{"title": label, "count": sh.MessageCount})).FontSize(13).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
								revBtn := components.DangerTouchButton(c, i18n.T("inspector.revoke"), sh.Revoked)
								if revBtn.Clicked() {
									go func() {
										if cl := ctl.store.Client(); cl != nil {
											_ = cl.RevokeRoomHistoryShare(context.Background(), roomID, sh.ID)
											ctl.refreshInspectorData(roomID)
										}
									}()
								}
							})
						}
					})
				}
			})
		})
	})
}
