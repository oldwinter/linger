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
	"github.com/oldwinter/linger/mobile/internal/i18n"
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

	agentName := i18n.T("run.title")
	elapsed := i18n.T("run.live_pill")
	if runMeta != nil {
		if runMeta.Agent.DisplayName != "" {
			agentName = runMeta.Agent.DisplayName
		}
		elapsed = formatElapsed(runMeta.CreatedAt)
	}

	isLive := runMeta == nil || runMeta.Status == "active"

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 14, 24, 14).Gap(12).Children(func() {
			// Run Hero Card & Balanced Remote Controls
			hero := ui.Column(c).FillWidth().Background(t.Surface).Radius(18).Padding(16, 16).Gap(12)
			components.ApplyCardElevation(hero, t)
			hero.Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(12).Children(func() {
					components.AvatarBadge(c, agentName, 40)
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, agentName).FontSize(16.5).FontWeight(600).LetterSpacing(-0.2).TextColor(t.Text).MaxLines(1)
						ui.Text(c, i18n.Tf("run.header", map[string]any{"id": runID, "status": elapsed})).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
					})
					components.StatusDotPill(c, i18n.StatusLabel(statusLabel), statusTone)
				})
				if statusDetail != "" {
					ui.Text(c, statusDetail).FontSize(13).LineHeight(1.35).TextColor(t.TextMuted)
				}
				if failureCode != "" {
					components.ErrorInline(c, i18n.Tf("run.failure_prefix", map[string]any{"err": failureCode}), nil)
				}
				ui.Row(c).FillWidth().Gap(8).Children(func() {
					syncBtn := components.SecondaryTouchButton(c, i18n.T("run.sync_events"), false)
					syncBtn.Grow(1).Basis(0).MinHeight(40)
					if syncBtn.Clicked() {
						go func() { _ = ctl.store.SyncRunPresentation(context.Background(), roomID, runID) }()
					}
					bgBtn := components.SecondaryTouchButton(c, i18n.T("run.background_tasks"), false)
					bgBtn.Grow(1).Basis(0).MinHeight(40)
					if bgBtn.Clicked() {
						ctl.openBackgroundTasks(roomID)
					}
				})
				stopBtn := components.DangerTouchButton(c, i18n.T("run.stop_run"), runMeta != nil && runMeta.Status != "active")
				stopBtn.FillWidth().MinHeight(40)
				if stopBtn.Clicked() {
					ctl.mu.Lock()
					ctl.watchRoomID = roomID
					ctl.watchRunID = runID
					ctl.cancelConfirmOpen = true
					ctl.mu.Unlock()
				}
				if unconfirmedCount > 0 || (runMeta != nil && runMeta.Status != "active") {
					redeliverBtn := components.SecondaryTouchButton(c, i18n.T("run.redeliver_inputs"), false)
					redeliverBtn.FillWidth().MinHeight(40)
					if redeliverBtn.Clicked() {
						go func() { _ = ctl.store.RedeliverRunInputs(context.Background(), roomID, runID) }()
					}
				}
			})

			// Structured Plan Checklist (plan.updated) with sculpted step markers
			if len(planSteps) > 0 {
				components.SectionCard(c, i18n.T("run.plan_title"), planExplanation, nil, func() {
					ui.Column(c).FillWidth().Gap(10).Children(func() {
						for i, step := range planSteps {
							step := step
							ui.Row(c.Key(i)).FillWidth().AlignItems(ui.Center).Gap(10).Children(func() {
								ui.Box(c).Size(20, 20).Shrink(0).Draw(func(p *ui.Painter, r ui.Rect) {
									cx := r.X + r.W/2
									cy := r.Y + r.H/2
									switch step.Status {
									case "completed":
										p.Fill(r, t.Success, r.W/2)
										theme.IconCheck(p, ui.Rect{X: r.X + 4, Y: r.Y + 4, W: r.W - 8, H: r.H - 8}, ex.OnAvatar)
									case "in_progress":
										p.Fill(r, ex.Brand.Alpha(0.22), r.W/2)
										d := float32(8)
										p.Fill(ui.Rect{X: cx - d/2, Y: cy - d/2, W: d, H: d}, ex.Brand, d/2)
									default:
										var ring ui.Path
										ring.Circle(cx, cy, 7)
										p.StrokePath(&ring, 1.5, ex.TextSubtle)
									}
								})
								txtCol := t.Text
								weight := 500
								if step.Status == "completed" {
									txtCol = t.TextMuted
									weight = 400
								} else if step.Status == "in_progress" {
									weight = 600
								}
								ui.Text(c, step.Content).FontSize(13.5).FontWeight(weight).LineHeight(1.35).TextColor(txtCol).Grow(1).Basis(0)
							})
						}
					})
				})
			}

			// Expandable Tool / Activity Timeline
			components.SectionCard(c, i18n.Tf("run.activities_title", map[string]any{"count": len(activities)}), i18n.T("run.activities_subtitle"), nil, func() {
				if len(activities) == 0 {
					ui.Text(c, i18n.T("run.activities_empty")).FontSize(13).TextColor(t.TextMuted)
					return
				}
				ui.Column(c).FillWidth().Gap(8).Children(func() {
					for _, act := range activities {
						act := act
						ctl.mu.Lock()
						expanded := ctl.expandedActivities[act.ID]
						ctl.mu.Unlock()

						tone := components.ToneBrand
						stateTxt := i18n.StatusLabel("running")
						if act.Outcome != "" {
							stateTxt = i18n.StatusLabel(act.Outcome)
							if act.Outcome == "succeeded" {
								tone = components.ToneSuccess
							} else {
								tone = components.ToneDanger
							}
						}

						box := ui.Column(c.Key(act.ID)).FillWidth().Padding(11, 12).Radius(12).Background(ex.MutedBg).
							Border(0.75, ex.SubtleBorder).Gap(6).Role(ui.RoleButton).Label(i18n.Tf("run.activity_a11y", map[string]any{"title": act.Title}))
						box.Children(func() {
							ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
								ui.Text(c, act.Title).FontSize(13.5).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
								components.StatusDotPill(c, stateTxt, tone)
							})
							if act.Detail != "" {
								ui.Text(c, act.Detail).FontSize(12).LineHeight(1.35).TextColor(t.TextMuted)
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
										ui.Column(c.Key(bi)).FillWidth().Padding(9, 10).Radius(8).Background(t.Surface).
											Border(0.75, ex.SubtleBorder).Children(func() {
											ui.Text(c, txt).FontSize(12).LineHeight(1.4).TextColor(t.Text)
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
				components.SectionCard(c, i18n.T("run.streaming_title"), i18n.T("run.streaming_subtitle"), nil, func() {
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
		Title:   i18n.T("run.stop_dialog_title"),
		Message: i18n.T("run.stop_dialog_body"),
		Cancel:  i18n.T("run.keep_running"),
	}, mobile.Action{
		Label:       i18n.T("run.stop_now"),
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
		Label:   i18n.T("run.background_tasks"),
	}, func() {
		ctl.mu.Lock()
		tasks := append([]api.RoomBackgroundTask(nil), ctl.bgTasks...)
		ctl.mu.Unlock()
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, i18n.Tf("run.bg_title", map[string]any{"count": len(tasks)})).FontSize(18).Bold().TextColor(t.Text)
				if len(tasks) == 0 {
					ui.Text(c, i18n.T("run.bg_empty")).FontSize(13).TextColor(t.TextMuted)
					return
				}
				for _, task := range tasks {
					task := task
					components.SectionCard(c, task.Title, task.Requirement, func() {
						cancelBtn := components.DangerTouchButton(c, i18n.T("common.cancel"), false)
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
