//go:build liveqa

package e2e_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/i18n"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func filteredQAEnv(sockPath string) []string {
	env := make([]string, 0, len(os.Environ())+1)
	for _, entry := range os.Environ() {
		if strings.HasPrefix(entry, "MYGO_AUTOMATION=") || strings.HasPrefix(entry, "MYGO_LOCALE=") {
			continue
		}
		env = append(env, entry)
	}
	return append(env, "MYGO_AUTOMATION="+sockPath)
}

func launchLingerMobileE2E(t *testing.T, dataDir string, extraArgs ...string) (*autoClient, func()) {
	t.Helper()
	binPath := filepath.Join(repoRoot(t), "mobile", ".bin", "linger-mobile-e2e")
	if _, err := os.Stat(binPath); err != nil {
		t.Fatalf("missing e2e binary at %s (run make -C mobile build-e2e): %v", binPath, err)
	}
	sockPath := filepath.Join(t.TempDir(), "auto.sock")
	args := append([]string{"--data-dir", dataDir}, extraArgs...)
	cmd := exec.Command(binPath, args...)
	cmd.Env = filteredQAEnv(sockPath)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start linger-mobile-e2e: %v", err)
	}
	var ac *autoClient
	stop := func() {
		if ac != nil {
			ac.Close()
			ac = nil
		}
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}
	t.Cleanup(stop)

	var err error
	ac, err = dialAutomation(sockPath, 15*time.Second)
	if err != nil {
		stop()
		t.Fatalf("dialAutomation(%s): %v", sockPath, err)
	}
	return ac, stop
}

func captureAndAssert(t *testing.T, ac *autoClient, outDir, filename string) {
	t.Helper()
	ac.idle(450)
	time.Sleep(150 * time.Millisecond)
	path := filepath.Join(outDir, filename)
	w, h, err := ac.captureTo(path)
	if err != nil {
		t.Fatalf("captureTo(%s): %v", filename, err)
	}
	if w <= 0 || h <= 0 {
		t.Fatalf("captureTo(%s) produced empty bounds %dx%d", filename, w, h)
	}
	t.Logf("captured %s (%dx%d)", path, w, h)
}

func trEN(key string) string { return i18n.Tp("en", key, nil) }
func trZH(key string) string { return i18n.Tp("zh-Hans", key, nil) }

