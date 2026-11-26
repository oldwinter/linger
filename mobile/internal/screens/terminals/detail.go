package terminals

import (
	"context"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/herdr"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

const maxTerminalBufferBytes = 256 * 1024

func (s *Screen) enterDetail(address string) {
	s.stopAttach()
	s.detailAddress = address
	s.detailPrompt = ""
	s.killConfirmOpen = false
	s.rmConfirmOpen = false

	s.mu.Lock()
	s.detailOutput = ""
	s.detailRead = nil
	s.detailError = ""
	s.detailBusy = true
	s.attachAddr = address
	s.mu.Unlock()

	go s.refreshDetailSnapshot(context.Background(), address)
}

func (s *Screen) exitDetail() {
	s.stopAttach()
	s.detailAddress = ""
	s.detailPrompt = ""
	s.killConfirmOpen = false
	s.rmConfirmOpen = false
	s.mu.Lock()
	s.attachAddr = ""
	s.detailError = ""
	s.mu.Unlock()
}

func (s *Screen) currentDetailAddress() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.attachAddr
}

func (s *Screen) stopAttach() {
	s.mu.Lock()
	att := s.attach
	s.attach = nil
	s.attachMode = herdr.AttachModeDisconnected
	s.mu.Unlock()
	if att != nil {
		_ = att.Close()
	}
}

func (s *Screen) startLiveAttach(address string) {
	cl, _, _ := s.activeClient()
	if cl == nil || address == "" {
		return
	}
	s.stopAttach()

	att := cl.NewAttachClient(address, herdr.AttachOptions{
		Cols:         80,
		Rows:         28,
		Observe:      false,
		PollInterval: 1500 * time.Millisecond,
		ReadLines:    herdr.DefaultReadLines,
	}, herdr.AttachCallbacks{
		OnOutput: func(out herdr.AttachOutput) {
			s.mu.Lock()
			if s.attachAddr != address {
				s.mu.Unlock()
				return
			}
			if out.Replace {
				s.detailOutput = out.Text
				cp := herdr.ReadResult{
					Text:     out.Text,
					Complete: out.Complete,
					How:      out.How,
					Why:      out.Why,
				}
				s.detailRead = &cp
			} else {
				combined := s.detailOutput + out.Text
				if len(combined) > maxTerminalBufferBytes {
					combined = combined[len(combined)-maxTerminalBufferBytes:]
				}
				s.detailOutput = combined
			}
			s.detailBusy = false
			s.detailError = ""
			s.mu.Unlock()
			s.notify()
		},
		OnStatus: func(st herdr.OSCStatus) {
			s.mu.Lock()
			for i := range s.terminals {
				if s.terminals[i].Address == address {
					cp := st
					s.terminals[i].Status = &cp
					break
				}
			}
			s.mu.Unlock()
			s.notify()
		},
		OnModeChanged: func(mode herdr.AttachMode) {
			s.mu.Lock()
			if s.attachAddr == address {
				s.attachMode = mode
			}
			s.mu.Unlock()
			s.notify()
		},
		OnError: func(err error) {
			if err == nil {
				return
			}
			s.mu.Lock()
			if s.attachAddr == address {
				s.detailError = err.Error()
			}
			s.mu.Unlock()
			s.notify()
		},
	})

	s.mu.Lock()
	if s.closed || s.attachAddr != address {
		s.mu.Unlock()
		return
	}
	s.attach = att
	s.mu.Unlock()

	go func() {
		if err := att.Connect(context.Background()); err != nil {
			s.mu.Lock()
			if s.attach == att {
				s.attach = nil
				s.attachMode = herdr.AttachModeDisconnected
				s.detailError = err.Error()
			}
			s.mu.Unlock()
			s.notify()
		}
	}()
}

func (s *Screen) refreshDetailSnapshot(ctx context.Context, address string) {
	cl, _, _ := s.activeClient()
	if cl == nil || address == "" {
		return
	}
	s.mu.Lock()
	s.detailBusy = true
	s.mu.Unlock()
	s.notify()

	readRes, readErr := cl.Read(ctx, address, herdr.DefaultReadLines)
	termRes, termErr := cl.GetTerminal(ctx, address)

	s.mu.Lock()
	if s.attachAddr != address {
		s.mu.Unlock()
		return
	}
	s.detailBusy = false
	if readErr == nil {
		cp := readRes
		s.detailRead = &cp
		s.detailOutput = readRes.Text
		s.detailError = ""
	} else {
		s.detailError = readErr.Error()
	}
	if termErr == nil && termRes.Address != "" {
		replaced := false
		for i := range s.terminals {
			if s.terminals[i].Address == termRes.Address {
				s.terminals[i] = termRes
				replaced = true
				break
			}
		}
		if !replaced {
			s.terminals = append(s.terminals, termRes)
		}
	}
	s.mu.Unlock()
	s.notify()
}

