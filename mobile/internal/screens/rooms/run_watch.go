package rooms

import (
	"context"
	"fmt"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

type trackedActivity struct {
	ID      string
	Kind    string
	Title   string
	Detail  string
	Outcome string
	Blocks  []api.AgentRuntimeActivityContentBlock
}

// ViewRunWatch renders the real-time streaming Agent Execution watcher for (roomID, runID).
func (ctl *Controller) ViewRunWatch(c *ui.Context, snap state.Snapshot, roomID, runID string) {
	t := c.Theme()
	ex := theme.Extra(t)
	events := ctl.store.RunPresentationEvents(runID)

	var runMeta *api.RoomRunStatus
	for i := range snap.ActiveRuns {
		if snap.ActiveRuns[i].RunID == runID {
			rCopy := snap.ActiveRuns[i]
			runMeta = &rCopy
			break
		}
	}

	// Fold incremental presentation events into live status, Plan, Activities, Output, and Unconfirmed Inputs.
	statusLabel := "working"
	statusDetail := ""
	statusTone := components.ToneInfo
	var planExplanation string
	var planSteps []api.AgentRuntimePlanStep
	var activities []*trackedActivity
	actByID := map[string]*trackedActivity{}
	var streamOut strings.Builder
	var unconfirmedCount int
	var failureCode string

	for _, ev := range events {
		switch ev.Type {
		case "working_status_changed":
			if ev.Status != "" {
				statusLabel = ev.Status
			}
			statusDetail = ev.Title
			statusTone = components.ToneInfo
		case "stopped_status_changed":
			statusLabel = ev.Outcome
			statusDetail = ""
			if statusLabel == "" {
				statusLabel = "stopped"
			}
			if ev.Failure != nil && ev.Failure.Code != "" {
				failureCode = ev.Failure.Code
				statusTone = components.ToneDanger
			} else if statusLabel == "completed" || statusLabel == "succeeded" {
				statusTone = components.ToneSuccess
			} else {
				statusTone = components.ToneWarning
			}
			unconfirmedCount = len(ev.UnconfirmedInputIDs)
		case "plan_updated":
			planExplanation = ev.Explanation
			planSteps = ev.Steps
		case "activity_started":
			act := &trackedActivity{
				ID:     ev.ActivityID,
				Kind:   ev.Kind,
				Title:  ev.Title,
				Blocks: ev.ContentBlocks,
			}
			if act.ID == "" {
				act.ID = fmt.Sprintf("ord_%d", ev.Ordinal)
			}
			actByID[act.ID] = act
			activities = append(activities, act)
		case "activity_updated":
			if act, ok := actByID[ev.ActivityID]; ok {
				act.Detail = ev.Detail
			}
		case "activity_finished":
			if act, ok := actByID[ev.ActivityID]; ok {
				act.Outcome = ev.Outcome
				if len(ev.ContentBlocks) > 0 {
					act.Blocks = append(act.Blocks, ev.ContentBlocks...)
				}
			}
		case "presentation_output_created":
			if ev.OutputText != "" {
				if streamOut.Len() > 0 {
					streamOut.WriteString("\n\n")
				}
				streamOut.WriteString(ev.OutputText)
			}
		}
	}

	if runMeta != nil && runMeta.Status == "aborted" {
		statusLabel = "aborted"
		statusTone = components.ToneDanger
	}

	agentName := "Agent Run"
	elapsed := "live"
	if runMeta != nil {
		if runMeta.Agent.DisplayName != "" {
			agentName = runMeta.Agent.DisplayName
		}
		elapsed = formatElapsed(runMeta.CreatedAt)
	}

	isLive := runMeta == nil || runMeta.Status == "active"

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 14, 24, 14).Gap(12).Children(func() {
			// Run Header & Remote Control Actions
			components.SectionCard(c, agentName, fmt.Sprintf("Run %s · %s", runID, elapsed), func() {
				components.StatusPill(c, statusLabel, statusTone)
			}, func() {
				if statusDetail != "" {
					ui.Text(c, statusDetail).FontSize(13).TextColor(t.TextMuted)
				}
				if failureCode != "" {
					components.ErrorInline(c, "Execution failure: "+failureCode, nil)
				}
				ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
					syncBtn := components.SecondaryTouchButton(c, "Sync Events", false)
					if syncBtn.Clicked() {
						go func() { _ = ctl.store.SyncRunPresentation(context.Background(), roomID, runID) }()
					}
					stopBtn := components.DangerTouchButton(c, "Stop Run", runMeta != nil && runMeta.Status != "active")
					if stopBtn.Clicked() {
						ctl.mu.Lock()
						ctl.watchRoomID = roomID
						ctl.watchRunID = runID
						ctl.cancelConfirmOpen = true
						ctl.mu.Unlock()
					}
					bgBtn := components.SecondaryTouchButton(c, "Background Tasks", false)
					if bgBtn.Clicked() {
						ctl.openBackgroundTasks(roomID)
					}
				})
				if unconfirmedCount > 0 || (runMeta != nil && runMeta.Status != "active") {
					redeliverBtn := components.SecondaryTouchButton(c, "Redeliver Unconfirmed Inputs", false)
					redeliverBtn.FillWidth()
					if redeliverBtn.Clicked() {
						go func() { _ = ctl.store.RedeliverRunInputs(context.Background(), roomID, runID) }()
					}
				}
			})

			// Structured Plan Checklist (plan.updated)
			if len(planSteps) > 0 {
				components.SectionCard(c, "Execution Plan", planExplanation, nil, func() {
					ui.Column(c).FillWidth().Gap(6).Children(func() {
						for i, step := range planSteps {
							ui.Row(c.Key(i)).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
								badge := "○"
								tone := components.ToneNeutral
								switch step.Status {
								case "completed":
									badge = "✓"
									tone = components.ToneSuccess
								case "in_progress":
									badge = "●"
									tone = components.ToneInfo
								}
								components.StatusPill(c, badge, tone)
								ui.Text(c, step.Content).FontSize(13).TextColor(t.Text).Grow(1).Basis(0)
							})
						}
					})
				})
			}

			// Expandable Tool / Activity Timeline
			components.SectionCard(c, fmt.Sprintf("Tool & Activity Timeline (%d)", len(activities)), "Tap an activity to inspect details and output", nil, func() {
				if len(activities) == 0 {
					ui.Text(c, "Waiting for runtime activities...").FontSize(13).TextColor(t.TextMuted)
					return
				}
				ui.Column(c).FillWidth().Gap(8).Children(func() {
					for _, act := range activities {
						act := act
						ctl.mu.Lock()
						expanded := ctl.expandedActivities[act.ID]
						ctl.mu.Unlock()

						tone := components.ToneInfo
						stateTxt := "running"
						if act.Outcome != "" {
							stateTxt = act.Outcome
							if act.Outcome == "succeeded" {
								tone = components.ToneSuccess
							} else {
								tone = components.ToneDanger
							}
						}

						box := ui.Column(c.Key(act.ID)).FillWidth().Padding(10, 10).Radius(10).Background(ex.MutedBg).
							Border(1, t.Border).Gap(6).Role(ui.RoleButton).Label("Activity " + act.Title)
						box.Children(func() {
							ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
								ui.Text(c, act.Title).FontSize(13).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
								components.StatusPill(c, stateTxt, tone)
							})
							if act.Detail != "" {
								ui.Text(c, act.Detail).FontSize(12).TextColor(t.TextMuted)
							}
							if expanded && len(act.Blocks) > 0 {
								for bi, blk := range act.Blocks {
									txt := blk.Text
									if txt == "" {
										txt = blk.Code
									}
									if txt == "" {
										txt = blk.Content
									}
									if txt != "" {
										ui.Column(c.Key(bi)).FillWidth().Padding(8, 8).Radius(8).Background(t.Surface).Children(func() {
											ui.Text(c, txt).FontSize(12).TextColor(t.Text)
										})
									}
								}
							}
						})
						if box.Clicked() {
							ctl.mu.Lock()
							ctl.expandedActivities[act.ID] = !expanded
							ctl.mu.Unlock()
						}
					}
				})
			})

			// Incremental Streaming Output via ui/markdown.Stream while active, markdown.View once complete.
			if streamOut.Len() > 0 {
				components.SectionCard(c, "Streaming Output", "Live presentation output", nil, func() {
					if isLive {
						markdown.Stream(c, streamOut.String(), &markdown.Options{WrapCode: true})
					} else {
						markdown.View(c, streamOut.String(), &markdown.Options{WrapCode: true})
					}
				})
			}
		})
	})

	// Cancel Run Confirmation ActionSheet + Haptics.Warning
	mobile.ActionSheet(c, &ctl.cancelConfirmOpen, mobile.ActionSheetOptions{
		Title:   "Stop Agent Run?",
		Message: "The active Agent turn will be interrupted immediately.",
		Cancel:  "Keep Running",
	}, mobile.Action{
		Label:       "Stop Run Now",
		Destructive: true,
		OnTap: func() {
			mygo.Haptics.Warning()
			ctl.mu.Lock()
			rid, run := ctl.watchRoomID, ctl.watchRunID
			ctl.mu.Unlock()
			go func() { _ = ctl.store.CancelRun(context.Background(), rid, run) }()
		},
	})

	// Background Tasks Sheet
	ctl.viewBackgroundTasksSheet(c, roomID)
}

