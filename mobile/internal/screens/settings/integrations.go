package settings

import (
	"context"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func (s *Screen) viewIntegrationsSection(c *ui.Context) {
	t := c.Theme()

	s.mu.Lock()
	conns := append([]api.ExternalConnectionC2(nil), s.connections...)
	apps := s.externalApps
	ws := s.webSearch
	vp := s.voicePolicy
	s.mu.Unlock()

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SectionIntegrations]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
			if s.integError != "" {
				components.StatusBanner(c, components.ToneDanger, s.integError, i18n.T("common.dismiss"), func() {
					s.integError = ""
				})
			}
			if s.integNotice != "" {
				components.StatusBanner(c, components.ToneSuccess, s.integNotice, i18n.T("common.ok"), func() {
					s.integNotice = ""
				})
			}

			// 1. External Apps & Connections
			components.SectionCard(c, i18n.Tf("settings.integrations.ext_title", map[string]any{"count": len(conns)}),
				i18n.Tf("settings.integrations.ext_sub", map[string]any{"count": len(apps.Apps)}), nil, func() {
					if len(conns) == 0 {
						ui.Text(c, i18n.T("settings.integrations.ext_empty")).FontSize(13).TextColor(t.TextMuted)
					} else {
						ui.Column(c).FillWidth().Gap(10).Children(func() {
							for _, conn := range conns {
								conn := conn
								busy := s.integBusyID == conn.ID
								ui.Column(c.Key(conn.ID)).FillWidth().Padding(12, 12).Gap(8).
									Radius(12).Background(theme.Extra(t).MutedBg).Border(0.75, theme.Extra(t).SubtleBorder).Children(func() {
									ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
										lbl := conn.Provider
										if conn.IdentityLabel != nil && *conn.IdentityLabel != "" {
											lbl += " · " + *conn.IdentityLabel
										}
										ui.Text(c, lbl).FontSize(14).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
										tone := components.ToneInfo
										if conn.Status == "connected" {
											tone = components.ToneSuccess
										} else if conn.Status == "disconnected" || conn.Status == "error" {
											tone = components.ToneDanger
										}
										components.StatusPill(c, i18n.StatusLabel(conn.Status), tone)
									})

									if conn.StatusCheckedAt != nil {
										ui.Text(c, i18n.Tf("settings.integrations.checked_prefix", map[string]any{"time": i18n.FormatDateTimeUTC(*conn.StatusCheckedAt)})).
											FontSize(11).TextColor(t.TextMuted)
									}

									ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
										ui.Text(c, i18n.T("settings.integrations.auto_reminders")).FontSize(12).TextColor(t.TextMuted)
										autoRem := conn.AutoReminders
										sw := mobile.Switch(c, &autoRem).Label(i18n.Tf("settings.integrations.auto_reminders_a11y", map[string]any{"name": conn.Provider})).Disabled(busy)
										if sw.Changed() {
											s.toggleConnAutoRemindersAsync(conn.ID, autoRem)
										}
									})

									ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
										chkLbl := i18n.T("settings.integrations.check_status")
										if busy {
											chkLbl = i18n.T("settings.integrations.checking")
										}
										chkBtn := components.PrimaryTouchButton(c, chkLbl, busy)
										if chkBtn.Clicked() {
											s.checkConnStatusAsync(conn)
										}
										grantBtn := components.SecondaryTouchButton(c, i18n.T("settings.integrations.agent_grants"), busy)
										if grantBtn.Clicked() {
											s.openAgentGrantsSheet(conn)
										}
										disBtn := components.DangerTouchButton(c, i18n.T("settings.integrations.disconnect"), busy)
										if disBtn.Clicked() {
											cp := conn
											s.connDisconnItem = &cp
											s.connDisconnSheet = true
										}
									})
								})
							}
						})
					}
				})

			// 2. Web Search Backends
			defSearch := ws.DefaultSearch
			if defSearch == "" {
				defSearch = i18n.T("common.none")
			}
			components.SectionCard(c, i18n.T("settings.integrations.search_title"), i18n.Tf("settings.integrations.search_sub", map[string]any{"name": defSearch}), nil, func() {
				if len(ws.Backends) == 0 {
					ui.Text(c, i18n.T("settings.integrations.search_empty")).FontSize(13).TextColor(t.TextMuted)
					return
				}
				ui.Column(c).FillWidth().Gap(10).Children(func() {
					for _, b := range ws.Backends {
						b := b
						isDefault := ws.DefaultSearch == b.ID
						buf := s.searchKeyBuf(b.ID)
						ui.Column(c.Key("ws:"+b.ID)).FillWidth().Padding(12, 12).Gap(8).
							Radius(12).Background(theme.Extra(t).MutedBg).Border(0.75, theme.Extra(t).SubtleBorder).Children(func() {
							ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
								ui.Text(c, b.Name).FontSize(14).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0)
								ui.Row(c).Gap(4).Children(func() {
									if isDefault {
										components.StatusPill(c, i18n.T("settings.integrations.default_badge"), components.ToneSuccess)
									}
									components.StatusPill(c, i18n.StatusLabel(b.KeyState), components.ToneNeutral)
								})
							})
							ui.Text(c, b.Description).FontSize(12).TextColor(t.TextMuted)

							if !isDefault && (b.Keyless || b.Status == "ready") {
								defBtn := components.SecondaryTouchButton(c, i18n.T("settings.integrations.set_default"), false)
								if defBtn.Clicked() {
									s.setDefaultWebSearchAsync(b.ID)
								}
							}
							if ws.CanSaveKeys && !b.Keyless {
								components.FormField(c, i18n.Tf("settings.integrations.api_key_for", map[string]any{"name": b.Name}), i18n.T("settings.integrations.api_key_ph"), buf, true)
								ui.Row(c).FillWidth().Gap(8).Children(func() {
									saveBtn := components.PrimaryTouchButton(c, i18n.T("settings.integrations.save_key"), strings.TrimSpace(*buf) == "")
									saveBtn.Grow(1).Basis(0)
									if saveBtn.Clicked() {
										keyVal := strings.TrimSpace(*buf)
										*buf = "" // immediately wipe secret from UI state
										s.saveWebSearchKeyAsync(b.ID, keyVal)
									}
									if b.KeyState == "saved" {
										rmBtn := components.DangerTouchButton(c, i18n.T("settings.integrations.remove_key"), false)
										if rmBtn.Clicked() {
											s.deleteWebSearchKeyAsync(b.ID)
										}
									}
								})
							}
						})
					}
				})
			})

			// 3. Voice Media Policy & Provider Keys
			components.SectionCard(c, i18n.T("settings.integrations.voice_title"), i18n.T("settings.integrations.voice_sub"), nil, func() {
				if vp == nil {
					ui.Text(c, i18n.T("settings.integrations.voice_unavailable")).FontSize(13).TextColor(t.TextMuted)
					return
				}
				ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
					if vp.VoiceMediaSupported {
						components.StatusPill(c, i18n.T("settings.integrations.stt_ready"), components.ToneSuccess)
					} else {
						components.StatusPill(c, i18n.T("settings.integrations.stt_off"), components.ToneNeutral)
					}
					if vp.LiveEnabled != nil && *vp.LiveEnabled {
						components.StatusPill(c, i18n.T("settings.integrations.live_on"), components.ToneSuccess)
					} else {
						components.StatusPill(c, i18n.T("settings.integrations.live_off"), components.ToneNeutral)
					}
				})

				s.viewVoiceKeyEditor(c, i18n.T("settings.integrations.soniox_label"), "soniox", vp.SonioxKey, &s.sonioxKeyInput)
				s.viewVoiceKeyEditor(c, i18n.T("settings.integrations.xai_label"), "xai", vp.XaiKey, &s.xaiKeyInput)
			})
		})
	})
}