func (s *Screen) findTerminal(address string) herdr.Terminal {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, term := range s.terminals {
		if term.Address == address {
			return term
		}
	}
	return herdr.Terminal{Address: address, State: "live"}
}

func (s *Screen) viewDetail(c *ui.Context) {
	t := c.Theme()
	ex := theme.Extra(t)
	addr := s.detailAddress
	term := s.findTerminal(addr)
	st := term.EffectiveStatus()

	s.mu.Lock()
	output := s.detailOutput
	readMeta := s.detailRead
	detailBusy := s.detailBusy
	detailErr := s.detailError
	attMode := s.attachMode
	attActive := s.attach != nil
	s.mu.Unlock()
	actionBusy := s.isBusy(addr)

	// Terminal plate harmonizes with Town Atelier in both Light and Dark themes.
	slabBg := ui.Hex("#161613")
	slabBorder := ex.SubtleBorder
	if t.Dark {
		slabBg = ui.Hex("#0C0C0A")
		slabBorder = ui.RGBA(243, 242, 235, 0.12)
	}
	slabInk := ui.Hex("#F3F2EB")
	slabMuted := ui.Hex("#9A988D")

	ui.Column(c).Fill().Background(t.Background).Children(func() {
		// Compact terminal identity & transport control bar.
		ui.Column(c).FillWidth().Padding(8, 14, 8, 14).Gap(6).Shrink(0).
			BorderWidth(0, 0, 0.75, 0).BorderColor(ex.Divider).Children(func() {
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
				backBtn := components.CompactSecondaryButton(c, i18n.T("terminals.detail.back_list"), theme.IconBack, false)
				backBtn.MinHeight(34)
				if backBtn.Clicked() {
					s.exitDetail()
					return
				}
				ui.Spacer(c)

				// Live Attach toggle button.
				streamLbl := i18n.T("terminals.detail.attach_btn")
				if attActive {
					streamLbl = i18n.T("terminals.detail.detach_btn")
				}
				liveBtn := components.CompactSecondaryButton(c, streamLbl, nil, term.IsFinished())
				liveBtn.MinHeight(34)
				if liveBtn.Clicked() {
					if attActive {
						s.stopAttach()
					} else {
						s.startLiveAttach(addr)
					}
				}

				refBtn := components.CompactSecondaryButton(c, i18n.T("common.refresh"), theme.IconRefresh, detailBusy)
				refBtn.MinHeight(34)
				if refBtn.Clicked() {
					go s.refreshDetailSnapshot(context.Background(), addr)
				}
			})

			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
				ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
					ui.Text(c, term.DisplayName()).FontSize(16).FontWeight(700).TextColor(t.Text).MaxLines(1)
					meta := term.EffectiveApp() + " · " + s.machineLabel(term.EffectiveMachine())
					if cwd := term.EffectiveCwd(); cwd != "" {
						meta += " · " + cwd
					}
					ui.Text(c, meta).FontSize(11.5).TextColor(t.TextMuted).MaxLines(1)
				})
				components.StatusDotPill(c, i18n.StatusLabel(st.State), statusTone(st.State))
				s.viewStreamModePill(c, attMode)
			})

			if detailErr != "" {
				components.ErrorInline(c, detailErr, func() {
					go s.refreshDetailSnapshot(context.Background(), addr)
				})
			}
			if readMeta != nil && !readMeta.Complete && strings.TrimSpace(readMeta.Why) != "" {
				components.StatusBanner(c, components.ToneWarning, i18n.Tf("terminals.detail.partial_hint", map[string]any{
					"how": readMeta.How,
					"why": readMeta.Why,
				}), "", nil)
			}
		})

		// Monospace screen & scrollback reader.
		ui.Box(c).FillWidth().Grow(1).Basis(0).Padding(8, 12, 8, 12).Children(func() {
			plate := ui.Scroll(c.Key("term_screen_"+addr)).Fill().Background(slabBg).Radius(14).
				Border(0.75, slabBorder).TrackScroll(&s.detailScroll)
			plate.Children(func() {
				ui.Column(c).FillWidth().Padding(12, 12).Gap(4).Children(func() {
					if strings.TrimSpace(output) == "" {
						ui.Text(c, i18n.T("terminals.detail.screen_empty")).Font("monospace").FontSize(12).TextColor(slabMuted)
					} else {
						ui.Text(c, output).Font("monospace").FontSize(12).LineHeight(1.4).TextColor(slabInk)
					}
				})
			})
		})

		// Bottom live control dock: quick keys + prompt composer + Interrupt / Kill / Remove.
		ui.Column(c).FillWidth().Background(t.Surface).Padding(8, 12, 10, 12).Gap(8).Shrink(0).
			BorderWidth(0.75, 0, 0, 0).BorderColor(ex.SubtleBorder).Children(func() {
			// Quick key row.
			detailKeys := []struct {
				label string
				key   string
			}{
				{"Enter", "enter"},
				{"Esc", "esc"},
				{"Ctrl+C", "ctrl+c"},
				{"\u2191", "up"},
				{"\u2193", "down"},
				{"Tab", "tab"},
				{"y", "y"},
				{"n", "n"},
			}
			ui.ScrollHorizontal(c).FillWidth().Children(func() {
				ui.Row(c).Gap(6).Children(func() {
					for _, dk := range detailKeys {
						dk := dk
						btn := components.CompactSecondaryButton(c.Key("dk_"+dk.key), dk.label, nil, actionBusy || term.IsFinished())
						btn.MinHeight(34).MinWidth(42)
						if btn.Clicked() {
							s.detailSendKeysAsync(addr, term.DisplayName(), dk.key, dk.label)
						}
					}
				})
			})

			// Prompt composer row.
			ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
				ui.TextInput(c.Key("detail_prompt_"+addr), &s.detailPrompt).Grow(1).Basis(0).MinHeight(42).
					Placeholder(i18n.T("terminals.detail.prompt_placeholder")).
					Label(i18n.T("terminals.detail.prompt_a11y")).
					Disabled(actionBusy || term.IsFinished())
				sendBtn := components.CompactPrimaryButton(c, i18n.T("terminals.blocked.send_btn"), nil, actionBusy || term.IsFinished() || strings.TrimSpace(s.detailPrompt) == "")
				sendBtn.MinHeight(42)
				if sendBtn.Clicked() {
					txt := strings.TrimSpace(s.detailPrompt)
					if txt != "" {
						s.detailSendPromptAsync(addr, term.DisplayName(), txt, term.IsBlocked())
					}
				}
			})

			// Lifecycle controls: Interrupt + Kill (live) or Remove (finished).
			ui.Row(c).FillWidth().Gap(8).Children(func() {
				if !term.IsFinished() {
					intBtn := components.SecondaryTouchButton(c, i18n.T("terminals.detail.interrupt_btn"), actionBusy)
					intBtn.Grow(1).Basis(0).MinHeight(40)
					if intBtn.Clicked() {
						s.interruptTerminalAsync(addr, term.DisplayName())
					}
					killBtn := components.DangerTouchButton(c, i18n.T("terminals.detail.kill_btn"), actionBusy)
					killBtn.Grow(1).Basis(0).MinHeight(40)
					if killBtn.Clicked() {
						s.confirmTargetAdr = addr
						s.confirmTargetNm = term.DisplayName()
						s.killConfirmOpen = true
					}
				} else {
					rmBtn := components.DangerTouchButton(c, i18n.T("terminals.detail.remove_btn"), actionBusy)
					rmBtn.FillWidth().MinHeight(40)
					if rmBtn.Clicked() {
						s.confirmTargetAdr = addr
						s.confirmTargetNm = term.DisplayName()
						s.rmConfirmOpen = true
					}
				}
			})
		})
	})
}

