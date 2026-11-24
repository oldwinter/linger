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
	"github.com/oldwinter/linger/mobile/internal/shell"
	"github.com/oldwinter/linger/mobile/internal/state"
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
	if forced := strings.ToLower(strings.TrimSpace(*flagTheme)); forced != "" {
		switch forced {
		case "light":
			_ = cfgStore.SetPreferences(withTheme(cfgStore.Preferences(), config.ThemeLight))
		case "dark":
			_ = cfgStore.SetPreferences(withTheme(cfgStore.Preferences(), config.ThemeDark))
		case "system":
			_ = cfgStore.SetPreferences(withTheme(cfgStore.Preferences(), config.ThemeSystem))
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

		if kept.ActiveTab >= 0 && kept.ActiveTab <= 4 {
			if _, ok := cfgStore.ActiveHost(); ok {
				appStore.SetActiveTab(kept.ActiveTab)
			}
		}

		win := mygo.NewWindow(mygo.WindowOptions{
			Title:     "Linger Mobile",
			Width:     420,
			Height:    800,
			MinWidth:  320,
			MinHeight: 568,
			Content:   ui.View(appShell.View),
		})
		appShell.SetWindow(win)
		appStore.SetNotifier(func() {
			win.Update(func() {})
		})
		mygo.Theme.OnUpdated(func() {
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
