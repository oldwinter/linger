package live

import (
	"context"
	"strconv"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func (ctl *Controller) viewCompute(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ex := theme.Extra(t)
	m := layout.Of(c)

	renderDesktopHostCard := func() {
		if snap.CompanionStatus == nil {
			return
		}
		cs := snap.CompanionStatus
		ver := cs.DesktopVersion
		if ver != "" && ver[0] >= '0' && ver[0] <= '9' {
			ver = "v" + ver
		}
		sub := cs.HostName
		if ver != "" {
			sub += " · " + ver
		}
		if snap.RTTMs > 0 {
			sub += " · " + i18n.Tf("live.compute.rtt_ms", map[string]any{"ms": snap.RTTMs})
		}
		daemonOK := cs.DaemonConnection == "connected" || cs.DaemonConnection == "online"
		components.SectionCard(c, i18n.T("live.compute.desktop_title"), sub, func() {
			tone := components.ToneSuccess
			if cs.LocalModelsDegraded || !daemonOK {
				tone = components.ToneWarning
			}
			components.StatusDotPill(c, i18n.StatusLabel(cs.RuntimeState), tone)
		}, func() {
			telemetryCell := func(text string, dotCol ui.Color) {
				ui.Row(c).Grow(1).Basis(0).Padding(9, 10).Radius(10).Background(ex.MutedBg).
					Border(0.75, ex.SubtleBorder).AlignItems(ui.Center).Gap(7).Children(func() {
					ui.Box(c).Size(6, 6).Radius(3).Background(dotCol).Shrink(0)
					ui.Text(c, text).FontSize(12).FontWeight(500).TextColor(t.Text).MaxLines(1)
				})
			}
			daemonDot := t.Success
			if !daemonOK {
				daemonDot = t.Warning
			}
			ui.Column(c).FillWidth().Gap(6).Children(func() {
				ui.Row(c).FillWidth().Gap(6).Children(func() {
					telemetryCell(i18n.Tf("live.compute.daemon", map[string]any{"status": i18n.StatusLabel(cs.DaemonConnection)}), daemonDot)
					telemetryCell(i18n.Tf("live.compute.server", map[string]any{"status": i18n.StatusLabel(cs.LocalServerPhase)}), ex.Info)
				})
				ui.Row(c).FillWidth().Gap(6).Children(func() {
					telemetryCell(i18n.Tf("live.compute.active_ops", map[string]any{"count": cs.ActiveOperations}), ex.Brand)
					telemetryCell(i18n.Tf("live.compute.url", map[string]any{"url": i18n.ServerURLModeLabel(cs.ServerURLMode)}), ex.TextSubtle)
				})
			})
			if cs.PreventSleep || cs.LocalModelsDegraded {
				ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
					if cs.PreventSleep {
						components.StatusDotPill(c, i18n.T("live.compute.awake_guard"), components.ToneSuccess)
					}
					if cs.LocalModelsDegraded {
						components.StatusDotPill(c, i18n.T("live.compute.models_degraded"), components.ToneWarning)
					}
				})
			}
			if cs.ComputerID != "" {
				ui.Text(c, i18n.Tf("live.compute.computer_devices", map[string]any{
					"id":    cs.ComputerID,
					"count": cs.PairedDevicesCount,
				})).FontSize(11.5).TextColor(ex.TextSubtle)
			}
		})
	}

	activeCompID := ctl.activeComputerID(snap)
	renderComputersCard := func() {
		components.SectionCard(c, i18n.Tf("live.compute.computers_title", map[string]any{"count": len(snap.Computers)}), i18n.T("live.compute.computers_subtitle"), nil, func() {
			if len(snap.Computers) == 0 {
				ui.Text(c, i18n.T("live.compute.computers_empty")).FontSize(13).TextColor(t.TextMuted)
				return
			}
			for _, comp := range snap.Computers {
				comp := comp
				tone := components.ToneSuccess
				if strings.ToLower(comp.Status) != "online" {
					tone = components.ToneWarning
				}
				ui.Column(c.Key(comp.ComputerID)).FillWidth().Padding(12, 12).Radius(12).Background(ex.MutedBg).
					Border(0.75, ex.SubtleBorder).Gap(10).Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(10).Children(func() {
						ui.Row(c).Size(36, 36).Radius(10).Background(t.Surface).Border(0.75, ex.SubtleBorder).
							AlignItems(ui.Center).Justify(ui.Center).Shrink(0).Children(func() {
							theme.IconBox(c, 18, t.Text, theme.IconHost)
						})
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, comp.DisplayName).FontSize(14.5).FontWeight(600).TextColor(t.Text).MaxLines(1)
							ui.Text(c, i18n.Tf("live.compute.computer_ops_runtimes", map[string]any{
								"ops":      comp.ActiveOperations,
								"runtimes": len(comp.Runtimes),
							})).FontSize(12).TextColor(t.TextMuted).MaxLines(1)
						})
						components.StatusDotPill(c, i18n.StatusLabel(comp.Status), tone)
					})
					ui.Row(c).FillWidth().Gap(6).Children(func() {
						permBtn := components.CompactSecondaryButton(c, i18n.T("live.compute.permissions_btn"), nil, false)
						permBtn.Grow(1).Basis(0).MinHeight(34).Padding(6, 6)
						if permBtn.Clicked() {
							ctl.openPermissionsSheet(comp.ComputerID)
						}
						brBtn := components.CompactSecondaryButton(c, i18n.T("live.compute.chrome_link_btn"), nil, false)
						brBtn.Grow(1).Basis(0).MinHeight(34).Padding(6, 6)
						if brBtn.Clicked() {
							ctl.openBrowserSheet(comp.ComputerID)
						}
						scanBtn := components.CompactSecondaryButton(c, i18n.T("live.compute.scan_skills_btn"), nil, false)
						scanBtn.Grow(1).Basis(0).MinHeight(34).Padding(6, 6)
						if scanBtn.Clicked() {
							ctl.scanSkillsAsync(snap.TenantID, comp.ComputerID)
						}
					})
				})
			}
			ctl.mu.Lock()
			scanRes := ctl.scanResult
			ctl.mu.Unlock()
			if scanRes != "" {
				ui.Text(c, scanRes).FontSize(12).TextColor(t.Success)
			}
		})
	}

	// 1 & 2. Desktop Companion Host + Enrolled Local Computers (side-by-side on unfolded screens).
	layout.TwoPaneRow(c, m.GridColumns >= 2 && snap.CompanionStatus != nil, 12, renderDesktopHostCard, renderComputersCard)

	// 3. Model Source & BYOK Switcher (GET/POST .../model-source)
	msMode := "local"
	msModel := i18n.T("live.compute.not_configured")
	if snap.ModelSource != nil && snap.ModelSource.Status != nil {
		msMode = snap.ModelSource.Status.Mode
		msModel = nonEmptyOr(snap.ModelSource.Status.RuntimeModel, msModel)
	}
	components.SectionCard(c, i18n.T("live.compute.source_title"), i18n.Tf("live.compute.source_active", map[string]any{
		"source":  i18n.ModelSourceLabel(msMode),
		"runtime": msModel,
	}), func() {
		components.StatusDotPill(c, strings.ToUpper(i18n.ModelSourceLabel(msMode)), components.ToneBrand)
	}, func() {
		// Full-width 3-column tactile switcher tray (no ragged wrapping).
		ui.Row(c).FillWidth().Background(ex.MutedBg).Radius(12).Padding(3, 3).Gap(3).Children(func() {
			for _, m := range []string{"local", "subscription", "byok"} {
				m := m
				isCurrent := strings.EqualFold(msMode, m)
				label := strings.ToUpper(i18n.ModelSourceLabel(m))
				disabled := activeCompID == ""
				bg := ui.Transparent
				fg := t.TextMuted
				if isCurrent {
					bg = t.Accent
					fg = t.AccentText
				}
				segLabel := label
				if isCurrent {
					segLabel = label + " \u2713"
				}
				btn := ui.Row(c.Key("ms_" + m)).Grow(1).Basis(0).MinHeight(38).PaddingX(6).Radius(9).
					Background(bg).AlignItems(ui.Center).Justify(ui.Center).
					Role(ui.RoleButton).Label(segLabel).Disabled(disabled)
				if !disabled && !isCurrent && btn.Pressed() {
					btn.Background(t.SurfacePressed)
				}
				btn.Children(func() {
					txt := ui.Text(c, segLabel).FontSize(11.5).TextColor(fg).NoWrap().MaxLines(1)
					if isCurrent {
						txt.FontWeight(700)
					} else {
						txt.FontWeight(600)
					}
				})
				if btn.Clicked() && !isCurrent && !disabled {
					switch m {
					case "byok":
						ctl.openBYOKSheet(snap)
					case "subscription":
						mygo.Haptics.Light()
						rt := ctl.effectiveSubscriptionRuntime(snap, activeCompID)
						ctl.mu.Lock()
						ctl.subRuntime = rt
						ctl.mu.Unlock()
						go func() {
							_, _ = ctl.store.SwitchModelSource(context.Background(), activeCompID, api.ModelSourceSwitchRequest{
								Mode:    "subscription",
								Runtime: &rt,
							})
						}()
					default:
						mygo.Haptics.Light()
						go func() {
							rt := "pi"
							_, _ = ctl.store.SwitchModelSource(context.Background(), activeCompID, api.ModelSourceSwitchRequest{
								Mode:    "local",
								Runtime: &rt,
							})
						}()
					}
				}
			}
		})
		cfgBtn := components.SecondaryTouchButton(c, i18n.T("live.compute.configure_byok"), activeCompID == "")
		cfgBtn.FillWidth().MinHeight(40)
		if cfgBtn.Clicked() {
			ctl.openBYOKSheet(snap)
		}
		if strings.EqualFold(msMode, "subscription") {
			curSub := ctl.effectiveSubscriptionRuntime(snap, activeCompID)
			subIdx := 0
			if curSub == "codex" {
				subIdx = 1
			}
			if components.SegmentedControl(c, &subIdx, i18n.HarnessLabel("claude"), i18n.HarnessLabel("codex")) {
				nextRt := "claude"
				if subIdx == 1 {
					nextRt = "codex"
				}
				ctl.mu.Lock()
				ctl.subRuntime = nextRt
				ctl.mu.Unlock()
				mygo.Haptics.Light()
				go func() {
					_, _ = ctl.store.SwitchModelSource(context.Background(), activeCompID, api.ModelSourceSwitchRequest{
						Mode:    "subscription",
						Runtime: &nextRt,
					})
				}()
			}
		}
	})

	// 4. Local Models Manager (Memory Pools + Pull/Load/Make Room & Load/Unload/Remove + Recheck Hardware)
	if snap.LocalModels != nil {
		lm := snap.LocalModels
		ctl.mu.Lock()
		rechecking := ctl.recheckBusy
		ctl.mu.Unlock()

		components.SectionCard(c, i18n.T("live.compute.local_models_title"), i18n.Tf("live.compute.models_subtitle", map[string]any{
			"pool":  lm.Computer.DisplayName,
			"count": len(lm.Models),
		}), func() {
			recheckLbl := i18n.T("live.compute.recheck")
			if rechecking {
				recheckLbl = i18n.T("live.compute.checking")
			}
			btn := components.CompactSecondaryButton(c, recheckLbl, theme.IconRefresh, rechecking)
			if btn.Clicked() {
				ctl.recheckHardwareAsync(lm.Computer.ComputerID)
			}
		}, func() {
			// GPU / Unified / System RAM memory pool utilization bars
			for _, pool := range lm.Pools {
				frac := 0.0
				if pool.TotalBytes > 0 {
					frac = float64(pool.UsedBytes) / float64(pool.TotalBytes)
				}
				ui.Column(c.Key(pool.ID)).FillWidth().Gap(5).Children(func() {
					ui.Row(c).FillWidth().Justify(ui.SpaceBetween).Children(func() {
						ui.Text(c, nonEmptyOr(pool.Label, pool.ID)).FontSize(12.5).FontWeight(600).TextColor(t.Text)
						ui.Text(c, i18n.Tf("live.compute.mem_used", map[string]any{
							"used":  i18n.FormatMemorySize(pool.UsedBytes),
							"total": i18n.FormatMemorySize(pool.TotalBytes),
						})).FontSize(11.5).TextColor(t.TextMuted)
					})
					ui.Progress(c, frac).FillWidth().Height(7)
				})
			}

			// Collect currently loaded model IDs for "Make Room & Load".
			var loadedIDs []string
			for _, mv := range lm.Models {
				if mv.Model.State == "loaded" {
					loadedIDs = append(loadedIDs, mv.Model.ID)
				}
			}

			// Individual model cards (2-column grid on unfolded foldables)
			layout.TwoColumnCards(c, m.GridColumns, 8, len(lm.Models), func(i int) {
				mv := lm.Models[i]
				mod := mv.Model
				ctl.mu.Lock()
				inFlight := ctl.modelBusy[mod.ID]
				ctl.mu.Unlock()
				busy := inFlight != ""

				stateTone := components.ToneNeutral
				switch mod.State {
				case "loaded":
					stateTone = components.ToneSuccess
				case "downloading", "loading":
					stateTone = components.ToneBrand
				case "idle":
					stateTone = components.ToneWarning
				}

				ui.Column(c.Key("lm_"+mod.ID)).FillWidth().Padding(12, 12).Radius(12).Background(ex.MutedBg).Border(0.75, ex.SubtleBorder).Gap(8).Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, mod.Name).FontSize(14.5).FontWeight(600).TextColor(t.Text).MaxLines(1)
							ui.Text(c, i18n.Tf("live.compute.model_specs", map[string]any{
								"quant": mod.Quant,
								"disk":  i18n.FormatMemorySize(mod.DownloadBytes),
								"vram":  i18n.FormatMemorySize(mod.MemoryBytes),
							})).FontSize(11.5).TextColor(t.TextMuted)
						})
						components.StatusDotPill(c, i18n.StatusLabel(mod.State), stateTone)
					})

					if mod.Download != nil && mod.Download.TotalBytes > 0 {
						pct := float64(mod.Download.DoneBytes) / float64(mod.Download.TotalBytes)
						ui.Progress(c, pct).FillWidth().Height(6)
						ui.Text(c, i18n.Tf("live.compute.downloading_pct", map[string]any{
							"pct":   strconv.Itoa(int(pct*100 + 0.5)),
							"done":  i18n.FormatMemorySize(mod.Download.DoneBytes),
							"total": i18n.FormatMemorySize(mod.Download.TotalBytes),
						})).FontSize(11.5).FontWeight(600).TextColor(ex.BrandText)
					}

					if mod.Error != nil && (mod.Error.Detail != nil && *mod.Error.Detail != "" || mod.Error.Code != "") {
						errMsg := mod.Error.Code
						if mod.Error.Detail != nil && *mod.Error.Detail != "" {
							errMsg = *mod.Error.Detail
						}
						components.ErrorInline(c, errMsg, nil)
					}

					// Action buttons tailored to state, with explicit busy labels disabling duplicate taps!
					ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
						switch mod.State {
						case "absent":
							lbl := i18n.T("live.compute.download")
							if inFlight == "pull" {
								lbl = i18n.T("live.compute.downloading")
							}
							b := components.CompactPrimaryButton(c, lbl, nil, busy)
							if b.Clicked() {
								ctl.actOnLocalModelAsync(lm.Computer.ComputerID, mod.ID, "pull", nil)
							}
						case "downloading":
							lbl := i18n.T("live.compute.cancel_download")
							if inFlight == "cancel_pull" {
								lbl = i18n.T("live.compute.canceling")
							}
							b := components.DangerTouchButton(c, lbl, busy)
							b.MinHeight(36)
							if b.Clicked() {
								ctl.actOnLocalModelAsync(lm.Computer.ComputerID, mod.ID, "cancel_pull", nil)
							}
						case "idle":
							loadLbl := i18n.T("live.compute.load")
							if inFlight == "load" {
								loadLbl = i18n.T("live.compute.loading")
							}
							b := components.CompactPrimaryButton(c, loadLbl, nil, busy)
							if b.Clicked() {
								ctl.actOnLocalModelAsync(lm.Computer.ComputerID, mod.ID, "load", nil)
							}
							if len(loadedIDs) > 0 {
								mrLbl := i18n.T("live.compute.make_room_load")
								if inFlight == "make_room_load" {
									mrLbl = i18n.T("live.compute.loading")
								}
								mr := components.CompactSecondaryButton(c, mrLbl, nil, busy)
								if mr.Clicked() {
									ctl.actOnLocalModelAsync(lm.Computer.ComputerID, mod.ID, "load", loadedIDs)
								}
							}
							rm := components.DangerTouchButton(c, i18n.T("common.remove"), busy)
							rm.MinHeight(36)
							if rm.Clicked() {
								ctl.mu.Lock()
								ctl.removeModelID = mod.ID
								ctl.removeModelName = mod.Name
								ctl.removeModelOpen = true
								ctl.mu.Unlock()
							}
						case "loaded":
							unLbl := i18n.T("live.compute.unload")
							if inFlight == "unload" {
								unLbl = i18n.T("live.compute.unloading")
							}
							b := components.CompactSecondaryButton(c, unLbl, nil, busy)
							if b.Clicked() {
								ctl.actOnLocalModelAsync(lm.Computer.ComputerID, mod.ID, "unload", nil)
							}
							rm := components.DangerTouchButton(c, i18n.T("common.remove"), busy)
							rm.MinHeight(36)
							if rm.Clicked() {
								ctl.mu.Lock()
								ctl.removeModelID = mod.ID
								ctl.removeModelName = mod.Name
								ctl.removeModelOpen = true
								ctl.mu.Unlock()
							}
						}
					})
				})
			})
		})
	}
}

