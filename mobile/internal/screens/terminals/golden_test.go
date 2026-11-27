package terminals_test

import (
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/herdr"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func matchAndOptionalCopyGolden(t *testing.T, tt *ui.Tester, goldenName string) {
	t.Helper()
	goldenPath := filepath.Join("testdata", goldenName)
	testutil.MatchGolden(t, tt, goldenPath)

	previewDir := os.Getenv("TERMINALS_PREVIEW_DIR")
	if previewDir == "" {
		return
	}
	img := tt.Image()
	if img == nil {
		t.Fatalf("%s: nil image for preview copy", goldenName)
	}
	if err := os.MkdirAll(previewDir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", previewDir, err)
	}
	f, err := os.Create(filepath.Join(previewDir, goldenName))
	if err != nil {
		t.Fatalf("create preview %s: %v", goldenName, err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatalf("encode preview %s: %v", goldenName, err)
	}
}

func newRichGoldenBackend(t *testing.T) *fakeHerdrBackend {
	t.Helper()
	fb := newFakeHerdrBackend(t)
	offline := false
	fb.mu.Lock()
	fb.machines = append(fb.machines, herdr.MachineView{
		Name:   "gpu-box",
		Status: "offline",
		Online: &offline,
	})
	fb.screenByAddr["vps/t7"] = herdr.ReadResult{
		Text: "$ cd /srv/linger && ./scripts/migrate.sh up --dry-run\n" +
			"Connecting to postgres://linger@127.0.0.1:5432/teamhub...\n" +
			"Found 2 pending migrations:\n" +
			"  0048_add_herdr_core_terminal_events.sql\n" +
			"  0049_add_companion_audit_index_for_long_line_overflow_check.sql\n" +
			"Dry-run diff: +2 tables, +3 indexes (0 destructive changes)\n" +
			"Apply 2 pending migrations to production cluster? [y/N] ",
		Complete: true,
		How:      "history",
	}
	fb.mu.Unlock()
	return fb
}

func TestTerminalsGoldenSnapshots(t *testing.T) {
	t.Cleanup(func() {
		i18n.SetPreference(config.LanguageEN)
	})

	vpPhone := testutil.StandardMobileViewports[1] // 390x844
	vpFold := testutil.FoldableViewports[1]        // 720x840 Android Z Fold unfolded

	renderOverview := func(lang config.LanguagePreference, dark bool, vp testutil.MobileViewport, name string) {
		t.Helper()
		i18n.SetPreference(lang)
		fb := newRichGoldenBackend(t)
		scr, _ := newTestTerminalsScreen(t, fb)
		tt := testutil.NewPhoneTester(func(c *ui.Context) {
			if dark {
				c.SetTheme(theme.TownDark())
			} else {
				c.SetTheme(theme.TownLight())
			}
			scr.View(c)
		}, vp)
		tt.Frame()
		matchAndOptionalCopyGolden(t, tt, name)
	}

	// 1. Overview: Light & Dark, EN & zh-Hans, Phone (390x844) + Unfolded Foldable (720x840).
	renderOverview(config.LanguageEN, false, vpPhone, "terminals_overview_light_390x844.png")
	renderOverview(config.LanguageEN, true, vpPhone, "terminals_overview_dark_390x844.png")
	renderOverview(config.LanguageZhHans, false, vpPhone, "terminals_overview_zh_light_390x844.png")
	renderOverview(config.LanguageZhHans, true, vpPhone, "terminals_overview_zh_dark_390x844.png")
	renderOverview(config.LanguageEN, false, vpFold, "terminals_overview_foldable_light_720x840.png")

	// 2. Terminal Detail: monospace scrollback + blocked context + plate toolbar + quick keys + send dock.
	renderDetail := func(lang config.LanguagePreference, dark bool, name string) {
		t.Helper()
		i18n.SetPreference(lang)
		fb := newRichGoldenBackend(t)
		scr, _ := newTestTerminalsScreen(t, fb)
		tt := testutil.NewPhoneTester(func(c *ui.Context) {
			if dark {
				c.SetTheme(theme.TownDark())
			} else {
				c.SetTheme(theme.TownLight())
			}
			scr.View(c)
		}, vpPhone)
		tt.Frame()
		scr.OpenTerminal("vps/t7")
		waitUntil(t, 2*time.Second, func() bool {
			tt.Frame()
			return tt.HasText("Found 2 pending migrations")
		})
		tt.Frame()
		matchAndOptionalCopyGolden(t, tt, name)
	}
	renderDetail(config.LanguageEN, true, "terminals_detail_dark_390x844.png")
	renderDetail(config.LanguageZhHans, false, "terminals_detail_zh_light_390x844.png")

	// 3. Quick Launch Sheet: templates + machine picker + smart defaults.
	renderLaunch := func(lang config.LanguagePreference, dark bool, name string) {
		t.Helper()
		i18n.SetPreference(lang)
		fb := newRichGoldenBackend(t)
		scr, _ := newTestTerminalsScreen(t, fb)
		tt := testutil.NewPhoneTester(func(c *ui.Context) {
			if dark {
				c.SetTheme(theme.TownDark())
			} else {
				c.SetTheme(theme.TownLight())
			}
			scr.View(c)
		}, vpPhone)
		tt.Frame()
		if err := tt.Click(i18n.T("terminals.launch_short")); err != nil {
			t.Fatalf("click launch (%s): %v", name, err)
		}
		settle(tt)
		matchAndOptionalCopyGolden(t, tt, name)
	}
	renderLaunch(config.LanguageEN, false, "terminals_launch_light_390x844.png")
	renderLaunch(config.LanguageZhHans, true, "terminals_launch_zh_dark_390x844.png")

	// 4. Unavailable / offline empty state: Dark EN & Light zh-Hans.
	renderUnavailable := func(lang config.LanguagePreference, dark bool, name string) {
		t.Helper()
		i18n.SetPreference(lang)
		fb := newRichGoldenBackend(t)
		fb.mu.Lock()
		fb.unavailable = true
		fb.unavailableSt = http.StatusServiceUnavailable
		fb.mu.Unlock()
		scr, _ := newTestTerminalsScreen(t, fb)
		tt := testutil.NewPhoneTester(func(c *ui.Context) {
			if dark {
				c.SetTheme(theme.TownDark())
			} else {
				c.SetTheme(theme.TownLight())
			}
			scr.View(c)
		}, vpPhone)
		tt.Frame()
		matchAndOptionalCopyGolden(t, tt, name)
	}
	renderUnavailable(config.LanguageEN, true, "terminals_unavailable_dark_390x844.png")
	renderUnavailable(config.LanguageZhHans, false, "terminals_unavailable_zh_light_390x844.png")
}
