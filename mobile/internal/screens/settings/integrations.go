package settings

import (
	"context"
	"fmt"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
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
				components.StatusBanner(c, components.ToneDanger, s.integError, "Dismiss", func() {
					s.integError = ""
				})
			}
			if s.integNotice != "" {
				components.StatusBanner(c, components.ToneSuccess, s.integNotice, "OK", func() {
					s.integNotice = ""
				})
			}

			// 1. External Apps & Connections
			components.SectionCard(c, fmt.Sprintf("External Connections (%d)", len(conns)),
				fmt.Sprintf("%d catalog apps available", len(apps.Apps)), nil, func() {
					if len(conns) == 0 {
						ui.Text(c, "No external connections authorized yet.").FontSize(13).TextColor(t.TextMuted)
					} else {
						ui.Column(c).FillWidth().Gap(10).Children(func() {
							for _, conn := range conns {
								conn := conn
								busy := s.integBusyID == conn.ID
								ui.Column(c.Key(conn.ID)).FillWidth().Padding(10, 12).Gap(8).
									Radius(10).Background(theme.Extra(t).MutedBg).Border(1, t.Border).Children(func() {
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
										components.StatusPill(c, conn.Status, tone)
									})

									if conn.StatusCheckedAt != nil {
										ui.Text(c, "Checked: "+conn.StatusCheckedAt.UTC().Format("Jan 2 15:04:05 UTC")).
											FontSize(11).TextColor(t.TextMuted)
									}

									ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
										ui.Text(c, "Auto-Reminders").FontSize(12).TextColor(t.TextMuted)
										autoRem := conn.AutoReminders
										sw := mobile.Switch(c, &autoRem).Label("Auto Reminders " + conn.Provider).Disabled(busy)
										if sw.Changed() {
											s.toggleConnAutoRemindersAsync(conn.ID, autoRem)
										}
									})

									ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
										chkLbl := "Check Status"
										if busy {
											chkLbl = "Checking..."
										}
										chkBtn := components.PrimaryTouchButton(c, chkLbl, busy)
										if chkBtn.Clicked() {
											s.checkConnStatusAsync(conn)
										}
										grantBtn := components.SecondaryTouchButton(c, "Agent Grants", busy)
										if grantBtn.Clicked() {
											s.openAgentGrantsSheet(conn)
										}
										disBtn := components.DangerTouchButton(c, "Disconnect", busy)
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
			components.SectionCard(c, "Web Search Backends", "Default search: "+ws.DefaultSearch, nil, func() {
				if len(ws.Backends) == 0 {
					ui.Text(c, "No search backends reported.").FontSize(13).TextColor(t.TextMuted)
					return
				}
				ui.Column(c).FillWidth().Gap(10).Children(func() {
					for _, b := range ws.Backends {
						b := b
						isDefault := ws.DefaultSearch == b.ID
						buf := s.searchKeyBuf(b.ID)
						ui.Column(c.Key("ws:" + b.ID)).FillWidth().Padding(10, 12).Gap(8).
							Radius(10).Background(theme.Extra(t).MutedBg).Border(1, t.Border).Children(func() {
							ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
								ui.Text(c, b.Name).FontSize(14).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0)
								ui.Row(c).Gap(4).Children(func() {
									if isDefault {
										components.StatusPill(c, "Default", components.ToneSuccess)
									}
									components.StatusPill(c, b.KeyState, components.ToneNeutral)
								})
							})
							ui.Text(c, b.Description).FontSize(12).TextColor(t.TextMuted)

							if !isDefault && (b.Keyless || b.Status == "ready") {
								defBtn := components.SecondaryTouchButton(c, "Set as Default", false)
								if defBtn.Clicked() {
									s.setDefaultWebSearchAsync(b.ID)
								}
							}
							if ws.CanSaveKeys && !b.Keyless {
								components.FormField(c, b.Name+" API Key", "Enter secret key", buf, true)
								ui.Row(c).FillWidth().Gap(8).Children(func() {
									saveBtn := components.PrimaryTouchButton(c, "Save Key", strings.TrimSpace(*buf) == "")
									saveBtn.Grow(1).Basis(0)
									if saveBtn.Clicked() {
										keyVal := strings.TrimSpace(*buf)
										*buf = "" // immediately wipe secret from UI state
										s.saveWebSearchKeyAsync(b.ID, keyVal)
									}
									if b.KeyState == "saved" {
										rmBtn := components.DangerTouchButton(c, "Remove Key", false)
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
			components.SectionCard(c, "Voice Infrastructure & Keys", "Speech-to-text & Live voice providers", nil, func() {
				if vp == nil {
					ui.Text(c, "Voice policy unavailable.").FontSize(13).TextColor(t.TextMuted)
					return
				}
				ui.Row(c).FillWidth().Wrap().Gap(6).Children(func() {
					if vp.VoiceMediaSupported {
						components.StatusPill(c, "Transcription Ready", components.ToneSuccess)
					} else {
						components.StatusPill(c, "Transcription Off", components.ToneNeutral)
					}
					if vp.LiveEnabled != nil && *vp.LiveEnabled {
						components.StatusPill(c, "Live Voice Enabled", components.ToneSuccess)
					} else {
						components.StatusPill(c, "Live Voice Off", components.ToneNeutral)
					}
				})

				s.viewVoiceKeyEditor(c, "Soniox (Transcription)", "soniox", vp.SonioxKey, &s.sonioxKeyInput)
				s.viewVoiceKeyEditor(c, "xAI (Live Voice)", "xai", vp.XaiKey, &s.xaiKeyInput)
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
	ui.Column(c.Key("vk:" + provider)).FillWidth().Padding(10, 12).Gap(8).
		Radius(10).Background(theme.Extra(t).MutedBg).Border(1, t.Border).Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
			ui.Text(c, title).FontSize(13).FontWeight(600).TextColor(t.Text)
			tone := components.ToneNeutral
			if src == "saved" || src == "environment" {
				tone = components.ToneSuccess
			}
			components.StatusPill(c, "Key: "+src, tone)
		})
		if !canSave && src == "environment" {
			ui.Text(c, "Managed by server environment variable.").FontSize(12).TextColor(t.TextMuted)
			return
		}
		components.FormField(c, title+" API Key", "sk-...", buf, true)
		busy := s.voiceKeyBusy == provider
		lbl := "Save & Validate " + strings.ToUpper(provider) + " Key"
		if busy {
			lbl = "Validating..."
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
			s.integNotice = updated.Provider + " status: " + updated.Status
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
		Label:   "Agent Connection Grants",
	}, func() {
		conn := s.grantsConn
		if conn == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(14, 16, 24, 16).Gap(10).Children(func() {
				ui.Text(c, "Agent Grants · "+conn.Provider).FontSize(18).Bold().TextColor(t.Text)
				if s.grantsBusy {
					components.LoadingSkeleton(c, 2)
					return
				}
				if len(s.grantsAgents) == 0 {
					ui.Text(c, "No agents available to grant.").FontSize(13).TextColor(t.TextMuted)
					return
				}
				for _, ag := range s.grantsAgents {
					ag := ag
					ui.Row(c.Key(ag.AgentActorID)).FillWidth().MinHeight(48).Padding(8, 12).Radius(10).
						Background(t.Surface).Border(1, t.Border).AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
						ui.Text(c, ag.AgentDisplayName).FontSize(14).FontWeight(600).TextColor(t.Text)
						granted := ag.Granted
						sw := mobile.Switch(c, &granted).Label("Grant " + ag.AgentDisplayName)
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
		Title:   "Disconnect " + conn.Provider + "?",
		Message: "Agents will lose access to this connection.",
		Cancel:  "Cancel",
	}, mobile.Action{
		Label:       "Disconnect",
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
			s.integNotice = "Disconnected " + conn.Provider
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
				s.integNotice = "Default search set to " + backendID
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
				s.integNotice = "Saved API key for " + backendID
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
				s.integNotice = "Removed API key for " + backendID
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
			s.integNotice = "Validated and saved " + strings.ToUpper(provider) + " key"
		})
	}()
}