func (ctl *Controller) actOnLocalModelAsync(computerID, modelID, action string, unloadFirst []string) {
	key := action
	if action == "load" && len(unloadFirst) > 0 {
		key = "make_room_load"
	}
	ctl.mu.Lock()
	if ctl.modelBusy[modelID] != "" {
		ctl.mu.Unlock()
		return
	}
	ctl.modelBusy[modelID] = key
	ctl.mu.Unlock()

	if action == "remove" || action == "cancel_pull" {
		mygo.Haptics.Warning()
	} else {
		mygo.Haptics.Light()
	}

	go func() {
		err := ctl.store.ActOnLocalModel(context.Background(), computerID, modelID, action, unloadFirst)
		ctl.mu.Lock()
		delete(ctl.modelBusy, modelID)
		ctl.mu.Unlock()
		if err == nil {
			mygo.Haptics.Success()
			ctl.setNotice(i18n.Tf("live.compute.toast.model_accepted", map[string]any{
				"id":     modelID,
				"action": i18n.LocalModelActionLabel(key),
			}))
		}
		ctl.store.Notify()
	}()
}

func (ctl *Controller) recheckHardwareAsync(computerID string) {
	ctl.mu.Lock()
	ctl.recheckBusy = true
	ctl.mu.Unlock()
	go func() {
		_ = ctl.store.RecheckLocalModels(context.Background(), computerID)
		ctl.mu.Lock()
		ctl.recheckBusy = false
		ctl.mu.Unlock()
		ctl.store.Notify()
	}()
}

