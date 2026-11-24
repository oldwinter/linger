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

func (ctl *Controller) viewCompute(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	ex := theme.Extra(t)

	// 1. Desktop Companion Host Health Card (GET /companion/v1/status)
	if snap.CompanionStatus != nil {
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
			sub += fmt.Sprintf(" · %dms RTT", snap.RTTMs)
		}
		components.SectionCard(c, "Desktop Companion Host", sub, func() {
			tone := components.ToneSuccess
			daemonOK := cs.DaemonConnection == "connected" || cs.DaemonConnection == "online"
			if cs.LocalModelsDegraded || !daemonOK {
				tone = components.ToneWarning
			}
			components.StatusPill(c, cs.RuntimeState, tone)
		}, func() {
			ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
				components.StatusPill(c, "Daemon: "+cs.DaemonConnection, components.ToneInfo)
				components.StatusPill(c, components.PluralInt(cs.ActiveOperations, "active op", "active ops"), components.ToneNeutral)
				components.StatusPill(c, "Server: "+cs.LocalServerPhase, components.ToneNeutral)
				components.StatusPill(c, "URL: "+cs.ServerURLMode, components.ToneNeutral)
				if cs.PreventSleep {
					components.StatusPill(c, "Awake Guard On", components.ToneSuccess)
				}
				if cs.LocalModelsDegraded {
					components.StatusPill(c, "Local Models Degraded", components.ToneWarning)
				}
			})
			if cs.ComputerID != "" {
				ui.Text(c, fmt.Sprintf("Computer ID: %s · %s", cs.ComputerID, components.PluralInt(cs.PairedDevicesCount, "paired device", "paired devices"))).
					FontSize(12).TextColor(t.TextMuted)
			}
		})
	}

	// 2. Enrolled Local Computers
	activeCompID := ctl.activeComputerID(snap)
	components.SectionCard(c, fmt.Sprintf("Local Computers (%d)", len(snap.Computers)), "Reuse Desktop's daemon, permissions, Chrome link & skills", nil, func() {
		if len(snap.Computers) == 0 {
			ui.Text(c, "No Local Computers enrolled in this workspace.").FontSize(13).TextColor(t.TextMuted)
			return
		}
		for _, comp := range snap.Computers {
			comp := comp
			tone := components.ToneSuccess
			if strings.ToLower(comp.Status) != "online" {
				tone = components.ToneWarning
			}
			ui.Column(c.Key(comp.ComputerID)).FillWidth().Padding(10, 10).Radius(10).Background(ex.MutedBg).Gap(8).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, comp.DisplayName).FontSize(14).FontWeight(600).TextColor(t.Text)
						ui.Text(c, fmt.Sprintf("%s · %s",
							components.PluralInt(comp.ActiveOperations, "active op", "active ops"),
							components.PluralInt(len(comp.Runtimes), "runtime", "runtimes"))).FontSize(12).TextColor(t.TextMuted)
					})
					components.StatusPill(c, comp.Status, tone)
				})
				ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
					permBtn := components.SecondaryTouchButton(c, "Permissions", false)
					if permBtn.Clicked() {
						ctl.openPermissionsSheet(comp.ComputerID)
					}
					brBtn := components.SecondaryTouchButton(c, "Chrome Link", false)
					if brBtn.Clicked() {
						ctl.openBrowserSheet(comp.ComputerID)
					}
					scanBtn := components.SecondaryTouchButton(c, "Scan Skills", false)
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

	// 3. Model Source & BYOK Switcher (GET/POST .../model-source)
	msMode := "local"
	msModel := "Not configured"
	if snap.ModelSource != nil && snap.ModelSource.Status != nil {
		msMode = snap.ModelSource.Status.Mode
		msModel = nonEmptyOr(snap.ModelSource.Status.RuntimeModel, msModel)
	}
	components.SectionCard(c, "Model Source & BYOK", fmt.Sprintf("Active: %s · %s", msMode, msModel), func() {
		components.StatusPill(c, strings.ToUpper(msMode), components.ToneInfo)
	}, func() {
		ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
			for _, m := range []string{"local", "managed", "byok"} {
				m := m
				isCurrent := strings.EqualFold(msMode, m)
				var btn ui.Element
				if isCurrent {
					btn = components.PrimaryTouchButton(c, strings.ToUpper(m)+" ✓", true)
				} else {
					btn = components.SecondaryTouchButton(c, strings.ToUpper(m), activeCompID == "")
				}
				if btn.Clicked() {
					if m == "byok" {
						ctl.openBYOKSheet(snap)
					} else {
						mygo.Haptics.Light()
						go func() {
							_, _ = ctl.store.SwitchModelSource(context.Background(), activeCompID, api.ModelSourceSwitchRequest{Mode: m})
						}()
					}
				}
			}
			cfgBtn := components.SecondaryTouchButton(c, "Configure / Test BYOK", activeCompID == "")
			if cfgBtn.Clicked() {
				ctl.openBYOKSheet(snap)
			}
		})
	})

	// 4. Local Models Manager (Memory Pools + Pull/Load/Make Room & Load/Unload/Remove + Recheck Hardware)
	if snap.LocalModels != nil {
		lm := snap.LocalModels
		ctl.mu.Lock()
		rechecking := ctl.recheckBusy
		ctl.mu.Unlock()

		components.SectionCard(c, "Local Models", fmt.Sprintf("%s · %s", lm.Computer.DisplayName, components.PluralInt(len(lm.Models), "catalog model", "catalog models")), func() {
			recheckLbl := "Recheck"
			if rechecking {
				recheckLbl = "Checking..."
			}
			btn := components.SecondaryTouchButton(c, recheckLbl, rechecking)
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
				ui.Column(c.Key(pool.ID)).FillWidth().Gap(4).Children(func() {
					ui.Row(c).FillWidth().Justify(ui.SpaceBetween).Children(func() {
						ui.Text(c, nonEmptyOr(pool.Label, pool.ID)).FontSize(12).FontWeight(600).TextColor(t.Text)
						ui.Text(c, fmt.Sprintf("%s / %s used", formatBytesGB(pool.UsedBytes), formatBytesGB(pool.TotalBytes))).
							FontSize(11).TextColor(t.TextMuted)
					})
					ui.Progress(c, frac).FillWidth().Height(6)
				})
			}

			// Collect currently loaded model IDs for "Make Room & Load".
			var loadedIDs []string
			for _, mv := range lm.Models {
				if mv.Model.State == "loaded" {
					loadedIDs = append(loadedIDs, mv.Model.ID)
				}
			}

			// Individual model cards
			for _, mv := range lm.Models {
				m := mv.Model
				ctl.mu.Lock()
				inFlight := ctl.modelBusy[m.ID]
				ctl.mu.Unlock()
				busy := inFlight != ""

				stateTone := components.ToneNeutral
				switch m.State {
				case "loaded":
					stateTone = components.ToneSuccess
				case "downloading", "loading":
					stateTone = components.ToneInfo
				case "idle":
					stateTone = components.ToneWarning
				}

				ui.Column(c.Key("lm_"+m.ID)).FillWidth().Padding(10, 10).Radius(10).Background(ex.MutedBg).Border(1, t.Border).Gap(6).Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(6).Children(func() {
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, m.Name).FontSize(14).FontWeight(600).TextColor(t.Text).MaxLines(1)
							ui.Text(c, fmt.Sprintf("%s · %s · %s VRAM", m.Quant, formatBytesGB(m.DownloadBytes), formatBytesGB(m.MemoryBytes))).
								FontSize(11).TextColor(t.TextMuted)
						})
						components.StatusPill(c, m.State, stateTone)
					})

					if m.Download != nil && m.Download.TotalBytes > 0 {
						pct := float64(m.Download.DownloadedBytes) / float64(m.Download.TotalBytes)
						ui.Progress(c, pct).FillWidth().Height(6)
						ui.Text(c, fmt.Sprintf("Downloading %.0f%% (%s / %s)", pct*100, formatBytesGB(m.Download.DownloadedBytes), formatBytesGB(m.Download.TotalBytes))).
							FontSize(11).TextColor(t.Accent)
					}

					if m.Error != nil && m.Error.Message != "" {
						components.ErrorInline(c, m.Error.Message, nil)
					}

					// Action buttons tailored to state, with explicit busy labels disabling duplicate taps!
					ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
						switch m.State {
						case "absent":
							lbl := "Download"
							if inFlight == "pull" {
								lbl = "Downloading..."
							}
							b := components.PrimaryTouchButton(c, lbl, busy)
							if b.Clicked() {
								ctl.actOnLocalModelAsync(lm.Computer.ComputerID, m.ID, "pull", nil)
							}
						case "downloading":
							lbl := "Cancel Download"
							if inFlight == "cancel_pull" {
								lbl = "Canceling..."
							}
							b := components.DangerTouchButton(c, lbl, busy)
							if b.Clicked() {
								ctl.actOnLocalModelAsync(lm.Computer.ComputerID, m.ID, "cancel_pull", nil)
							}
						case "idle":
							loadLbl := "Load"
							if inFlight == "load" {
								loadLbl = "Loading..."
							}
							b := components.PrimaryTouchButton(c, loadLbl, busy)
							if b.Clicked() {
								ctl.actOnLocalModelAsync(lm.Computer.ComputerID, m.ID, "load", nil)
							}
							if len(loadedIDs) > 0 {
								mrLbl := "Make Room & Load"
								if inFlight == "make_room_load" {
									mrLbl = "Loading..."
								}
								mr := components.SecondaryTouchButton(c, mrLbl, busy)
								if mr.Clicked() {
									ctl.actOnLocalModelAsync(lm.Computer.ComputerID, m.ID, "load", loadedIDs)
								}
							}
							rm := components.DangerTouchButton(c, "Remove", busy)
							if rm.Clicked() {
								ctl.mu.Lock()
								ctl.removeModelID = m.ID
								ctl.removeModelName = m.Name
								ctl.removeModelOpen = true
								ctl.mu.Unlock()
							}
						case "loaded":
							unLbl := "Unload"
							if inFlight == "unload" {
								unLbl = "Unloading..."
							}
							b := components.SecondaryTouchButton(c, unLbl, busy)
							if b.Clicked() {
								ctl.actOnLocalModelAsync(lm.Computer.ComputerID, m.ID, "unload", nil)
							}
							rm := components.DangerTouchButton(c, "Remove", busy)
							if rm.Clicked() {
								ctl.mu.Lock()
								ctl.removeModelID = m.ID
								ctl.removeModelName = m.Name
								ctl.removeModelOpen = true
								ctl.mu.Unlock()
							}
						}
					})
				})
			}
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
			ctl.setNotice(fmt.Sprintf("Model %s: %s accepted", modelID, action))
		}
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
	}()
}

