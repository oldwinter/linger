package work

import (
	"context"
	"fmt"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

var issueFilterKeys = []string{
	"work.filter.mine",
	"work.filter.open",
	"work.filter.in_progress",
	"work.filter.resolved",
	"work.filter.archived",
}

func (s *Screen) viewIssuesSegment(c *ui.Context) {
	t := c.Theme()

	s.mu.Lock()
	allItems := append([]api.WorkItem(nil), s.workItems...)
	s.mu.Unlock()
	filtered := s.filterWorkItems(allItems)
	activeFilter := i18n.T(issueFilterKeys[s.issueFilter])

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SegmentIssues]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
			// Dedicated action header row + full-width scrollable filter pill row (zero clipped pill sliver).
			ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
				ui.Text(c, i18n.Tf("work.issues.header", map[string]any{
					"filter": activeFilter,
					"count":  len(filtered),
				})).FontSize(13).FontWeight(600).TextColor(t.TextMuted).Grow(1).Basis(0).MaxLines(1)
				newBtn := components.PrimaryTouchButton(c, i18n.T("work.issues.new_short"), false)
				newBtn.Shrink(0)
				if newBtn.Clicked() {
					s.openCreateWorkItemSheet()
				}
			})
			ui.ScrollHorizontal(c).FillWidth().Children(func() {
				ui.Row(c).Gap(6).Role(ui.RoleTabList).Children(func() {
					for idx, key := range issueFilterKeys {
						label := i18n.T(key)
						on := s.issueFilter == idx
						bg := theme.Extra(t).MutedBg
						fg := t.TextMuted
						if on {
							bg = t.Accent
							fg = t.AccentText
						}
						chip := ui.Row(c.Key(idx)).MinHeight(36).PaddingX(12).Radius(999).Background(bg).
							AlignItems(ui.Center).Justify(ui.Center).Shrink(0).
							Role(ui.RoleTab).Label(label).Checked(on)
						chip.Children(func() {
							ui.Text(c, label).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
						})
						if chip.Clicked() {
							s.issueFilter = idx
						}
					}
				})
			})

			if len(filtered) == 0 {
				msg := i18n.T("work.issues.empty_filtered")
				if len(allItems) == 0 {
					msg = i18n.T("work.issues.empty_all")
				}
				components.EmptyState(c, theme.IconWork, i18n.T("work.issues.empty_title"), msg, i18n.T("work.issues.new_btn"), func() {
					s.openCreateWorkItemSheet()
				})
				return
			}

			for _, wi := range filtered {
				wi := wi
				row := ui.Column(c.Key(wi.ID)).FillWidth().Padding(12, 12).Gap(6).
					Radius(12).Background(t.Surface).Border(1, t.Border).
					Role(ui.RoleButton).Label(i18n.Tf("work.issues.item_a11y", map[string]any{
					"num":   wi.Number,
					"title": wi.Title,
				}))
				row.Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Text(c, fmt.Sprintf("#%d \u00b7 %s", wi.Number, strings.ToUpper(i18n.WorkKindLabel(wi.Kind)))).
							FontSize(11).FontWeight(600).TextColor(t.TextMuted).NoWrap()
						ui.Row(c).Gap(4).Shrink(0).Children(func() {
							components.StatusPill(c, i18n.WorkPriorityLabel(wi.Priority), priorityTone(wi.Priority))
							if wi.ArchivedAt != nil {
								components.StatusPill(c, i18n.WorkStateLabel("archived"), components.ToneNeutral)
							} else {
								components.StatusPill(c, formatWorkItemState(wi.State), stateTone(wi.State))
							}
						})
					})
					ui.Text(c, wi.Title).FontSize(15).FontWeight(600).TextColor(t.Text).MaxLines(2)
					if strings.TrimSpace(wi.Description) != "" {
						ui.Text(c, wi.Description).FontSize(12).TextColor(t.TextMuted).MaxLines(2)
					}
					ui.Row(c).FillWidth().Wrap().Gap(6).AlignItems(ui.Center).Children(func() {
						if len(wi.Assignees) > 0 {
							names := make([]string, 0, len(wi.Assignees))
							for _, a := range wi.Assignees {
								names = append(names, a.Actor.DisplayName)
							}
							ui.Text(c, i18n.Tf("work.issues.assigned", map[string]any{"names": strings.Join(names, ", ")})).
								FontSize(11).TextColor(t.TextMuted)
						}
						if wi.TaskExecution != nil {
							components.StatusPill(c, i18n.Tf("work.issues.exec", map[string]any{"status": i18n.StatusLabel(wi.TaskExecution.Status)}), components.ToneInfo)
						}
					})
				})
				if row.Clicked() {
					s.openWorkItemDetail(wi)
				}
			}
		})
	})
}