func (ctl *Controller) viewRemoveModelConfirm(c *ui.Context, snap state.Snapshot) {
	ctl.mu.Lock()
	mID := ctl.removeModelID
	mName := ctl.removeModelName
	ctl.mu.Unlock()
	mobile.ActionSheet(c, &ctl.removeModelOpen, mobile.ActionSheetOptions{
		Title:   i18n.Tf("live.compute.remove_title", map[string]any{"name": mName}),
		Message: i18n.T("live.compute.remove_body"),
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("live.compute.delete_weights"),
		Destructive: true,
		OnTap: func() {
			if snap.LocalModels != nil {
				ctl.actOnLocalModelAsync(snap.LocalModels.Computer.ComputerID, mID, "remove", nil)
			}
		},
	})
}

func (ctl *Controller) openPermissionsSheet(computerID string) {
	ctl.mu.Lock()
	if computerID != "" {
		ctl.selectedComputerID = computerID
	}
	ctl.permSheetOpen = true
	ctl.mu.Unlock()
	go func() {
		cl := ctl.store.Client()
		tid := ctl.store.Snapshot().TenantID
		cid := ctl.activeComputerID(ctl.store.Snapshot())
		if cl == nil || tid == "" || cid == "" {
			return
		}
		if st, err := cl.GetLocalComputerPermissionsTyped(context.Background(), tid, cid); err == nil {
			ctl.mu.Lock()
			ctl.permStatus = &st
			ctl.mu.Unlock()
			ctl.store.Notify()
		}
	}()
}

