package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/shell"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

// keptNavState persists non-sensitive UI navigation state across OS restarts
// and mygo dev reloads via mygo.KeepState. Secrets stay strictly in OS Keychain.
type keptNavState struct {
	ActiveTab int
}

func main() {
	var (
		flagHostURL   = flag.String("host-url", "", "Connect directly to a Companion/TeamHub URL in desktop preview")
		flagToken     = flag.String("token", "", "Companion Bearer token for desktop preview (--host-url)")
		flagTLSFP     = flag.String("tls-fp", "", "Optional SPKI TLS fingerprint for --host-url")
		flagDataDir   = flag.String("data-dir", "", "Isolated data directory for preferences, secrets, and SQLite cache")
		flagTheme     = flag.String("theme", "", "Force theme preference: system, light, or dark")
		flagLang      = flag.String("lang", "", "Force language preference: system, en, or zh-Hans")
		flagPairURI   = flag.String("pair-uri", "", "Open Connection Hub directly with a linger://pair?... URI")
		flagPlainHTTP = flag.Bool("plain-http", false, "Explicitly opt in to plain HTTP for --host-url (Tailscale/dev)")
	)
	flag.Parse()

	kept := &keptNavState{ActiveTab: state.TabRooms}
	mygo.KeepState(kept)

	var (
		prefsBackend   config.PreferencesBackend
		secretsBackend config.SecretsBackend
		dataDir        = strings.TrimSpace(*flagDataDir)
	)
	if dataDir != "" {
		_ = os.MkdirAll(dataDir, 0o700)
		prefsBackend = config.NewFilePreferencesBackend(filepath.Join(dataDir, "preferences.json"))
		secretsBackend = config.NewFileSecretsBackend(filepath.Join(dataDir, "secrets.json"))
	}

	cfgStore := config.NewStore(prefsBackend, secretsBackend)
	var themeOverride *config.ThemePreference
	if rawTheme := strings.TrimSpace(*flagTheme); rawTheme != "" {
		if pref, ok := config.ParseThemePreference(rawTheme); ok {
			themeOverride = &pref
		} else {
			fmt.Fprintf(os.Stderr, "linger-mobile: ignoring invalid --theme %q (expected system, light, or dark)\n", rawTheme)
		}
	}
	var langOverride *config.LanguagePreference
	if rawLang := strings.TrimSpace(*flagLang); rawLang != "" {
		if pref, ok := config.ParseLanguagePreference(rawLang); ok {
			langOverride = &pref
		} else {
			fmt.Fprintf(os.Stderr, "linger-mobile: ignoring invalid --lang %q (expected system, en, or zh-Hans)\n", rawLang)
		}
	}

	appStore := state.NewAppStore(state.Options{
		ConfigStore:      cfgStore,
		DataDir:          dataDir,
		ThemeOverride:    themeOverride,
		LanguageOverride: langOverride,
	})
	appShell := shell.New(appStore, func() bool {
		return mygo.Theme.IsDark()
	})

	mygo.App.OnOpenURL(func(rawURL string) {
		lower := strings.ToLower(strings.TrimSpace(rawURL))
		if strings.HasPrefix(lower, "lingerx://pair") || strings.HasPrefix(lower, "linger://pair") {
			appStore.SetPendingPairURI(rawURL)
		}
	})

	mygo.Power.OnSuspend(func() {
		appShell.SetSuspended(true)
		appStore.SetSuspended(true)
	})
	mygo.Power.OnResume(func() {
		appStore.SetSuspended(false)
		appShell.SetSuspended(false)
	})
	mygo.Network.OnChanged(func(status mygo.NetworkStatus) {
		appStore.SetOnline(status.Online)
	})

	mygo.App.OnWillQuit(func(_ *mygo.QuitEvent) {
		kept.ActiveTab = appStore.Snapshot().ActiveTab
		appShell.Close()
		appStore.StopDiscovery()
		appStore.Disconnect()
	})

	mygo.App.WhenReady(func() {
		if dataDir == "" {
			if userDir, err := mygo.App.Path(mygo.PathUserData); err == nil && userDir != "" {
				_ = os.MkdirAll(userDir, 0o700)
				appStore.SetDataDir(userDir)
			}
		}

		mygo.App.SetLanguages(i18n.SupportedLanguages()...)
		i18n.SetSystemLocaleFunc(func() string {
			return mygo.App.Locale()
		})

		initPrefs := appStore.Snapshot().Prefs
		mygo.App.SetLocale(i18n.MyGoLocaleTarget(initPrefs.Language))
		i18n.SetPreference(initPrefs.Language)
		mygo.Theme.SetSource(theme.ToMyGoSource(initPrefs.Theme))
		mygo.SystemBars.SetStyle(theme.ToSystemBarStyle(initPrefs.Theme))

		if kept.ActiveTab >= 0 && kept.ActiveTab <= 4 {
			if _, ok := cfgStore.ActiveHost(); ok {
				appStore.SetActiveTab(kept.ActiveTab)
			}
		}

		windowTitleForStore := func() string {
			snap := appStore.Snapshot()
			hostName := ""
			if snap.Phase == state.PhaseConnected && snap.ActiveHost != nil {
				hostName = strings.TrimSpace(snap.ActiveHost.Name)
			}
			return i18n.WindowTitle(hostName)
		}

		lastTitle := windowTitleForStore()
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:           lastTitle,
			BackgroundColor: theme.BackgroundHex(initPrefs.Theme, mygo.Theme.IsDark()),
			Width:           420,
			Height:          800,
			MinWidth:        320,
			MinHeight:       568,
			Content:         ui.View(appShell.View),
		})
		syncWindowTitle := func() {
			if next := windowTitleForStore(); next != lastTitle {
				lastTitle = next
				win.SetTitle(next)
			}
		}
		appShell.SetWindow(win)
		appStore.SetNotifier(func() {
			win.Update(func() {
				syncWindowTitle()
			})
		})
		appStore.SetOnThemeChanged(func(pref config.ThemePreference) {
			mygo.Theme.SetSource(theme.ToMyGoSource(pref))
			mygo.SystemBars.SetStyle(theme.ToSystemBarStyle(pref))
			win.Update(func() {
				_ = win.SetBackgroundColor(theme.BackgroundHex(pref, mygo.Theme.IsDark()))
			})
		})
		appStore.SetOnLanguageChanged(func(pref config.LanguagePreference) {
			mygo.App.SetLocale(i18n.MyGoLocaleTarget(pref))
			if pref == config.LanguageSystem {
				i18n.RefreshSystemLocale(mygo.App.Locale())
			}
			win.Update(func() {
				syncWindowTitle()
			})
		})
		mygo.Theme.OnUpdated(func() {
			snap := appStore.Snapshot()
			_ = win.SetBackgroundColor(theme.BackgroundHex(snap.Prefs.Theme, mygo.Theme.IsDark()))
			win.Update(func() {})
		})
		mygo.App.OnLocaleChanged(func(locale string) {
			i18n.RefreshSystemLocale(locale)
			syncWindowTitle()
			win.Update(func() {})
		})

		appStore.StartDiscovery(context.Background())

		// Connect immediately when launched with preview flags, pair URI, or a saved active host.
		if pairURI := strings.TrimSpace(*flagPairURI); pairURI != "" {
			appStore.SetPendingPairURI(pairURI)
		} else if hostURL := strings.TrimSpace(*flagHostURL); hostURL != "" {
			go func() {
				if err := appStore.ConfigurePreviewHost(context.Background(), hostURL, strings.TrimSpace(*flagToken), strings.TrimSpace(*flagTLSFP), *flagPlainHTTP); err == nil {
					win.Update(func() {
						appStore.Routers[state.TabMore].Replace("/more")
						appStore.SetActiveTab(state.TabRooms)
					})
				}
			}()
		} else if ah, ok := cfgStore.ActiveHost(); ok {
			go func() {
				_ = appStore.ConnectHost(context.Background(), ah.ID)
			}()
		}
	})

	mygo.App.Run()
}
