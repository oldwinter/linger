// Package voice provides Linger Mobile's Town Atelier bidirectional LiveKit
// WebRTC voice session sheet with microphone permission recovery, Voice Media
// Policy enforcement, live acoustic meters, call controls, and live subtitles.
package voice

import (
	"context"
	"strings"
	"sync"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
	voicecore "github.com/oldwinter/linger/mobile/internal/voice"
)

// Deps injects store access, optional custom voice controller (for tests), and navigation hooks.
type Deps struct {
	Store               *state.AppStore
	Controller          *voicecore.Controller
	OnOpenVoiceSettings func()
	ShowToast           func(string)
}

// Screen owns the interactive Mobile Voice Sheet UI and its bound voice.Controller.
type Screen struct {
	store               *state.AppStore
	ctl                 *voicecore.Controller
	onOpenVoiceSettings func()
	showToast           func(string)

	mu            sync.Mutex
	open          bool
	wasOpen       bool
	roomID        string
	roomName      string
	lastSuspended bool
	bgWG          sync.WaitGroup
}

// New constructs a Voice Screen wired to deps.Store and a real LiveKit voice.Controller
// unless deps.Controller is provided explicitly.
func New(deps Deps) *Screen {
	s := &Screen{
		store:               deps.Store,
		onOpenVoiceSettings: deps.OnOpenVoiceSettings,
		showToast:           deps.ShowToast,
	}
	if deps.Controller != nil {
		s.ctl = deps.Controller
	} else {
		s.ctl = voicecore.NewController(voicecore.Dependencies{
			Client: func() *api.Client {
				if s.store == nil {
					return nil
				}
				return s.store.Client()
			},
			TenantID: func() string {
				if s.store == nil {
					return ""
				}
				return s.store.Snapshot().TenantID
			},
			OnChange: func() {
				if s.store != nil {
					s.store.Notify()
				}
			},
			OnInsertDraft: func(roomID, text string) {
				s.insertDraft(roomID, text)
			},
		})
	}
	return s
}

func (s *Screen) insertDraft(roomID, text string) {
	text = strings.TrimSpace(text)
	if text == "" || s.store == nil {
		return
	}
	cur := strings.TrimSpace(s.store.GetDraft(roomID))
	next := text
	if cur != "" {
		next = cur + " " + text
	}
	s.store.SetDraft(roomID, next)
	if s.showToast != nil {
		s.showToast(i18n.T("voice.toast.draft_inserted"))
	}
}

func (s *Screen) launchAsync(fn func()) {
	s.bgWG.Add(1)
	go func() {
		defer s.bgWG.Done()
		fn()
	}()
}

// Controller exposes the underlying voice.Controller for integration tests and lifecycle hooks.
func (s *Screen) Controller() *voicecore.Controller {
	return s.ctl
}

// IsOpen reports whether the Voice Sheet is currently presented.
func (s *Screen) IsOpen() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.open
}

// Open opens the Voice Sheet for roomID and refreshes Voice Media Policy and mic permission.
func (s *Screen) Open(roomID, roomName string) {
	s.mu.Lock()
	s.roomID = strings.TrimSpace(roomID)
	s.roomName = strings.TrimSpace(roomName)
	s.open = true
	s.mu.Unlock()

	s.launchAsync(func() {
		s.ctl.PrepareRoom(context.Background(), roomID, roomName)
	})
	if s.store != nil {
		s.store.Notify()
	}
}

// Dismiss closes the Voice Sheet and tears down any active voice session cleanly.
func (s *Screen) Dismiss() {
	s.mu.Lock()
	s.open = false
	s.wasOpen = false
	s.mu.Unlock()

	s.ctl.Disconnect(context.Background())
	if s.store != nil {
		s.store.Notify()
	}
}

