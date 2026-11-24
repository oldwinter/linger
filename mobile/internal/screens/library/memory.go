package library

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/egoist/mygo/audio"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/realtime"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

var memoryFilterLabels = []string{"All", "Daily", "Weekly", "Meetings"}
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

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SegmentMemory]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 24, 16).Gap(10).Children(func() {
			// Active Voice Capture banner when recording
			if activeCap != nil {
				components.SectionCard(c, "Active Voice Capture", "Room "+activeCap.RoomID, func() {
					components.StatusPill(c, activeCap.Status, components.ToneSuccess)
				}, func() {
					btn := components.PrimaryTouchButton(c, "Open Live Transcript & Q&A", false)
					btn.FillWidth()
					if btn.Clicked() {
						s.openVoiceCapture(*activeCap)
					}
				})
			}

			// Filter pills
			ui.ScrollHorizontal(c).FillWidth().Children(func() {
				ui.Row(c).Gap(6).Role(ui.RoleTabList).Children(func() {
					for i, lbl := range memoryFilterLabels {
						on := s.memoryFilter == i
						bg := theme.Extra(t).MutedBg
						fg := t.TextMuted
						if on {
							bg = t.Accent
							fg = t.AccentText
						}
						chip := ui.Row(c.Key(i)).MinHeight(34).PaddingX(12).Radius(999).Background(bg).
							AlignItems(ui.Center).Shrink(0).Role(ui.RoleTab).Label(lbl).Checked(on)
						chip.Children(func() {
							ui.Text(c, lbl).FontSize(12).FontWeight(600).TextColor(fg).NoWrap()
						})
						if chip.Clicked() {
							s.memoryFilter = i
						}
					}
				})
			})

			if len(filtered) == 0 {
				components.EmptyState(c, theme.IconLive, "No Memory Entries",
					"Daily journals, weekly digests, and recorded meetings will appear here.", "", nil)
				return
			}

			for _, entry := range filtered {
				entry := entry
				row := ui.Column(c.Key(entry.ID)).FillWidth().Padding(12, 12).Gap(6).
					Radius(12).Background(t.Surface).Border(1, t.Border).
					Role(ui.RoleButton).Label("Memory " + entry.Title)
				row.Children(func() {
					ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Text(c, entry.Title).FontSize(15).FontWeight(600).TextColor(t.Text).Grow(1).Basis(0).MaxLines(1)
						components.StatusPill(c, firstWikiStr(entry.Kind, "journal"), components.ToneInfo)
					})
					if entry.Summary != "" {
						ui.Text(c, entry.Summary).FontSize(12).TextColor(t.TextMuted).MaxLines(2)
					}
					if entry.Meeting != nil {
						ui.Row(c).Wrap().Gap(6).Children(func() {
							components.StatusPill(c, "Voice Capture", components.ToneSuccess)
							if entry.Meeting.RecordingFilename != "" {
								components.StatusPill(c, entry.Meeting.RecordingFilename, components.ToneNeutral)
							}
						})
					}
				})
				if row.Clicked() {
					s.openMemoryEntry(entry)
				}
			}
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
		Label:   "Memory Journal Detail",
	}, func() {
		entry := s.memoryDetailEntry
		if entry == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Text(c, entry.Title).FontSize(18).Bold().TextColor(t.Text).Grow(1).Basis(0)
					components.StatusPill(c, entry.Kind, components.ToneInfo)
				})
				if entry.Path != "" {
					ui.Text(c, entry.Path).FontSize(11).TextColor(t.TextMuted)
				}
				if entry.Meeting != nil {
					mt := entry.Meeting
					components.SectionCard(c, "Meeting Recording & Q&A", mt.RecordingFilename, nil, func() {
						openCapBtn := components.PrimaryTouchButton(c, "Open Transcript, Audio & Q&A", false)
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
		Label:   "Voice Capture and Meeting Q&A",
	}, func() {
		vc := s.voiceCapture
		if vc == nil {
			return
		}
		ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Text(c, "Voice Capture "+vc.ID).FontSize(17).Bold().TextColor(t.Text).Grow(1).Basis(0)
					components.StatusPill(c, vc.Status, components.ToneInfo)
				})

				if s.voiceErr != "" {
					components.StatusBanner(c, components.ToneDanger, s.voiceErr, "Dismiss", func() {
						s.voiceErr = ""
					})
				}

				ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
					if vc.Status == "recording" || vc.Status == "active" {
						stopBtn := components.DangerTouchButton(c, "Stop Capture", s.voiceBusy)
						if stopBtn.Clicked() {
							s.stopCaptureAsync(vc.ID)
						}
					}
					if vc.GapCount > 0 || (vc.TranscriptRecoveryStatus != nil && *vc.TranscriptRecoveryStatus == "needed") {
						recBtn := components.SecondaryTouchButton(c, "Retry Transcript Recovery", s.voiceBusy)
						if recBtn.Clicked() {
							s.retryTranscriptRecoveryAsync(vc.ID)
						}
					}
				})

				// Recorded Audio Playback section
				components.SectionCard(c, "Recorded Audio", "", nil, func() {
					if s.voiceAudioStatus != "" {
						ui.Text(c, s.voiceAudioStatus).FontSize(12).TextColor(t.TextMuted)
					}
					ui.Row(c).FillWidth().Gap(8).Children(func() {
						if !s.voiceAudioLoaded {
							verID := ""
							if vc.AudioDocumentVersionID != nil {
								verID = *vc.AudioDocumentVersionID
							} else {
								verID = "dv_rec_1"
							}
							playBtn := components.SecondaryTouchButton(c, "Load Audio", s.voiceBusy || verID == "")
							playBtn.Grow(1).Basis(0)
							if playBtn.Clicked() {
								s.loadAudioVersion(verID)
							}
						} else {
							lbl := "Play"
							if s.voiceAudioPlaying {
								lbl = "Pause"
							}
							toggleBtn := components.PrimaryTouchButton(c, lbl, false)
							toggleBtn.Grow(1).Basis(0)
							if toggleBtn.Clicked() {
								s.toggleAudioPlayback()
							}
							stopAudioBtn := components.SecondaryTouchButton(c, "Stop Audio", false)
							if stopAudioBtn.Clicked() {
								s.stopAudioPlayerOnly()
							}
						}
					})
				})

				// Live & Historical Transcript
				components.SectionCard(c, fmt.Sprintf("Transcript (%d turns)", len(s.voiceTranscripts)), "", nil, func() {
					if len(s.voiceTranscripts) == 0 && s.voicePartial == "" {
						ui.Text(c, "Waiting for transcript segments...").FontSize(13).TextColor(t.TextMuted)
					} else {
						for _, tr := range s.voiceTranscripts {
							speaker := tr.Lane
							if tr.SpeakerID != nil && *tr.SpeakerID != "" {
								speaker = *tr.SpeakerID
							}
							ui.Text(c, fmt.Sprintf("[%s] %s", speaker, tr.Text)).FontSize(13).TextColor(t.Text)
						}
						if s.voicePartial != "" {
							ui.Text(c, "Live: "+s.voicePartial).FontSize(13).TextColor(t.Accent)
						}
					}
				})

				// Meeting Q&A
				components.SectionCard(c, "Ask Meeting Q&A", "", nil, func() {
					ta := ui.TextArea(c, &s.voiceQuestionDraft).FillWidth().MinHeight(64).
						Placeholder("Ask a question about this recording...").Label("Meeting Question Input")
					ta.OnTextKey(func(k ui.TextKey) bool {
						if k.Key != ui.KeyEnter || k.Mods != 0 {
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
					askBtn := components.PrimaryTouchButton(c, "Ask Question", s.voiceBusy || strings.TrimSpace(s.voiceQuestionDraft) == "")
					askBtn.FillWidth()
					if askBtn.Clicked() {
						s.askVoiceQuestionAsync(vc.ID, s.voiceQuestionDraft)
					}

					for _, q := range s.voiceQuestions {
						q := q
						ui.Column(c.Key(q.ID)).FillWidth().Padding(10, 10).Radius(10).Background(theme.Extra(t).MutedBg).Gap(4).Children(func() {
							ui.Text(c, "Q: "+q.Question).FontSize(13).FontWeight(600).TextColor(t.Text)
							if q.Answered {
								ui.Text(c, "A: "+q.Answer).FontSize(13).TextColor(t.TextMuted)
							} else {
								ui.Text(c, "Answering...").FontSize(12).TextColor(t.Accent)
							}
							taskBtn := components.SecondaryTouchButton(c, "Send to Task", q.TaskTitle != nil)
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
				s.voiceErr = err.Error()
				return
			}
			cp := updated
			s.voiceCapture = &cp
			s.toast("Capture stopped")
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
				s.voiceErr = err.Error()
				return
			}
			cp := updated
			s.voiceCapture = &cp
			s.toast("Transcript recovery queued")
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
				s.voiceErr = err.Error()
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
				s.voiceErr = err.Error()
				return
			}
			for i := range s.voiceQuestions {
				if s.voiceQuestions[i].ID == updated.ID {
					s.voiceQuestions[i] = updated
				}
			}
			s.toast("Sent answer to Task")
		})
	}()
}

func (s *Screen) loadAudioVersion(verID string) {
	client := s.client()
	if client == nil {
		return
	}
	s.voiceAudioStatus = "Downloading recording..."
	go func() {
		data, ct, err := client.DownloadDocumentVersion(context.Background(), verID)
		if err != nil {
			s.enqueueUI(func() {
				s.voiceAudioStatus = "Could not load recording: " + err.Error()
			})
			return
		}
		player, pErr := audio.OpenStream(bytes.NewReader(data))
		if pErr != nil {
			msg := "Unsupported recording audio format (" + ct + "); transcript remains available below."
			if !errors.Is(pErr, audio.ErrFormat) {
				msg = "Audio playback unavailable: " + pErr.Error()
			}
			s.enqueueUI(func() {
				s.voiceAudioLoaded = false
				s.voiceAudioStatus = msg
			})
			return
		}
		s.mu.Lock()
		if s.audioPlayer != nil {
			s.audioPlayer.Stop()
			s.audioPlayer.Close()
		}
		s.audioPlayer = player
		s.mu.Unlock()
		player.Play()
		s.enqueueUI(func() {
			s.voiceAudioLoaded = true
			s.voiceAudioPlaying = true
			s.voiceAudioStatus = "Playing recording"
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
		s.voiceAudioStatus = "Paused"
	} else {
		p.Play()
		s.voiceAudioPlaying = true
		s.voiceAudioStatus = "Playing"
	}
}

func (s *Screen) stopAudioPlayerOnly() {
	s.mu.Lock()
	p := s.audioPlayer
	s.audioPlayer = nil
	s.mu.Unlock()
	if p != nil {
		p.Stop()
		p.Close()
	}
	s.voiceAudioLoaded = false
	s.voiceAudioPlaying = false
	s.voiceAudioStatus = "Stopped"
}
