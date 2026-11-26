package settings

import (
	"context"

	"github.com/egoist/mygo/plugins/biometrics"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/layout"
)

func (s *Screen) viewPreferencesSection(c *ui.Context) {
	t := c.Theme()

	var prefs config.AppPreferences
	if s.deps.Store != nil {
		prefs = s.deps.Store.Snapshot().Prefs
	} else {
		prefs = config.AppPreferences{
			Theme:               config.ThemeSystem,
			Language:            config.LanguageSystem,
			HapticsDisabled:     !s.hapticsEnabled,
			ComposerReturnSends: s.composerReturnSend,
		}
	}

	s.mu.Lock()
	bioChecked := s.bioChecked
	bioSupported := s.bioSupported
	bioKind := s.bioKind
	stats := s.cacheStats
	s.mu.Unlock()

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SectionPreferences]).Children(func() {
		layout.ReadableWrap(c, layout.Of(c).ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(components.ListGap(t)).Children(func() {
				if s.prefsError != "" {
					components.StatusBanner(c, components.ToneDanger, s.prefsError, i18n.T("common.dismiss"), func() {
						s.prefsError = ""
					})
				}
				if s.prefsNotice != "" {
					components.StatusBanner(c, components.ToneSuccess, s.prefsNotice, i18n.T("common.ok"), func() {
						s.prefsNotice = ""
					})
				}

				// Biometric App Lock
				components.SectionCard(c, i18n.T("settings.prefs.security_title"), i18n.T("settings.prefs.security_subtitle"), nil, func() {
					bioOn := prefs.BiometricLock
					bioSub := i18n.T("settings.prefs.biometric_hint")
					if bioChecked && !bioSupported {
						bioSub = i18n.T("settings.prefs.biometric_unavailable")
					} else if bioSupported && bioKind != biometrics.None {
						if bioOn {
							bioSub = i18n.Tf("settings.prefs.biometric_enabled_via", map[string]any{"name": i18n.BiometricKindLabel(string(bioKind))})
						} else {
							bioSub = i18n.Tf("settings.prefs.biometric_off_via", map[string]any{"name": i18n.BiometricKindLabel(string(bioKind))})
						}
					}
					ui.Row(c).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, i18n.T("settings.prefs.biometric_label")).FontSize(14).FontWeight(600).TextColor(t.Text)
							ui.Text(c, bioSub).FontSize(12).TextColor(t.TextMuted)
						})
						sw := mobile.Switch(c, &bioOn).Label(i18n.T("settings.prefs.biometric_a11y")).Disabled(bioChecked && !bioSupported)
						if sw.Changed() {
							if s.deps.Store != nil {
								_ = s.deps.Store.SetBiometricPreference(bioOn)
							}
							if s.deps.OnBiometricChanged != nil {
								s.deps.OnBiometricChanged(bioOn)
							}
						}
					})
				})

				// Appearance & Language
				components.SectionCard(c, i18n.T("appearance.title"), i18n.T("appearance.subtitle"), nil, func() {
					components.ThemeSegmentedSelector(c, prefs.Theme, func(next config.ThemePreference) {
						if s.deps.Store != nil {
							_ = s.deps.Store.SetThemePreference(next)
						}
						if s.deps.OnThemeChanged != nil {
							s.deps.OnThemeChanged(next)
						}
					})

					components.LanguageSegmentedSelector(c, prefs.Language, func(next config.LanguagePreference) {
						if s.deps.Store != nil {
							_ = s.deps.Store.SetLanguagePreference(next)
						}
						if s.deps.OnLanguageChanged != nil {
							s.deps.OnLanguageChanged(next)
						}
					})

					ui.Text(c, i18n.T("appearance.density")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					densIdx := 0
					if prefs.CompactMode {
						densIdx = 1
					}
					if components.SegmentedControl(c, &densIdx, i18n.T("appearance.density_comfortable"), i18n.T("appearance.density_compact")) {
						prefs.CompactMode = densIdx == 1
						if s.deps.Store != nil {
							_ = s.deps.Store.UpdatePreferences(prefs)
						}
					}
				})

				// Interaction
				components.SectionCard(c, i18n.T("settings.prefs.interaction_title"), i18n.T("settings.prefs.interaction_subtitle"), nil, func() {
					hapticsOn := prefs.HapticsEnabled()
					ui.Row(c).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, i18n.T("settings.prefs.haptic_label")).FontSize(14).FontWeight(600).TextColor(t.Text)
							ui.Text(c, i18n.T("settings.prefs.haptic_sub")).FontSize(12).TextColor(t.TextMuted)
						})
						sw := mobile.Switch(c, &hapticsOn).Label(i18n.T("settings.prefs.haptic_a11y"))
						if sw.Changed() {
							s.hapticsEnabled = hapticsOn
							components.SetHapticsEnabled(hapticsOn)
							if hapticsOn {
								components.HapticLight()
							}
							if s.deps.Store != nil {
								_ = s.deps.Store.SetHapticsPreference(hapticsOn)
							}
							if s.deps.OnHapticsChanged != nil {
								s.deps.OnHapticsChanged(hapticsOn)
							}
						}
					})

					ui.Text(c, i18n.T("settings.prefs.return_key_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					retIdx := 0
					if prefs.ComposerReturnSends {
						retIdx = 1
					}
					if components.SegmentedControl(c, &retIdx, i18n.T("settings.prefs.return_newline"), i18n.T("settings.prefs.return_send")) {
						sendOnEnter := retIdx == 1
						s.composerReturnSend = sendOnEnter
						if s.deps.Store != nil {
							s.deps.Store.SetComposerReturnSends(sendOnEnter)
						}
						if s.deps.OnComposerReturnChanged != nil {
							s.deps.OnComposerReturnChanged(sendOnEnter)
						}
					}
				})

				// Offline Cache
				components.SectionCard(c, i18n.T("settings.prefs.sqlite_title"), i18n.T("settings.prefs.sqlite_subtitle"), nil, func() {
					ui.Text(c, i18n.Tf("settings.prefs.sqlite_row1", map[string]any{
						"rooms":    stats.Rooms,
						"messages": stats.Messages,
						"work":     stats.WorkItems,
					})).FontSize(13).TextColor(t.Text)
					ui.Text(c, i18n.Tf("settings.prefs.sqlite_row2", map[string]any{
						"routines": stats.Routines,
						"notes":    stats.PocketNotes,
						"docs":     stats.Documents,
						"outbox":   stats.Outbox,
					})).FontSize(12).TextColor(t.TextMuted)

					clearBtn := components.DangerTouchButton(c, i18n.T("settings.prefs.clear_cache"), false)
					clearBtn.FillWidth()
					if clearBtn.Clicked() {
						s.clearCacheConfirm = true
					}
				})
			})
		})
	})
}

