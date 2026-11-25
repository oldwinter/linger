package shell_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/golden"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/screens/live"
	"github.com/oldwinter/linger/mobile/internal/screens/settings"
	"github.com/oldwinter/linger/mobile/internal/shell"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func settleFrame(tt *ui.Tester) {
	tt.Frame()
	tt.Advance(600 * time.Millisecond)
	tt.Frame()
}

func restoreI18nState(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		i18n.SetSystemLocaleFunc(nil)
		i18n.SetPreference(config.LanguageEN)
	})
}

func assertVisibleControlsHaveValidBounds(t *testing.T, tt *ui.Tester, screenName string, vpWidth, vpHeight int) {
	t.Helper()
	var tabRects []ui.Rect
	var tabCount int
	for _, info := range tt.AccessAll() {
		if info.Offscreen {
			continue
		}
		if info.Role == ui.RoleTab && info.Bounds.W > 0 && info.Bounds.H > 0 {
			tabCount++
			if info.Bounds.X < -1 || info.Bounds.X+info.Bounds.W > float32(vpWidth)+2 {
				t.Fatalf("%s (%dx%d): tab %q overflows viewport width: %+v",
					screenName, vpWidth, vpHeight, info.Name, info.Bounds)
			}
			foldClipped := info.Bounds.Y <= 60 || info.Bounds.Y+info.Bounds.H >= float32(vpHeight)-90
			if !foldClipped && (info.Bounds.W < 20 || info.Bounds.H < 20) {
				t.Fatalf("%s (%dx%d): tab %q crushed too small: %+v",
					screenName, vpWidth, vpHeight, info.Name, info.Bounds)
			}
			for _, prev := range tabRects {
				horizOverlap := info.Bounds.X < prev.X+prev.W-1 && prev.X < info.Bounds.X+info.Bounds.W-1
				vertOverlap := info.Bounds.Y < prev.Y+prev.H-1 && prev.Y < info.Bounds.Y+info.Bounds.H-1
				if horizOverlap && vertOverlap {
					t.Fatalf("%s (%dx%d): tab %q overlaps another tab (%+v vs %+v)",
						screenName, vpWidth, vpHeight, info.Name, info.Bounds, prev)
				}
			}
			tabRects = append(tabRects, info.Bounds)
		}
		if info.Role == ui.RoleButton && info.Bounds.W > 0 && info.Bounds.H > 0 {
			foldClipped := info.Bounds.Y <= 60 || info.Bounds.Y+info.Bounds.H >= float32(vpHeight)-90
			if info.Bounds.W < 20 || (!foldClipped && info.Bounds.H < 20) {
				t.Fatalf("%s (%dx%d): visible button %q too small %+v",
					screenName, vpWidth, vpHeight, info.Name, info.Bounds)
			}
		}
	}
	if tabCount == 0 {
		t.Fatalf("%s (%dx%d): expected visible tabs/controls, got 0", screenName, vpWidth, vpHeight)
	}
}

func TestShellLiveThemeSystemLightDarkSwitching(t *testing.T) {
	restoreI18nState(t)

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	_ = cfgStore.SetPreferences(config.AppPreferences{
		Theme:    config.ThemeSystem,
		Language: config.LanguageEN,
	})
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()

	var themeEvents []config.ThemePreference
	store.SetOnThemeChanged(func(pref config.ThemePreference) {
		themeEvents = append(themeEvents, pref)
	})

	var sysDark atomic.Bool
	appShell := shell.New(store, sysDark.Load)
	defer appShell.Close()

	store.SetActiveTab(state.TabMore)
	store.Routers[state.TabMore].Replace("/more")
	appShell.Settings().SelectSection(settings.SectionPreferences)

	var observedBg ui.Color
	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		appShell.View(c)
		observedBg = c.Theme().Background
	}, testutil.StandardMobileViewports[1])

	// System theme initially Light (sysDark = false).
	tt.Frame()
	if observedBg != theme.TownLight().Background {
		t.Fatalf("System+Light bg = %+v, want TownLight %+v", observedBg, theme.TownLight().Background)
	}

	// OS dark mode toggles live -> 1 frame updates UI theme immediately.
	sysDark.Store(true)
	tt.Frame()
	if observedBg != theme.TownDark().Background {
		t.Fatalf("System+Dark live flip bg = %+v, want TownDark %+v", observedBg, theme.TownDark().Background)
	}

	// Tap explicit Town Light segmented option -> updates in 1 frame & persists.
	if err := tt.Click(i18n.Tp("en", "theme.light", nil)); err != nil {
		t.Fatalf("click Town Light: %v", err)
	}
	tt.Frame()
	if observedBg != theme.TownLight().Background {
		t.Fatalf("explicit Town Light bg = %+v, want %+v", observedBg, theme.TownLight().Background)
	}
	if got := cfgStore.Preferences().Theme; got != config.ThemeLight {
		t.Fatalf("persisted theme = %q, want light", got)
	}

	// Tap explicit Town Dark segmented option -> updates in 1 frame & persists.
	if err := tt.Click(i18n.Tp("en", "theme.dark", nil)); err != nil {
		t.Fatalf("click Town Dark: %v", err)
	}
	tt.Frame()
	if observedBg != theme.TownDark().Background {
		t.Fatalf("explicit Town Dark bg = %+v, want %+v", observedBg, theme.TownDark().Background)
	}
	if got := cfgStore.Preferences().Theme; got != config.ThemeDark {
		t.Fatalf("persisted theme = %q, want dark", got)
	}
	if len(themeEvents) != 2 || themeEvents[0] != config.ThemeLight || themeEvents[1] != config.ThemeDark {
		t.Fatalf("expected exactly [light dark] OnThemeChanged callbacks (deduplicated), got %v", themeEvents)
	}
	// Redundant write of already-active ThemeDark must be a no-op.
	if err := store.SetThemePreference(config.ThemeDark); err != nil {
		t.Fatalf("redundant SetThemePreference: %v", err)
	}
	if len(themeEvents) != 2 {
		t.Fatalf("expected redundant SetThemePreference not to fire OnThemeChanged, got %v", themeEvents)
	}
}

