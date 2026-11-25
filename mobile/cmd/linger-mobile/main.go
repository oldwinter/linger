package main

import (
	"context"
	"flag"
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
	if rawTheme := strings.TrimSpace(*flagTheme); rawTheme != "" {
		if pref, ok := config.ParseThemePreference(rawTheme); ok {
			_ = cfgStore.SetPreferences(withTheme(cfgStore.Preferences(), pref))
		}
	}
	forcedLang := false
	if rawLang := strings.TrimSpace(*flagLang); rawLang != "" {
		if pref, ok := config.ParseLanguagePreference(rawLang); ok {
			_ = cfgStore.SetPreferences(withLanguage(cfgStore.Preferences(), pref))
			forcedLang = true
		}
	}

	appStore := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     dataDir,
	})
	appShell := shell.New(appStore, func() bool {
		return mygo.Theme.IsDark()
	})

	mygo.App.OnOpenURL(func(rawURL string) {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(rawURL)), "linger://pair") {
			appStore.SetPendingPairURI(rawURL)
		}
	})

	mygo.Power.OnSuspend(func() {
		appStore.SetSuspended(true)
	})
	mygo.Power.OnResume(func() {
		appStore.SetSuspended(false)
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
		if forcedLang || initPrefs.Language != config.LanguageSystem {
			target := ""
			if initPrefs.Language != config.LanguageSystem {
				target = i18n.ResolveLocale(initPrefs.Language, "")
			}
			mygo.App.SetLocale(target)
		}
		i18n.SetPreference(initPrefs.Language)
		mygo.Theme.SetSource(theme.ToMyGoSource(initPrefs.Theme))
		mygo.SystemBars.SetStyle(theme.ToSystemBarStyle(initPrefs.Theme))

		if kept.ActiveTab >= 0 && kept.ActiveTab <= 4 {
			if _, ok := cfgStore.ActiveHost(); ok {
				appStore.SetActiveTab(kept.ActiveTab)
			}
		}

		win := mygo.NewWindow(mygo.WindowOptions{
			Title:           i18n.WindowTitle(""),
			BackgroundColor: theme.BackgroundHex(initPrefs.Theme, mygo.Theme.IsDark()),
			Width:           420,
			Height:          800,
			MinWidth:        320,
			MinHeight:       568,
			Content:         ui.View(appShell.View),
		})
		appShell.SetWindow(win)
		appStore.SetNotifier(func() {
			win.Update(func() {})
		})
		appStore.SetOnThemeChanged(func(pref config.ThemePreference) {
			mygo.Theme.SetSource(theme.ToMyGoSource(pref))
			mygo.SystemBars.SetStyle(theme.ToSystemBarStyle(pref))
			win.Update(func() {
				_ = win.SetBackgroundColor(theme.BackgroundHex(pref, mygo.Theme.IsDark()))
			})
		})
		appStore.SetOnLanguageChanged(func(pref config.LanguagePreference) {
			target := ""
			if pref != config.LanguageSystem {
				target = i18n.ResolveLocale(pref, "")
			}
			mygo.App.SetLocale(target)
			win.Update(func() {
				win.SetTitle(i18n.WindowTitle(""))
			})
		})
		mygo.Theme.OnUpdated(func() {
			snap := appStore.Snapshot()
			_ = win.SetBackgroundColor(theme.BackgroundHex(snap.Prefs.Theme, mygo.Theme.IsDark()))
			win.Update(func() {})
		})
		mygo.App.OnLocaleChanged(func(locale string) {
			i18n.RefreshSystemLocale(locale)
			win.SetTitle(i18n.WindowTitle(""))
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

func withTheme(p config.AppPreferences, pref config.ThemePreference) config.AppPreferences {
	p.Theme = pref
	return p
}

func withLanguage(p config.AppPreferences, pref config.LanguagePreference) config.AppPreferences {
	p.Language = pref
	return p
}