func (s *Screen) viewVoiceKeyEditor(c *ui.Context, title, provider string, st *api.VoiceProviderKeyStatusC2, buf *string) {
	t := c.Theme()
	src := "none"
	canSave := true
	if st != nil {
		if st.Source != "" {
			src = st.Source
		}
		canSave = st.CanSave
	}
	ui.Column(c.Key("vk:"+provider)).FillWidth().Padding(12, 12).Gap(8).
		Radius(12).Background(theme.Extra(t).MutedBg).Border(0.75, theme.Extra(t).SubtleBorder).Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
			ui.Text(c, title).FontSize(13).FontWeight(600).TextColor(t.Text)
			tone := components.ToneNeutral
			if src == "saved" || src == "environment" {
				tone = components.ToneSuccess
			}
			components.StatusPill(c, i18n.Tf("settings.integrations.key_source", map[string]any{"source": i18n.StatusLabel(src)}), tone)
		})
		if !canSave && src == "environment" {
			ui.Text(c, i18n.T("settings.integrations.env_managed")).FontSize(12).TextColor(t.TextMuted)
			return
		}
		components.FormField(c, i18n.Tf("settings.integrations.api_key_for", map[string]any{"name": title}), "sk-...", buf, true)
		busy := s.voiceKeyBusy == provider
		lbl := i18n.Tf("settings.integrations.save_validate", map[string]any{"name": strings.ToUpper(provider)})
		if busy {
			lbl = i18n.T("settings.integrations.validating")
		}
		btn := components.PrimaryTouchButton(c, lbl, busy || !canSave || strings.TrimSpace(*buf) == "")
		btn.FillWidth()
		if btn.Clicked() {
			secret := strings.TrimSpace(*buf)
			*buf = "" // wipe secret from UI buffer immediately
			s.saveVoiceKeyAsync(provider, secret)
		}
	})
}

