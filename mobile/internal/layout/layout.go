// Package layout classifies mobile, tablet, and foldable window geometries
// (Android foldables, iPhone Duo outer/inner displays, split-screen multi-window,
// and landscape orientations) and provides responsive container helpers.
package layout

import "github.com/egoist/mygo/ui"

// WindowClass follows responsive size-class thresholds in DIPs/points:
//   - ClassCompact:  width < 600  (phones, foldable cover screens, narrow split-screen)
//   - ClassMedium:   600 <= w < 840 (unfolded book-style foldables: iPhone Duo 669pt, Z Fold 720dp, Pixel Fold 800dp)
//   - ClassExpanded: width >= 840 (landscape foldables: iPhone Duo 951pt, tablets)
type WindowClass int

const (
	// ClassCompact represents single-column phones and foldable cover displays.
	ClassCompact WindowClass = iota
	// ClassMedium represents portrait unfolded book-style foldables and small tablets.
	ClassMedium
	// ClassExpanded represents landscape unfolded foldables and large tablets.
	ClassExpanded
)

// Breakpoint thresholds in DIPs/points.
const (
	MediumMinWidth    float32 = 600
	SplitPaneMinWidth float32 = 640
	ExpandedMinWidth  float32 = 840
	ShortHeightMax    float32 = 700
)

// Metrics describes the current window geometry and adaptive layout decisions.
type Metrics struct {
	Width            float32
	Height           float32
	SafeTop          float32
	SafeRight        float32
	SafeBottom       float32
	SafeLeft         float32
	Class            WindowClass
	Landscape        bool
	ShortHeight      bool // True on compact-height displays (e.g. iPhone Duo cover 466x678, landscape)
	UseNavRail       bool // Left navigation rail instead of bottom dock bar
	UseSplitPane     bool // Hinge-aligned two-pane master-detail (Tab 1 Rooms + Chat)
	RailWidth        float32
	MasterWidth      float32
	GridColumns      int
	ReadableMaxWidth float32 // 0 on Compact (full bleed), capped on Medium/Expanded
	SheetMaxWidth    float32 // 0 on Compact (full bleed), capped on Medium/Expanded
}

// Of computes adaptive foldable/responsive metrics from the active MyGo UI context.
func Of(c *ui.Context) Metrics {
	w, h := c.Size()
	top, right, bottom, left := c.SafeArea()
	return Compute(w, h, top, right, bottom, left)
}

// Compute calculates Metrics from explicit window dimensions and safe-area insets.
func Compute(w, h, safeTop, safeRight, safeBottom, safeLeft float32) Metrics {
	m := Metrics{
		Width:       w,
		Height:      h,
		SafeTop:     safeTop,
		SafeRight:   safeRight,
		SafeBottom:  safeBottom,
		SafeLeft:    safeLeft,
		Class:       ClassCompact,
		Landscape:   w > 0 && h > 0 && w > h,
		ShortHeight: h > 0 && h < ShortHeightMax,
		GridColumns: 1,
	}

	switch {
	case w >= ExpandedMinWidth:
		m.Class = ClassExpanded
		m.UseNavRail = true
		m.UseSplitPane = true
		m.RailWidth = 80
		m.GridColumns = 2
		m.ReadableMaxWidth = 920
		m.SheetMaxWidth = 600
	case w >= MediumMinWidth:
		m.Class = ClassMedium
		m.UseNavRail = true
		m.UseSplitPane = w >= SplitPaneMinWidth
		m.RailWidth = 72
		m.GridColumns = 2
		m.ReadableMaxWidth = 780
		m.SheetMaxWidth = 560
	default:
		m.Class = ClassCompact
		m.UseNavRail = false
		m.UseSplitPane = false
		m.GridColumns = 1
	}

	if m.UseSplitPane {
		// Align the Master|Detail vertical divider with the physical center fold
		// crease (x = w/2) on book-style foldables (iPhone Duo 669pt, Z Fold 720dp,
		// Pixel Fold 800dp) while keeping both panes comfortably legible.
		creaseMaster := w/2 - safeLeft - m.RailWidth
		const (
			minMaster float32 = 240
			maxMaster float32 = 324
		)
		if creaseMaster < minMaster {
			creaseMaster = minMaster
		}
		if creaseMaster > maxMaster {
			creaseMaster = maxMaster
		}
		// Never starve the right detail pane on tight split-screen windows.
		usable := w - safeLeft - safeRight - m.RailWidth
		if maxAllow := usable - 300; maxAllow >= 220 && creaseMaster > maxAllow {
			creaseMaster = maxAllow
		}
		m.MasterWidth = creaseMaster
	}

	return m
}

// ReadableWrap centers content inside a max-width column on unfolded/wide screens.
// When maxW <= 0 (compact phones), fn is called directly with zero wrapper overhead
// so existing phone layouts remain pixel-identical.
func ReadableWrap(c *ui.Context, maxW float32, fn func()) {
	if maxW <= 0 {
		fn()
		return
	}
	ui.Column(c).FillWidth().AlignItems(ui.Center).Children(func() {
		ui.Column(c).FillWidth().MaxWidth(maxW).Children(fn)
	})
}

// TwoPaneRow renders left and right stacked vertically on compact screens,
// or side-by-side in equal-flex columns on unfolded/wide screens.
func TwoPaneRow(c *ui.Context, twoCol bool, gap float32, left, right func()) {
	if !twoCol {
		left()
		right()
		return
	}
	ui.Row(c).FillWidth().Gap(gap).AlignItems(ui.Start).Children(func() {
		ui.Column(c).Grow(1).Basis(0).Gap(gap).Children(left)
		ui.Column(c).Grow(1).Basis(0).Gap(gap).Children(right)
	})
}

// TwoColumnCards renders count cards in a single vertical stack when cols <= 1,
// or balanced 2-column paired rows when cols >= 2.
func TwoColumnCards(c *ui.Context, cols int, gap float32, count int, render func(i int)) {
	if cols <= 1 {
		for i := 0; i < count; i++ {
			render(i)
		}
		return
	}
	for i := 0; i < count; i += 2 {
		i := i
		ui.Row(c.Key(i / 2)).FillWidth().Gap(gap).AlignItems(ui.Start).Children(func() {
			ui.Column(c.Key(i)).Grow(1).Basis(0).Children(func() {
				render(i)
			})
			if i+1 < count {
				ui.Column(c.Key(i + 1)).Grow(1).Basis(0).Children(func() {
					render(i + 1)
				})
			} else {
				// Empty spacer keeps an odd trailing card aligned to the left column width.
				ui.Box(c.Key("pad")).Grow(1).Basis(0)
			}
		})
	}
}