func TestShellLiveLanguageSwitchingAndSystemLocale(t *testing.T) {
	restoreI18nState(t)

	var sysLocale atomic.Value
	sysLocale.Store("zh-Hans-CN")
	i18n.SetSystemLocaleFunc(func() string {
		v, _ := sysLocale.Load().(string)
		return v
	})

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	_ = cfgStore.SetPreferences(config.AppPreferences{
		Theme:    config.ThemeLight,
		Language: config.LanguageSystem,
	})
	i18n.SetPreference(config.LanguageSystem)

	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()

	var langEvents []config.LanguagePreference
	store.SetOnLanguageChanged(func(pref config.LanguagePreference) {
		langEvents = append(langEvents, pref)
		// Simulate main.go calling mygo.App.SetLocale(target) before i18n resolves System.
		if pref == config.LanguageSystem {
			sysLocale.Store("zh-CN")
		}
	})

	appShell := shell.New(store, func() bool { return false })
	defer appShell.Close()

	store.SetActiveTab(state.TabMore)
	store.Routers[state.TabMore].Replace("/more")
	appShell.Settings().SelectSection(settings.SectionPreferences)

	tt := testutil.NewPhoneTester(appShell.View, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Follows OS zh-Hans-CN immediately on start.
	zhRooms := i18n.Tp(i18n.LocaleZhHans, "tab.rooms", nil)
	zhMore := i18n.Tp(i18n.LocaleZhHans, "tab.more", nil)
	zhPrefsTab := i18n.Tp(i18n.LocaleZhHans, "settings.tab.prefs", nil)
	zhAppearance := i18n.Tp(i18n.LocaleZhHans, "appearance.title", nil)
	if !tt.HasText(zhRooms) || !tt.HasText(zhMore) || !tt.HasText(zhPrefsTab) || !tt.HasText(zhAppearance) {
		t.Fatalf("expected Simplified Chinese system locale UI, texts=%v", tt.Texts())
	}

	// OS switches locale dynamically to en-US -> RefreshSystemLocale flips UI cleanly.
	sysLocale.Store("en-US")
	changed, resolved := i18n.RefreshSystemLocale("en-US")
	if !changed || resolved != i18n.LocaleEN {
		t.Fatalf("RefreshSystemLocale(en-US) = (%v, %q), want (true, en)", changed, resolved)
	}
	tt.Frame()
	if !tt.HasText("Rooms") || !tt.HasText("Live") || !tt.HasText("More") {
		t.Fatalf("expected English UI after system locale change, texts=%v", tt.Texts())
	}

	// Tap "Simplified Chinese" inside Settings -> Prefs -> updates in 1 frame across tabs & persists.
	if err := tt.Click("\u7b80\u4f53\u4e2d\u6587"); err != nil {
		t.Fatalf("click Simplified Chinese option: %v", err)
	}
	tt.Frame()
	if !tt.HasText(zhRooms) || !tt.HasText("\u5b9e\u65f6") || !tt.HasText("\u5de5\u4f5c") || !tt.HasText("\u8d44\u6599\u5e93") || !tt.HasText(zhMore) {
		t.Fatalf("expected all 5 bottom tabs in Simplified Chinese after 1 frame, texts=%v", tt.Texts())
	}
	if got := cfgStore.Preferences().Language; got != config.LanguageZhHans {
		t.Fatalf("persisted language = %q, want zh-Hans", got)
	}
	if len(langEvents) == 0 || langEvents[len(langEvents)-1] != config.LanguageZhHans {
		t.Fatalf("expected OnLanguageChanged zh-Hans callback, got %v", langEvents)
	}

	// Tap "English" restores English in 1 frame.
	if err := tt.Click("English"); err != nil {
		t.Fatalf("click English option: %v", err)
	}
	tt.Frame()
	if !tt.HasText("Rooms") || !tt.HasText("More") {
		t.Fatalf("expected English UI restored in 1 frame, texts=%v", tt.Texts())
	}

	// Switch back from English -> System: click Language row's "System" (near "English", not Theme row's "System").
	enRect, ok := tt.Find("English")
	if !ok {
		t.Fatal("cannot find English option")
	}
	var sysLang *ui.AccessInfo
	for _, a := range tt.AccessAll() {
		if a.Name == "System" && a.Bounds.W > 0 && a.Bounds.Y >= enRect.Y-4 && a.Bounds.Y <= enRect.Y+enRect.H+4 {
			cp := a
			sysLang = &cp
			break
		}
	}
	if sysLang == nil {
		t.Fatalf("cannot find Language System option aligned with English (%+v)", enRect)
	}
	tt.ClickAt(sysLang.Bounds.X+sysLang.Bounds.W/2, sysLang.Bounds.Y+sysLang.Bounds.H/2)
	if got := i18n.ActiveLocale(); got != i18n.LocaleZhHans {
		t.Fatalf("switching en -> system did not immediately resolve OS locale: got %q, want %q", got, i18n.LocaleZhHans)
	}
	tt.Frame()
	if !tt.HasText(zhRooms) {
		t.Fatalf("expected Chinese UI restored immediately after clicking System, texts=%v", tt.Texts())
	}
}

func TestSessionOverridesDoNotPersistAndStoreToastsLocalized(t *testing.T) {
	restoreI18nState(t)

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	themeOver := config.ThemeDark
	langOver := config.LanguageZhHans
	store := state.NewAppStore(state.Options{
		ConfigStore:      cfgStore,
		DataDir:          t.TempDir(),
		ThemeOverride:    &themeOver,
		LanguageOverride: &langOver,
	})
	defer store.Disconnect()

	snap := store.Snapshot()
	if snap.Prefs.Theme != config.ThemeDark || snap.Prefs.Language != config.LanguageZhHans {
		t.Fatalf("session overrides not applied in snapshot: %+v", snap.Prefs)
	}
	disk := cfgStore.Preferences()
	if disk.Theme != config.ThemeSystem || disk.Language != config.LanguageSystem {
		t.Fatalf("session overrides leaked to persisted config: %+v", disk)
	}

	// Changing unrelated preference preserves active session overrides without writing them to disk.
	if err := store.SetBiometricPreference(true); err != nil {
		t.Fatalf("SetBiometricPreference: %v", err)
	}
	diskAfter := cfgStore.Preferences()
	if !diskAfter.BiometricLock || diskAfter.Theme != config.ThemeSystem || diskAfter.Language != config.LanguageSystem {
		t.Fatalf("unexpected persisted preferences after biometric toggle: %+v", diskAfter)
	}
	if store.Snapshot().Prefs.Theme != config.ThemeDark || store.Snapshot().Prefs.Language != config.LanguageZhHans {
		t.Fatalf("session overrides dropped after biometric toggle: %+v", store.Snapshot().Prefs)
	}

	// Verify store_c1 toasts use localized catalog strings.
	if err := store.MarkAllRoomsRead(context.Background()); err != nil {
		t.Fatalf("MarkAllRoomsRead: %v", err)
	}
	wantToast := i18n.Tp(i18n.LocaleZhHans, "state.toast.all_caught_up", nil)
	if got := store.Snapshot().StatusMessage; got != wantToast {
		t.Fatalf("MarkAllRoomsRead StatusMessage = %q, want %q", got, wantToast)
	}
}

func TestOfflineConnectHubAppearanceQuickControlsAndPrefsNavigation(t *testing.T) {
	restoreI18nState(t)

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()

	appShell := shell.New(store, func() bool { return false })
	defer appShell.Close()
	appShell.OpenConnect()

	var observedBg ui.Color
	tt := testutil.NewPhoneTester(func(c *ui.Context) {
		appShell.View(c)
		observedBg = c.Theme().Background
	}, testutil.StandardMobileViewports[1])
	tt.Frame()

	// Before pairing any host, quick Appearance & Language controls are visible on Connect Hub.
	if !tt.HasText("Appearance & Language") || !tt.HasText("All Prefs") {
		t.Fatalf("expected Appearance & Language quick card on unpaired Connect Hub, texts=%v", tt.Texts())
	}

	// 1 tap switches Theme to Dark.
	if err := tt.Click("Dark"); err != nil {
		t.Fatalf("click quick Dark pill on Connect Hub: %v", err)
	}
	tt.Frame()
	if observedBg != theme.TownDark().Background {
		t.Fatalf("expected TownDark bg after Connect Hub pill click, got %+v", observedBg)
	}

	// 1 tap switches Language to Chinese.
	if err := tt.Click(i18n.Tp(i18n.LocaleZhHans, "lang.pill_zh", nil)); err != nil {
		t.Fatalf("click quick Chinese pill on Connect Hub: %v", err)
	}
	tt.Frame()
	if !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "connect.tab.saved", nil)) || !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "connect.tab.pair", nil)) {
		t.Fatalf("expected Connect Hub translated in 1 frame, texts=%v", tt.Texts())
	}

	// Tap All Prefs opens More -> Prefs offline even when unpaired!
	if err := tt.Click(i18n.Tp(i18n.LocaleZhHans, "appearance.all_prefs", nil)); err != nil {
		t.Fatalf("click All Prefs button: %v", err)
	}
	tt.Frame()
	if !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "settings.prefs.biometric_label", nil)) || !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "appearance.title", nil)) {
		t.Fatalf("expected offline More -> Prefs in Chinese after All Prefs tap, texts=%v", tt.Texts())
	}
}

