package terminals

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/herdr"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

const maxTerminalBufferBytes = 256 * 1024

func (s *Screen) enterDetail(address string) {
	s.stopAttach()
	s.detailAddress = address
	s.detailPrompt = ""
	s.interruptConfirmOpen = false
	s.killConfirmOpen = false
	s.rmConfirmOpen = false
	s.detailScroll.X = 0
	s.detailScroll.Y = 0

	s.mu.Lock()
	s.detailOutput = ""
	s.detailRead = nil
	s.detailError = ""
	s.detailNotice = ""
	s.detailNoticeTone = components.ToneSuccess
	s.detailBusy = true
	s.detailScrollBottom = true
	s.attachAddr = address
	s.mu.Unlock()

	go s.refreshDetailSnapshot(context.Background(), address)
}

func (s *Screen) exitDetail() {
	s.stopAttach()
	s.detailAddress = ""
	s.detailPrompt = ""
	s.interruptConfirmOpen = false
	s.killConfirmOpen = false
	s.rmConfirmOpen = false
	s.mu.Lock()
	s.attachAddr = ""
	s.detailError = ""
	s.detailNotice = ""
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
			clean := herdr.SanitizeTerminalText(out.Text)
			s.mu.Lock()
			if s.attachAddr != address {
				s.mu.Unlock()
				return
			}
			if out.Replace {
				s.detailOutput = clean
				cp := herdr.ReadResult{
					Text:     clean,
					Complete: out.Complete,
					How:      out.How,
					Why:      out.Why,
				}
				s.detailRead = &cp
			} else {
				combined := s.detailOutput + clean
				if len(combined) > maxTerminalBufferBytes {
					combined = combined[len(combined)-maxTerminalBufferBytes:]
				}
				s.detailOutput = combined
			}
			s.detailBusy = false
			s.detailError = ""
			s.detailScrollBottom = true
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
				if mode == herdr.AttachModeWebSocket || mode == herdr.AttachModePolling {
					s.detailError = ""
				}
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
				s.detailError = presentHerdrError(err)
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
				s.detailError = presentHerdrError(err)
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
		clean := herdr.SanitizeTerminalText(readRes.Text)
		cp := readRes
		cp.Text = clean
		s.detailRead = &cp
		s.detailOutput = clean
		s.detailError = ""
		s.detailScrollBottom = true
	} else {
		s.detailError = presentHerdrError(readErr)
	}
	if termErr == nil && termRes.Address != "" {
		s.upsertTerminalLocked(termRes)
	}
	s.mu.Unlock()
	s.notify()
}

