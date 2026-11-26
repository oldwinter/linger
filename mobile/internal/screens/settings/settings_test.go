package settings_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/biometrics"
	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/cache"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/screens/settings"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func waitUntil(t *testing.T, timeout time.Duration, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for condition")
}

func settle(tt *ui.Tester) {
	tt.Frame()
	tt.Advance(600 * time.Millisecond)
	tt.Frame()
}

func clickOrScroll(t *testing.T, tt *ui.Tester, name string) {
	t.Helper()
	settle(tt)
	for range 8 {
		r, ok := tt.Find(name)
		if ok && r.Y >= 0 && r.Y+r.H <= 810 {
			if err := tt.Click(name); err == nil {
				settle(tt)
				return
			}
		}
		dy := float32(240)
		if ok && r.Y < 40 {
			dy = -240
		}
		tt.Scroll(200, 260, 0, dy)
		tt.Frame()
	}
	if err := tt.Click(name); err != nil {
		t.Fatalf("click %q: %v", name, err)
	}
	settle(tt)
}

func focusField(t *testing.T, tt *ui.Tester, label string) {
	t.Helper()
	settle(tt)
	for range 8 {
		info, ok := tt.AccessByRole(ui.RoleTextField, label)
		if ok && !info.Offscreen && info.Bounds.W > 0 && info.Bounds.H > 0 && info.Bounds.Y >= 40 && info.Bounds.Y+info.Bounds.H <= 810 {
			tt.ClickAt(info.Bounds.X+info.Bounds.W/2, info.Bounds.Y+info.Bounds.H/2)
			tt.Key(0, ui.KeyEnd)
			tt.Frame()
			return
		}
		dy := float32(240)
		if ok && info.Bounds.Y < 40 {
			dy = -240
		}
		tt.Scroll(200, 260, 0, dy)
		tt.Frame()
	}
	t.Fatalf("text field %q not focusable or outside window", label)
}

type settingsHarness struct {
	srv           *testutil.C2FakeServer
	cfg           *config.Store
	store         *state.AppStore
	cs            *cache.Store
	screen        *settings.Screen
	themes        []config.ThemePreference
	biometrics    []bool
	signedOut     bool
	cacheCleared  bool
	connectOpened bool
	shared        []mygo.ShareOptions
	bioKind       biometrics.Kind
	bioErr        error
}

func newSettingsHarness(t *testing.T, bioKind biometrics.Kind, bioErr error) *settingsHarness {
	t.Helper()
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	t.Cleanup(srv.Close)

	client, err := srv.NewClient()
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	cs, err := cache.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("cache.Open: %v", err)
	}
	t.Cleanup(func() { _ = cs.Close() })

	cfg := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	_ = cfg.UpsertHost(config.HostProfile{
		ID:             srv.HostID,
		Name:           srv.HostName,
		Mode:           config.HostModeCompanion,
		PrimaryURL:     srv.URL,
		TLS:            true,
		TLSFingerprint: srv.Fingerprint,
	})
	_ = cfg.SetActiveHost(srv.HostID)
	_ = cfg.SaveSecret(srv.HostID, srv.ValidToken)
	store := state.NewAppStore(state.Options{
		ConfigStore: cfg,
		DataDir:     t.TempDir(),
	})
	t.Cleanup(store.Disconnect)

	h := &settingsHarness{
		srv:     srv,
		cfg:     cfg,
		store:   store,
		cs:      cs,
		bioKind: bioKind,
		bioErr:  bioErr,
	}
	h.screen = settings.New(settings.Deps{
		Store:    store,
		Client:   client,
		Cache:    cs,
		TenantID: srv.TenantID,
		OnOpenConnect: func() {
			h.connectOpened = true
		},
		OnThemeChanged: func(pref config.ThemePreference) {
			h.themes = append(h.themes, pref)
		},
		OnBiometricChanged: func(on bool) {
			h.biometrics = append(h.biometrics, on)
		},
		OnSignOut: func() {
			h.signedOut = true
		},
		OnClearCache: func(_ context.Context) error {
			h.cacheCleared = true
			return nil
		},
		CheckBiometrics: func(_ context.Context) (biometrics.Kind, error) {
			return h.bioKind, h.bioErr
		},
		Share: func(o mygo.ShareOptions) error {
			h.shared = append(h.shared, o)
			return nil
		},
	})
	h.screen.Refresh(context.Background())
	return h
}