func (ctl *Controller) viewPermissionsSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.permSheetOpen, mobile.SheetOptions{Detents: []float32{0.65, 0.90}, Label: i18n.T("live.compute.perms_a11y")}, func() {
		ctl.mu.Lock()
		st := ctl.permStatus
		ctl.mu.Unlock()
		cid := ctl.activeComputerID(snap)
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, i18n.T("live.compute.host_perms_title")).FontSize(18).Bold().TextColor(t.Text)
				if st == nil {
					components.LoadingSkeleton(c, 2)
					return
				}
				for _, subj := range st.Subjects {
					subj := subj
					components.SectionCard(c.Key(subj.Subject), i18n.Tf("live.compute.app_line", map[string]any{"name": subj.Subject}), st.Platform, nil, func() {
						for _, p := range subj.Permissions {
							p := p
							tone := components.ToneWarning
							if p.State == "granted" {
								tone = components.ToneSuccess
							}
							ui.Row(c.Key(p.ID)).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
								ui.Text(c, p.ID).FontSize(13).TextColor(t.Text).Grow(1).Basis(0)
								components.StatusPill(c, i18n.StatusLabel(p.State), tone)
								if p.State != "granted" {
									action := "open_settings"
									lbl := i18n.T("live.compute.settings_btn")
									if p.Prompt == "available" {
										action = "prompt"
										lbl = i18n.T("live.compute.prompt_btn")
									}
									btn := components.SecondaryTouchButton(c, lbl, false)
									if btn.Clicked() {
										go func() {
											if cl := ctl.store.Client(); cl != nil {
												if updated, err := cl.ActOnLocalComputerPermissionTyped(context.Background(), snap.TenantID, cid, subj.Subject, p.ID, action); err == nil {
													ctl.mu.Lock()
													ctl.permStatus = &updated
													ctl.mu.Unlock()
													ctl.store.Notify()
												}
											}
										}()
									}
								}
							})
						}
					})
				}
			})
		})
	})
}

