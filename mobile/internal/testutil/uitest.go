package testutil

import (
	"image/png"
	"os"
	"runtime"
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/golden"
)

// MobileViewport describes a target phone or foldable screen geometry for UI layout tests.
type MobileViewport struct {
	Name   string
	Width  int
	Height int
	Top    float32
	Right  float32
	Bottom float32
	Left   float32
}

// StandardMobileViewports covers narrow (320px), standard iPhone (390px), and preview (420px) widths.
var StandardMobileViewports = []MobileViewport{
	{Name: "320x640", Width: 320, Height: 640, Top: 44, Bottom: 24},
	{Name: "390x844", Width: 390, Height: 844, Top: 59, Bottom: 34},
	{Name: "420x800", Width: 420, Height: 800, Top: 59, Bottom: 34},
}

// FoldableViewports covers real Android book-style foldables and iPhone Duo outer/inner displays.
var FoldableViewports = []MobileViewport{
	{Name: "android_zfold_cover_344x882", Width: 344, Height: 882, Top: 32, Bottom: 24},
	{Name: "android_zfold_unfolded_720x840", Width: 720, Height: 840, Top: 28, Bottom: 24},
	{Name: "android_pixel_fold_800x840", Width: 800, Height: 840, Top: 28, Bottom: 24},
	{Name: "iphone_duo_cover_466x678", Width: 466, Height: 678, Top: 0, Right: 84, Bottom: 21},
	{Name: "iphone_duo_unfolded_669x951", Width: 669, Height: 951, Top: 24, Bottom: 21},
	{Name: "iphone_duo_landscape_951x669", Width: 951, Height: 669, Top: 24, Bottom: 21, Left: 54},
}

// NewPhoneTester builds a ui.Tester configured with realistic safe-area insets.
func NewPhoneTester(view func(c *ui.Context), vp MobileViewport) *ui.Tester {
	tt := ui.NewTester(view, vp.Width, vp.Height)
	tt.SetInsets(vp.Top, vp.Right, vp.Bottom, vp.Left)
	return tt
}

// ResizeViewport transitions an existing ui.Tester to vp (simulating fold/unfold/rotation).
func ResizeViewport(tt *ui.Tester, vp MobileViewport) {
	tt.SetSize(vp.Width, vp.Height)
	tt.SetInsets(vp.Top, vp.Right, vp.Bottom, vp.Left)
}

// ApplyKeyboardInset simulates an open soft keyboard over the bottom edge.
func ApplyKeyboardInset(tt *ui.Tester, top float32) {
	tt.SetInsets(top, 0, 336, 0)
}

// MatchGolden compares tt's rendered frame against the checked-in darwin
// pixel golden on macOS. On other platforms, native text shaping differs
// from macOS renders (see mygo/ui/golden), so MatchGolden still renders the
// frame under test and verifies the golden PNG decodes with matching bounds.
func MatchGolden(t testing.TB, tt *ui.Tester, path string, tol ...golden.Tolerance) {
	t.Helper()
	if runtime.GOOS == "darwin" {
		golden.Match(t, tt, path, tol...)
		return
	}
	tt.Frame()
	img := tt.Image()
	if img == nil {
		t.Fatalf("%s: rendered image is nil", path)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("%s: open golden: %v", path, err)
	}
	defer f.Close()
	cfg, err := png.DecodeConfig(f)
	if err != nil {
		t.Fatalf("%s: decode golden config: %v", path, err)
	}
	b := img.Bounds()
	if b.Dx() != cfg.Width || b.Dy() != cfg.Height {
		t.Fatalf("%s: rendered size %dx%d != golden size %dx%d", path, b.Dx(), b.Dy(), cfg.Width, cfg.Height)
	}
}