func (ctl *Controller) openBackgroundTasks(roomID string) {
	ctl.mu.Lock()
	ctl.bgTasksOpen = true
	ctl.mu.Unlock()
	go func() {
		if cl := ctl.store.Client(); cl != nil {
			if items, err := cl.ListRoomBackgroundTasks(context.Background(), roomID); err == nil {
				ctl.mu.Lock()
				ctl.bgTasks = items
				ctl.mu.Unlock()
			}
		}
	}()
}

func (ctl *Controller) viewBackgroundTasksSheet(c *ui.Context, roomID string) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.bgTasksOpen, mobile.SheetOptions{
		Detents: []float32{0.55, 0.85},
		Label:   "Background Tasks",
	}, func() {
		ctl.mu.Lock()
		tasks := append([]api.RoomBackgroundTask(nil), ctl.bgTasks...)
		ctl.mu.Unlock()
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, fmt.Sprintf("Background Tasks (%d)", len(tasks))).FontSize(18).Bold().TextColor(t.Text)
				if len(tasks) == 0 {
					ui.Text(c, "No active background tasks in this Room.").FontSize(13).TextColor(t.TextMuted)
					return
				}
				for _, task := range tasks {
					task := task
					components.SectionCard(c, task.Title, task.Requirement, func() {
						cancelBtn := components.DangerTouchButton(c, "Cancel", false)
						if cancelBtn.Clicked() {
							mygo.Haptics.Warning()
							go func() {
								if cl := ctl.store.Client(); cl != nil {
									_ = cl.CancelRoomBackgroundTask(context.Background(), roomID, task.ID)
									ctl.openBackgroundTasks(roomID)
								}
							}()
						}
					}, nil)
				}
			})
		})
	})
}