func (s *Screen) searchKeyBuf(backendID string) *string {
	buf, ok := s.searchKeyInputs[backendID]
	if !ok {
		v := ""
		buf = &v
		s.searchKeyInputs[backendID] = buf
	}
	return buf
}

func (s *Screen) checkConnStatusAsync(conn api.ExternalConnectionC2) {
	client := s.client()
	if client == nil || s.integBusyID != "" {
		return
	}
	s.integBusyID = conn.ID
	s.integError = ""
	s.integNotice = ""
	go func() {
		updated, err := client.CheckExternalConnectionStatus(context.Background(), conn.ID, conn.Revision)
		s.enqueueUI(func() {
			s.integBusyID = ""
			if err != nil {
				s.integError = err.Error()
				return
			}
			s.replaceConnection(updated)
			s.integNotice = i18n.Tf("settings.integrations.toast.status_checked", map[string]any{
				"provider": updated.Provider,
				"status":   i18n.StatusLabel(updated.Status),
			})
		})
	}()
}

func (s *Screen) toggleConnAutoRemindersAsync(connID string, enabled bool) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		updated, err := client.SetExternalConnectionAutoRemindersC2(context.Background(), connID, enabled)
		s.enqueueUI(func() {
			if err != nil {
				s.integError = err.Error()
				return
			}
			s.replaceConnection(updated)
		})
	}()
}

func (s *Screen) openAgentGrantsSheet(conn api.ExternalConnectionC2) {
	cp := conn
	s.grantsConn = &cp
	s.grantsAgents = nil
	s.grantsBusy = true
	s.grantsSheetOpen = true

	client := s.client()
	if client == nil {
		s.grantsBusy = false
		return
	}
	go func() {
		agents, err := client.ListExternalConnectionAgentGrants(context.Background(), conn.ID)
		s.enqueueUI(func() {
			s.grantsBusy = false
			if err != nil {
				s.integError = err.Error()
				return
			}
			s.grantsAgents = agents
		})
	}()
}

func (s *Screen) viewAgentGrantsSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.grantsSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.58, 0.85},
		Label:   i18n.T("settings.integrations.grants_sheet_a11y"),
	}, func() {
		conn := s.grantsConn
		if conn == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(14, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, i18n.Tf("settings.integrations.grants_title", map[string]any{"app": conn.Provider})).FontSize(18).Bold().TextColor(t.Text)
				if s.grantsBusy {
					components.LoadingSkeleton(c, 2)
					return
				}
				if len(s.grantsAgents) == 0 {
					ui.Text(c, i18n.T("settings.integrations.grants_empty")).FontSize(13).TextColor(t.TextMuted)
					return
				}
				for _, ag := range s.grantsAgents {
					ag := ag
					ui.Row(c.Key(ag.AgentActorID)).FillWidth().MinHeight(48).Padding(8, 12).Radius(10).
						Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
						ui.Text(c, ag.AgentDisplayName).FontSize(14).FontWeight(600).TextColor(t.Text)
						granted := ag.Granted
						sw := mobile.Switch(c, &granted).Label(i18n.Tf("settings.integrations.grant_a11y", map[string]any{"name": ag.AgentDisplayName}))
						if sw.Changed() {
							s.setAgentGrantAsync(conn.ID, ag.AgentActorID, granted)
						}
					})
				}
			})
		})
	})
}

func (s *Screen) setAgentGrantAsync(connID, agentActorID string, granted bool) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		updated, err := client.SetExternalConnectionAgentGrant(context.Background(), connID, agentActorID, granted)
		s.enqueueUI(func() {
			if err != nil {
				s.integError = err.Error()
				return
			}
			for i := range s.grantsAgents {
				if s.grantsAgents[i].AgentActorID == updated.AgentActorID {
					s.grantsAgents[i] = updated
				}
			}
		})
	}()
}