func (ctl *Controller) openBrowserSheet(computerID string) {
	ctl.mu.Lock()
	if computerID != "" {
		ctl.selectedComputerID = computerID
	}
	ctl.browserSheetOpen = true
	ctl.mu.Unlock()
	ctl.refreshBrowserStatus(computerID)
}

func (ctl *Controller) refreshBrowserStatus(computerID string) {
	go func() {
		cl := ctl.store.Client()
		tid := ctl.store.Snapshot().TenantID
		cid := computerID
		if cid == "" {
			cid = ctl.activeComputerID(ctl.store.Snapshot())
		}
		if cl == nil || tid == "" || cid == "" {
			return
		}
		if st, err := cl.GetLocalComputerBrowserConnectionTyped(context.Background(), tid, cid); err == nil {
			cp := st
			ctl.store.EnqueueUI(func() {
				ctl.mu.Lock()
				ctl.browserStatus = &cp
				if cp.Profile != nil {
					ctl.browserProfile = *cp.Profile
				}
				ctl.mu.Unlock()
			})
		}
	}()
}

func (ctl *Controller) viewBrowserSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.browserSheetOpen, mobile.SheetOptions{Detents: []float32{0.58}, Label: i18n.T("live.compute.browser_a11y")}, func() {
		ctl.mu.Lock()
		st := ctl.browserStatus
		ctl.mu.Unlock()
		cid := ctl.activeComputerID(snap)
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, i18n.T("live.compute.browser_title")).FontSize(18).Bold().TextColor(t.Text)
				if st != nil {
					components.StatusPill(c, i18n.StatusLabel(st.State)+" ("+i18n.BrowserModeLabel(st.Mode)+")", components.ToneInfo)
				}
				components.FormField(c, i18n.T("live.compute.chrome_profile"), i18n.T("common.default"), &ctl.browserProfile, false)
				ui.Row(c).FillWidth().Gap(8).Children(func() {
					connBtn := components.PrimaryTouchButton(c, i18n.T("live.compute.connect_chrome"), false)
					connBtn.Grow(1).Basis(0)
					if connBtn.Clicked() {
						prof := strings.TrimSpace(ctl.browserProfile)
						go func() {
							if cl := ctl.store.Client(); cl != nil {
								if updated, err := cl.PutLocalComputerBrowserConnectionTyped(context.Background(), snap.TenantID, cid, prof); err == nil {
									ctl.mu.Lock()
									ctl.browserStatus = &updated
									ctl.mu.Unlock()
									ctl.store.Notify()
								}
							}
						}()
					}
					discBtn := components.DangerTouchButton(c, i18n.T("live.compute.disconnect"), false)
					if discBtn.Clicked() {
						go func() {
							if cl := ctl.store.Client(); cl != nil {
								_ = cl.DeleteLocalComputerBrowserConnection(context.Background(), snap.TenantID, cid)
								ctl.refreshBrowserStatus(cid)
							}
						}()
					}
				})
			})
		})
	})
}

