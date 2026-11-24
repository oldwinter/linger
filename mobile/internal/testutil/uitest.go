package testutil

import "github.com/egoist/mygo/ui"

// MobileViewport describes a target phone screen geometry for UI layout tests.
type MobileViewport struct {
	Name   string
	Width  int
	Height int
	Top    float32
	Bottom float32
}

// StandardMobileViewports covers narrow (320px), standard iPhone (390px), and preview (420px) widths.
var StandardMobileViewports = []MobileViewport{
	{Name: "320x640", Width: 320, Height: 640, Top: 44, Bottom: 24},
	{Name: "390x844", Width: 390, Height: 844, Top: 59, Bottom: 34},
	{Name: "420x800", Width: 420, Height: 800, Top: 59, Bottom: 34},
}

// NewPhoneTester builds a ui.Tester configured with realistic iPhone safe-area insets.
func NewPhoneTester(view func(c *ui.Context), vp MobileViewport) *ui.Tester {
	tt := ui.NewTester(view, vp.Width, vp.Height)
	tt.SetInsets(vp.Top, 0, vp.Bottom, 0)
	return tt
}

// ApplyKeyboardInset simulates an open soft keyboard over the bottom edge.
func ApplyKeyboardInset(tt *ui.Tester, top float32) {
	tt.SetInsets(top, 0, 336, 0)
}