func (s *Screen) filterWorkItems(items []api.WorkItem) []api.WorkItem {
	me := s.currentActorID()
	out := make([]api.WorkItem, 0, len(items))
	for _, wi := range items {
		isArchived := wi.ArchivedAt != nil
		switch s.issueFilter {
		case 0: // Mine
			if isArchived {
				continue
			}
			if me != "" {
				mine := wi.CreatedBy.ID == me
				for _, a := range wi.Assignees {
					if a.Actor.ID == me {
						mine = true
						break
					}
				}
				if !mine {
					continue
				}
			}
		case 1: // Open
			if isArchived || wi.State != "open" {
				continue
			}
		case 2: // In Progress
			if isArchived || wi.State != "in_progress" {
				continue
			}
		case 3: // Resolved
			if isArchived || wi.State != "resolved" {
				continue
			}
		case 4: // Archived
			if !isArchived {
				continue
			}
		}
		out = append(out, wi)
	}
	return out
}

func (s *Screen) openCreateWorkItemSheet() {
	s.createSheetOpen = true
	s.createError = ""
}

func (s *Screen) viewCreateWorkItemSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.createSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.92},
		Label:   i18n.T("work.issues.create_btn"),
	}, func() {
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, i18n.T("work.issues.create_title")).FontSize(18).Bold().TextColor(t.Text)
				if s.createError != "" {
					components.StatusBanner(c, components.ToneDanger, s.createError, i18n.T("common.dismiss"), func() {
						s.createError = ""
					})
				}

				ui.Text(c, i18n.T("work.issues.kind_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				components.SegmentedControl(c, &s.createKind, i18n.WorkKindLabel("issue"), i18n.WorkKindLabel("task"))

				components.FormField(c, i18n.T("work.issues.title_label"), i18n.T("work.issues.title_placeholder"), &s.createTitle, false)

				ui.Column(c).FillWidth().Gap(4).Children(func() {
					ui.Text(c, i18n.T("work.issues.desc_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.TextArea(c, &s.createDesc).FillWidth().MinHeight(88).
						Placeholder(i18n.T("work.issues.desc_placeholder")).Label(i18n.T("work.issues.desc_a11y"))
				})

				ui.Text(c, i18n.T("work.issues.priority_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				components.SegmentedControl(c, &s.createPriority,
					i18n.WorkPriorityLabel("low"),
					i18n.WorkPriorityLabel("medium"),
					i18n.WorkPriorityLabel("high"),
					i18n.WorkPriorityLabel("urgent"))

				submitLabel := i18n.T("work.issues.create_btn")
				if s.createBusy {
					submitLabel = i18n.T("common.creating")
				}
				disabled := s.createBusy || strings.TrimSpace(s.createTitle) == ""
				btn := components.PrimaryTouchButton(c, submitLabel, disabled)
				btn.FillWidth()
				if btn.Clicked() {
					s.submitCreateWorkItem()
				}
			})
		})
	})
}

func (s *Screen) submitCreateWorkItem() {
	if s.createBusy {
		return
	}
	client := s.client()
	tenantID := s.tenantID()
	if client == nil || tenantID == "" {
		s.createError = i18n.T("work.issues.err_connect_first")
		return
	}
	title := strings.TrimSpace(s.createTitle)
	if title == "" {
		s.createError = i18n.T("work.issues.err_title_required")
		return
	}
	kind := "issue"
	if s.createKind == 1 {
		kind = "task"
	}
	priorities := []string{"low", "medium", "high", "urgent"}
	prio := priorities[s.createPriority%len(priorities)]
	desc := strings.TrimSpace(s.createDesc)
	var descPtr *string
	if desc != "" {
		descPtr = &desc
	}
	var originPtr *string
	if s.createOriginRoomID != "" {
		origin := s.createOriginRoomID
		originPtr = &origin
	}

	s.createBusy = true
	s.createError = ""

	go func() {
		wi, err := client.CreateWorkItemIdempotent(context.Background(), tenantID, api.WorkItemCreateInput{
			Kind:         kind,
			Title:        title,
			Description:  descPtr,
			Priority:     &prio,
			OriginRoomID: originPtr,
		}, "")
		if err != nil {
			s.enqueueUI(func() {
				s.createBusy = false
				s.createError = err.Error()
			})
			return
		}
		if cs := s.cacheStore(); cs != nil {
			_ = cs.UpsertWorkItems(context.Background(), []api.WorkItem{wi})
		}
		s.mu.Lock()
		s.workItems = append([]api.WorkItem{wi}, s.workItems...)
		s.mu.Unlock()
		s.enqueueUI(func() {
			s.createBusy = false
			s.createError = ""
			s.createTitle = ""
			s.createDesc = ""
			s.createSheetOpen = false
			s.toast(i18n.Tf("work.issues.toast.created", map[string]any{"num": wi.Number}))
		})
	}()
}