func TestSettingsViewportsInsetsThemesAndAccessibility(t *testing.T) {
	h := newSettingsHarness(t, biometrics.FaceID, nil)

	for _, vp := range testutil.StandardMobileViewports {
		for _, dark := range []bool{false, true} {
			mode := "light"
			if dark {
				mode = "dark"
			}
			t.Run(vp.Name+"_"+mode, func(t *testing.T) {
				view := func(c *ui.Context) {
					if dark {
						c.SetTheme(theme.TownDark())
					} else {
						c.SetTheme(theme.TownLight())
					}
					ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
						h.screen.View(c)
					})
				}
				h.screen.SelectSection(settings.SectionOverview)
				tt := testutil.NewPhoneTester(view, vp)
				tt.SetInsets(59, 0, 34, 0)
				tt.Frame()
				if !tt.HasText("Studio Mac") || !tt.HasText("LAN TLS Pinned") {
					t.Fatalf("expected active host card in overview, texts=%v", tt.Texts())
				}
				if len(tt.AccessAll()) < 6 {
					t.Fatalf("expected rich accessibility tree, got %d nodes", len(tt.AccessAll()))
				}

				h.screen.SelectSection(settings.SectionIntegrations)
				testutil.ApplyKeyboardInset(tt, 59)
				tt.Frame()
				if !tt.HasText("Voice Infrastructure & Keys") {
					t.Fatal("expected Voice Infrastructure card")
				}
			})
		}
	}
}

func TestSettingsProactiveShadowRulePromotionAndEdit(t *testing.T) {
	h := newSettingsHarness(t, biometrics.FaceID, nil)
	h.screen.SelectSection(settings.SectionRules)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		h.screen.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Shadow rule + divergence visible
	if !tt.HasText("Shadow Review (1)") || !tt.HasText("Customer reported crash on launch") {
		t.Fatalf("expected shadow rule divergence, texts=%v", tt.Texts())
	}

	// 1-tap Promote moves rule from Shadow Review to Active Rules
	clickOrScroll(t, tt, "Promote")
	waitUntil(t, 5*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Active Rules (2)")
	})

	// Test Edit sheet with CJK escaped input
	clickOrScroll(t, tt, "Edit")
	clickOrScroll(t, tt, "Rule Text")
	tt.Type(" \u4f18\u5148\u5904\u7406")
	tt.Frame()
	clickOrScroll(t, tt, "Save Rule")
	waitUntil(t, 5*time.Second, func() bool {
		settle(tt)
		return !tt.HasText("Save Rule") && tt.HasText("\u4f18\u5148\u5904\u7406")
	})

	// Test Mandate ActionSheet
	clickOrScroll(t, tt, "Mandate")
	clickOrScroll(t, tt, "Create Work Item")
	waitUntil(t, 5*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Mandate: Create Work Item")
	})
}

func TestShadowRuleDismissRequiresConfirmation(t *testing.T) {
	h := newSettingsHarness(t, biometrics.FaceID, nil)
	h.screen.SelectSection(settings.SectionRules)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		h.screen.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	if !tt.HasText("Shadow Review (1)") {
		t.Fatalf("expected 1 shadow rule initially, texts=%v", tt.Texts())
	}
	clickOrScroll(t, tt, "Dismiss")
	if !tt.HasText("Dismiss Rule") {
		t.Fatalf("expected Dismiss confirmation ActionSheet before removing shadow rule, texts=%v", tt.Texts())
	}
	// Cancelling preserves the shadow rule.
	clickOrScroll(t, tt, "Cancel")
	if !tt.HasText("Shadow Review (1)") {
		t.Fatal("shadow rule disappeared after cancelling confirmation")
	}
	// Confirming removes the shadow rule.
	clickOrScroll(t, tt, "Dismiss")
	clickOrScroll(t, tt, "Dismiss Rule")
	waitUntil(t, 5*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Shadow Review (0)")
	})
}