// SetSuspended propagates OS background/suspend lifecycle transitions directly to the voice engine.
func (s *Screen) SetSuspended(suspended bool) {
	s.mu.Lock()
	s.lastSuspended = suspended
	s.mu.Unlock()
	s.ctl.SetSuspended(suspended)
}

// Close permanently shuts down the voice controller and waits for any UI-launched actions.
func (s *Screen) Close() {
	s.mu.Lock()
	s.open = false
	s.wasOpen = false
	s.mu.Unlock()
	s.ctl.Close()
	s.bgWG.Wait()
}

// ViewSheet renders the Voice screen inside a modal mobile.Sheet and enforces
// clean teardown when the sheet is swiped/dismissed or when app state suspends/disconnects.
func (s *Screen) ViewSheet(c *ui.Context, snap state.Snapshot) {
	s.mu.Lock()
	prevSuspended := s.lastSuspended
	s.lastSuspended = snap.Suspended
	open := s.open
	wasOpen := s.wasOpen
	s.mu.Unlock()

	if snap.Suspended && !prevSuspended {
		s.ctl.SetSuspended(true)
	} else if !snap.Suspended && prevSuspended {
		s.ctl.SetSuspended(false)
	}

	if snap.Phase != state.PhaseConnected && snap.ActiveHost == nil && open {
		s.Dismiss()
		return
	}

	sheetOpen := open
	mobile.Sheet(c, &sheetOpen, mobile.SheetOptions{
		Detents: []float32{0.82, 0.94},
		Label:   i18n.T("voice.sheet_a11y"),
	}, func() {
		s.ViewBody(c)
	})

	if wasOpen && !sheetOpen {
		// User dismissed the sheet via swipe or backdrop tap — tear down active call cleanly.
		s.mu.Lock()
		s.open = false
		s.wasOpen = false
		s.mu.Unlock()
		s.launchAsync(func() {
			s.ctl.Disconnect(context.Background())
		})
	} else {
		s.mu.Lock()
		s.open = sheetOpen
		s.wasOpen = sheetOpen
		s.mu.Unlock()
	}
}