func (s *Screen) openWorkItemDetail(wi api.WorkItem) {
	cp := wi
	s.detailItemID = wi.ID
	s.detailItem = &cp
	s.detailOpen = true
	s.detailError = ""
	s.detailComments = nil
	s.detailTimeline = nil
	s.detailTaskExec = nil
	s.detailTaskConv = nil
	s.detailTaskRuns = nil
	s.commentDraft = ""
	s.editingCommentID = ""
	s.loadWorkItemDetailsAsync(wi)
}

func (s *Screen) syncDetailItemFromSlice() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, wi := range s.workItems {
		if wi.ID == s.detailItemID {
			cp := wi
			s.detailItem = &cp
			return
		}
	}
}

func (s *Screen) loadWorkItemDetailsAsync(wi api.WorkItem) {
	client := s.client()
	if client == nil {
		return
	}
	s.detailBusy = true
	go func() {
		ctx := context.Background()
		latest, gErr := client.GetWorkItem(ctx, wi.ID)
		comments, cErr := client.ListWorkItemComments(ctx, wi.ID)
		timeline, tErr := client.ListWorkItemTimelineTyped(ctx, wi.ID)

		var execPtr *api.TaskExecutionProjection
		var convPtr *api.TaskConversation
		var runsPtr *api.TaskRuntimePresentationRunPage
		if wi.Kind == "task" {
			if ex, err := client.GetTaskExecution(ctx, wi.ID); err == nil {
				execPtr = &ex
			}
			if cv, err := client.GetTaskConversationTyped(ctx, wi.ID); err == nil {
				convPtr = &cv
			}
			if rp, err := client.ListTaskRuntimePresentationRuns(ctx, wi.ID, 10, ""); err == nil {
				runsPtr = &rp
			}
		}

		s.enqueueUI(func() {
			s.detailBusy = false
			if gErr == nil {
				s.replaceWorkItem(latest)
			}
			if cErr == nil {
				s.detailComments = comments.Items
			} else if s.detailError == "" {
				s.detailError = cErr.Error()
			}
			if tErr == nil {
				s.detailTimeline = timeline.Items
			}
			s.detailTaskExec = execPtr
			s.detailTaskConv = convPtr
			s.detailTaskRuns = runsPtr
		})
	}()
}

func (s *Screen) replaceWorkItem(updated api.WorkItem) {
	s.mu.Lock()
	found := false
	for i := range s.workItems {
		if s.workItems[i].ID == updated.ID {
			s.workItems[i] = updated
			found = true
			break
		}
	}
	if !found {
		s.workItems = append([]api.WorkItem{updated}, s.workItems...)
	}
	s.mu.Unlock()
	if cs := s.cacheStore(); cs != nil {
		_ = cs.UpsertWorkItems(context.Background(), []api.WorkItem{updated})
	}
	if s.detailItemID == updated.ID {
		cp := updated
		s.detailItem = &cp
	}
}

