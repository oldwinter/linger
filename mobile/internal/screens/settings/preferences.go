package settings

import (
	"context"
	"fmt"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/biometrics"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/config"
)

func (s *Screen) viewPreferencesSection(c *ui.Context) {
	t := c.Theme()

	var prefs config.AppPreferences
	if s.deps.Store != nil {
		prefs = s.deps.Store.Snapshot().Prefs
	} else {
		prefs = config.AppPreferences{Theme: config.ThemeSystem}
	}

	s.mu.Lock()
	bioChecked := s.bioChecked
	bioSupported := s.bioSupported
	bioKind := s.bioKind
	stats := s.cacheStats
	s.mu.Unlock()

	ui.Scroll(c).FillWidth().Grow(1).Basis(0).TrackScroll(&s.scroll[SectionPreferences]).Children(func() {
		ui.Column(c).FillWidth().Padding(12, 16, 28, 16).Gap(12).Children(func() {
			if s.prefsNotice != "" {
				components.StatusBanner(c, components.ToneSuccess, s.prefsNotice, "OK", func() {
					s.prefsNotice = ""
				})
			}

			// Biometric App Lock
			components.SectionCard(c, "Security", "Protect paired host credentials on this device", nil, func() {
				bioSub := "Require Face ID / Touch ID on resume"
				if bioChecked && !bioSupported {
					bioSub = "Biometric hardware is unavailable on this device"
				} else if bioSupported && bioKind != biometrics.None {
					bioSub = "Enabled via " + string(bioKind)
				}
				bioOn := prefs.BiometricLock
				ui.Row(c).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, "Biometric App Lock").FontSize(14).FontWeight(600).TextColor(t.Text)
						ui.Text(c, bioSub).FontSize(12).TextColor(t.TextMuted)
					})
					sw := mobile.Switch(c, &bioOn).Label("Toggle Biometric App Lock").Disabled(bioChecked && !bioSupported)
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

			// Appearance
			components.SectionCard(c, "Appearance", "Theme and layout density", nil, func() {
				ui.Text(c, "Theme").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				themeIdx := 0
				switch prefs.Theme {
				case config.ThemeLight:
					themeIdx = 1
				case config.ThemeDark:
					themeIdx = 2
				}
				if components.SegmentedControl(c, &themeIdx, "System", "Town Light", "Town Dark") {
					next := config.ThemeSystem
					if themeIdx == 1 {
						next = config.ThemeLight
					} else if themeIdx == 2 {
						next = config.ThemeDark
					}
					if s.deps.Store != nil {
						_ = s.deps.Store.SetThemePreference(next)
					}
					if s.deps.OnThemeChanged != nil {
						s.deps.OnThemeChanged(next)
					}
				}

				ui.Text(c, "Density").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				densIdx := 0
				if prefs.CompactMode {
					densIdx = 1
				}
				if components.SegmentedControl(c, &densIdx, "Comfortable", "Compact") {
					prefs.CompactMode = densIdx == 1
					if s.deps.Store != nil {
						_ = s.deps.Store.UpdatePreferences(prefs)
					}
				}
			})

			// Interaction
			components.SectionCard(c, "Interaction", "Touch feedback and composer shortcuts", nil, func() {
				ui.Row(c).FillWidth().MinHeight(44).AlignItems(ui.Center).Justify(ui.SpaceBetween).Gap(8).Children(func() {
					ui.Column(c).Grow(1).Basis(0).Gap(2).Children(func() {
						ui.Text(c, "Haptic Feedback").FontSize(14).FontWeight(600).TextColor(t.Text)
						ui.Text(c, "Subtle vibration on actions and toggles").FontSize(12).TextColor(t.TextMuted)
					})
					sw := mobile.Switch(c, &s.hapticsEnabled).Label("Toggle Haptic Feedback")
					if sw.Changed() {
						if s.hapticsEnabled {
							mygo.Haptics.Light()
						}
						if s.deps.OnHapticsChanged != nil {
							s.deps.OnHapticsChanged(s.hapticsEnabled)
						}
					}
				})

				ui.Text(c, "Composer Return Key").FontSize(12).FontWeight(600).TextColor(t.TextMuted)
				retIdx := 0
				if s.composerReturnSend {
					retIdx = 1
				}
				if components.SegmentedControl(c, &retIdx, "Newline", "Send") {
					s.composerReturnSend = retIdx == 1
					if s.deps.OnComposerReturnChanged != nil {
						s.deps.OnComposerReturnChanged(s.composerReturnSend)
					}
				}
			})

			// Offline Cache
			components.SectionCard(c, "Offline Cache (SQLite)", "Local encrypted host database stats", nil, func() {
				ui.Text(c, fmt.Sprintf("Rooms: %d · Messages: %d · Work Items: %d",
					stats.Rooms, stats.Messages, stats.WorkItems)).FontSize(13).TextColor(t.Text)
				ui.Text(c, fmt.Sprintf("Routines: %d · Pocket Notes: %d · Docs: %d · Outbox: %d",
					stats.Routines, stats.PocketNotes, stats.Documents, stats.Outbox)).FontSize(12).TextColor(t.TextMuted)

				clearBtn := components.DangerTouchButton(c, "Clear Local Cache", false)
				clearBtn.FillWidth()
				if clearBtn.Clicked() {
					s.clearCacheConfirm = true
				}
			})
		})
	})
}

func (s *Screen) viewClearCacheConfirmSheet(c *ui.Context) {
	mobile.ActionSheet(c, &s.clearCacheConfirm, mobile.ActionSheetOptions{
		Title:   "Clear Local Cache?",
		Message: "Removes cached Rooms, Messages, Work Items, and Documents from this device.",
		Cancel:  "Cancel",
	}, mobile.Action{
		Label:       "Clear Cache",
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
			s.prefsNotice = "Local cache cleared"
			s.toast("Local cache cleared")
		})
	}()
}