func TestPreferencesPersistenceBiometricOffSubtitleAndInlineCacheError(t *testing.T) {
	srv, err := testutil.NewC2FakeServer(true)
	if err != nil {
		t.Fatalf("NewC2FakeServer: %v", err)
	}
	defer srv.Close()

	client, err := srv.NewClient()
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	cs, err := cache.Open(context.Background(), ":memory:")
	if err != nil {
		t.Fatalf("cache.Open: %v", err)
	}
	defer func() { _ = cs.Close() }()

	// Enqueue an unsynced Pocket Note so Clear Local Cache must report preserving it.
	if err := cs.EnqueueOutbox(context.Background(), "pocket:test-1", "pocket_note.put", "today", map[string]string{"text": "unsynced"}); err != nil {
		t.Fatalf("EnqueueOutbox: %v", err)
	}

	prefsBackend := config.NewMemoryPreferencesBackend()
	secretsBackend := config.NewMemorySecretsBackend()
	cfg := config.NewStore(prefsBackend, secretsBackend)
	store := state.NewAppStore(state.Options{ConfigStore: cfg, DataDir: t.TempDir()})
	defer store.Disconnect()

	failClear := true
	var errorToasts []string
	scr := settings.New(settings.Deps{
		Store:    store,
		Client:   client,
		Cache:    cs,
		TenantID: srv.TenantID,
		OnClearCache: func(ctx context.Context) error {
			if failClear {
				return errors.New("disk busy")
			}
			return cs.Clear(ctx)
		},
		ShowErrorToast: func(msg string) {
			errorToasts = append(errorToasts, msg)
		},
		CheckBiometrics: func(_ context.Context) (biometrics.Kind, error) {
			return biometrics.FaceID, nil
		},
	})
	scr.Refresh(context.Background())
	scr.SelectSection(settings.SectionPreferences)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		scr.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// 1. Biometric Lock OFF must NOT say "Enabled via Face ID".
	if tt.HasText("Enabled via Face ID") {
		t.Fatalf("biometric lock OFF rendered misleading Enabled subtitle: %v", tt.Texts())
	}
	if !tt.HasText("Off — require Face ID to unlock") {
		t.Fatalf("expected accurate Off biometric subtitle, texts=%v", tt.Texts())
	}

	// 2. Toggle Compact Mode, Haptic Feedback, and Composer Return Key -> persisted across reload!
	clickOrScroll(t, tt, "Compact")
	clickOrScroll(t, tt, "Toggle Haptic Feedback")
	clickOrScroll(t, tt, "Send")

	if components.HapticsEnabled() {
		t.Fatal("expected global haptics disabled after toggling switch OFF")
	}
	t.Cleanup(func() { components.SetHapticsEnabled(true) })

	reloadedCfg := config.NewStore(prefsBackend, secretsBackend)
	reloadedStore := state.NewAppStore(state.Options{ConfigStore: reloadedCfg, DataDir: t.TempDir()})
	defer reloadedStore.Disconnect()
	reloadedSnap := reloadedStore.Snapshot()
	if !reloadedSnap.Prefs.CompactMode {
		t.Fatal("expected CompactMode persisted across reload")
	}
	if reloadedSnap.Prefs.HapticsEnabled() {
		t.Fatal("expected HapticsDisabled persisted across reload")
	}
	if !reloadedSnap.ComposerReturnSends || !reloadedSnap.Prefs.ComposerReturnSends {
		t.Fatal("expected ComposerReturnSends persisted across reload")
	}

	// 3. Clear Cache failure renders inline on Preferences + triggers error toast.
	clickOrScroll(t, tt, "Clear Local Cache")
	if !tt.HasText("Removes cached Rooms, Messages, Work Items, and Documents from this device. Your 1 unsynced offline item will be preserved.") {
		t.Fatalf("expected confirmation naming preserved outbox count, texts=%v", tt.Texts())
	}
	clickOrScroll(t, tt, "Clear Cache")
	waitUntil(t, 5*time.Second, func() bool {
		settle(tt)
		return tt.HasText("disk busy")
	})
	if len(errorToasts) == 0 {
		t.Fatal("expected OnErrorToast on clear cache failure")
	}

	// 4. Clear Cache success preserves pending outbox row and announces preserved count.
	failClear = false
	clickOrScroll(t, tt, "Clear Local Cache")
	clickOrScroll(t, tt, "Clear Cache")
	waitUntil(t, 5*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Local cache cleared (1 unsynced item preserved)")
	})
	rows, err := cs.ListOutbox(context.Background())
	if err != nil || len(rows) != 1 {
		t.Fatalf("expected pending outbox row preserved after clear, got %d (%v)", len(rows), err)
	}

	// 5. Enqueuing another outbox item AFTER Refresh must still show live count in confirmation sheet.
	if err := cs.EnqueueOutbox(context.Background(), "pocket:test-2", "pocket_note.put", "today", map[string]string{"text": "second unsynced"}); err != nil {
		t.Fatalf("EnqueueOutbox second: %v", err)
	}
	clickOrScroll(t, tt, "Clear Local Cache")
	if !tt.HasText("Removes cached Rooms, Messages, Work Items, and Documents from this device. Your 2 unsynced offline items will be preserved.") {
		t.Fatalf("expected confirmation to refresh live outbox count (2), texts=%v", tt.Texts())
	}
	clickOrScroll(t, tt, "Cancel")
}