func (s *Screen) viewWorkItemDetailSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.detailOpen, mobile.SheetOptions{
		Detents: []float32{0.94},
		Label:   i18n.T("work.issues.detail_title"),
	}, func() {
		wi := s.detailItem
		if wi == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				if s.detailError != "" {
					components.StatusBanner(c, components.ToneDanger, s.detailError, i18n.T("common.dismiss"), func() {
						s.detailError = ""
					})
				}

				// Title & status badges
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Text(c, fmt.Sprintf("#%d \u00b7 %s", wi.Number, strings.ToUpper(i18n.WorkKindLabel(wi.Kind)))).
						FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.Row(c).Gap(6).Children(func() {
						components.StatusPill(c, i18n.WorkPriorityLabel(wi.Priority), priorityTone(wi.Priority))
						components.StatusPill(c, formatWorkItemState(wi.State), stateTone(wi.State))
					})
				})
				ui.Text(c, wi.Title).FontSize(19).Bold().TextColor(t.Text)
				if strings.TrimSpace(wi.Description) != "" {
					ui.Text(c, wi.Description).FontSize(14).TextColor(t.TextMuted)
				}

				// Action bar (Transition, Edit, Archive/Unarchive, Jump to Work Room)
				ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
					trBtn := components.PrimaryTouchButton(c, i18n.T("work.issues.transition_btn"), s.detailBusy)
					if trBtn.Clicked() {
						s.transitionSheet = true
					}
					edBtn := components.SecondaryTouchButton(c, i18n.T("common.edit"), s.detailBusy)
					if edBtn.Clicked() {
						s.openEditWorkItem(*wi)
					}
					archLabel := i18n.T("work.issues.archive_btn")
					if wi.ArchivedAt != nil {
						archLabel = i18n.T("work.issues.unarchive_btn")
					}
					archBtn := components.SecondaryTouchButton(c, archLabel, s.detailBusy)
					if archBtn.Clicked() {
						s.toggleArchiveWorkItem(*wi)
					}
					roomTarget := ""
					if wi.WorkRoomID != nil && *wi.WorkRoomID != "" {
						roomTarget = *wi.WorkRoomID
					} else if wi.OriginRoomID != nil && *wi.OriginRoomID != "" {
						roomTarget = *wi.OriginRoomID
					}
					if roomTarget != "" && s.deps.OnOpenRoom != nil {
						rmBtn := components.SecondaryTouchButton(c, i18n.T("work.issues.jump_room"), false)
						if rmBtn.Clicked() {
							s.detailOpen = false
							s.deps.OnOpenRoom(roomTarget)
						}
					}
				})

				// Assignees section
				components.SectionCard(c, i18n.T("work.issues.assignees"), "", func() {
					addBtn := components.SecondaryTouchButton(c, i18n.T("work.issues.assign_btn"), s.detailBusy)
					addBtn.MinHeight(34).Padding(6, 10)
					if addBtn.Clicked() {
						s.assigneeSheet = true
					}
				}, func() {
					if len(wi.Assignees) == 0 {
						ui.Text(c, i18n.T("work.issues.unassigned")).FontSize(13).TextColor(t.TextMuted)
						return
					}
					ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
						for _, a := range wi.Assignees {
							a := a
							chip := ui.Row(c.Key(a.Actor.ID)).MinHeight(34).Padding(4, 10).Radius(999).
								Background(theme.Extra(t).MutedBg).AlignItems(ui.Center).Gap(6).
								Role(ui.RoleButton).Label(i18n.Tf("work.issues.remove_assignee_a11y", map[string]any{"name": a.Actor.DisplayName}))
							chip.Children(func() {
								ui.Text(c, a.Actor.DisplayName+" \u00d7").FontSize(12).FontWeight(600).TextColor(t.Text)
							})
							if chip.Clicked() {
								s.removeWorkItemAssignee(wi.ID, a.Actor.ID)
							}
						}
					})
				})

				// Task Execution / Conversation / Presentation Runs
				if wi.Kind == "task" {
					s.viewTaskDetailsSection(c, *wi)
				}

				// Comments thread + IME-safe composer
				components.SectionCard(c, i18n.Tf("work.issues.comments_title", map[string]any{"count": len(s.detailComments)}), "", nil, func() {
					if len(s.detailComments) == 0 {
						ui.Text(c, i18n.T("work.issues.comments_empty")).FontSize(13).TextColor(t.TextMuted)
					} else {
						ui.Column(c).FillWidth().Gap(8).Children(func() {
							for _, cm := range s.detailComments {
								cm := cm
								if cm.DeletedAt != nil {
									continue
								}
								ui.Column(c.Key(cm.ID)).FillWidth().Padding(10, 10).Radius(10).
									Background(theme.Extra(t).MutedBg).Gap(4).Children(func() {
									ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
										ui.Text(c, cm.Author.DisplayName).FontSize(12).FontWeight(600).TextColor(t.Text)
										ui.Row(c).Gap(6).Children(func() {
											eb := ui.Row(c).MinHeight(28).PaddingX(8).Radius(6).Background(t.Surface).
												AlignItems(ui.Center).Role(ui.RoleButton).Label(i18n.T("work.issues.edit_comment_a11y"))
											eb.Children(func() {
												ui.Text(c, i18n.T("common.edit")).FontSize(11).TextColor(t.Accent)
											})
											if eb.Clicked() {
												s.editingCommentID = cm.ID
												s.editingCommentVer = cm.Version
												s.editingCommentBody = cm.Body
											}
											db := ui.Row(c).MinHeight(28).PaddingX(8).Radius(6).Background(t.Surface).
												AlignItems(ui.Center).Role(ui.RoleButton).Label(i18n.T("work.issues.delete_comment_a11y"))
											db.Children(func() {
												ui.Text(c, i18n.T("common.delete")).FontSize(11).TextColor(t.Danger)
											})
											if db.Clicked() {
												s.deleteCommentAsync(wi.ID, cm.ID, cm.Version)
											}
										})
									})
									if s.editingCommentID == cm.ID {
										ui.TextArea(c, &s.editingCommentBody).FillWidth().MinHeight(64).Label(i18n.T("work.issues.edit_comment_title"))
										ui.Row(c).FillWidth().Gap(8).Children(func() {
											saveBtn := components.PrimaryTouchButton(c, i18n.T("common.save"), strings.TrimSpace(s.editingCommentBody) == "")
											saveBtn.Grow(1).Basis(0)
											if saveBtn.Clicked() {
												s.updateCommentAsync(wi.ID, cm.ID, s.editingCommentBody, s.editingCommentVer)
											}
											cancelBtn := components.SecondaryTouchButton(c, i18n.T("common.cancel"), false)
											cancelBtn.Grow(1).Basis(0)
											if cancelBtn.Clicked() {
												s.editingCommentID = ""
											}
										})
									} else {
										ui.Text(c, cm.Body).FontSize(13).TextColor(t.Text)
									}
								})
							}
						})
					}

					// IME-safe comment composer: plain Enter sends; Shift+Enter adds newline; IME composition ignores Enter.
					ui.Column(c).FillWidth().Gap(6).Children(func() {
						ta := ui.TextArea(c, &s.commentDraft).FillWidth().MinHeight(68).
							Placeholder(i18n.T("work.issues.comment_placeholder")).Label(i18n.T("work.issues.comment_a11y"))
						ta.OnTextKey(func(k ui.TextKey) bool {
							if k.Key != ui.KeyEnter || k.Mods != 0 {
								return false
							}
							txt := strings.TrimSpace(k.Text())
							if txt == "" {
								return true
							}
							k.SetText("")
							s.commentDraft = ""
							s.addCommentAsync(wi.ID, txt)
							return true
						})
						sendBtn := components.PrimaryTouchButton(c, i18n.T("work.issues.send_comment"), s.detailBusy || strings.TrimSpace(s.commentDraft) == "")
						sendBtn.FillWidth()
						if sendBtn.Clicked() {
							s.addCommentAsync(wi.ID, s.commentDraft)
						}
					})
				})

				// Activity Timeline
				components.SectionCard(c, i18n.Tf("work.issues.activity_title", map[string]any{"count": len(s.detailTimeline)}), "", nil, func() {
					if len(s.detailTimeline) == 0 {
						ui.Text(c, i18n.T("work.issues.activity_empty")).FontSize(13).TextColor(t.TextMuted)
						return
					}
					ui.Column(c).FillWidth().Gap(6).Children(func() {
						for i, entry := range s.detailTimeline {
							if entry.Activity != nil {
								act := entry.Activity
								desc := act.Kind
								if act.FromState != nil && act.ToState != nil {
									desc = fmt.Sprintf("%s: %s -> %s", act.Kind, formatWorkItemState(*act.FromState), formatWorkItemState(*act.ToState))
								}
								ui.Row(c.Key(i)).FillWidth().Gap(6).Children(func() {
									ui.Text(c, "\u2022 "+act.Actor.DisplayName+" \u2014 "+desc).FontSize(12).TextColor(t.TextMuted)
								})
							} else if entry.Comment != nil {
								ui.Row(c.Key(i)).FillWidth().Gap(6).Children(func() {
									ui.Text(c, i18n.Tf("work.issues.activity_commented", map[string]any{
										"actor": entry.Comment.Author.DisplayName,
									})).FontSize(12).TextColor(t.TextMuted)
								})
							}
						}
					})
				})
			})
		})
	})
}