func (s *Screen) viewStreamModePill(c *ui.Context, mode herdr.AttachMode) {
	switch mode {
	case herdr.AttachModeWebSocket:
		components.StatusPill(c, i18n.T("terminals.detail.stream_ws"), components.ToneSuccess)
	case herdr.AttachModePolling:
		components.StatusPill(c, i18n.T("terminals.detail.stream_poll"), components.ToneInfo)
	default:
		components.StatusPill(c, i18n.T("terminals.detail.stream_off"), components.ToneNeutral)
	}
}

func (s *Screen) detailSendPromptAsync(address, displayName, text string, forceBlocked bool) {
	cl, _, _ := s.activeClient()
	if cl == nil {
		return
	}
	if !s.trySetBusy(address) {
		return
	}
	components.HapticLight()
	go func() {
		s.mu.Lock()
		att := s.attach
		attMode := s.attachMode
		s.mu.Unlock()

		var err error
		if !forceBlocked && att != nil && attMode == herdr.AttachModeWebSocket {
			err = att.Send(context.Background(), text)
		} else {
			req := herdr.SendRequest{Address: address, Text: text}
			if forceBlocked {
				req.If = "blocked"
				req.Force = true
			}
			_, err = cl.Send(context.Background(), req)
		}
		s.clearBusy(address)
		if err != nil {
			s.mu.Lock()
			s.detailError = err.Error()
			s.mu.Unlock()
			s.notify()
			return
		}
		components.HapticSuccess()
		s.enqueueUI(func() {
			s.detailPrompt = ""
		})
		s.toast(i18n.Tf("terminals.toast.sent", map[string]any{"name": displayName}))
		s.refreshDetailSnapshot(context.Background(), address)
	}()
}