func (ctl *Controller) viewRemoveModelConfirm(c *ui.Context, snap state.Snapshot) {
	ctl.mu.Lock()
	mID := ctl.removeModelID
	mName := ctl.removeModelName
	ctl.mu.Unlock()
	mobile.ActionSheet(c, &ctl.removeModelOpen, mobile.ActionSheetOptions{
		Title:   "Remove " + mName + "?",
		Message: "Deletes downloaded model weights from Desktop disk.",
		Cancel:  "Cancel",
	}, mobile.Action{
		Label:       "Delete Weights",
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
		}
	}()
}

func (ctl *Controller) viewPermissionsSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.permSheetOpen, mobile.SheetOptions{Detents: []float32{0.65, 0.90}, Label: "Computer Permissions"}, func() {
		ctl.mu.Lock()
		st := ctl.permStatus
		ctl.mu.Unlock()
		cid := ctl.activeComputerID(snap)
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, "Host Permissions").FontSize(18).Bold().TextColor(t.Text)
				if st == nil {
					components.LoadingSkeleton(c, 2)
					return
				}
				for _, subj := range st.Subjects {
					subj := subj
					components.SectionCard(c.Key(subj.Subject), "App: "+subj.Subject, st.Platform, nil, func() {
						for _, p := range subj.Permissions {
							p := p
							tone := components.ToneWarning
							if p.State == "granted" {
								tone = components.ToneSuccess
							}
							ui.Row(c.Key(p.ID)).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
								ui.Text(c, p.ID).FontSize(13).TextColor(t.Text).Grow(1).Basis(0)
								components.StatusPill(c, p.State, tone)
								if p.State != "granted" {
									action := "open_settings"
									lbl := "Settings"
									if p.Prompt == "available" {
										action = "prompt"
										lbl = "Prompt"
									}
									btn := components.SecondaryTouchButton(c, lbl, false)
									if btn.Clicked() {
										go func() {
											if cl := ctl.store.Client(); cl != nil {
												if updated, err := cl.ActOnLocalComputerPermissionTyped(context.Background(), snap.TenantID, cid, subj.Subject, p.ID, action); err == nil {
													ctl.mu.Lock()
													ctl.permStatus = &updated
													ctl.mu.Unlock()
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
	go func() {
		cl := ctl.store.Client()
		tid := ctl.store.Snapshot().TenantID
		cid := ctl.activeComputerID(ctl.store.Snapshot())
		if cl == nil || tid == "" || cid == "" {
			return
		}
		if st, err := cl.GetLocalComputerBrowserConnectionTyped(context.Background(), tid, cid); err == nil {
			ctl.mu.Lock()
			ctl.browserStatus = &st
			if st.Profile != nil {
				ctl.browserProfile = *st.Profile
			}
			ctl.mu.Unlock()
		}
	}()
}

func (ctl *Controller) viewBrowserSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.browserSheetOpen, mobile.SheetOptions{Detents: []float32{0.58}, Label: "Browser Connection"}, func() {
		ctl.mu.Lock()
		st := ctl.browserStatus
		ctl.mu.Unlock()
		cid := ctl.activeComputerID(snap)
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, "Desktop Browser Connection").FontSize(18).Bold().TextColor(t.Text)
				if st != nil {
					components.StatusPill(c, fmt.Sprintf("%s (%s)", st.State, st.Mode), components.ToneInfo)
				}
				components.FormField(c, "Chrome Profile", "Default", &ctl.browserProfile, false)
				ui.Row(c).FillWidth().Gap(8).Children(func() {
					connBtn := components.PrimaryTouchButton(c, "Connect Chrome", false)
					connBtn.Grow(1).Basis(0)
					if connBtn.Clicked() {
						prof := strings.TrimSpace(ctl.browserProfile)
						go func() {
							if cl := ctl.store.Client(); cl != nil {
								if updated, err := cl.PutLocalComputerBrowserConnectionTyped(context.Background(), snap.TenantID, cid, prof); err == nil {
									ctl.mu.Lock()
									ctl.browserStatus = &updated
									ctl.mu.Unlock()
								}
							}
						}()
					}
					discBtn := components.DangerTouchButton(c, "Disconnect", false)
					if discBtn.Clicked() {
						go func() {
							if cl := ctl.store.Client(); cl != nil {
								_ = cl.DeleteLocalComputerBrowserConnection(context.Background(), snap.TenantID, cid)
								ctl.openBrowserSheet(cid)
							}
						}()
					}
				})
			})
		})
	})
}

func (ctl *Controller) openBYOKSheet(snap state.Snapshot) {
	ctl.mu.Lock()
	if snap.ModelSource != nil && snap.ModelSource.Status != nil {
		ctl.byokMode = snap.ModelSource.Status.Mode
		if snap.ModelSource.Status.Byok.BaseURL != nil {
			ctl.byokBaseURL = *snap.ModelSource.Status.Byok.BaseURL
		}
		if snap.ModelSource.Status.Byok.Model != nil {
			ctl.byokModelID = *snap.ModelSource.Status.Byok.Model
		}
	}
	ctl.byokTestMsg = ""
	ctl.byokSheetOpen = true
	ctl.mu.Unlock()
}

func (ctl *Controller) viewBYOKSheet(c *ui.Context, snap state.Snapshot) {
	t := c.Theme()
	mobile.Sheet(c, &ctl.byokSheetOpen, mobile.SheetOptions{Detents: []float32{0.80, 0.94}, Label: "BYOK Model Source"}, func() {
		ctl.mu.Lock()
		busy := ctl.byokBusy
		testMsg := ctl.byokTestMsg
		models := append([]api.ByokModel(nil), ctl.byokModels...)
		ctl.mu.Unlock()
		cid := ctl.activeComputerID(snap)

		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(10, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, "BYOK Provider Configuration").FontSize(18).Bold().TextColor(t.Text)
				if testMsg != "" {
					components.StatusBanner(c, components.ToneInfo, testMsg, "", nil)
				}
				components.FormField(c, "Base URL", "https://api.openai.com", &ctl.byokBaseURL, false)
				components.FormField(c, "Path", "/v1", &ctl.byokPath, false)
				components.FormField(c, "Endpoint", "/chat/completions", &ctl.byokEndpoint, false)
				components.FormField(c, "Model ID", "gpt-4o-mini", &ctl.byokModelID, false)
				components.FormField(c, "API Key (stored only on Desktop 0600)", "sk-...", &ctl.byokAPIKey, true)

				ui.Row(c).FillWidth().Gap(8).Children(func() {
					testBtn := components.SecondaryTouchButton(c, "Test Connection", busy)
					testBtn.Grow(1).Basis(0)
					if testBtn.Clicked() {
						ctl.testBYOKAsync(snap.TenantID, cid)
					}
					listBtn := components.SecondaryTouchButton(c, "List Models", busy)
					listBtn.Grow(1).Basis(0)
					if listBtn.Clicked() {
						ctl.listBYOKModelsAsync(snap.TenantID, cid)
					}
				})

				if len(models) > 0 {
					components.SectionCard(c, fmt.Sprintf("Provider Models (%d)", len(models)), "Tap a model to select", nil, func() {
						for _, m := range models {
							m := m
							lbl := m.ID
							if m.Name != nil && *m.Name != "" {
								lbl = *m.Name + " (" + m.ID + ")"
							}
							row := ui.Row(c.Key("bm_"+m.ID)).FillWidth().MinHeight(40).Padding(6, 8).Radius(8).
								AlignItems(ui.Center).Role(ui.RoleButton).Label("Select model " + m.ID)
							row.Children(func() { ui.Text(c, lbl).FontSize(13).TextColor(t.Accent) })
							if row.Clicked() {
								ctl.mu.Lock()
								ctl.byokModelID = m.ID
								ctl.mu.Unlock()
							}
						}
					})
				}

				applyBtn := components.PrimaryTouchButton(c, "Switch Desktop to BYOK", busy || strings.TrimSpace(ctl.byokModelID) == "")
				applyBtn.FillWidth()
				if applyBtn.Clicked() {
					baseURL := strings.TrimSpace(ctl.byokBaseURL)
					model := strings.TrimSpace(ctl.byokModelID)
					key := ctl.byokAPIKey
					ctl.mu.Lock()
					ctl.byokBusy = true
					ctl.mu.Unlock()
					go func() {
						_, err := ctl.store.SwitchModelSource(context.Background(), cid, api.ModelSourceSwitchRequest{
							Mode:         "byok",
							BaseURL:      &baseURL,
							RuntimeModel: &model,
							APIKey:       &key,
						})
						ctl.mu.Lock()
						ctl.byokBusy = false
						if err == nil {
							ctl.byokSheetOpen = false
						}
						ctl.mu.Unlock()
					}()
				}
			})
		})
	})
}