func (s *Screen) upsertTerminalLocked(term herdr.Terminal) {
	for i := range s.terminals {
		if s.terminals[i].Address == term.Address {
			s.terminals[i] = term
			return
		}
	}
	s.terminals = append(s.terminals, term)
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
	m := layout.Of(c)
	addr := s.detailAddress
	term := s.findTerminal(addr)
	st := term.EffectiveStatus()

	s.mu.Lock()
	output := s.detailOutput
	readMeta := s.detailRead
	detailBusy := s.detailBusy
	detailErr := s.detailError
	detailNotice := s.detailNotice
	detailNoticeTone := s.detailNoticeTone
	attMode := s.attachMode
	attActive := s.attach != nil
	wantBottom := s.detailScrollBottom
	s.detailScrollBottom = false
	s.mu.Unlock()
	actionBusy := s.isBusy(addr)

	if wantBottom {
		s.detailScroll.Y = math.MaxFloat32
	}

	plateCol := TerminalPlateColors(t)
	lineCount := countTerminalLines(output)

	ui.Column(c).Fill().Background(t.Background).Children(func() {
		// Compact terminal identity & transport control header.
		layout.ReadableWrap(c, m.ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(8, 14, 8, 14).Gap(7).Shrink(0).
				BorderWidth(0, 0, 0.75, 0).BorderColor(ex.Divider).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
					backBtn := components.CompactSecondaryButton(c, i18n.T("terminals.detail.back_list"), theme.IconBack, false)
					backBtn.MinHeight(40)
					if backBtn.Clicked() {
						components.HapticLight()
						s.exitDetail()
						return
					}
					ui.Spacer(c)

					// Live Attach toggle button (shows luminous dot when actively streaming/polling).
					streamLbl := i18n.T("terminals.detail.attach_btn")
					if attActive {
						streamLbl = i18n.T("terminals.detail.detach_btn")
					}
					liveDisabled := term.IsFinished()
					liveBg := ex.ElevatedBg
					liveFg := t.Text
					if liveDisabled {
						liveBg, liveFg, _ = DisabledButtonColors(t)
					} else if attActive {
						liveBg = t.Accent
						liveFg = t.AccentText
					}
					liveBtn := ui.Row(c.Key("detail_live_toggle")).MinHeight(40).Padding(7, 12).Radius(999).
						Background(liveBg).AlignItems(ui.Center).Justify(ui.Center).Gap(6).Shrink(0).
						Role(ui.RoleButton).Label(streamLbl).Checked(attActive).Disabled(liveDisabled)
					if !liveDisabled && !attActive {
						components.ApplyCardElevation(liveBtn, t)
					} else if liveDisabled {
						liveBtn.Border(0.75, ex.SubtleBorder)
					}
					if !liveDisabled && liveBtn.Pressed() {
						liveBtn.Scale(0.97, 0.97)
					}
					liveBtn.Children(func() {
						if attActive {
							dot := t.Success
							if attMode == herdr.AttachModePolling {
								dot = ex.Info
							}
							ui.Box(c).Size(6, 6).Radius(3).Background(dot).Shrink(0)
						}
						ui.Text(c, streamLbl).FontSize(12.5).FontWeight(600).TextColor(liveFg).NoWrap()
					})
					if liveBtn.Clicked() {
						components.HapticLight()
						if attActive {
							s.stopAttach()
						} else {
							s.startLiveAttach(addr)
						}
					}

					refBtn := components.CompactSecondaryButton(c, i18n.T("common.refresh"), theme.IconRefresh, detailBusy)
					refBtn.MinHeight(40)
					if refBtn.Clicked() {
						components.HapticLight()
						go s.refreshDetailSnapshot(context.Background(), addr)
					}
				})

				ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, term.DisplayName()).FontSize(16.5).FontWeight(700).LetterSpacing(-0.2).TextColor(t.Text).MaxLines(1)
						meta := term.EffectiveApp() + " · " + s.machineLabel(term.EffectiveMachine())
						if cwd := term.EffectiveCwd(); cwd != "" {
							meta += " · " + cwd
						}
						ui.Text(c, meta).FontSize(11.5).TextColor(t.TextMuted).MaxLines(1)
					})
					components.StatusDotPill(c, i18n.StatusLabel(st.State), statusTone(st.State))
				})

				// Contextual OSC 7501 approval or working progress banner.
				if term.IsBlocked() {
					msg := strings.TrimSpace(st.Msg)
					if msg == "" {
						msg = i18n.T("terminals.blocked.prompt_fallback")
					}
					ui.Column(c).FillWidth().Padding(9, 11).Radius(11).Background(ex.BrandTint).
						Border(0.75, ex.Brand.Alpha(0.30)).Gap(2).Children(func() {
						ui.Text(c, i18n.T("terminals.detail.blocked_label")).FontSize(11).FontWeight(600).TextColor(ex.BrandText)
						ui.Text(c, msg).FontSize(13).FontWeight(600).LineHeight(1.35).TextColor(t.Text).MaxLines(3)
					})
				} else if pct, hasProg := st.ProgressPercent(); hasProg && !term.IsFinished() {
					ui.Column(c).FillWidth().Padding(8, 10).Radius(10).Background(ex.MutedBg).
						Border(0.75, ex.SubtleBorder).Gap(5).Children(func() {
						if msg := strings.TrimSpace(st.Msg); msg != "" {
							ui.Text(c, msg).FontSize(12).FontWeight(500).TextColor(t.Text).MaxLines(1)
						}
						ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(8).Children(func() {
							ui.Progress(c, float64(pct)/100.0).Grow(1).Basis(0).Height(6)
							ui.Text(c, fmt.Sprintf("%d%%", pct)).FontSize(11.5).FontWeight(600).TextColor(ex.Info).NoWrap()
						})
					})
				}

				if detailNotice != "" {
					components.StatusBanner(c, detailNoticeTone, detailNotice, i18n.T("common.ok"), func() {
						s.mu.Lock()
						s.detailNotice = ""
						s.mu.Unlock()
					})
				}
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
		})

		// Monospace screen & scrollback plate with integrated toolbar (stream beacon, wrap/scroll, jump-to-bottom).
		ui.Box(c).FillWidth().Grow(1).Basis(0).Padding(8, 12, 8, 12).Children(func() {
			frame := ui.Column(c).Fill().Background(plateCol.Bg).Radius(14).Border(0.75, plateCol.Border).Clip()
			if m.ReadableMaxWidth > 0 {
				frame.MaxWidth(m.ReadableMaxWidth).AlignSelf(ui.Center)
			}
			frame.Children(func() {
				// Slim dark plate toolbar.
				ui.Row(c).FillWidth().Background(plateCol.HeaderBg).Padding(6, 10).Gap(6).
					AlignItems(ui.Center).BorderWidth(0, 0, 0.75, 0).BorderColor(plateCol.Border).Shrink(0).Children(func() {
					dotCol := plateCol.Muted
					switch attMode {
					case herdr.AttachModeWebSocket:
						dotCol = ui.Hex("#64BF7A")
					case herdr.AttachModePolling:
						dotCol = ui.Hex("#6CB2EA")
					}
					ui.Box(c).Size(7, 7).Radius(3.5).Background(dotCol).Shrink(0)
					ui.Text(c, streamModeLabel(attMode)).FontSize(11.5).FontWeight(600).TextColor(plateCol.Ink).NoWrap()
					if lineCount > 0 {
						ui.Text(c, "· "+i18n.Tf("terminals.detail.lines_count", map[string]any{"count": lineCount})).
							FontSize(11).TextColor(plateCol.Muted).NoWrap()
					}
					ui.Spacer(c)

					// Wrap vs horizontal-pan toggle.
					wrapLbl := i18n.T("terminals.detail.wrap_off")
					if s.detailWrap {
						wrapLbl = i18n.T("terminals.detail.wrap_on")
					}
					wrapBtn := ui.Row(c.Key("plate_wrap_toggle")).MinHeight(28).Padding(4, 9).Radius(999).
						Background(plateCol.PillBg).AlignItems(ui.Center).Justify(ui.Center).Shrink(0).
						Role(ui.RoleButton).Label(wrapLbl).Checked(s.detailWrap)
					if wrapBtn.Pressed() {
						wrapBtn.Scale(0.96, 0.96)
					}
					wrapBtn.Children(func() {
						ui.Text(c, wrapLbl).FontSize(11).FontWeight(600).TextColor(plateCol.Ink).NoWrap()
					})
					if wrapBtn.Clicked() {
						components.HapticLight()
						s.detailWrap = !s.detailWrap
						s.detailScroll.X = 0
					}

					// Quick jump-to-bottom pill.
					bottomLbl := i18n.T("terminals.detail.jump_bottom")
					botBtn := ui.Row(c.Key("plate_jump_bottom")).MinHeight(28).Padding(4, 9).Radius(999).
						Background(plateCol.PillBg).AlignItems(ui.Center).Justify(ui.Center).Shrink(0).
						Role(ui.RoleButton).Label(bottomLbl)
					if botBtn.Pressed() {
						botBtn.Scale(0.96, 0.96)
					}
					botBtn.Children(func() {
						ui.Text(c, "\u2193 "+bottomLbl).FontSize(11).FontWeight(600).TextColor(plateCol.Ink).NoWrap()
					})
					if botBtn.Clicked() {
						components.HapticLight()
						s.detailScroll.Y = math.MaxFloat32
						s.detailScroll.X = 0
					}
				})

				// Terminal scrollback content: ScrollBoth + NoWrap by default for zero mangled lines on 390px.
				if strings.TrimSpace(output) == "" {
					ui.Column(c).FillWidth().Grow(1).Basis(0).Padding(12, 12).Children(func() {
						ui.Text(c, i18n.T("terminals.detail.screen_empty")).Font("monospace").FontSize(11.5).TextColor(plateCol.Muted)
					})
				} else if s.detailWrap {
					ui.Scroll(c.Key("term_screen_wrap_"+addr)).FillWidth().Grow(1).Basis(0).TrackScroll(&s.detailScroll).Children(func() {
						ui.Column(c).FillWidth().Padding(10, 12, 14, 12).Children(func() {
							ui.Text(c, output).Font("monospace").FontSize(11.5).LineHeight(1.48).TextColor(plateCol.Ink)
						})
					})
				} else {
					scrollBox := ui.ScrollBoth(c.Key("term_screen_both_"+addr)).FillWidth().Grow(1).Basis(0).TrackScroll(&s.detailScroll)
					if s.detailScroll.MaxX > 2 && s.detailScroll.X < s.detailScroll.MaxX-2 {
						bgCol := plateCol.Bg
						scrollBox.DrawOver(func(p *ui.Painter, r ui.Rect) {
							// Subtle right-edge scroll cue when wide terminal lines pan horizontally.
							p.Fill(ui.Rect{X: r.X + r.W - 14, Y: r.Y, W: 14, H: r.H}, bgCol.Alpha(0.65), 0)
							p.Fill(ui.Rect{X: r.X + r.W - 6, Y: r.Y, W: 6, H: r.H}, bgCol.Alpha(0.90), 0)
						})
					}
					scrollBox.Children(func() {
						ui.Column(c).Padding(10, 16, 14, 12).Children(func() {
							ui.Text(c, output).Font("monospace").FontSize(11.5).LineHeight(1.48).TextColor(plateCol.Ink).NoWrap()
						})
					})
				}
			})
		})

		// Bottom live control dock: >=44pt quick keys + prompt composer + confirmed Interrupt / Kill / Remove.
		ui.Column(c).FillWidth().Background(t.Surface).Padding(8, 12, 10, 12).Gap(8).Shrink(0).
			BorderWidth(0.75, 0, 0, 0).BorderColor(ex.SubtleBorder).Children(func() {
			layout.ReadableWrap(c, m.ReadableMaxWidth, func() {
				ui.Column(c).FillWidth().Gap(8).Children(func() {
					// Quick key row (>=44pt height & width; fits Enter, Esc, Ctrl+C, Up, Down, y, n on 390px).
					detailKeys := []struct {
						label   string
						key     string
						primary bool
					}{
						{"Enter", "enter", term.IsBlocked()},
						{"Esc", "esc", false},
						{"Ctrl+C", "ctrl+c", false},
						{"\u2191", "up", false},
						{"\u2193", "down", false},
						{"y", "y", term.IsBlocked()},
						{"n", "n", false},
						{"Tab", "tab", false},
					}
					ui.ScrollHorizontal(c).FillWidth().Children(func() {
						ui.Row(c).Gap(5).Padding(1, 1).Children(func() {
							for _, dk := range detailKeys {
								dk := dk
								btn := quickKeyButton(c, "dk_"+dk.key, dk.label, dk.primary, actionBusy || term.IsFinished())
								if dk.key == "ctrl+c" {
									btn.Padding(8, 9)
								}
								if btn.Clicked() {
									s.detailSendKeysAsync(addr, term.DisplayName(), dk.key, dk.label)
								}
							}
						})
					})

					// >=44pt Prompt composer row.
					ui.Row(c).FillWidth().AlignItems(ui.Center).Gap(6).Children(func() {
						ui.TextInput(c.Key("detail_prompt_"+addr), &s.detailPrompt).Grow(1).Basis(0).MinHeight(44).
							Placeholder(i18n.T("terminals.detail.prompt_placeholder")).
							Label(i18n.T("terminals.detail.prompt_a11y")).
							Disabled(actionBusy || term.IsFinished())
						sendLbl := i18n.T("terminals.blocked.send_btn")
						if actionBusy {
							sendLbl = i18n.T("terminals.sending")
						}
						sendBtn := sendTouchButton(c, "detail_send_"+addr, sendLbl, actionBusy || term.IsFinished() || strings.TrimSpace(s.detailPrompt) == "")
						if sendBtn.Clicked() {
							txt := strings.TrimSpace(s.detailPrompt)
							if txt != "" {
								s.detailSendPromptAsync(term, txt)
							}
						}
					})

					// >=44pt Lifecycle controls: Interrupt + Kill (live) or Remove (finished), all ActionSheet-confirmed.
					ui.Row(c).FillWidth().Gap(8).Children(func() {
						if !term.IsFinished() {
							intBtn := components.SecondaryTouchButton(c, i18n.T("terminals.detail.interrupt_btn"), actionBusy)
							intBtn.Grow(1).Basis(0)
							if intBtn.Clicked() {
								components.HapticLight()
								s.confirmTargetAdr = addr
								s.confirmTargetNm = term.DisplayName()
								s.interruptConfirmOpen = true
							}
							killBtn := components.DangerTouchButton(c, i18n.T("terminals.detail.kill_btn"), actionBusy)
							killBtn.Grow(1).Basis(0)
							if killBtn.Clicked() {
								components.HapticLight()
								s.confirmTargetAdr = addr
								s.confirmTargetNm = term.DisplayName()
								s.killConfirmOpen = true
							}
						} else {
							rmBtn := components.DangerTouchButton(c, i18n.T("terminals.detail.remove_btn"), actionBusy)
							rmBtn.FillWidth()
							if rmBtn.Clicked() {
								components.HapticLight()
								s.confirmTargetAdr = addr
								s.confirmTargetNm = term.DisplayName()
								s.rmConfirmOpen = true
							}
						}
					})
				})
			})
		})
	})
}