func (s *Screen) viewTaskDetailsSection(c *ui.Context, wi api.WorkItem) {
	t := c.Theme()
	components.SectionCard(c, i18n.T("work.issues.exec_title"), "", nil, func() {
		if s.detailTaskExec != nil {
			ui.Row(c).FillWidth().Wrap().Gap(6).AlignItems(ui.Center).Children(func() {
				components.StatusPill(c, i18n.Tf("work.issues.status_line", map[string]any{"status": i18n.StatusLabel(s.detailTaskExec.Status)}), components.ToneInfo)
				components.StatusPill(c, i18n.Tf("work.issues.gen_line", map[string]any{"gen": s.detailTaskExec.Generation}), components.ToneNeutral)
				if s.detailTaskExec.DesiredControl != "" && s.detailTaskExec.DesiredControl != "none" {
					components.StatusPill(c, i18n.Tf("work.issues.control_line", map[string]any{"control": s.detailTaskExec.DesiredControl}), components.ToneWarning)
				}
			})
		} else if wi.TaskExecution != nil {
			components.StatusPill(c, i18n.Tf("work.issues.status_line", map[string]any{"status": i18n.StatusLabel(wi.TaskExecution.Status)}), components.ToneInfo)
		} else {
			ui.Text(c, i18n.T("work.issues.exec_empty")).FontSize(12).TextColor(t.TextMuted)
		}

		if s.detailTaskConv != nil && len(s.detailTaskConv.Inputs) > 0 {
			ui.Text(c, i18n.Tf("work.issues.inputs_cards", map[string]any{
				"inputs": len(s.detailTaskConv.Inputs),
				"cards":  len(s.detailTaskConv.Cards),
			})).FontSize(12).FontWeight(600).TextColor(t.Text)
			for _, in := range s.detailTaskConv.Inputs {
				ui.Text(c, in.Author.DisplayName+": "+in.Body).FontSize(12).TextColor(t.TextMuted).MaxLines(2)
			}
		}

		if s.detailTaskRuns != nil {
			totalRuns := len(s.detailTaskRuns.ActiveItems) + len(s.detailTaskRuns.HistoryItems)
			ui.Text(c, i18n.Tf("work.issues.pres_runs", map[string]any{
				"active":  len(s.detailTaskRuns.ActiveItems),
				"history": len(s.detailTaskRuns.HistoryItems),
			})).FontSize(12).TextColor(t.TextMuted)
			if totalRuns > 0 {
				for _, run := range s.detailTaskRuns.ActiveItems {
					ui.Row(c.Key(run.RunID)).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
						ui.Text(c, run.Agent.DisplayName).FontSize(12).TextColor(t.Text)
						components.StatusPill(c, i18n.StatusLabel(run.Status), components.ToneSuccess)
					})
				}
			}
		}
	})
}