func TestChineseLayoutSafetyAcrossPhoneViewports(t *testing.T) {
	restoreI18nState(t)

	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedAllFixtures()
	defer srv.Close()

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	_ = cfgStore.SetPreferences(config.AppPreferences{
		Theme:    config.ThemeLight,
		Language: config.LanguageZhHans,
	})
	i18n.SetPreference(config.LanguageZhHans)

	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()
	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}

	appShell := shell.New(store, func() bool { return false })
	defer appShell.Close()
	appShell.Work().Refresh(context.Background())
	appShell.Library().Refresh(context.Background())
	appShell.Settings().Refresh(context.Background())

	for _, vp := range testutil.StandardMobileViewports {
		vp := vp
		t.Run(vp.Name, func(t *testing.T) {
			store.Routers[state.TabRooms] = ui.NewRouter("/rooms")
			store.Routers[state.TabMore] = ui.NewRouter("/more")
			tt := testutil.NewPhoneTester(appShell.View, vp)

			// Connect Hub
			appShell.OpenConnect()
			settleFrame(tt)
			assertVisibleControlsHaveValidBounds(t, tt, "ConnectHub", vp.Width, vp.Height)

			// Rooms
			store.SetActiveTab(state.TabRooms)
			store.Routers[state.TabRooms] = ui.NewRouter("/rooms")
			settleFrame(tt)
			if !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "rooms.catch_up", nil)) {
				t.Fatalf("%s: expected Chinese Catch-Up button, texts=%v", vp.Name, tt.Texts())
			}
			assertVisibleControlsHaveValidBounds(t, tt, "Rooms", vp.Width, vp.Height)

			// Live (Compute)
			store.SetActiveTab(state.TabLive)
			appShell.Live().SelectSegment(live.SegmentCompute)
			settleFrame(tt)
			if !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "live.compute.desktop_title", nil)) {
				t.Fatalf("%s: expected Chinese Desktop Companion Host, texts=%v", vp.Name, tt.Texts())
			}
			assertVisibleControlsHaveValidBounds(t, tt, "Live", vp.Width, vp.Height)

			// Work
			store.SetActiveTab(state.TabWork)
			settleFrame(tt)
			if !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "work.tab.routines", nil)) || !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "work.tab.pocket", nil)) {
				t.Fatalf("%s: expected Chinese Work segments, texts=%v", vp.Name, tt.Texts())
			}
			assertVisibleControlsHaveValidBounds(t, tt, "Work", vp.Width, vp.Height)

			// Library
			store.SetActiveTab(state.TabLibrary)
			settleFrame(tt)
			if !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "library.tab.docs", nil)) || !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "library.tab.wiki", nil)) || !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "library.tab.memory", nil)) {
				t.Fatalf("%s: expected Chinese Library segments, texts=%v", vp.Name, tt.Texts())
			}
			assertVisibleControlsHaveValidBounds(t, tt, "Library", vp.Width, vp.Height)

			// More Overview & Prefs
			store.SetActiveTab(state.TabMore)
			store.Routers[state.TabMore] = ui.NewRouter("/more")
			appShell.Settings().SelectSection(settings.SectionOverview)
			settleFrame(tt)
			if !tt.HasText(i18n.Tp(i18n.LocaleZhHans, "appearance.title", nil)) {
				t.Fatalf("%s: expected Chinese Appearance card in More Overview, texts=%v", vp.Name, tt.Texts())
			}
			assertVisibleControlsHaveValidBounds(t, tt, "MoreOverview", vp.Width, vp.Height)

			appShell.Settings().SelectSection(settings.SectionPreferences)
			settleFrame(tt)
			assertVisibleControlsHaveValidBounds(t, tt, "MorePrefs", vp.Width, vp.Height)
		})
	}
}

