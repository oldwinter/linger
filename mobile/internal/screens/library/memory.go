package library

import (
	"bytes"
	"context"
	"errors"
	"strings"

	"github.com/egoist/mygo/audio"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/realtime"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

var memoryFilterKeys = []string{
	"library.memory.filter_all",
	"library.memory.filter_daily",
	"library.memory.filter_weekly",
	"library.memory.filter_meetings",
}
var memoryFilterKinds = []string{"", "daily", "weekly", "meeting"}

func (s *Screen) viewMemorySegment(c *ui.Context) {
	t := c.Theme()

	s.mu.Lock()
	entries := append([]api.PersonalMemoryEntryC2(nil), s.memoryEntries...)
	activeCap := s.activeCapture
	s.mu.Unlock()

	wantKind := memoryFilterKinds[s.memoryFilter%len(memoryFilterKinds)]
	var filtered []api.PersonalMemoryEntryC2
	for _, e := range entries {
		if wantKind == "" || e.Kind == wantKind {
			filtered = append(filtered, e)
		}
	}

	m := layout.Of(c)

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SegmentMemory]).Children(func() {
		layout.ReadableWrap(c, m.ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
				// Active Voice Capture banner when recording
				if activeCap != nil {
					components.SectionCard(c, i18n.T("library.memory.active_capture"), i18n.Tf("library.memory.room_line", map[string]any{"id": activeCap.RoomID}), func() {
						components.StatusPill(c, i18n.StatusLabel(activeCap.Status), components.ToneSuccess)
					}, func() {
						btn := components.PrimaryTouchButton(c, i18n.T("library.memory.open_transcript"), false)
						btn.FillWidth()
						if btn.Clicked() {
							s.openVoiceCapture(*activeCap)
						}
					})
				}

				// Filter pills
				memLabels := make([]string, len(memoryFilterKeys))
				for i, k := range memoryFilterKeys {
					memLabels[i] = i18n.T(k)
				}
				components.FilterPillBar(c, &s.memoryFilter, memLabels...)

				if len(filtered) == 0 {
					components.EmptyState(c, theme.IconLive, i18n.T("library.memory.empty_title"),
						i18n.T("library.memory.empty_body"), "", nil)
					return
				}

				layout.TwoColumnCards(c, m.GridColumns, 10, len(filtered), func(i int) {
					entry := filtered[i]
					row := ui.Column(c.Key(entry.ID)).FillWidth().Padding(13, 14).Gap(6).
						Radius(16).Background(t.Surface).
						Role(ui.RoleButton).Label(i18n.Tf("library.memory.entry_a11y", map[string]any{"title": entry.Title}))
					components.ApplyCardElevation(row, t)
					if row.Pressed() {
						row.Background(t.SurfacePressed)
					}
					row.Children(func() {
						ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
							ui.Text(c, entry.Title).FontSize(15).FontWeight(600).LetterSpacing(-0.15).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
							components.StatusDotPill(c, i18n.MemoryKindLabel(entry.Kind), components.ToneInfo)
						})
						if entry.Summary != "" {
							ui.Text(c, entry.Summary).FontSize(13).LineHeight(1.38).TextColor(t.TextMuted).MaxLines(2)
						}
						if entry.Meeting != nil {
							ui.Row(c).Wrap().Gap(6).Children(func() {
								components.StatusDotPill(c, i18n.T("library.memory.voice_capture_title"), components.ToneSuccess)
								if entry.Meeting.RecordingFilename != "" {
									components.StatusPill(c, entry.Meeting.RecordingFilename, components.ToneNeutral)
								}
							})
						}
					})
					if row.Clicked() {
						s.openMemoryEntry(entry)
					}
				})
			})
		})
	})
}

func (s *Screen) openMemoryEntry(entry api.PersonalMemoryEntryC2) {
	cp := entry
	s.memoryDetailEntry = &cp
	s.memoryDetailOpen = true

	client := s.client()
	tenantID := s.tenantID()
	if client != nil && tenantID != "" {
		go func() {
			if full, err := client.GetPersonalMemoryEntry(context.Background(), tenantID, entry.ID); err == nil {
				s.enqueueUI(func() {
					f := full
					s.memoryDetailEntry = &f
				})
			}
		}()
	}
}

