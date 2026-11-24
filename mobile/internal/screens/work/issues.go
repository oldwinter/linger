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
	"github.com/oldwinter/linger/mobile/internal/theme"
)

var issueFilterLabels = []string{"Mine", "Open", "In Progress", "Resolved", "Archived"}

func (s *Screen) viewIssuesSegment(c *ui.Context) {
	t := c.Theme()

	s.mu.Lock()
	allItems := append([]api.WorkItem(nil), s.workItems...)
	s.mu.Unlock()
	filtered := s.filterWorkItems(allItems)

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SegmentIssues]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
			// Narrow-safe horizontally scrollable filter pills + New Work Item button.
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				ui.ScrollHorizontal(c).Grow(1).Basis(0).Children(func() {
					ui.Row(c).Gap(6).Role(ui.RoleTabList).Children(func() {
						for idx, label := range issueFilterLabels {
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
				newBtn := components.PrimaryTouchButton(c, "+ New", false)
				newBtn.Shrink(0)
				if newBtn.Clicked() {
					s.openCreateWorkItemSheet()
				}
			})

			if len(filtered) == 0 {
				msg := "No Work Items match the selected filter."
				if len(allItems) == 0 {
					msg = "No Work Items synced yet. Create an issue or task, or pull sync."
				}
				components.EmptyState(c, theme.IconWork, "No Work Items", msg, "New Work Item", func() {
					s.openCreateWorkItemSheet()
				})
				return
			}

			for _, wi := range filtered {
				wi := wi
				row := ui.Column(c.Key(wi.ID)).FillWidth().Padding(12, 12).Gap(6).
					Radius(12).Background(t.Surface).Border(1, t.Border).
					Role(ui.RoleButton).Label(fmt.Sprintf("Work item #%d %s", wi.Number, wi.Title))
				row.Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Text(c, fmt.Sprintf("#%d · %s", wi.Number, strings.ToUpper(wi.Kind))).
							FontSize(11).FontWeight(600).TextColor(t.TextMuted).NoWrap()
						ui.Row(c).Gap(4).Shrink(0).Children(func() {
							components.StatusPill(c, wi.Priority, priorityTone(wi.Priority))
							if wi.ArchivedAt != nil {
								components.StatusPill(c, "Archived", components.ToneNeutral)
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
							ui.Text(c, "Assigned: "+strings.Join(names, ", ")).FontSize(11).TextColor(t.TextMuted)
						}
						if wi.TaskExecution != nil {
							components.StatusPill(c, "Exec: "+wi.TaskExecution.Status, components.ToneInfo)
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
		Label:   "Create Work Item",
	}, func() {
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, "New Work Item").FontSize(18).Bold().TextColor(t.Text)
				if s.createError != "" {
					components.StatusBanner(c, components.ToneDanger, s.createError, "Dismiss", func() {
						s.createError = ""
					})
				}

				ui.Text(c, "Kind").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				components.SegmentedControl(c, &s.createKind, "Issue", "Task")

				components.FormField(c, "Title", "Describe the work item", &s.createTitle, false)

				ui.Column(c).FillWidth().Gap(4).Children(func() {
					ui.Text(c, "Description").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.TextArea(c, &s.createDesc).FillWidth().MinHeight(88).
						Placeholder("Optional acceptance details or context").Label("Work Item Description")
				})

				ui.Text(c, "Priority").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				components.SegmentedControl(c, &s.createPriority, "Low", "Medium", "High", "Urgent")

				submitLabel := "Create Work Item"
				if s.createBusy {
					submitLabel = "Creating..."
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
		s.createError = "Connect to a host before creating Work Items."
		return
	}
	title := strings.TrimSpace(s.createTitle)
	if title == "" {
		s.createError = "Title is required."
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
			s.toast(fmt.Sprintf("Created #%d", wi.Number))
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
		Label:   "Work Item Detail",
	}, func() {
		wi := s.detailItem
		if wi == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				if s.detailError != "" {
					components.StatusBanner(c, components.ToneDanger, s.detailError, "Dismiss", func() {
						s.detailError = ""
					})
				}

				// Title & status badges
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Text(c, fmt.Sprintf("#%d · %s", wi.Number, strings.ToUpper(wi.Kind))).
						FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.Row(c).Gap(6).Children(func() {
						components.StatusPill(c, wi.Priority, priorityTone(wi.Priority))
						components.StatusPill(c, formatWorkItemState(wi.State), stateTone(wi.State))
					})
				})
				ui.Text(c, wi.Title).FontSize(19).Bold().TextColor(t.Text)
				if strings.TrimSpace(wi.Description) != "" {
					ui.Text(c, wi.Description).FontSize(14).TextColor(t.TextMuted)
				}

				// Action bar (Transition, Edit, Archive/Unarchive, Jump to Work Room)
				ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
					trBtn := components.PrimaryTouchButton(c, "Transition", s.detailBusy)
					if trBtn.Clicked() {
						s.transitionSheet = true
					}
					edBtn := components.SecondaryTouchButton(c, "Edit", s.detailBusy)
					if edBtn.Clicked() {
						s.openEditWorkItem(*wi)
					}
					archLabel := "Archive"
					if wi.ArchivedAt != nil {
						archLabel = "Unarchive"
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
						rmBtn := components.SecondaryTouchButton(c, "Jump to Work Room", false)
						if rmBtn.Clicked() {
							s.detailOpen = false
							s.deps.OnOpenRoom(roomTarget)
						}
					}
				})

				// Assignees section
				components.SectionCard(c, "Assignees", "", func() {
					addBtn := components.SecondaryTouchButton(c, "+ Assign", s.detailBusy)
					addBtn.MinHeight(34).Padding(6, 10)
					if addBtn.Clicked() {
						s.assigneeSheet = true
					}
				}, func() {
					if len(wi.Assignees) == 0 {
						ui.Text(c, "Unassigned").FontSize(13).TextColor(t.TextMuted)
						return
					}
					ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
						for _, a := range wi.Assignees {
							a := a
							chip := ui.Row(c.Key(a.Actor.ID)).MinHeight(34).Padding(4, 10).Radius(999).
								Background(theme.Extra(t).MutedBg).AlignItems(ui.Center).Gap(6).
								Role(ui.RoleButton).Label("Remove assignee " + a.Actor.DisplayName)
							chip.Children(func() {
								ui.Text(c, a.Actor.DisplayName+" ×").FontSize(12).FontWeight(600).TextColor(t.Text)
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
				components.SectionCard(c, fmt.Sprintf("Comments (%d)", len(s.detailComments)), "", nil, func() {
					if len(s.detailComments) == 0 {
						ui.Text(c, "No comments yet.").FontSize(13).TextColor(t.TextMuted)
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
												AlignItems(ui.Center).Role(ui.RoleButton).Label("Edit comment")
											eb.Children(func() {
												ui.Text(c, "Edit").FontSize(11).TextColor(t.Accent)
											})
											if eb.Clicked() {
												s.editingCommentID = cm.ID
												s.editingCommentVer = cm.Version
												s.editingCommentBody = cm.Body
											}
											db := ui.Row(c).MinHeight(28).PaddingX(8).Radius(6).Background(t.Surface).
												AlignItems(ui.Center).Role(ui.RoleButton).Label("Delete comment")
											db.Children(func() {
												ui.Text(c, "Delete").FontSize(11).TextColor(t.Danger)
											})
											if db.Clicked() {
												s.deleteCommentAsync(wi.ID, cm.ID, cm.Version)
											}
										})
									})
									if s.editingCommentID == cm.ID {
										ui.TextArea(c, &s.editingCommentBody).FillWidth().MinHeight(64).Label("Edit Comment")
										ui.Row(c).FillWidth().Gap(8).Children(func() {
											saveBtn := components.PrimaryTouchButton(c, "Save", strings.TrimSpace(s.editingCommentBody) == "")
											saveBtn.Grow(1).Basis(0)
											if saveBtn.Clicked() {
												s.updateCommentAsync(wi.ID, cm.ID, s.editingCommentBody, s.editingCommentVer)
											}
											cancelBtn := components.SecondaryTouchButton(c, "Cancel", false)
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
							Placeholder("Add a comment (Shift+Enter for newline)").Label("Work Item Comment Input")
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
						sendBtn := components.PrimaryTouchButton(c, "Send Comment", s.detailBusy || strings.TrimSpace(s.commentDraft) == "")
						sendBtn.FillWidth()
						if sendBtn.Clicked() {
							s.addCommentAsync(wi.ID, s.commentDraft)
						}
					})
				})

				// Activity Timeline
				components.SectionCard(c, fmt.Sprintf("Activity Timeline (%d)", len(s.detailTimeline)), "", nil, func() {
					if len(s.detailTimeline) == 0 {
						ui.Text(c, "No activity events yet.").FontSize(13).TextColor(t.TextMuted)
						return
					}
					ui.Column(c).FillWidth().Gap(6).Children(func() {
						for i, entry := range s.detailTimeline {
							if entry.Activity != nil {
								act := entry.Activity
								desc := act.Kind
								if act.FromState != nil && act.ToState != nil {
									desc = fmt.Sprintf("%s: %s -> %s", act.Kind, *act.FromState, *act.ToState)
								}
								ui.Row(c.Key(i)).FillWidth().Gap(6).Children(func() {
									ui.Text(c, "• "+act.Actor.DisplayName+" — "+desc).FontSize(12).TextColor(t.TextMuted)
								})
							} else if entry.Comment != nil {
								ui.Row(c.Key(i)).FillWidth().Gap(6).Children(func() {
									ui.Text(c, "• "+entry.Comment.Author.DisplayName+" commented").FontSize(12).TextColor(t.TextMuted)
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
	components.SectionCard(c, "Task Execution & Runs", "", nil, func() {
		if s.detailTaskExec != nil {
			ui.Row(c).FillWidth().Wrap().Gap(6).AlignItems(ui.Center).Children(func() {
				components.StatusPill(c, "Status: "+s.detailTaskExec.Status, components.ToneInfo)
				components.StatusPill(c, fmt.Sprintf("Gen %d", s.detailTaskExec.Generation), components.ToneNeutral)
				if s.detailTaskExec.DesiredControl != "" && s.detailTaskExec.DesiredControl != "none" {
					components.StatusPill(c, "Control: "+s.detailTaskExec.DesiredControl, components.ToneWarning)
				}
			})
		} else if wi.TaskExecution != nil {
			components.StatusPill(c, "Status: "+wi.TaskExecution.Status, components.ToneInfo)
		} else {
			ui.Text(c, "No execution projection recorded yet.").FontSize(12).TextColor(t.TextMuted)
		}

		if s.detailTaskConv != nil && len(s.detailTaskConv.Inputs) > 0 {
			ui.Text(c, fmt.Sprintf("Conversation Inputs (%d) · Decision Cards (%d)",
				len(s.detailTaskConv.Inputs), len(s.detailTaskConv.Cards))).
				FontSize(12).FontWeight(600).TextColor(t.Text)
			for _, in := range s.detailTaskConv.Inputs {
				ui.Text(c, in.Author.DisplayName+": "+in.Body).FontSize(12).TextColor(t.TextMuted).MaxLines(2)
			}
		}

		if s.detailTaskRuns != nil {
			totalRuns := len(s.detailTaskRuns.ActiveItems) + len(s.detailTaskRuns.HistoryItems)
			ui.Text(c, fmt.Sprintf("Presentation Runs: %d active, %d history",
				len(s.detailTaskRuns.ActiveItems), len(s.detailTaskRuns.HistoryItems))).
				FontSize(12).TextColor(t.TextMuted)
			if totalRuns > 0 {
				for _, run := range s.detailTaskRuns.ActiveItems {
					ui.Row(c.Key(run.RunID)).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
						ui.Text(c, run.Agent.DisplayName).FontSize(12).TextColor(t.Text)
						components.StatusPill(c, run.Status, components.ToneSuccess)
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
			Label: "Open",
			OnTap: func() { s.transitionWorkItem(*wi, "open", nil) },
		},
		{
			Label: "In Progress",
			OnTap: func() { s.transitionWorkItem(*wi, "in_progress", nil) },
		},
		{
			Label: "Resolved (Completed)",
			OnTap: func() {
				res := "completed"
				s.transitionWorkItem(*wi, "resolved", &res)
			},
		},
		{
			Label: "Resolved (Not Planned)",
			OnTap: func() {
				res := "not_planned"
				s.transitionWorkItem(*wi, "resolved", &res)
			},
		},
	}
	mobile.ActionSheet(c, &s.transitionSheet, mobile.ActionSheetOptions{
		Title:   fmt.Sprintf("Transition #%d", wi.Number),
		Message: "Current state: " + formatWorkItemState(wi.State),
		Cancel:  "Cancel",
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
			s.toast("Updated state to " + formatWorkItemState(updated.State))
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
		Label:   "Edit Work Item",
	}, func() {
		wi := s.detailItem
		if wi == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(12).Children(func() {
				ui.Text(c, fmt.Sprintf("Edit #%d", wi.Number)).FontSize(18).Bold().TextColor(t.Text)
				if s.editError != "" {
					components.StatusBanner(c, components.ToneDanger, s.editError, "Dismiss", func() {
						s.editError = ""
					})
				}
				components.FormField(c, "Title", "Title", &s.editTitle, false)
				ui.Column(c).FillWidth().Gap(4).Children(func() {
					ui.Text(c, "Description").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					ui.TextArea(c, &s.editDesc).FillWidth().MinHeight(88).Label("Edit Description")
				})
				components.SegmentedControl(c, &s.editPriority, "Low", "Medium", "High", "Urgent")
				saveLabel := "Save Changes"
				if s.editBusy {
					saveLabel = "Saving..."
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
			s.toast("Work Item saved")
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
		Label:   "Assign Member",
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
				ui.Text(c, "Select Assignee").FontSize(18).Bold().TextColor(t.Text)
				if len(actors) == 0 {
					ui.Text(c, "No tenant actors loaded yet.").FontSize(13).TextColor(t.TextMuted)
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
						Role(ui.RoleButton).Label("Assign " + act.DisplayName)
					row.Children(func() {
						components.AvatarBadge(c, act.DisplayName, 32)
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, act.DisplayName).FontSize(14).FontWeight(600).TextColor(t.Text)
							ui.Text(c, act.Kind).FontSize(11).TextColor(t.TextMuted)
						})
						if assigned {
							components.StatusPill(c, "Assigned", components.ToneSuccess)
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
