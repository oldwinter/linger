package shell_test

import (
	"context"
	"math"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/screens/library"
	"github.com/oldwinter/linger/mobile/internal/screens/live"
	"github.com/oldwinter/linger/mobile/internal/screens/settings"
	"github.com/oldwinter/linger/mobile/internal/screens/work"
	"github.com/oldwinter/linger/mobile/internal/shell"
	"github.com/oldwinter/linger/mobile/internal/state"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func setupFoldableShell(t *testing.T) (*testutil.FakeServer, *state.AppStore, *shell.Shell) {
	t.Helper()
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	srv.SeedAllFixtures()

	cfgStore := config.NewStore(config.NewMemoryPreferencesBackend(), config.NewMemorySecretsBackend())
	_ = cfgStore.SetPreferences(config.AppPreferences{
		Theme:    config.ThemeLight,
		Language: config.LanguageEN,
	})
	store := state.NewAppStore(state.Options{
		ConfigStore: cfgStore,
		DataDir:     t.TempDir(),
	})
	if err := store.ConfigurePreviewHost(context.Background(), srv.URL, srv.ValidToken, srv.Fingerprint, false); err != nil {
		srv.Close()
		store.Disconnect()
		t.Fatalf("ConfigurePreviewHost: %v", err)
	}
	store.SetActiveTab(state.TabRooms)

	appShell := shell.New(store, func() bool { return false })
	appShell.Work().Refresh(context.Background())
	appShell.Library().Refresh(context.Background())
	appShell.Settings().Refresh(context.Background())
	return srv, store, appShell
}

func TestFoldableDynamicResizeAndHingeAlignment(t *testing.T) {
	srv, store, appShell := setupFoldableShell(t)
	defer srv.Close()
	defer store.Disconnect()
	defer appShell.Close()

	// Start folded on Android Z Fold cover display (344x882).
	coverVP := testutil.FoldableViewports[0]
	tt := testutil.NewPhoneTester(appShell.View, coverVP)
	tt.Frame()

	// Compact cover screen uses Bottom Dock (wide horizontal tablist near bottom edge).
	navRect, ok := tt.Find("Navigation")
	if !ok {
		t.Fatal("expected Navigation tablist on Android Z Fold cover screen")
	}
	if navRect.W < 300 || navRect.Y < 700 {
		t.Fatalf("expected horizontal bottom dock on cover 344x882, got rect=%+v", navRect)
	}

	// Unfold live to Android Galaxy Z Fold inner display (720x840) — no restart, state preserved!
	zfoldInner := testutil.FoldableViewports[1]
	testutil.ResizeViewport(tt, zfoldInner)
	tt.Frame()

	navRect, ok = tt.Find("Navigation")
	if !ok {
		t.Fatal("expected Navigation rail on Z Fold unfolded 720x840")
	}
	if navRect.W > 90 || navRect.H < 700 {
		t.Fatalf("expected vertical left navigation rail on Z Fold unfolded 720x840, got rect=%+v", navRect)
	}

	// Master Rooms list AND Chat Detail (Inspector button) must be simultaneously visible!
	if !tt.HasText("Product Launch") || !tt.HasText("Catch-Up") || !tt.HasText("Inspector") {
		t.Fatal("expected simultaneous Rooms list + Chat detail in split pane on Z Fold unfolded 720x840")
	}

	// Verify Master pane stays completely left of the physical 50% hinge crease (x = 360dp)
	// and Detail content sits cleanly to the right of the crease.
	creaseX := float32(zfoldInner.Width) / 2
	newBtnRect, ok := tt.Find("New Room")
	if !ok {
		t.Fatal("expected New Room button at right edge of master pane on Z Fold unfolded")
	}
	inspRect, ok := tt.Find("Room Inspector")
	if !ok {
		t.Fatal("expected Room Inspector button in detail pane on Z Fold unfolded")
	}
	if newBtnRect.X+newBtnRect.W > creaseX {
		t.Fatalf("Z Fold master controls cross crease: right=%.1f > creaseX=%.1f", newBtnRect.X+newBtnRect.W, creaseX)
	}
	if diff := math.Abs(float64((newBtnRect.X + newBtnRect.W + 10) - creaseX)); diff > 8.0 {
		t.Fatalf("Z Fold master pane edge expected near crease %.1f, right+pad=%.1f", creaseX, newBtnRect.X+newBtnRect.W+10)
	}
	if inspRect.X < creaseX {
		t.Fatalf("Z Fold detail Inspector expected right of crease %.1f, got X=%.1f", creaseX, inspRect.X)
	}

	// Transition live to iPhone Duo Outer Cover (466x678, short-height wide cover display).
	duoCover := testutil.FoldableViewports[3]
	testutil.ResizeViewport(tt, duoCover)
	tt.Frame()

	navRect, ok = tt.Find("Navigation")
	if !ok || navRect.W < 400 {
		t.Fatalf("expected compact bottom dock on iPhone Duo cover 466x678, got ok=%v rect=%+v", ok, navRect)
	}
	if tt.HasText("Inspector") {
		t.Fatal("expected single-pane Rooms list (not split chat) when folded on iPhone Duo cover 466x678")
	}

	// Unfold live to iPhone Duo Inner Portrait (669x951) and verify exact crease alignment (x = 334.5pt).
	duoInner := testutil.FoldableViewports[4]
	testutil.ResizeViewport(tt, duoInner)
	tt.Frame()

	if !tt.HasText("Product Launch") || !tt.HasText("Inspector") {
		t.Fatal("expected simultaneous Rooms master + Chat detail on iPhone Duo unfolded 669x951")
	}
	duoCreaseX := float32(duoInner.Width) / 2
	newBtnRect, ok = tt.Find("New Room")
	if !ok {
		t.Fatal("expected New Room button on iPhone Duo unfolded")
	}
	inspRect, ok = tt.Find("Room Inspector")
	if !ok {
		t.Fatal("expected Room Inspector button on iPhone Duo unfolded")
	}
	if newBtnRect.X+newBtnRect.W > duoCreaseX {
		t.Fatalf("iPhone Duo master controls cross crease: right=%.1f > creaseX=%.1f", newBtnRect.X+newBtnRect.W, duoCreaseX)
	}
	if diff := math.Abs(float64((newBtnRect.X + newBtnRect.W + 10) - duoCreaseX)); diff > 8.0 {
		t.Fatalf("iPhone Duo master pane edge expected near crease %.1f, right+pad=%.1f", duoCreaseX, newBtnRect.X+newBtnRect.W+10)
	}
	if inspRect.X < duoCreaseX {
		t.Fatalf("iPhone Duo detail Inspector expected right of crease %.1f, got X=%.1f", duoCreaseX, inspRect.X)
	}

	// Rotate live to iPhone Duo Inner Landscape (951x669, safeLeft=54pt) and traverse all 5 tabs + dark/ZH.
	duoLand := testutil.FoldableViewports[5]
	testutil.ResizeViewport(tt, duoLand)

	// Tab 2: Live -> Compute (2-pane Host + Local Computers + 2-col Local Models)
	store.SetActiveTab(state.TabLive)
	appShell.Live().SelectSegment(live.SegmentCompute)
	tt.Frame()
	if !tt.HasText("Desktop Companion Host") || !tt.HasText("Qwen3 4B") {
		t.Fatal("expected Compute 2-pane layout on iPhone Duo landscape")
	}

	// Tab 3: Work -> Issues & Pocket (2-pane Today + Past Days)
	store.SetActiveTab(state.TabWork)
	appShell.Work().SelectSegment(work.SegmentIssues)
	tt.Frame()
	if !tt.HasText("Ship Mobile Companion Wave C-2") {
		t.Fatal("expected Work Issues grid on iPhone Duo landscape")
	}
	appShell.Work().SelectSegment(work.SegmentPocket)
	tt.Frame()
	if !tt.HasText("Today's Pocket Note") || !tt.HasText("Past Days") {
		t.Fatal("expected Pocket Notes side-by-side panes on iPhone Duo landscape")
	}

	// Tab 4: Library -> Wiki Knowledge Graph (2-pane canvas + legend)
	store.SetActiveTab(state.TabLibrary)
	appShell.Library().SelectSegment(library.SegmentWiki)
	tt.Frame()
	if !tt.HasText("Personal Knowledge Wiki") || !tt.HasText("Reset Zoom") {
		t.Fatal("expected Wiki Knowledge Graph side-by-side layout on iPhone Duo landscape")
	}

	// Tab 5: More -> Overview in Dark + Chinese
	_ = store.SetThemePreference(config.ThemeDark)
	_ = store.SetLanguagePreference(config.LanguageZhHans)
	store.SetActiveTab(state.TabMore)
	store.Routers[state.TabMore].Replace("/more")
	appShell.Settings().SelectSection(settings.SectionOverview)
	tt.Frame()
	// Verify ZH localized overview rendered cleanly without panic on expanded foldable.
	if !tt.HasText("\u5916\u89c2\u4e0e\u8bed\u8a00") {
		t.Fatal("expected ZH Appearance & Language card on unfolded landscape More overview")
	}
}

func TestFoldableSplitPaneBackStackContinuity(t *testing.T) {
	srv, store, appShell := setupFoldableShell(t)
	defer srv.Close()
	defer store.Disconnect()
	defer appShell.Close()

	// Start unfolded on iPhone Duo inner display (669x951) at /rooms.
	duoInner := testutil.FoldableViewports[4]
	duoCover := testutil.FoldableViewports[3]

	tt := testutil.NewPhoneTester(appShell.View, duoInner)
	tt.Frame()

	// Tap "Product Launch" row in master list while unfolded.
	if err := tt.Click("Product Launch"); err != nil {
		t.Fatalf("click Product Launch room row: %v", err)
	}
	tt.Frame()

	// Unfolded top bar should suppress global Back while viewing a top-level room in split pane.
	if _, ok := tt.Find("Back"); ok {
		t.Fatal("expected no redundant global Back button for top-level room in split-pane mode")
	}

	// Now fold device to iPhone Duo cover screen (466x678): user must remain in the room
	// with a working Back button that returns cleanly to /rooms.
	testutil.ResizeViewport(tt, duoCover)
	tt.Frame()

	if _, ok := tt.Find("Back"); !ok {
		t.Fatal("expected global Back button after folding from split-pane room to cover screen")
	}
	if !tt.HasText("Inspector") {
		t.Fatal("expected active room chat preserved after folding to cover screen")
	}

	if err := tt.Click("Back"); err != nil {
		t.Fatalf("click Back button on cover screen: %v", err)
	}
	tt.Frame()
	if _, ok := tt.Find("Back"); ok || !tt.HasText("Catch-Up") {
		t.Fatal("expected Back button on cover screen to return to Rooms list")
	}

	// Unfold again: last viewed room should automatically populate the right detail pane.
	testutil.ResizeViewport(tt, duoInner)
	tt.Frame()
	if !tt.HasText("Inspector") || !tt.HasText("Product Launch") {
		t.Fatal("expected last-viewed room restored in right detail pane after unfolding")
	}
}

func TestAllFoldableViewportsRenderEveryTabCleanly(t *testing.T) {
	srv, store, appShell := setupFoldableShell(t)
	defer srv.Close()
	defer store.Disconnect()
	defer appShell.Close()

	for _, vp := range testutil.FoldableViewports {
		t.Run(vp.Name, func(t *testing.T) {
			store.Routers[state.TabRooms] = ui.NewRouter("/rooms")
			store.Routers[state.TabMore] = ui.NewRouter("/more")
			tt := testutil.NewPhoneTester(appShell.View, vp)

			for _, tab := range []int{state.TabRooms, state.TabLive, state.TabWork, state.TabLibrary, state.TabMore} {
				store.SetActiveTab(tab)
				tt.Frame()
				if tt.Image() == nil {
					t.Fatalf("nil image rendered for tab %d on %s", tab, vp.Name)
				}
			}
		})
	}
}