func (s *Screen) viewMemoryDetailSheet(c *ui.Context) {
	t := c.Theme()
	mobile.Sheet(c, &s.memoryDetailOpen, mobile.SheetOptions{
		Detents: []float32{0.82, 0.96},
		Label:   i18n.T("library.memory.journal_detail_title"),
	}, func() {
		entry := s.memoryDetailEntry
		if entry == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Text(c, entry.Title).FontSize(18).Bold().TextColor(t.Text).Grow(1).Basis(0)
					components.StatusPill(c, i18n.MemoryKindLabel(entry.Kind), components.ToneInfo)
				})
				if entry.Path != "" {
					ui.Text(c, entry.Path).FontSize(11).TextColor(t.TextMuted)
				}
				if entry.Meeting != nil {
					mt := entry.Meeting
					components.SectionCard(c, i18n.T("library.memory.meeting_card_title"), mt.RecordingFilename, nil, func() {
						openCapBtn := components.PrimaryTouchButton(c, i18n.T("library.memory.open_meeting_btn"), false)
						openCapBtn.FillWidth()
						if openCapBtn.Clicked() {
							s.memoryDetailOpen = false
							s.openVoiceCaptureByID(mt.CaptureID)
						}
					})
				}
				ui.Divider(c)
				body := entry.Content
				if strings.TrimSpace(body) == "" {
					body = entry.Summary
				}
				markdown.View(c, body, &s.mdOpts).FillWidth()
			})
		})
	})
}

func (s *Screen) openVoiceCaptureByID(captureID string) {
	s.openVoiceCapture(api.VoiceCapture{ID: captureID, Status: "loading"})
}

func (s *Screen) openVoiceCapture(vc api.VoiceCapture) {
	cp := vc
	s.voiceCapture = &cp
	s.voiceSessionID = vc.VoiceSessionID
	s.voiceSheetOpen = true
	s.voiceErr = ""
	s.voiceTranscripts = nil
	s.voicePartial = ""
	s.voiceQuestions = nil
	s.voiceAudioStatus = ""
	s.voiceAudioPlaying = false
	s.voiceAudioLoaded = false
	s.stopAudioAndStream()

	client := s.client()
	if client == nil {
		return
	}
	s.voiceBusy = true
	go func() {
		ctx := context.Background()
		latest, gErr := client.GetVoiceCapture(ctx, vc.ID)
		if gErr == nil {
			vc = latest
		}
		var trEvents []api.VoiceTranscriptEvent
		var partial string
		if vc.VoiceSessionID != "" {
			if page, err := client.ListVoiceTranscriptEvents(ctx, vc.VoiceSessionID); err == nil {
				trEvents = page.Items
				if page.PartialTranscript != nil {
					partial = *page.PartialTranscript
				}
			}
		}
		qs, _ := client.ListVoiceCaptureQuestions(ctx, vc.ID)

		s.enqueueUI(func() {
			s.voiceBusy = false
			if gErr == nil {
				l := latest
				s.voiceCapture = &l
				s.voiceSessionID = latest.VoiceSessionID
			}
			s.voiceTranscripts = trEvents
			s.voicePartial = partial
			s.voiceQuestions = qs
			if vc.VoiceSessionID != "" {
				s.startVoiceSSE(vc.VoiceSessionID)
			}
		})
	}()
}

func (s *Screen) startVoiceSSE(sessionID string) {
	client := s.client()
	if client == nil || sessionID == "" {
		return
	}
	s.stopAudioAndStream()

	streamCtx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.voiceStreamCancel = cancel
	s.mu.Unlock()

	vs := realtime.NewVoiceSessionStream(client, sessionID, realtime.VoiceStreamCallbacks{
		OnEvents: func(page api.VoiceEventPage) {
			s.enqueueUI(func() {
				for _, ev := range page.Items {
					if ev.Capture != nil {
						cp := *ev.Capture
						s.voiceCapture = &cp
					}
					if ev.Transcript != nil {
						s.voiceTranscripts = append(s.voiceTranscripts, *ev.Transcript)
					}
				}
			})
		},
		OnPartial: func(partial api.VoiceTranscriptEventPage) {
			if partial.PartialTranscript != nil {
				txt := *partial.PartialTranscript
				s.enqueueUI(func() { s.voicePartial = txt })
			}
		},
	})

	go func() {
		_ = vs.RunOnce(streamCtx)
	}()
}