func (s *Screen) viewTransitionActionSheet(c *ui.Context) {
	wi := s.detailItem
	if wi == nil {
		s.transitionSheet = false
		return
	}
	actions := []mobile.Action{
		{
			Label: i18n.WorkStateLabel("open"),
			OnTap: func() { s.transitionWorkItem(*wi, "open", nil) },
		},
		{
			Label: i18n.WorkStateLabel("in_progress"),
			OnTap: func() { s.transitionWorkItem(*wi, "in_progress", nil) },
		},
		{
			Label: i18n.T("work.issues.res_completed"),
			OnTap: func() {
				res := "completed"
				s.transitionWorkItem(*wi, "resolved", &res)
			},
		},
		{
			Label: i18n.T("work.issues.res_not_planned"),
			OnTap: func() {
				res := "not_planned"
				s.transitionWorkItem(*wi, "resolved", &res)
			},
		},
	}
	mobile.ActionSheet(c, &s.transitionSheet, mobile.ActionSheetOptions{
		Title:   i18n.Tf("work.issues.transition_title", map[string]any{"num": wi.Number}),
		Message: i18n.Tf("work.issues.current_state", map[string]any{"state": formatWorkItemState(wi.State)}),
		Cancel:  i18n.T("common.cancel"),
	}, actions...)
}