func (s *Screen) detailSendKeysAsync(address, displayName, key, label string) {
	s.mu.Lock()
	att := s.attach
	attMode := s.attachMode
	s.mu.Unlock()

	if att != nil && attMode == herdr.AttachModeWebSocket {
		if !s.trySetBusy(address) {
			return
		}
		components.HapticLight()
		go func() {
			err := att.Keys(context.Background(), key)
			s.clearBusy(address)
			if err != nil {
				s.mu.Lock()
				s.detailError = err.Error()
				s.mu.Unlock()
				s.notify()
				return
			}
			s.toast(i18n.Tf("terminals.toast.keys_sent", map[string]any{"key": label, "name": displayName}))
		}()
		return
	}
	s.sendKeysAsync(address, displayName, []string{key}, label)
}

func (s *Screen) interruptTerminalAsync(address, displayName string) {
	cl, _, _ := s.activeClient()
	if cl == nil {
		return
	}
	if !s.trySetBusy(address) {
		return
	}
	components.HapticWarning()
	go func() {
		_, err := cl.Interrupt(context.Background(), herdr.InterruptRequest{Address: address, Timeout: 10})
		s.clearBusy(address)
		if err != nil {
			s.mu.Lock()
			s.detailError = err.Error()
			s.mu.Unlock()
			s.notify()
			return
		}
		s.toast(i18n.Tf("terminals.toast.interrupted", map[string]any{"name": displayName}))
		s.refreshDetailSnapshot(context.Background(), address)
		s.Refresh(context.Background())
	}()
}

func (s *Screen) killTerminalAsync(address, displayName string) {
	cl, _, _ := s.activeClient()
	if cl == nil {
		return
	}
	if !s.trySetBusy(address) {
		return
	}
	components.HapticWarning()
	go func() {
		_, err := cl.Kill(context.Background(), address)
		s.clearBusy(address)
		if err != nil {
			s.mu.Lock()
			s.detailError = err.Error()
			s.mu.Unlock()
			s.notify()
			return
		}
		s.stopAttach()
		s.toast(i18n.Tf("terminals.toast.killed", map[string]any{"name": displayName}))
		s.refreshDetailSnapshot(context.Background(), address)
		s.Refresh(context.Background())
	}()
}

func (s *Screen) removeTerminalAsync(address, displayName string) {
	cl, _, _ := s.activeClient()
	if cl == nil {
		return
	}
	if !s.trySetBusy(address) {
		return
	}
	components.HapticWarning()
	go func() {
		_, err := cl.Remove(context.Background(), address)
		s.clearBusy(address)
		if err != nil {
			s.mu.Lock()
			s.detailError = err.Error()
			s.mu.Unlock()
			s.notify()
			return
		}
		s.toast(i18n.Tf("terminals.toast.removed", map[string]any{"name": displayName}))
		s.enqueueUI(func() {
			s.exitDetail()
		})
		s.Refresh(context.Background())
	}()
}

func (s *Screen) viewKillConfirmSheet(c *ui.Context) {
	addr := s.confirmTargetAdr
	name := s.confirmTargetNm
	components.ActionSheet(c, &s.killConfirmOpen, mobile.ActionSheetOptions{
		Title:   i18n.Tf("terminals.detail.kill_title", map[string]any{"name": name}),
		Message: i18n.T("terminals.detail.kill_body"),
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("terminals.detail.kill_confirm"),
		Destructive: true,
		OnTap: func() {
			s.killTerminalAsync(addr, name)
		},
	})
}

func (s *Screen) viewRemoveConfirmSheet(c *ui.Context) {
	addr := s.confirmTargetAdr
	name := s.confirmTargetNm
	components.ActionSheet(c, &s.rmConfirmOpen, mobile.ActionSheetOptions{
		Title:   i18n.Tf("terminals.detail.remove_title", map[string]any{"name": name}),
		Message: i18n.T("terminals.detail.remove_body"),
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("terminals.detail.remove_confirm"),
		Destructive: true,
		OnTap: func() {
			s.removeTerminalAsync(addr, name)
		},
	})
}