func (s *Screen) stopAudioAndStream() {
	s.mu.Lock()
	s.audioGen++
	cancel := s.voiceStreamCancel
	s.voiceStreamCancel = nil
	player := s.audioPlayer
	s.audioPlayer = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if player != nil {
		player.Stop()
		player.Close()
	}
}

func (s *Screen) viewVoiceCaptureSheet(c *ui.Context) {
	t := c.Theme()
	wasOpen := s.voiceSheetOpen
	mobile.Sheet(c, &s.voiceSheetOpen, mobile.SheetOptions{
		Detents: []float32{0.86, 0.96},
		Label:   i18n.T("library.memory.voice_sheet_a11y"),
	}, func() {
		vc := s.voiceCapture
		if vc == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Text(c, i18n.Tf("library.memory.voice_header", map[string]any{"id": vc.ID})).FontSize(17).Bold().TextColor(t.Text).Grow(1).Basis(0)
					components.StatusPill(c, i18n.StatusLabel(vc.Status), components.ToneInfo)
				})

				if s.voiceErr != "" {
					components.StatusBanner(c, components.ToneDanger, s.voiceErr, i18n.T("common.dismiss"), func() {
						s.voiceErr = ""
					})
				}

				ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
					if vc.Status == "recording" || vc.Status == "active" {
						stopBtn := components.DangerTouchButton(c, i18n.T("library.memory.stop_capture"), s.voiceBusy)
						if stopBtn.Clicked() {
							s.stopCaptureAsync(vc.ID)
						}
					}
					if vc.GapCount > 0 || (vc.TranscriptRecoveryStatus != nil && *vc.TranscriptRecoveryStatus == "needed") {
						recBtn := components.SecondaryTouchButton(c, i18n.T("library.memory.retry_recovery"), s.voiceBusy)
						if recBtn.Clicked() {
							s.retryTranscriptRecoveryAsync(vc.ID)
						}
					}
				})

				// Recorded Audio Playback section
				components.SectionCard(c, i18n.T("library.memory.recorded_audio"), "", nil, func() {
					if s.voiceAudioStatus != "" {
						ui.Text(c, s.voiceAudioStatus).FontSize(12).TextColor(t.TextMuted)
					}
					ui.Row(c).FillWidth().Gap(8).Children(func() {
						if !s.voiceAudioLoaded {
							verID := ""
							if vc.AudioDocumentVersionID != nil {
								verID = strings.TrimSpace(*vc.AudioDocumentVersionID)
							}
							if verID == "" && s.voiceAudioStatus == "" {
								ui.Text(c, i18n.T("library.memory.no_audio")).FontSize(12).TextColor(t.TextMuted).Grow(1).Basis(0)
							} else {
								playBtn := components.SecondaryTouchButton(c, i18n.T("library.memory.load_audio"), s.voiceBusy || verID == "")
								playBtn.Grow(1).Basis(0)
								if playBtn.Clicked() {
									s.loadAudioVersion(verID)
								}
							}
						} else {
							lbl := i18n.T("library.memory.play")
							if s.voiceAudioPlaying {
								lbl = i18n.T("library.memory.pause")
							}
							toggleBtn := components.PrimaryTouchButton(c, lbl, false)
							toggleBtn.Grow(1).Basis(0)
							if toggleBtn.Clicked() {
								s.toggleAudioPlayback()
							}
							stopAudioBtn := components.SecondaryTouchButton(c, i18n.T("library.memory.stop_audio"), false)
							if stopAudioBtn.Clicked() {
								s.stopAudioPlayerOnly()
							}
						}
					})
				})

				// Live & Historical Transcript
				components.SectionCard(c, i18n.Tf("library.memory.transcript_title", map[string]any{"count": len(s.voiceTranscripts)}), "", nil, func() {
					if len(s.voiceTranscripts) == 0 && s.voicePartial == "" {
						ui.Text(c, i18n.T("library.memory.transcript_waiting")).FontSize(13).TextColor(t.TextMuted)
					} else {
						for _, tr := range s.voiceTranscripts {
							speaker := tr.Lane
							if tr.SpeakerID != nil && *tr.SpeakerID != "" {
								speaker = *tr.SpeakerID
							}
							ui.Text(c, "["+speaker+"] "+tr.Text).FontSize(13).TextColor(t.Text)
						}
						if s.voicePartial != "" {
							ui.Text(c, i18n.Tf("library.memory.live_prefix", map[string]any{"text": s.voicePartial})).FontSize(13).TextColor(t.Accent)
						}
					}
				})

				// Meeting Q&A
				components.SectionCard(c, i18n.T("library.memory.ask_qa_title"), "", nil, func() {
					ta := ui.TextArea(c, &s.voiceQuestionDraft).FillWidth().MinHeight(64).
						Placeholder(i18n.T("library.memory.qa_placeholder")).Label(i18n.T("library.memory.meeting_a11y"))
					// Snapshot IME composing state during build; ui.Element handles expire before OnTextKey runs.
					composing := ta.Composing()
					ta.OnTextKey(func(k ui.TextKey) bool {
						if k.Key != ui.KeyEnter || composing || k.Mods != 0 {
							return false
						}
						q := strings.TrimSpace(k.Text())
						if q == "" {
							return true
						}
						k.SetText("")
						s.voiceQuestionDraft = ""
						s.askVoiceQuestionAsync(vc.ID, q)
						return true
					})
					askBtn := components.PrimaryTouchButton(c, i18n.T("library.memory.ask_btn"), s.voiceBusy || strings.TrimSpace(s.voiceQuestionDraft) == "")
					askBtn.FillWidth()
					if askBtn.Clicked() {
						s.askVoiceQuestionAsync(vc.ID, s.voiceQuestionDraft)
					}

					for _, q := range s.voiceQuestions {
						q := q
						ui.Column(c.Key(q.ID)).FillWidth().Padding(10, 10).Radius(10).Background(theme.Extra(t).MutedBg).Gap(4).Children(func() {
							ui.Text(c, i18n.Tf("library.memory.q_prefix", map[string]any{"text": q.Question})).FontSize(13).FontWeight(600).TextColor(t.Text)
							if q.Answered {
								ui.Text(c, i18n.Tf("library.memory.a_prefix", map[string]any{"text": q.Answer})).FontSize(13).TextColor(t.TextMuted)
							} else {
								ui.Text(c, i18n.T("library.memory.answering")).FontSize(12).TextColor(t.Accent)
							}
							taskBtn := components.SecondaryTouchButton(c, i18n.T("library.memory.send_to_task"), q.TaskTitle != nil)
							taskBtn.MinHeight(32)
							if taskBtn.Clicked() {
								s.sendVoiceQuestionTaskAsync(vc.ID, q.ID)
							}
						})
					}
				})
			})
		})
	})
	if wasOpen && !s.voiceSheetOpen {
		s.stopAudioAndStream()
	}
}