func (s *Screen) transitionWorkItem(wi api.WorkItem, state string, resolution *string) {
	client := s.client()
	if client == nil {
		return
	}
	s.detailBusy = true
	s.detailError = ""
	go func() {
		updated, err := client.TransitionWorkItemIdempotent(context.Background(), wi.ID, state, resolution, wi.Version, "")
		s.enqueueUI(func() {
			s.detailBusy = false
			if err != nil {
				s.detailError = err.Error()
				return
			}
			s.replaceWorkItem(updated)
			s.loadWorkItemDetailsAsync(updated)
			s.toast(i18n.Tf("work.issues.toast.updated_state", map[string]any{"state": formatWorkItemState(updated.State)}))
		})
	}()
}

func (s *Screen) openEditWorkItem(wi api.WorkItem) {
	s.editTitle = wi.Title
	s.editDesc = wi.Description
	s.editPriority = 1
	switch wi.Priority {
	case "low":
		s.editPriority = 0
	case "medium":
		s.editPriority = 1
	case "high":
		s.editPriority = 2
	case "urgent":
		s.editPriority = 3
	}
	s.editError = ""
	s.editSheetOpen = true
}

func (s *Screen) viewWorkItemEditSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.editSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.72, 0.90},
		Label:   i18n.T("work.issues.edit_a11y"),
	}, func() {
		wi := s.detailItem
		if wi == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, i18n.Tf("work.issues.edit_title", map[string]any{"num": wi.Number})).FontSize(18).Bold().TextColor(t.Text)
				if s.editError != "" {
					components.StatusBanner(c, components.ToneDanger, s.editError, i18n.T("common.dismiss"), func() {
						s.editError = ""
					})
				}
				components.FormField(c, i18n.T("work.issues.title_label"), i18n.T("work.issues.title_label"), &s.editTitle, false)
				ui.Column(c).FillWidth().Gap(4).Children(func() {
					ui.Text(c, i18n.T("work.issues.desc_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.TextArea(c, &s.editDesc).FillWidth().MinHeight(88).Label(i18n.T("work.issues.edit_desc_a11y"))
				})
				components.SegmentedControl(c, &s.editPriority,
					i18n.WorkPriorityLabel("low"),
					i18n.WorkPriorityLabel("medium"),
					i18n.WorkPriorityLabel("high"),
					i18n.WorkPriorityLabel("urgent"))
				saveLabel := i18n.T("work.issues.save_changes")
				if s.editBusy {
					saveLabel = i18n.T("common.saving")
				}
				btn := components.PrimaryTouchButton(c, saveLabel, s.editBusy || strings.TrimSpace(s.editTitle) == "")
				btn.FillWidth()
				if btn.Clicked() {
					s.submitEditWorkItem(*wi)
				}
			})
		})
	})
}

func (s *Screen) submitEditWorkItem(wi api.WorkItem) {
	client := s.client()
	if client == nil || s.editBusy {
		return
	}
	title := strings.TrimSpace(s.editTitle)
	desc := strings.TrimSpace(s.editDesc)
	priorities := []string{"low", "medium", "high", "urgent"}
	prio := priorities[s.editPriority%len(priorities)]
	s.editBusy = true
	s.editError = ""
	go func() {
		updated, err := client.UpdateWorkItemIdempotent(context.Background(), wi.ID, api.WorkItemUpdateInput{
			ExpectedVersion: wi.Version,
			Title:           &title,
			Description:     &desc,
			Priority:        &prio,
		}, "")
		s.enqueueUI(func() {
			s.editBusy = false
			if err != nil {
				s.editError = err.Error()
				return
			}
			s.replaceWorkItem(updated)
			s.editSheetOpen = false
			s.toast(i18n.T("work.issues.toast.saved"))
		})
	}()
}

func (s *Screen) toggleArchiveWorkItem(wi api.WorkItem) {
	client := s.client()
	if client == nil {
		return
	}
	s.detailBusy = true
	s.detailError = ""
	go func() {
		var updated api.WorkItem
		var err error
		if wi.ArchivedAt != nil {
			updated, err = client.UnarchiveWorkItemIdempotent(context.Background(), wi.ID, wi.Version, "")
		} else {
			updated, err = client.ArchiveWorkItemIdempotent(context.Background(), wi.ID, wi.Version, "")
		}
		s.enqueueUI(func() {
			s.detailBusy = false
			if err != nil {
				s.detailError = err.Error()
				return
			}
			s.replaceWorkItem(updated)
			mygo.Haptics.Light()
		})
	}()
}