func (s *Screen) viewDisconnectConfirmSheet(c *ui.Context) {
	conn := s.connDisconnItem
	if conn == nil {
		s.connDisconnSheet = false
		return
	}
	mobile.ActionSheet(c, &s.connDisconnSheet, mobile.ActionSheetOptions{
		Title:   i18n.Tf("settings.integrations.disconnect_title", map[string]any{"name": conn.Provider}),
		Message: i18n.T("settings.integrations.disconnect_body"),
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("settings.integrations.disconnect"),
		Destructive: true,
		OnTap:       func() { s.disconnectConnAsync(*conn) },
	})
}

func (s *Screen) disconnectConnAsync(conn api.ExternalConnectionC2) {
	client := s.client()
	if client == nil {
		return
	}
	s.integBusyID = conn.ID
	go func() {
		updated, err := client.DisconnectExternalConnectionC2(context.Background(), conn.ID, conn.Revision)
		s.enqueueUI(func() {
			s.integBusyID = ""
			if err != nil {
				s.integError = err.Error()
				return
			}
			s.replaceConnection(updated)
			s.connDisconnItem = nil
			s.integNotice = i18n.Tf("settings.integrations.toast.disconnected", map[string]any{"name": conn.Provider})
		})
	}()
}

func (s *Screen) replaceConnection(updated api.ExternalConnectionC2) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.connections {
		if s.connections[i].ID == updated.ID {
			s.connections[i] = updated
			return
		}
	}
	s.connections = append(s.connections, updated)
}

func (s *Screen) setDefaultWebSearchAsync(backendID string) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		if err := client.SetWebSearchDefault(context.Background(), backendID); err != nil {
			s.enqueueUI(func() { s.integError = err.Error() })
			return
		}
		if ws, err := client.ListWebSearchBackends(context.Background()); err == nil {
			s.enqueueUI(func() {
				s.mu.Lock()
				s.webSearch = ws
				s.mu.Unlock()
				s.integNotice = i18n.Tf("settings.integrations.toast.default_search", map[string]any{"name": backendID})
			})
		}
	}()
}

func (s *Screen) saveWebSearchKeyAsync(backendID, apiKey string) {
	client := s.client()
	if client == nil || apiKey == "" {
		return
	}
	go func() {
		if err := client.SaveWebSearchKey(context.Background(), backendID, apiKey); err != nil {
			s.enqueueUI(func() { s.integError = err.Error() })
			return
		}
		if ws, err := client.ListWebSearchBackends(context.Background()); err == nil {
			s.enqueueUI(func() {
				s.mu.Lock()
				s.webSearch = ws
				s.mu.Unlock()
				s.integNotice = i18n.Tf("settings.integrations.toast.saved_key", map[string]any{"name": backendID})
			})
		}
	}()
}

func (s *Screen) deleteWebSearchKeyAsync(backendID string) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		if err := client.DeleteWebSearchKey(context.Background(), backendID); err != nil {
			s.enqueueUI(func() { s.integError = err.Error() })
			return
		}
		if ws, err := client.ListWebSearchBackends(context.Background()); err == nil {
			s.enqueueUI(func() {
				s.mu.Lock()
				s.webSearch = ws
				s.mu.Unlock()
				s.integNotice = i18n.Tf("settings.integrations.toast.removed_key", map[string]any{"name": backendID})
			})
		}
	}()
}

func (s *Screen) saveVoiceKeyAsync(provider, apiKey string) {
	client := s.client()
	if client == nil || apiKey == "" || s.voiceKeyBusy != "" {
		return
	}
	s.voiceKeyBusy = provider
	s.integError = ""
	s.integNotice = ""
	go func() {
		st, err := client.SaveVoiceProviderKeyC2(context.Background(), provider, apiKey)
		s.enqueueUI(func() {
			s.voiceKeyBusy = ""
			if err != nil {
				s.integError = err.Error()
				return
			}
			s.mu.Lock()
			if s.voicePolicy == nil {
				s.voicePolicy = &api.VoiceMediaPolicyC2{}
			}
			cp := st
			switch provider {
			case "soniox":
				s.voicePolicy.SonioxKey = &cp
			case "xai":
				s.voicePolicy.XaiKey = &cp
			}
			s.mu.Unlock()
			s.integNotice = i18n.Tf("settings.integrations.toast.validated_voice", map[string]any{"name": strings.ToUpper(provider)})
		})
	}()
}