func (ctl *Controller) currentBYOKInput() api.ByokInput {
	ctl.mu.Lock()
	defer ctl.mu.Unlock()
	var keyPtr *string
	if ctl.byokAPIKey != "" {
		k := ctl.byokAPIKey
		keyPtr = &k
	}
	return api.ByokInput{
		BaseURL:  strings.TrimSpace(ctl.byokBaseURL),
		Path:     strings.TrimSpace(ctl.byokPath),
		Endpoint: strings.TrimSpace(ctl.byokEndpoint),
		Protocol: ctl.byokProtocol,
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
				msg = "Test failed: " + err.Error()
			} else if res.Ok {
				msg = fmt.Sprintf("Connected OK · %s (%d ctx)", res.ModelID, res.ContextWindow)
			} else {
				msg = "Endpoint returned not-ok"
			}
		}
		ctl.mu.Lock()
		ctl.byokBusy = false
		ctl.byokTestMsg = msg
		ctl.mu.Unlock()
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
				msg = "List failed: " + err.Error()
			} else {
				list = res.Models
				msg = fmt.Sprintf("Loaded %s from provider", components.PluralInt(len(res.Models), "model", "models"))
			}
		}
		ctl.mu.Lock()
		ctl.byokBusy = false
		ctl.byokModels = list
		ctl.byokTestMsg = msg
		ctl.mu.Unlock()
	}()
}

func (ctl *Controller) scanSkillsAsync(tenantID, compID string) {
	go func() {
		if cl := ctl.store.Client(); cl != nil {
			_, err := cl.ScanLocalComputerSkills(context.Background(), tenantID, compID)
			ctl.mu.Lock()
			if err != nil {
				ctl.scanResult = "Skill scan failed: " + err.Error()
			} else {
				ctl.scanResult = "Skill scan complete."
			}
			ctl.mu.Unlock()
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