func TestShellChineseGoldenSnapshotsLightAndDark(t *testing.T) {
	restoreI18nState(t)

	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedAllFixtures()
	defer srv.Close()

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	_ = cfgStore.SetPreferences(config.AppPreferences{
		Theme:    config.ThemeLight,
		Language: config.LanguageZhHans,
	})
	i18n.SetPreference(config.LanguageZhHans)

	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	defer store.Disconnect()

	vp := testutil.StandardMobileViewports[1]

	// 1. Offline Connect Hub in Chinese (Light & Dark)
	appOffline := shell.New(store, func() bool { return false })
	appOffline.OpenConnect()
	ttConnLight := testutil.NewPhoneTester(appOffline.View, vp)
	settleFrame(ttConnLight)
	golden.Match(t, ttConnLight, "testdata/shell_connect_zh_light_390x844.png")

	_ = store.SetThemePreference(config.ThemeDark)
	ttConnDark := testutil.NewPhoneTester(appOffline.View, vp)
	settleFrame(ttConnDark)
	golden.Match(t, ttConnDark, "testdata/shell_connect_zh_dark_390x844.png")
	appOffline.Close()

	// 2. Hydrated Shell: Rooms + More Overview in Chinese (Light & Dark)
	_ = store.SetThemePreference(config.ThemeLight)
	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}
	appHydrated := shell.New(store, func() bool { return false })
	defer appHydrated.Close()
	appHydrated.Work().Refresh(context.Background())
	store.SetRTTMs(0)

	store.SetActiveTab(state.TabRooms)
	store.Routers[state.TabRooms] = ui.NewRouter("/rooms")
	ttRoomsLight := testutil.NewPhoneTester(appHydrated.View, vp)
	settleFrame(ttRoomsLight)
	golden.Match(t, ttRoomsLight, "testdata/shell_rooms_zh_light_390x844.png")

	_ = store.SetThemePreference(config.ThemeDark)
	ttRoomsDark := testutil.NewPhoneTester(appHydrated.View, vp)
	settleFrame(ttRoomsDark)
	golden.Match(t, ttRoomsDark, "testdata/shell_rooms_zh_dark_390x844.png")

	moreCfg := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	_ = moreCfg.SetPreferences(config.AppPreferences{
		Theme:    config.ThemeLight,
		Language: config.LanguageZhHans,
	})
	_ = moreCfg.UpsertHost(config.HostProfile{
		ID:             "studio_mac",
		Name:           "Studio Mac",
		Mode:           config.HostModeCompanion,
		PrimaryURL:     "https://studio-mac.local:8443",
		TLS:            true,
		TLSFingerprint: "SHA256:DEMO",
	})
	_ = moreCfg.SetActiveHost("studio_mac")
	moreStore := state.NewAppStore(state.Options{
		ConfigStore: moreCfg,
		DataDir:     t.TempDir(),
	})
	moreApp := shell.New(moreStore, func() bool { return false })
	defer moreApp.Close()
	moreStore.SetActiveTab(state.TabMore)
	moreStore.Routers[state.TabMore] = ui.NewRouter("/more")
	moreApp.Settings().SelectSection(settings.SectionOverview)
	ttMoreLight := testutil.NewPhoneTester(moreApp.View, vp)
	settleFrame(ttMoreLight)
	golden.Match(t, ttMoreLight, "testdata/shell_more_zh_light_390x844.png")

	_ = moreStore.SetThemePreference(config.ThemeDark)
	ttMoreDark := testutil.NewPhoneTester(moreApp.View, vp)
	settleFrame(ttMoreDark)
	golden.Match(t, ttMoreDark, "testdata/shell_more_zh_dark_390x844.png")
}