// ViewBody renders the full Voice Session surface (usable inside ViewSheet or standalone in tests).
func (s *Screen) ViewBody(c *ui.Context) {
	t := c.Theme()
	ex := theme.Extra(t)
	vsnap := s.ctl.Snapshot()

	s.mu.Lock()
	roomID := s.roomID
	roomName := s.roomName
	s.mu.Unlock()
	if vsnap.RoomID != "" {
		roomID = vsnap.RoomID
	}
	if vsnap.RoomName != "" {
		roomName = vsnap.RoomName
	}
	if roomName == "" {
		roomName = i18n.T("voice.room_fallback")
	}

	isLive := vsnap.Phase == voicecore.PhaseConnected || vsnap.Phase == voicecore.PhaseReconnecting
	isBusy := vsnap.Phase == voicecore.PhaseCheckingPolicy ||
		vsnap.Phase == voicecore.PhaseRequestingPermission ||
		vsnap.Phase == voicecore.PhaseConnecting

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).Children(func() {
		layout.ReadableWrap(c, layout.Of(c).SheetMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				// Header: title + room context + live semantic status pill.
				ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, i18n.T("voice.title")).FontSize(19).FontWeight(700).LetterSpacing(-0.25).TextColor(t.Text).MaxLines(1)
						ui.Text(c, roomName).FontSize(12.5).FontWeight(500).TextColor(t.TextMuted).MaxLines(1)
					})
					statusLbl, statusTone := phaseBadge(vsnap.Phase)
					components.StatusDotPill(c, statusLbl, statusTone)
				})

				// Mode selector while not actively streaming.
				if !isLive && !isBusy {
					modeIdx := 0
					if vsnap.Purpose == api.VoicePurposeChatDictation {
						modeIdx = 1
					}
					if components.SegmentedControl(c, &modeIdx, i18n.T("voice.mode_live"), i18n.T("voice.mode_dictation")) {
						if modeIdx == 1 {
							s.ctl.SelectPurpose(api.VoicePurposeChatDictation)
						} else {
							s.ctl.SelectPurpose(api.VoicePurposeChatLive)
						}
					}
				}

				// Background/suspend clean disconnect notice.
				if vsnap.SuspendedDisconnected {
					components.StatusBanner(c, components.ToneWarning, i18n.T("voice.suspend_notice"), "", nil)
				}

				// Policy-blocked recovery card (never bypasses Voice Media Policy).
				if vsnap.Phase == voicecore.PhasePolicyBlocked {
					s.viewPolicyBlockedCard(c, vsnap)
				}

				// Microphone permission prompt / denied recovery cards.
				if vsnap.Phase == voicecore.PhasePermissionDenied || vsnap.Permission == voicecore.PermissionDenied {
					s.viewPermissionDeniedCard(c, roomID, roomName)
				} else if vsnap.Permission == voicecore.PermissionNotDetermined && !isLive && !isBusy {
					s.viewPermissionPromptCard(c)
				}

				// Transient / connection error banner with retry.
				if vsnap.Phase == voicecore.PhaseError {
					errText := vsnap.ErrorMessage
					if vsnap.ErrorCode == "LIVEKIT_LOOPBACK_UNREACHABLE" {
						errText = i18n.T("voice.err.loopback_unreachable")
					}
					if strings.TrimSpace(errText) == "" {
						errText = i18n.T("voice.status.error")
					}
					components.ErrorInline(c, errText, func() {
						s.launchAsync(func() {
							_ = s.ctl.Connect(context.Background(), roomID, roomName, vsnap.Purpose)
						})
					})
				}

				// Acoustic hero card: orbital visualizer + speaking status + input/output meters.
				heroCard := ui.Column(c).FillWidth().Background(t.Surface).Radius(18).Padding(18, 16).Gap(14).AlignItems(ui.Center)
				components.ApplyCardElevation(heroCard, t)
				heroCard.Children(func() {
					renderAcousticOrb(c, vsnap)

					ui.Text(c, voiceHeadline(vsnap)).FontSize(15).FontWeight(600).TextColor(t.Text).TextAlign(ui.Center)
					if !isLive && !isBusy {
						ui.Text(c, i18n.T("voice.ready_hint")).FontSize(12.5).LineHeight(1.4).TextColor(t.TextMuted).TextAlign(ui.Center)
					}

					// Live audio input & remote playback level meters.
					ui.Column(c).FillWidth().Gap(8).Children(func() {
						renderAudioMeter(c, i18n.T("voice.meter_mic"), vsnap.InputLevel, ex.Brand, vsnap.LocalSpeaking)
						if vsnap.Purpose == api.VoicePurposeChatLive {
							renderAudioMeter(c, i18n.T("voice.meter_remote"), vsnap.OutputLevel, theme.Nature.Lake, vsnap.RemoteSpeaking)
						}
					})
				})

				// Tactile primary call controls (>=44pt touch targets).
				if isLive {
					ui.Row(c).FillWidth().Gap(10).Children(func() {
						muteLbl := i18n.T("voice.btn.mute")
						muteIcon := theme.IconMic
						if vsnap.Muted {
							muteLbl = i18n.T("voice.btn.unmute")
							muteIcon = theme.IconMicOff
						}
						muteBtn := controlTileButton(c, muteLbl, muteIcon, vsnap.Muted, false)
						if muteBtn.Clicked() {
							components.HapticLight()
							_ = s.ctl.ToggleMute()
						}

						if vsnap.Purpose == api.VoicePurposeChatLive {
							spkLbl := i18n.T("voice.btn.speaker_on")
							spkIcon := theme.IconSpeaker
							if vsnap.SpeakerMuted {
								spkLbl = i18n.T("voice.btn.speaker_off")
								spkIcon = theme.IconSpeakerOff
							}
							spkBtn := controlTileButton(c, spkLbl, spkIcon, vsnap.SpeakerMuted, false)
							if spkBtn.Clicked() {
								components.HapticLight()
								s.ctl.ToggleSpeakerMuted()
							}
						} else {
							commitBtn := controlTileButton(c, i18n.T("voice.btn.commit_turn"), theme.IconSend, false, false)
							if commitBtn.Clicked() {
								components.HapticLight()
								s.launchAsync(func() {
									_ = s.ctl.CommitDictationTurn(context.Background())
								})
							}
						}
					})

					endBtn := components.DangerTouchButton(c, i18n.T("voice.btn.disconnect"), false)
					endBtn.FillWidth()
					if endBtn.Clicked() {
						components.HapticLight()
						s.launchAsync(func() {
							s.ctl.Disconnect(context.Background())
						})
					}
				} else {
					connectLbl := i18n.T("voice.btn.connect")
					if isBusy {
						connectLbl = i18n.T("voice.btn.connecting")
					}
					connectBtn := components.PrimaryTouchButton(c, connectLbl, isBusy || roomID == "")
					connectBtn.FillWidth()
					if connectBtn.Clicked() {
						components.HapticLight()
						s.launchAsync(func() {
							_ = s.ctl.Connect(context.Background(), roomID, roomName, vsnap.Purpose)
						})
					}
				}

				// Live Transcript & Assistant Subtitles card.
				s.viewTranscriptCard(c, vsnap, isLive)
			})
		})
	})
}