func streamModeLabel(mode herdr.AttachMode) string {
	switch mode {
	case herdr.AttachModeWebSocket:
		return i18n.T("terminals.detail.stream_ws")
	case herdr.AttachModePolling:
		return i18n.T("terminals.detail.stream_poll")
	default:
		return i18n.T("terminals.detail.stream_off")
	}
}

func countTerminalLines(text string) int {
	trimmed := strings.TrimRight(text, "\n")
	if trimmed == "" {
		return 0
	}
	return strings.Count(trimmed, "\n") + 1
}

func (s *Screen) detailSendPromptAsync(term herdr.Terminal, text string) {
	cl, _, _ := s.activeClient()
	if cl == nil {
		return
	}
	address := term.Address
	displayName := term.DisplayName()
	forceBlocked := term.IsBlocked()
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
				if term.Turn > 0 {
					turn := term.Turn
					req.Turn = &turn
				}
			}
			_, err = cl.Send(context.Background(), req)
		}
		s.clearBusy(address)
		if err != nil {
			components.HapticWarning()
			if errors.Is(err, herdr.ErrPreconditionFailed) {
				staleMsg := i18n.Tf("terminals.toast.cas_stale", map[string]any{"name": displayName})
				s.mu.Lock()
				s.detailNotice = staleMsg
				s.detailNoticeTone = components.ToneWarning
				s.detailError = ""
				s.mu.Unlock()
				s.toast(staleMsg)
				s.refreshDetailSnapshot(context.Background(), address)
				s.Refresh(context.Background())
				return
			}
			s.mu.Lock()
			s.detailError = presentHerdrError(err)
			s.mu.Unlock()
			s.notify()
			return
		}
		components.HapticSuccess()
		s.mu.Lock()
		s.detailError = ""
		s.detailScrollBottom = true
		if forceBlocked {
			s.detailNotice = i18n.Tf("terminals.toast.delivered", map[string]any{"name": displayName})
			s.detailNoticeTone = components.ToneSuccess
		}
		s.mu.Unlock()
		s.enqueueUI(func() {
			s.detailPrompt = ""
		})
		if forceBlocked {
			s.toast(i18n.Tf("terminals.toast.delivered", map[string]any{"name": displayName}))
		} else {
			s.toast(i18n.Tf("terminals.toast.sent", map[string]any{"name": displayName}))
		}
		s.refreshDetailSnapshot(context.Background(), address)
		if forceBlocked {
			s.Refresh(context.Background())
		}
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
				components.HapticWarning()
				s.mu.Lock()
				s.detailError = presentHerdrError(err)
				s.mu.Unlock()
				s.notify()
				return
			}
			components.HapticSuccess()
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
			s.detailError = presentHerdrError(err)
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
			s.detailError = presentHerdrError(err)
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
			s.detailError = presentHerdrError(err)
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

func (s *Screen) viewInterruptConfirmSheet(c *ui.Context) {
	addr := s.confirmTargetAdr
	name := s.confirmTargetNm
	components.ActionSheet(c, &s.interruptConfirmOpen, mobile.ActionSheetOptions{
		Title:   i18n.Tf("terminals.detail.interrupt_title", map[string]any{"name": name}),
		Message: i18n.T("terminals.detail.interrupt_body"),
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("terminals.detail.interrupt_confirm"),
		Destructive: true,
		OnTap: func() {
			s.interruptTerminalAsync(addr, name)
		},
	})
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