func TestSettingsExternalConnectionsWebSearchAndVoiceKeysMasked(t *testing.T) {
	h := newSettingsHarness(t, biometrics.FaceID, nil)
	h.screen.SelectSection(settings.SectionIntegrations)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		h.screen.View(c)
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// 1. External connection status check + agent grants
	clickOrScroll(t, tt, "Check Status")
	waitUntil(t, 5*time.Second, func() bool {
		settle(tt)
		return tt.HasText("github status: Connected")
	})

	clickOrScroll(t, tt, "Agent Grants")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Grant Another Me")
	})
	clickOrScroll(t, tt, "Grant Another Me")
	// Close agent grants sheet via Escape
	tt.Key(0, ui.KeyEscape)
	settle(tt)

	// 2. Web Search API Key masked entry (never echoed into UI texts)
	secretSearchKey := "tvly-super-secret-xyz"
	focusField(t, tt, "Tavily API Key")
	tt.Type(secretSearchKey)
	tt.Frame()
	clickOrScroll(t, tt, "Save Key")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Saved API key for tavily")
	})
	if h.srv.SavedSearchKeys["tavily"] != secretSearchKey {
		t.Fatalf("server saved search key = %q, want %q", h.srv.SavedSearchKeys["tavily"], secretSearchKey)
	}
	joined := strings.Join(tt.Texts(), " ")
	if strings.Contains(joined, secretSearchKey) {
		t.Fatalf("secret web search key leaked into rendered UI texts")
	}

	// 3. Voice Provider (Soniox) masked key entry (never echoed into UI texts)
	secretVoiceKey := "snx-secret-99999"
	focusField(t, tt, "Soniox (Transcription) API Key")
	tt.Type(secretVoiceKey)
	tt.Frame()
	clickOrScroll(t, tt, "Save & Validate SONIOX Key")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Validated and saved SONIOX key")
	})
	if h.srv.SavedVoiceKeys["soniox"] != secretVoiceKey {
		t.Fatalf("server saved voice key = %q, want %q", h.srv.SavedVoiceKeys["soniox"], secretVoiceKey)
	}
	joinedAfter := strings.Join(tt.Texts(), " ")
	if strings.Contains(joinedAfter, secretVoiceKey) {
		t.Fatalf("secret voice key leaked into rendered UI texts")
	}
}