func validModelSourceRuntime(rt string) bool {
	return rt == "pi" || rt == "claude" || rt == "codex"
}

func validByokProtocol(protocol string) bool {
	return protocol == "openai-chat" || protocol == "openai-responses" || protocol == "anthropic"
}

func (ctl *Controller) effectiveSubscriptionRuntime(snap state.Snapshot, compID string) string {
	ctl.mu.Lock()
	saved := ctl.subRuntime
	ctl.mu.Unlock()
	if saved == "claude" || saved == "codex" {
		return saved
	}
	if snap.ModelSource != nil && snap.ModelSource.Status != nil {
		rt := snap.ModelSource.Status.Runtime
		if rt == "claude" || rt == "codex" {
			return rt
		}
	}
	for _, comp := range snap.Computers {
		if compID != "" && comp.ComputerID != compID {
			continue
		}
		for _, rt := range comp.Runtimes {
			if rt.Type == "claude" || rt.Type == "codex" {
				return rt.Type
			}
		}
	}
	return "claude"
}

func (ctl *Controller) openBYOKSheet(snap state.Snapshot) {
	ctl.mu.Lock()
	if snap.ModelSource != nil && snap.ModelSource.Status != nil {
		st := snap.ModelSource.Status
		ctl.byokMode = st.Mode
		if validModelSourceRuntime(st.Runtime) {
			ctl.byokRuntime = st.Runtime
		}
		if st.Byok.BaseURL != nil {
			ctl.byokBaseURL = *st.Byok.BaseURL
		}
		if st.Byok.Path != nil {
			ctl.byokPath = *st.Byok.Path
		} else if st.Byok.Configured {
			ctl.byokPath = ""
		}
		if st.Byok.Endpoint != nil {
			ctl.byokEndpoint = *st.Byok.Endpoint
		} else if st.Byok.Configured {
			ctl.byokEndpoint = ""
		}
		if st.Byok.Protocol != nil && validByokProtocol(*st.Byok.Protocol) {
			ctl.byokProtocol = *st.Byok.Protocol
		}
		if st.Byok.ModelID != nil {
			ctl.byokModelID = *st.Byok.ModelID
		}
	}
	if !validModelSourceRuntime(ctl.byokRuntime) {
		ctl.byokRuntime = "pi"
	}
	if !validByokProtocol(ctl.byokProtocol) {
		ctl.byokProtocol = "openai-chat"
	}
	ctl.byokAPIKey = ""
	ctl.byokTestMsg = ""
	ctl.byokSheetOpen = true
	ctl.mu.Unlock()
}