func (s *Screen) stopCaptureAsync(captureID string) {
	client := s.client()
	if client == nil {
		return
	}
	s.voiceBusy = true
	go func() {
		updated, err := client.StopVoiceCapture(context.Background(), captureID)
		s.enqueueUI(func() {
			s.voiceBusy = false
			if err != nil {
				s.voiceErr = api.PresentError(err)
				return
			}
			cp := updated
			s.voiceCapture = &cp
			s.toast(i18n.T("library.memory.toast.capture_stopped"))
		})
	}()
}

func (s *Screen) retryTranscriptRecoveryAsync(captureID string) {
	client := s.client()
	if client == nil {
		return
	}
	s.voiceBusy = true
	go func() {
		updated, err := client.RetryVoiceCaptureTranscript(context.Background(), captureID)
		s.enqueueUI(func() {
			s.voiceBusy = false
			if err != nil {
				s.voiceErr = api.PresentError(err)
				return
			}
			cp := updated
			s.voiceCapture = &cp
			s.toast(i18n.T("library.memory.toast.recovery_queued"))
		})
	}()
}

func (s *Screen) askVoiceQuestionAsync(captureID, question string) {
	client := s.client()
	question = strings.TrimSpace(question)
	if client == nil || question == "" {
		return
	}
	s.voiceBusy = true
	go func() {
		ans, err := client.AskVoiceCaptureQuestion(context.Background(), captureID, question)
		s.enqueueUI(func() {
			s.voiceBusy = false
			if err != nil {
				s.voiceErr = api.PresentError(err)
				return
			}
			s.voiceQuestionDraft = ""
			s.voiceQuestions = append([]api.VoiceCaptureQuestion{ans}, s.voiceQuestions...)
		})
	}()
}