func (s *Screen) viewAssigneeSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.assigneeSheet, mobile.SheetOptions{
		Detents: []float32{0.55, 0.85},
		Label:   i18n.T("work.issues.assign_member_a11y"),
	}, func() {
		wi := s.detailItem
		if wi == nil {
			return
		}
		s.mu.Lock()
		actors := append([]api.Actor(nil), s.actors...)
		s.mu.Unlock()
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(8).Children(func() {
				ui.Text(c, i18n.T("work.issues.assign_title")).FontSize(18).Bold().TextColor(t.Text)
				if len(actors) == 0 {
					ui.Text(c, i18n.T("work.issues.no_actors")).FontSize(13).TextColor(t.TextMuted)
					return
				}
				for _, act := range actors {
					act := act
					assigned := false
					for _, a := range wi.Assignees {
						if a.Actor.ID == act.ID {
							assigned = true
							break
						}
					}
					row := ui.Row(c.Key(act.ID)).FillWidth().MinHeight(48).Padding(8, 12).Gap(10).
						Radius(10).Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).
						Role(ui.RoleButton).Label(i18n.Tf("work.issues.assign_a11y", map[string]any{"name": act.DisplayName}))
					row.Children(func() {
						components.AvatarBadge(c, act.DisplayName, 32)
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, act.DisplayName).FontSize(14).FontWeight(600).TextColor(t.Text)
							ui.Text(c, i18n.ActorRoleLabel(act.Kind)).FontSize(11).TextColor(t.TextMuted)
						})
						if assigned {
							components.StatusPill(c, i18n.T("work.issues.assigned_badge"), components.ToneSuccess)
						}
					})
					if row.Clicked() {
						if assigned {
							s.removeWorkItemAssignee(wi.ID, act.ID)
						} else {
							s.addWorkItemAssignee(wi.ID, act.ID)
						}
						s.assigneeSheet = false
					}
				}
			})
		})
	})
}

func (s *Screen) addWorkItemAssignee(wiID, actorID string) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		_, err := client.PutWorkItemAssignment(context.Background(), wiID, actorID, "")
		if err != nil {
			s.enqueueUI(func() { s.detailError = err.Error() })
			return
		}
		if latest, gErr := client.GetWorkItem(context.Background(), wiID); gErr == nil {
			s.enqueueUI(func() { s.replaceWorkItem(latest) })
		}
	}()
}

func (s *Screen) removeWorkItemAssignee(wiID, actorID string) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		if err := client.DeleteWorkItemAssignment(context.Background(), wiID, actorID, ""); err != nil {
			s.enqueueUI(func() { s.detailError = err.Error() })
			return
		}
		if latest, gErr := client.GetWorkItem(context.Background(), wiID); gErr == nil {
			s.enqueueUI(func() { s.replaceWorkItem(latest) })
		}
	}()
}

func (s *Screen) addCommentAsync(wiID, body string) {
	body = strings.TrimSpace(body)
	client := s.client()
	if client == nil || body == "" {
		return
	}
	s.detailBusy = true
	s.detailError = ""
	go func() {
		cm, err := client.CreateWorkItemCommentIdempotent(context.Background(), wiID, body, "")
		s.enqueueUI(func() {
			s.detailBusy = false
			if err != nil {
				s.detailError = err.Error()
				return
			}
			s.commentDraft = ""
			s.detailComments = append(s.detailComments, cm)
		})
	}()
}

func (s *Screen) updateCommentAsync(wiID, commentID, body string, ver int64) {
	client := s.client()
	body = strings.TrimSpace(body)
	if client == nil || body == "" {
		return
	}
	s.detailBusy = true
	go func() {
		cm, err := client.UpdateWorkItemComment(context.Background(), wiID, commentID, body, ver, "")
		s.enqueueUI(func() {
			s.detailBusy = false
			if err != nil {
				s.detailError = err.Error()
				return
			}
			s.editingCommentID = ""
			for i := range s.detailComments {
				if s.detailComments[i].ID == cm.ID {
					s.detailComments[i] = cm
					break
				}
			}
		})
	}()
}

func (s *Screen) deleteCommentAsync(wiID, commentID string, ver int64) {
	client := s.client()
	if client == nil {
		return
	}
	s.detailBusy = true
	go func() {
		cm, err := client.DeleteWorkItemComment(context.Background(), wiID, commentID, ver, "")
		s.enqueueUI(func() {
			s.detailBusy = false
			if err != nil {
				s.detailError = err.Error()
				return
			}
			for i := range s.detailComments {
				if s.detailComments[i].ID == cm.ID {
					s.detailComments[i] = cm
					break
				}
			}
		})
	}()
}