func (s *Screen) viewPolicyBlockedCard(c *ui.Context, vsnap voicecore.Snapshot) {
	t := c.Theme()
	reasonText := policyReasonMessage(vsnap.PolicyDecision.Reason)
	components.SectionCard(c, i18n.T("voice.policy.title"), reasonText, nil, func() {
		ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
			if s.onOpenVoiceSettings != nil {
				settingsBtn := components.CompactPrimaryButton(c, i18n.T("voice.btn.open_voice_settings"), theme.IconSliders, false)
				if settingsBtn.Clicked() {
					s.Dismiss()
					s.onOpenVoiceSettings()
				}
			}
			switch vsnap.PolicyDecision.FallbackPurpose {
			case api.VoicePurposeChatDictation:
				fbBtn := components.CompactSecondaryButton(c, i18n.T("voice.btn.switch_dictation"), theme.IconMic, false)
				if fbBtn.Clicked() {
					s.ctl.SelectPurpose(api.VoicePurposeChatDictation)
				}
			case api.VoicePurposeChatLive:
				fbBtn := components.CompactSecondaryButton(c, i18n.T("voice.btn.switch_live"), theme.IconMic, false)
				if fbBtn.Clicked() {
					s.ctl.SelectPurpose(api.VoicePurposeChatLive)
				}
			}
		})
		_ = t
	})
}

func (s *Screen) viewPermissionPromptCard(c *ui.Context) {
	components.SectionCard(c, i18n.T("voice.perm.prompt_title"), i18n.T("voice.perm.prompt_body"), nil, func() {
		allowBtn := components.PrimaryTouchButton(c, i18n.T("voice.btn.allow_mic"), false)
		allowBtn.FillWidth()
		if allowBtn.Clicked() {
			s.launchAsync(func() {
				_, _ = s.ctl.RequestPermission(context.Background())
			})
		}
	})
}

func (s *Screen) viewPermissionDeniedCard(c *ui.Context, roomID, roomName string) {
	components.SectionCard(c, i18n.T("voice.perm.denied_title"), i18n.T("voice.perm.denied_body"), nil, func() {
		ui.Row(c).FillWidth().Wrap().Gap(8).Children(func() {
			sysBtn := components.CompactPrimaryButton(c, i18n.T("voice.btn.open_sys_settings"), theme.IconSliders, false)
			if sysBtn.Clicked() {
				if err := s.ctl.OpenPermissionSettings(); err != nil && s.showToast != nil {
					s.showToast(i18n.T("voice.toast.settings_failed"))
				}
			}
			checkBtn := components.CompactSecondaryButton(c, i18n.T("voice.btn.check_again"), theme.IconRefresh, false)
			if checkBtn.Clicked() {
				s.launchAsync(func() {
					s.ctl.PrepareRoom(context.Background(), roomID, roomName)
				})
			}
		})
	})
}