func (s *Screen) viewClearCacheConfirmSheet(c *ui.Context) {
	s.mu.Lock()
	pendingOutbox := s.cacheStats.Outbox
	s.mu.Unlock()

	msg := i18n.T("settings.prefs.clear_body")
	if pendingOutbox > 0 {
		msg = i18n.Tf("settings.prefs.clear_body_preserve_outbox", map[string]any{"count": pendingOutbox})
	}
	mobile.ActionSheet(c, &s.clearCacheConfirm, mobile.ActionSheetOptions{
		Title:   i18n.T("settings.prefs.clear_title"),
		Message: msg,
		Cancel:  i18n.T("common.cancel"),
	}, mobile.Action{
		Label:       i18n.T("settings.prefs.clear_confirm"),
		Destructive: true,
		OnTap:       s.clearCacheAsync,
	})
}

func (s *Screen) clearCacheAsync() {
	go func() {
		ctx := context.Background()
		if s.deps.OnClearCache != nil {
			if err := s.deps.OnClearCache(ctx); err != nil {
				presented := api.PresentError(err)
				s.enqueueUI(func() {
					s.prefsNotice = ""
					s.prefsError = presented
					s.errorToast(presented)
				})
				return
			}
		}
		s.refreshCacheStats(ctx)
		s.mu.Lock()
		preserved := s.cacheStats.Outbox
		s.mu.Unlock()
		notice := i18n.T("settings.prefs.toast.cleared")
		if preserved > 0 {
			notice = i18n.Tf("settings.prefs.toast.cleared_preserved", map[string]any{"count": preserved})
		}
		s.enqueueUI(func() {
			s.prefsError = ""
			s.prefsNotice = notice
			s.toast(notice)
		})
	}()
}