func (s *Screen) sendVoiceQuestionTaskAsync(captureID, questionID string) {
	client := s.client()
	if client == nil {
		return
	}
	go func() {
		updated, err := client.SendVoiceCaptureQuestionTask(context.Background(), captureID, questionID)
		s.enqueueUI(func() {
			if err != nil {
				s.voiceErr = api.PresentError(err)
				return
			}
			for i := range s.voiceQuestions {
				if s.voiceQuestions[i].ID == updated.ID {
					s.voiceQuestions[i] = updated
				}
			}
			s.toast(i18n.T("library.memory.toast.sent_task"))
		})
	}()
}

func (s *Screen) loadAudioVersion(verID string) {
	client := s.client()
	if client == nil || strings.TrimSpace(verID) == "" {
		return
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.audioGen++
	myGen := s.audioGen
	s.mu.Unlock()

	s.voiceAudioStatus = i18n.T("library.memory.downloading_audio")
	go func() {
		data, ct, err := client.DownloadDocumentVersion(context.Background(), verID)
		if err != nil {
			s.enqueueUI(func() {
				s.voiceAudioStatus = i18n.Tf("library.memory.err_load_audio", map[string]any{"err": err.Error()})
			})
			return
		}
		player, pErr := audio.OpenStream(bytes.NewReader(data))
		if pErr != nil {
			msg := i18n.Tf("library.memory.err_audio_format", map[string]any{"mime": ct})
			if !errors.Is(pErr, audio.ErrFormat) {
				msg = i18n.Tf("library.memory.err_playback", map[string]any{"err": pErr.Error()})
			}
			s.enqueueUI(func() {
				s.voiceAudioLoaded = false
				s.voiceAudioStatus = msg
			})
			return
		}
		s.mu.Lock()
		if s.closed || s.audioGen != myGen {
			s.mu.Unlock()
			player.Stop()
			player.Close()
			return
		}
		prev := s.audioPlayer
		s.audioPlayer = player
		s.mu.Unlock()
		if prev != nil {
			prev.Stop()
			prev.Close()
		}
		player.Play()
		s.enqueueUI(func() {
			s.voiceAudioLoaded = true
			s.voiceAudioPlaying = true
			s.voiceAudioStatus = i18n.T("library.memory.playing_recording")
		})
	}()
}

func (s *Screen) toggleAudioPlayback() {
	s.mu.Lock()
	p := s.audioPlayer
	s.mu.Unlock()
	if p == nil {
		return
	}
	if s.voiceAudioPlaying {
		p.Pause()
		s.voiceAudioPlaying = false
		s.voiceAudioStatus = i18n.T("library.memory.status_paused")
	} else {
		p.Play()
		s.voiceAudioPlaying = true
		s.voiceAudioStatus = i18n.T("library.memory.status_playing")
	}
}

func (s *Screen) stopAudioPlayerOnly() {
	s.mu.Lock()
	s.audioGen++
	p := s.audioPlayer
	s.audioPlayer = nil
	s.mu.Unlock()
	if p != nil {
		p.Stop()
		p.Close()
	}
	s.voiceAudioLoaded = false
	s.voiceAudioPlaying = false
	s.voiceAudioStatus = i18n.T("library.memory.status_stopped")
}