func (s *Screen) viewTranscriptCard(c *ui.Context, vsnap voicecore.Snapshot, isLive bool) {
	t := c.Theme()
	ex := theme.Extra(t)

	var trailing func()
	if isLive {
		trailing = func() {
			if vsnap.RuntimeReady {
				components.StatusDotPill(c, i18n.T("voice.runtime_ready"), components.ToneSuccess)
			} else {
				components.StatusDotPill(c, i18n.T("voice.runtime_waiting"), components.ToneInfo)
			}
		}
	}

	components.SectionCard(c, i18n.T("voice.transcript.title"), "", trailing, func() {
		hasContent := len(vsnap.Entries) > 0 ||
			strings.TrimSpace(vsnap.PartialTranscript) != "" ||
			strings.TrimSpace(vsnap.ReplySubtitle) != ""
		if !hasContent {
			ui.Text(c, i18n.T("voice.transcript.empty")).FontSize(13).LineHeight(1.4).TextColor(t.TextMuted)
			return
		}

		ui.Column(c).FillWidth().Gap(8).Children(func() {
			for i, entry := range vsnap.Entries {
				roleLbl := i18n.T("voice.transcript.agent")
				roleTone := components.ToneInfo
				if entry.Role == "user" {
					roleLbl = i18n.T("voice.transcript.you")
					roleTone = components.ToneBrand
				}
				body := entry.Text
				if entry.Interrupted {
					body += " " + i18n.T("voice.transcript.interrupted")
				}
				ui.Column(c.Key(i)).FillWidth().Padding(8, 10).Radius(12).Background(ex.MutedBg).Gap(5).AlignItems(ui.Start).Children(func() {
					components.StatusPill(c, roleLbl, roleTone)
					ui.Text(c, body).FontSize(13.5).LineHeight(1.4).TextColor(t.Text)
				})
			}
			if pt := strings.TrimSpace(vsnap.PartialTranscript); pt != "" {
				ui.Column(c.Key("partial")).FillWidth().Padding(8, 10).Radius(12).Background(ex.BrandTint).Gap(5).AlignItems(ui.Start).Children(func() {
					components.StatusPill(c, i18n.T("voice.transcript.you"), components.ToneBrand)
					ui.Text(c, pt).FontSize(13.5).LineHeight(1.4).TextColor(t.Text)
				})
			}
			if rs := strings.TrimSpace(vsnap.ReplySubtitle); rs != "" {
				ui.Column(c.Key("reply_sub")).FillWidth().Padding(8, 10).Radius(12).Background(ex.InfoTint).Gap(5).AlignItems(ui.Start).Children(func() {
					components.StatusPill(c, i18n.T("voice.transcript.agent"), components.ToneInfo)
					ui.Text(c, rs).FontSize(13.5).LineHeight(1.4).TextColor(t.Text)
				})
			}
		})
	})
}