func (ctl *Controller) viewBYOKSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	wasOpen := ctl.byokSheetOpen
	mobile.Sheet(c, &ctl.byokSheetOpen, mobile.SheetOptions{Detents: []float32{0.80, 0.94}, Label: i18n.T("live.compute.byok_a11y")}, func() {
		ctl.mu.Lock()
		busy := ctl.byokBusy
		testMsg := ctl.byokTestMsg
		curRuntime := ctl.byokRuntime
		curProtocol := ctl.byokProtocol
		models := append([]api.ByokModel(nil), ctl.byokModels...)
		ctl.mu.Unlock()
		cid := ctl.activeComputerID(snap)

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, i18n.T("live.compute.byok_title")).FontSize(18).Bold().TextColor(t.Text)
				if testMsg != "" {
					components.StatusBanner(c, components.ToneInfo, testMsg, "", nil)
				}

				runtimes := []string{"pi", "claude", "codex"}
				rtIdx := 0
				for i, r := range runtimes {
					if curRuntime == r {
						rtIdx = i
						break
					}
				}
				ui.Text(c, i18n.T("live.compute.harness_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				if components.SegmentedControl(c, &rtIdx, i18n.T("live.compute.harness_pi"), i18n.T("live.compute.harness_claude"), i18n.T("live.compute.harness_codex")) {
					ctl.mu.Lock()
					ctl.byokRuntime = runtimes[rtIdx]
					ctl.mu.Unlock()
				}

				protocols := []string{"openai-chat", "openai-responses", "anthropic"}
				protoIdx := 0
				for i, p := range protocols {
					if curProtocol == p {
						protoIdx = i
						break
					}
				}
				ui.Text(c, i18n.T("live.compute.protocol_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				if components.SegmentedControl(c, &protoIdx, i18n.T("live.compute.protocol.openai_chat"), i18n.T("live.compute.protocol.responses"), i18n.T("live.compute.protocol.anthropic")) {
					ctl.mu.Lock()
					ctl.byokProtocol = protocols[protoIdx]
					ctl.mu.Unlock()
				}

				components.FormField(c, i18n.T("live.compute.base_url"), "https://api.openai.com", &ctl.byokBaseURL, false)
				components.FormField(c, i18n.T("live.compute.path_label"), "/v1", &ctl.byokPath, false)
				components.FormField(c, i18n.T("live.compute.endpoint_label"), "/chat/completions", &ctl.byokEndpoint, false)
				components.FormField(c, i18n.T("live.compute.model_id_label"), "gpt-4o-mini", &ctl.byokModelID, false)
				components.FormField(c, i18n.T("live.compute.api_key_desktop"), "sk-...", &ctl.byokAPIKey, true)

				ui.Row(c).FillWidth().Gap(8).Children(func() {
					testBtn := components.SecondaryTouchButton(c, i18n.T("live.compute.test_conn"), busy)
					testBtn.Grow(1).Basis(0)
					if testBtn.Clicked() {
						ctl.testBYOKAsync(snap.TenantID, cid)
					}
					listBtn := components.SecondaryTouchButton(c, i18n.T("live.compute.list_models"), busy)
					listBtn.Grow(1).Basis(0)
					if listBtn.Clicked() {
						ctl.listBYOKModelsAsync(snap.TenantID, cid)
					}
				})

				if len(models) > 0 {
					components.SectionCard(c, i18n.Tf("live.compute.provider_models", map[string]any{"count": len(models)}), i18n.T("live.compute.provider_models_sub"), nil, func() {
						for _, m := range models {
							m := m
							lbl := m.ID
							if m.Name != nil && *m.Name != "" {
								lbl = *m.Name + " (" + m.ID + ")"
							}
							row := ui.Row(c.Key("bm_"+m.ID)).FillWidth().MinHeight(40).Padding(6, 8).Radius(8).
								AlignItems(ui.Center).Role(ui.RoleButton).Label(i18n.Tf("live.compute.select_model_a11y", map[string]any{"id": m.ID}))
							row.Children(func() { ui.Text(c, lbl).FontSize(13).TextColor(t.Accent) })
							if row.Clicked() {
								ctl.mu.Lock()
								ctl.byokModelID = m.ID
								ctl.mu.Unlock()
							}
						}
					})
				}

				applyBtn := components.PrimaryTouchButton(c, i18n.T("live.compute.switch_byok"), busy || strings.TrimSpace(ctl.byokModelID) == "")
				applyBtn.FillWidth()
				if applyBtn.Clicked() {
					in := ctl.currentBYOKInput()
					ctl.mu.Lock()
					rt := ctl.byokRuntime
					if !validModelSourceRuntime(rt) {
						rt = "pi"
					}
					ctl.byokBusy = true
					ctl.mu.Unlock()
					go func() {
						_, err := ctl.store.SwitchModelSource(context.Background(), cid, api.ModelSourceSwitchRequest{
							Mode:    "byok",
							Runtime: &rt,
							Byok:    &in,
						})
						ctl.store.EnqueueUI(func() {
							ctl.mu.Lock()
							ctl.byokBusy = false
							if err == nil {
								ctl.byokAPIKey = ""
								ctl.byokSheetOpen = false
							} else {
								ctl.byokTestMsg = i18n.Tf("live.compute.toast.switch_failed", map[string]any{"err": err.Error()})
							}
							ctl.mu.Unlock()
						})
					}()
				}
			})
		})
	})
	if wasOpen && !ctl.byokSheetOpen {
		// Wipe sensitive API key from memory immediately when the BYOK sheet closes.
		ctl.mu.Lock()
		ctl.byokAPIKey = ""
		ctl.mu.Unlock()
	}
}