func TestLiveThemeI18nQA(t *testing.T) {
	outDir := "/tmp/linger-mobile-theme-i18n-qa"
	if err := os.RemoveAll(outDir); err != nil {
		t.Fatalf("RemoveAll(%s): %v", outDir, err)
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", outDir, err)
	}

	// Pass A: Unpaired offline startup + 1-tap theme & language switches on Connect Hub & Prefs.
	offlineDir := t.TempDir()
	acOff, stopOff := launchLingerMobileE2E(t, offlineDir, "--theme", "light", "--lang", "en")
	if _, err := acOff.waitText(trEN("appearance.all_prefs"), 12*time.Second); err != nil {
		t.Fatalf("Pass A wait Connect Hub EN: %v", err)
	}
	captureAndAssert(t, acOff, outDir, "01-connect-offline-light-en.png")

	if err := acOff.pressContains(trEN("theme.pill_dark"), "button"); err != nil {
		t.Fatalf("Pass A tap Dark pill: %v", err)
	}
	captureAndAssert(t, acOff, outDir, "02-connect-offline-dark-en.png")

	if err := acOff.pressContains(trEN("lang.pill_zh"), "button"); err != nil {
		t.Fatalf("Pass A tap Chinese pill: %v", err)
	}
	if _, err := acOff.waitText(trZH("appearance.all_prefs"), 8*time.Second); err != nil {
		t.Fatalf("Pass A wait Connect Hub ZH: %v", err)
	}
	captureAndAssert(t, acOff, outDir, "03-connect-offline-dark-zh.png")

	if err := acOff.pressContains(trZH("appearance.all_prefs"), "button"); err != nil {
		t.Fatalf("Pass A tap All Prefs ZH: %v", err)
	}
	if _, err := acOff.waitText(trZH("settings.prefs.security_title"), 8*time.Second); err != nil {
		t.Fatalf("Pass A wait Prefs ZH: %v", err)
	}
	captureAndAssert(t, acOff, outDir, "04-prefs-offline-dark-zh.png")

	if err := acOff.pressContains(trZH("theme.light"), "button"); err != nil {
		t.Fatalf("Pass A tap Town Light ZH: %v", err)
	}
	captureAndAssert(t, acOff, outDir, "05-prefs-offline-light-zh.png")
	stopOff()

	// Pass B: Paired live app across all 5 tabs in Chinese + live theme/language switches.
	upstream, err := testutil.NewFakeServer(false)
	if err != nil {
		t.Fatalf("NewFakeServer upstream: %v", err)
	}
	upstream.SeedAllFixtures()
	defer upstream.Close()

	boot, gwURL := startRealStandaloneGateway(t, upstream.URL, t.TempDir())
	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        gwURL,
		Mode:           api.AuthModeCompanion,
		TLSFingerprint: boot.TLSFingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pairResp, err := client.Pair(ctx, api.PairRequest{
		PIN:        boot.PairingPIN,
		DeviceName: "Live Theme i18n QA",
		Platform:   "darwin",
		AppVersion: "0.1.0",
	})
	if err != nil {
		t.Fatalf("Pair: %v", err)
	}

	pairedDir := t.TempDir()
	acLive, stopLive := launchLingerMobileE2E(
		t,
		pairedDir,
		"--host-url", gwURL,
		"--token", pairResp.Token,
		"--tls-fp", boot.TLSFingerprint,
		"--theme", "light",
		"--lang", "zh-Hans",
	)
	defer stopLive()

	if _, err := acLive.waitText("Product Launch", 15*time.Second); err != nil {
		t.Fatalf("Pass B wait Rooms populated: %v", err)
	}
	captureAndAssert(t, acLive, outDir, "06-rooms-light-zh.png")

	if err := acLive.pressContains(trZH("tab.live"), "tab"); err != nil {
		t.Fatalf("Pass B tap Live tab: %v", err)
	}
	if _, err := acLive.waitText(trZH("live.tab.compute"), 8*time.Second); err != nil {
		t.Fatalf("Pass B wait Live tab: %v", err)
	}
	if err := acLive.pressContains(trZH("live.tab.compute"), ""); err != nil {
		t.Fatalf("Pass B tap Compute subtab: %v", err)
	}
	captureAndAssert(t, acLive, outDir, "07-live-compute-light-zh.png")

	if err := acLive.pressContains(trZH("tab.work"), "tab"); err != nil {
		t.Fatalf("Pass B tap Work tab: %v", err)
	}
	if _, err := acLive.waitText(trZH("work.tab.issues"), 8*time.Second); err != nil {
		t.Fatalf("Pass B wait Work tab: %v", err)
	}
	captureAndAssert(t, acLive, outDir, "08-work-issues-light-zh.png")

	if err := acLive.pressContains(trZH("tab.library"), "tab"); err != nil {
		t.Fatalf("Pass B tap Library tab: %v", err)
	}
	if _, err := acLive.waitText(trZH("library.tab.wiki"), 8*time.Second); err != nil {
		t.Fatalf("Pass B wait Library tab: %v", err)
	}
	if err := acLive.pressContains(trZH("library.tab.wiki"), ""); err != nil {
		t.Fatalf("Pass B tap Wiki subtab: %v", err)
	}
	captureAndAssert(t, acLive, outDir, "09-library-wiki-light-zh.png")

	if err := acLive.pressContains(trZH("tab.more"), "tab"); err != nil {
		t.Fatalf("Pass B tap More tab: %v", err)
	}
	if _, err := acLive.waitText(trZH("appearance.title"), 8*time.Second); err != nil {
		t.Fatalf("Pass B wait More Overview ZH: %v", err)
	}
	captureAndAssert(t, acLive, outDir, "10-more-overview-light-zh.png")

	if err := acLive.pressContains(trZH("theme.dark"), "button"); err != nil {
		t.Fatalf("Pass B tap Town Dark ZH: %v", err)
	}
	captureAndAssert(t, acLive, outDir, "11-more-overview-dark-zh.png")

	if err := acLive.pressContains(trZH("tab.rooms"), "tab"); err != nil {
		t.Fatalf("Pass B return to Rooms tab: %v", err)
	}
	if _, err := acLive.waitText("Product Launch", 8*time.Second); err != nil {
		t.Fatalf("Pass B wait Rooms dark ZH: %v", err)
	}
	captureAndAssert(t, acLive, outDir, "12-rooms-dark-zh.png")

	if err := acLive.pressContains(trZH("tab.more"), "tab"); err != nil {
		t.Fatalf("Pass B tap More tab for EN switch: %v", err)
	}
	if _, err := acLive.waitText(trZH("lang.en"), 8*time.Second); err != nil {
		t.Fatalf("Pass B wait More language pill: %v", err)
	}
	if err := acLive.pressContains(trZH("lang.en"), "button"); err != nil {
		t.Fatalf("Pass B tap English: %v", err)
	}
	if _, err := acLive.waitText(trEN("appearance.title"), 8*time.Second); err != nil {
		t.Fatalf("Pass B wait More Overview EN: %v", err)
	}
	captureAndAssert(t, acLive, outDir, "13-more-overview-dark-en.png")
}