func renderAcousticOrb(c *ui.Context, vsnap voicecore.Snapshot) {
	t := c.Theme()
	ex := theme.Extra(t)

	level := vsnap.InputLevel
	if vsnap.OutputLevel > level {
		level = vsnap.OutputLevel
	}
	if level < 0 {
		level = 0
	}
	if level > 1 {
		level = 1
	}

	orbColor := ex.MutedBg
	iconColor := t.TextMuted
	ringColor := ex.SubtleBorder
	iconFn := theme.IconMic

	switch {
	case vsnap.Muted && vsnap.Phase == voicecore.PhaseConnected:
		orbColor = ex.DangerTint
		iconColor = t.Danger
		ringColor = t.Danger.Alpha(0.28)
		iconFn = theme.IconMicOff
	case vsnap.RemoteSpeaking:
		orbColor = theme.Nature.Lake.Alpha(0.18)
		iconColor = theme.Nature.Lake
		ringColor = theme.Nature.Lake.Alpha(0.32)
		iconFn = theme.IconSpeaker
	case vsnap.LocalSpeaking:
		orbColor = ex.BrandTint
		iconColor = ex.Brand
		ringColor = ex.Brand.Alpha(0.38)
		iconFn = theme.IconMic
	case vsnap.Phase == voicecore.PhaseConnected:
		orbColor = ex.OKTint
		iconColor = t.Success
		ringColor = t.Success.Alpha(0.28)
		iconFn = theme.IconMic
	case vsnap.Phase == voicecore.PhasePermissionDenied || vsnap.Phase == voicecore.PhaseError:
		orbColor = ex.DangerTint
		iconColor = t.Danger
		ringColor = t.Danger.Alpha(0.25)
		iconFn = theme.IconMicOff
	case vsnap.Phase == voicecore.PhasePolicyBlocked:
		orbColor = ex.WarnTint
		iconColor = t.Warning
		ringColor = t.Warning.Alpha(0.25)
		iconFn = theme.IconMicOff
	}

	ui.Box(c).Size(96, 96).Shrink(0).Draw(func(p *ui.Painter, r ui.Rect) {
		cx := r.X + r.W/2
		cy := r.Y + r.H/2
		outerR := float32(34) + level*13
		midR := float32(28) + level*7
		coreR := float32(26)

		p.Fill(ui.Rect{X: cx - outerR, Y: cy - outerR, W: outerR * 2, H: outerR * 2}, ringColor.Alpha(0.22), outerR)
		p.Fill(ui.Rect{X: cx - midR, Y: cy - midR, W: midR * 2, H: midR * 2}, ringColor.Alpha(0.38), midR)
		p.Fill(ui.Rect{X: cx - coreR, Y: cy - coreR, W: coreR * 2, H: coreR * 2}, orbColor, coreR)
		p.Stroke(ui.Rect{X: cx - coreR, Y: cy - coreR, W: coreR * 2, H: coreR * 2}, ringColor, coreR, 1.25)

		iconSize := float32(26)
		iconFn(p, ui.Rect{X: cx - iconSize/2, Y: cy - iconSize/2, W: iconSize, H: iconSize}, iconColor)
	})
}

func renderAudioMeter(c *ui.Context, label string, level float32, barColor ui.Color, active bool) {
	t := c.Theme()
	ex := theme.Extra(t)
	if level < 0 {
		level = 0
	}
	if level > 1 {
		level = 1
	}

	ui.Column(c).FillWidth().Gap(4).Children(func() {
		ui.Row(c).FillWidth().AlignItems(ui.Center).Justify(ui.SpaceBetween).Children(func() {
			lblColor := t.TextMuted
			if active {
				lblColor = t.Text
			}
			ui.Text(c, label).FontSize(11.5).FontWeight(600).TextColor(lblColor)
			dotColor := ex.SubtleBorder
			if active {
				dotColor = barColor
			}
			ui.Box(c).Size(7, 7).Radius(3.5).Background(dotColor).Shrink(0)
		})
		ui.Box(c).FillWidth().Height(7).Radius(3.5).Draw(func(p *ui.Painter, r ui.Rect) {
			p.Fill(r, ex.MutedBg, 3.5)
			if level > 0.01 {
				fillW := r.W * level
				if fillW < 7 {
					fillW = 7
				}
				p.Fill(ui.Rect{X: r.X, Y: r.Y, W: fillW, H: r.H}, barColor, 3.5)
			}
		})
	})
}