func (ctl *Controller) currentBYOKInput() api.ByokInput {
	ctl.mu.Lock()
	defer ctl.mu.Unlock()
	var keyPtr *string
	if ctl.byokAPIKey != "" {
		k := ctl.byokAPIKey
		keyPtr = &k
	}
	proto := ctl.byokProtocol
	if !validByokProtocol(proto) {
		proto = "openai-chat"
	}
	return api.ByokInput{
		BaseURL:  strings.TrimSpace(ctl.byokBaseURL),
		Path:     strings.TrimSpace(ctl.byokPath),
		Endpoint: strings.TrimSpace(ctl.byokEndpoint),
		Protocol: proto,
		ModelID:  strings.TrimSpace(ctl.byokModelID),
		APIKey:   keyPtr,
	}
}

func (ctl *Controller) testBYOKAsync(tenantID, compID string) {
	in := ctl.currentBYOKInput()
	ctl.mu.Lock()
	ctl.byokBusy = true
	ctl.mu.Unlock()
	go func() {
		cl := ctl.store.Client()
		var msg string
		if cl != nil {
			res, err := cl.TestLocalComputerModelSourceTyped(context.Background(), tenantID, compID, in)
			if err != nil {
				msg = i18n.Tf("live.compute.toast.test_failed", map[string]any{"err": err.Error()})
			} else if res.Ok {
				msg = i18n.Tf("live.compute.toast.connected_ok", map[string]any{
					"model": res.ModelID,
					"ctx":   res.ContextWindow,
				})
			} else {
				msg = i18n.T("live.compute.toast.endpoint_not_ok")
			}
		}
		ctl.mu.Lock()
		ctl.byokBusy = false
		ctl.byokTestMsg = msg
		ctl.mu.Unlock()
		ctl.store.Notify()
	}()
}

func (ctl *Controller) listBYOKModelsAsync(tenantID, compID string) {
	in := ctl.currentBYOKInput()
	ctl.mu.Lock()
	ctl.byokBusy = true
	ctl.mu.Unlock()
	go func() {
		cl := ctl.store.Client()
		var list []api.ByokModel
		var msg string
		if cl != nil {
			res, err := cl.ListLocalComputerByokModelsTyped(context.Background(), tenantID, compID, in)
			if err != nil {
				msg = i18n.Tf("live.compute.toast.list_failed", map[string]any{"err": err.Error()})
			} else {
				list = res.Models
				msg = i18n.Tf("live.compute.toast.loaded_models", map[string]any{"count": len(res.Models)})
			}
		}
		ctl.mu.Lock()
		ctl.byokBusy = false
		ctl.byokModels = list
		ctl.byokTestMsg = msg
		ctl.mu.Unlock()
		ctl.store.Notify()
	}()
}

func (ctl *Controller) scanSkillsAsync(tenantID, compID string) {
	go func() {
		if cl := ctl.store.Client(); cl != nil {
			_, err := cl.ScanLocalComputerSkills(context.Background(), tenantID, compID)
			ctl.mu.Lock()
			if err != nil {
				ctl.scanResult = i18n.Tf("live.compute.toast.skill_scan_failed", map[string]any{"err": err.Error()})
			} else {
				ctl.scanResult = i18n.T("live.compute.toast.skill_scan_ok")
			}
			ctl.mu.Unlock()
			ctl.store.Notify()
			_ = ctl.store.RefreshActiveHost(context.Background())
		}
	}()
}

func (ctl *Controller) activeComputerID(snap state.Snapshot) string {
	ctl.mu.Lock()
	cid := ctl.selectedComputerID
	ctl.mu.Unlock()
	if cid != "" {
		return cid
	}
	if len(snap.Computers) > 0 {
		return snap.Computers[0].ComputerID
	}
	if snap.LocalModels != nil {
		return snap.LocalModels.Computer.ComputerID
	}
	return ""
}
