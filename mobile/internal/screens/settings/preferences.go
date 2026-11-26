package settings

import (
	"context"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/biometrics"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
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
		prefs = config.AppPreferences{Theme: config.ThemeSystem, Language: config.LanguageSystem}
	}

	s.mu.Lock()
	bioChecked := s.bioChecked
	bioSupported := s.bioSupported
	bioKind := s.bioKind
	stats := s.cacheStats
	s.mu.Unlock()

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SectionPreferences]).Children(func() {
		layout.ReadableWrap(c, layout.Of(c).ReadableMaxWidth, func() {
			ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
				if s.prefsNotice != "" {
					components.StatusBanner(c, components.ToneSuccess, s.prefsNotice, i18n.T("common.ok"), func() {
						s.prefsNotice = ""
					})
				}

				// Biometric App Lock
				components.SectionCard(c, i18n.T("settings.prefs.security_title"), i18n.T("settings.prefs.security_subtitle"), nil, func() {
					bioSub := i18n.T("settings.prefs.biometric_hint")
					if bioChecked && !bioSupported {
						bioSub = i18n.T("settings.prefs.biometric_unavailable")
					} else if bioSupported && bioKind != biometrics.None {
						bioSub = i18n.Tf("settings.prefs.biometric_enabled_via", map[string]any{"name": i18n.BiometricKindLabel(string(bioKind))})
					}
					bioOn := prefs.BiometricLock
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
					ui.Row(c).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
						ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
							ui.Text(c, i18n.T("settings.prefs.haptic_label")).FontSize(14).FontWeight(600).TextColor(t.Text)
							ui.Text(c, i18n.T("settings.prefs.haptic_sub")).FontSize(12).TextColor(t.TextMuted)
						})
						sw := mobile.Switch(c, &s.hapticsEnabled).Label(i18n.T("settings.prefs.haptic_label"))
						if sw.Changed() {
							if s.hapticsEnabled {
								mygo.Haptics.Light()
							}
							if s.deps.OnHapticsChanged != nil {
								s.deps.OnHapticsChanged(s.hapticsEnabled)
							}
						}
					})

					ui.Text(c, i18n.T("settings.prefs.return_key_label")).FontSize(12).FontWeight(600).TextColor(t.TextMuted)
					retIdx := 0
					if s.composerReturnSend {
						retIdx = 1
					}
					if components.SegmentedControl(c, &retIdx, i18n.T("settings.prefs.return_newline"), i18n.T("settings.prefs.return_send")) {
						s.composerReturnSend = retIdx == 1
						if s.deps.OnComposerReturnChanged != nil {
							s.deps.OnComposerReturnChanged(s.composerReturnSend)
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
	mobile.ActionSheet(c, &s.clearCacheConfirm, mobile.ActionSheetOptions{
		Title:   i18n.T("settings.prefs.clear_title"),
		Message: i18n.T("settings.prefs.clear_body"),
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
				s.enqueueUI(func() { s.hostError = err.Error() })
				return
			}
		}
		s.refreshCacheStats(ctx)
		s.enqueueUI(func() {
			s.prefsNotice = i18n.T("settings.prefs.toast.cleared")
			s.toast(i18n.T("settings.prefs.toast.cleared"))
		})
	}()
}