func controlTileButton(c *ui.Context, label string, icon theme.IconFunc, activeAlert bool, disabled bool) ui.Element {
	t := c.Theme()
	ex := theme.Extra(t)
	bg := ex.ElevatedBg
	fg := t.Text
	borderCol := ex.SubtleBorder
	if activeAlert {
		bg = ex.DangerTint
		fg = t.Danger
		borderCol = t.Danger.Alpha(0.32)
	}
	btn := ui.Row(c).Grow(1).Basis(0).MinHeight(46).Padding(10, 12).Radius(12).
		Background(bg).Border(0.75, borderCol).AlignItems(ui.Center).Justify(ui.Center).Gap(7).
		Role(ui.RoleButton).Label(label).Disabled(disabled)
	if !disabled && btn.Pressed() {
		btn.Scale(0.98, 0.98)
	}
	btn.Children(func() {
		theme.IconBox(c, 16, fg, icon)
		ui.Text(c, label).FontSize(13.5).FontWeight(600).TextColor(fg).NoWrap().MaxLines(1)
	})
	return btn
}

func phaseBadge(phase voicecore.SessionPhase) (string, components.Tone) {
	switch phase {
	case voicecore.PhaseCheckingPolicy:
		return i18n.T("voice.status.checking"), components.ToneInfo
	case voicecore.PhaseRequestingPermission:
		return i18n.T("voice.status.permission"), components.ToneInfo
	case voicecore.PhasePermissionDenied:
		return i18n.T("voice.status.permission_denied"), components.ToneDanger
	case voicecore.PhasePolicyBlocked:
		return i18n.T("voice.status.policy_blocked"), components.ToneWarning
	case voicecore.PhaseConnecting:
		return i18n.T("voice.status.connecting"), components.ToneInfo
	case voicecore.PhaseConnected:
		return i18n.T("voice.status.connected"), components.ToneSuccess
	case voicecore.PhaseReconnecting:
		return i18n.T("voice.status.reconnecting"), components.ToneWarning
	case voicecore.PhaseError:
		return i18n.T("voice.status.error"), components.ToneDanger
	default:
		return i18n.T("voice.status.idle"), components.ToneNeutral
	}
}

func voiceHeadline(vsnap voicecore.Snapshot) string {
	switch vsnap.Phase {
	case voicecore.PhaseConnected:
		if vsnap.Muted {
			return i18n.T("voice.muted_hint")
		}
		if vsnap.RemoteSpeaking {
			return i18n.T("voice.speaking_agent")
		}
		if vsnap.LocalSpeaking {
			return i18n.T("voice.speaking_you")
		}
		return i18n.T("voice.listening")
	case voicecore.PhaseConnecting:
		return i18n.T("voice.status.connecting")
	case voicecore.PhaseReconnecting:
		return i18n.T("voice.status.reconnecting")
	case voicecore.PhaseCheckingPolicy:
		return i18n.T("voice.status.checking")
	case voicecore.PhaseRequestingPermission:
		return i18n.T("voice.status.permission")
	case voicecore.PhasePermissionDenied:
		return i18n.T("voice.status.permission_denied")
	case voicecore.PhasePolicyBlocked:
		return i18n.T("voice.status.policy_blocked")
	case voicecore.PhaseError:
		return i18n.T("voice.status.error")
	default:
		return i18n.T("voice.status.idle")
	}
}

func policyReasonMessage(reason voicecore.PolicyBlockReason) string {
	switch reason {
	case voicecore.PolicyBlockLiveDisabled:
		return i18n.T("voice.policy.live_disabled")
	case voicecore.PolicyBlockXAIKeyMissing:
		return i18n.T("voice.policy.xai_missing")
	case voicecore.PolicyBlockSonioxKeyMissing:
		return i18n.T("voice.policy.soniox_missing")
	case voicecore.PolicyBlockNoRoomAgent:
		return i18n.T("voice.policy.no_room_agent")
	default:
		return i18n.T("voice.policy.unavailable")
	}
}