func TestSettingsProfileInsightsBiometricsThemeAndHostControls(t *testing.T) {
	// Test unsupported biometrics fallback text first
	hUnsup := newSettingsHarness(t, biometrics.None, errors.ErrUnsupported)
	hUnsup.screen.SelectSection(settings.SectionPreferences)
	ttUnsup := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		hUnsup.screen.View(c)
	}, testutil.StandardMobileViewports[1])
	ttUnsup.Frame()
	if !ttUnsup.HasText("Biometric hardware is unavailable on this device") {
		t.Fatalf("expected unsupported biometrics fallback text, texts=%v", ttUnsup.Texts())
	}

	// Full harness with Face ID available
	h := newSettingsHarness(t, biometrics.FaceID, nil)

	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		h.screen.View(c)
	}, testutil.StandardMobileViewports[1])

	// Preferences: Biometric switch, Theme, Haptics, Return Key, Clear Cache
	h.screen.SelectSection(settings.SectionPreferences)
	tt.Frame()
	clickOrScroll(t, tt, "Toggle Biometric App Lock")
	if len(h.biometrics) != 1 || !h.biometrics[0] {
		t.Fatalf("expected OnBiometricChanged(true), got %v", h.biometrics)
	}
	clickOrScroll(t, tt, "Town Dark")
	if len(h.themes) != 1 || h.themes[0] != config.ThemeDark {
		t.Fatalf("expected OnThemeChanged(ThemeDark), got %v", h.themes)
	}
	clickOrScroll(t, tt, "Clear Local Cache")
	clickOrScroll(t, tt, "Clear Cache")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return h.cacheCleared
	})

	// Profile & Insights: Account Profile + Insight Prune
	h.screen.SelectSection(settings.SectionProfile)
	tt.Frame()
	clickOrScroll(t, tt, "Save Account Profile")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Account profile saved")
	})
	clickOrScroll(t, tt, "Prune")
	clickOrScroll(t, tt, "Delete Insight")
	waitUntil(t, 2*time.Second, func() bool {
		settle(tt)
		return tt.HasText("Personal Insights (1)")
	})

	// Host Card: Manage Hosts, Export Diagnostics, Rotate Token, Unpair / Sign Out
	h.screen.SelectSection(settings.SectionOverview)
	tt.Frame()
	clickOrScroll(t, tt, "Manage Hosts / Pair New Desktop")
	if !h.connectOpened {
		t.Fatal("expected OnOpenConnect callback")
	}
	clickOrScroll(t, tt, "Export Diagnostics")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return len(h.shared) == 1
	})
	if strings.Contains(h.shared[0].Text, h.srv.ValidToken) {
		t.Fatal("diagnostics leaked bearer token")
	}
	clickOrScroll(t, tt, "Unpair / Sign Out")
	clickOrScroll(t, tt, "Unpair & Sign Out")
	waitUntil(t, 2*time.Second, func() bool {
		tt.Frame()
		return h.signedOut
	})
}

func TestSettingsGoldenSnapshots(t *testing.T) {
	h := newSettingsHarness(t, biometrics.FaceID, nil)
	if ah, ok := h.cfg.ActiveHost(); ok {
		ah.PrimaryURL = "https://studio-mac.local:8443"
		_ = h.cfg.UpsertHost(ah)
	}
	h.screen.SelectSection(settings.SectionOverview)

	ttLight := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownLight())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			h.screen.View(c)
		})
	}, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttLight, "testdata/settings_overview_light_390x844.png")

	ttDark := testutil.NewPhoneTester(func(c *ui.Context) {
		c.SetTheme(theme.TownDark())
		ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
			h.screen.View(c)
		})
	}, testutil.StandardMobileViewports[1])
	testutil.MatchGolden(t, ttDark, "testdata/settings_overview_dark_390x844.png")
}
