package layout_test

import (
	"math"
	"testing"

	"github.com/oldwinter/linger/mobile/internal/layout"
)

func TestFoldableMetricsBreakpoints(t *testing.T) {
	tests := []struct {
		name           string
		w, h           float32
		top, r, b, l   float32
		wantClass      layout.WindowClass
		wantRail       bool
		wantSplit      bool
		wantShortH     bool
		wantGridCols   int
		checkCreaseMax float32 // if > 0, assert |rail+master+left - w/2| <= checkCreaseMax
	}{
		{
			name:         "Standard iPhone 390x844",
			w:            390,
			h:            844,
			top:          59,
			b:            34,
			wantClass:    layout.ClassCompact,
			wantRail:     false,
			wantSplit:    false,
			wantShortH:   false,
			wantGridCols: 1,
		},
		{
			name:         "Narrow Android Z Fold Cover 344x882",
			w:            344,
			h:            882,
			top:          32,
			b:            24,
			wantClass:    layout.ClassCompact,
			wantRail:     false,
			wantSplit:    false,
			wantShortH:   false,
			wantGridCols: 1,
		},
		{
			name:         "iPhone Duo Outer Cover 466x678",
			w:            466,
			h:            678,
			top:          54,
			b:            21,
			wantClass:    layout.ClassCompact,
			wantRail:     false,
			wantSplit:    false,
			wantShortH:   true,
			wantGridCols: 1,
		},
		{
			name:           "iPhone Duo Inner Unfolded Portrait 669x951",
			w:              669,
			h:              951,
			top:            24,
			b:              21,
			wantClass:      layout.ClassMedium,
			wantRail:       true,
			wantSplit:      true,
			wantShortH:     false,
			wantGridCols:   2,
			checkCreaseMax: 1.0, // Divider aligns on exact physical fold crease x=334.5pt
		},
		{
			name:         "iPhone Duo Inner Unfolded Landscape 951x669",
			w:            951,
			h:            669,
			top:          24,
			b:            21,
			l:            54,
			wantClass:    layout.ClassExpanded,
			wantRail:     true,
			wantSplit:    true,
			wantShortH:   true,
			wantGridCols: 2,
		},
		{
			name:           "Android Galaxy Z Fold Unfolded 720x840",
			w:              720,
			h:              840,
			top:            28,
			b:              24,
			wantClass:      layout.ClassMedium,
			wantRail:       true,
			wantSplit:      true,
			wantShortH:     false,
			wantGridCols:   2,
			checkCreaseMax: 1.0, // Divider aligns on exact physical fold crease x=360dp
		},
		{
			name:           "Android Pixel Fold Unfolded 800x840",
			w:              800,
			h:              840,
			top:            28,
			b:              24,
			wantClass:      layout.ClassMedium,
			wantRail:       true,
			wantSplit:      true,
			wantShortH:     false,
			wantGridCols:   2,
			checkCreaseMax: 6.0, // Divider at x=396dp within 4dp of 400dp crease
		},
		{
			name:         "Android Compact Split-Screen 610x840",
			w:            610,
			h:            840,
			top:          28,
			b:            24,
			wantClass:    layout.ClassMedium,
			wantRail:     true,
			wantSplit:    false,
			wantShortH:   false,
			wantGridCols: 2,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := layout.Compute(tc.w, tc.h, tc.top, tc.r, tc.b, tc.l)
			if m.Class != tc.wantClass {
				t.Errorf("Class = %v, want %v", m.Class, tc.wantClass)
			}
			if m.UseNavRail != tc.wantRail {
				t.Errorf("UseNavRail = %v, want %v", m.UseNavRail, tc.wantRail)
			}
			if m.UseSplitPane != tc.wantSplit {
				t.Errorf("UseSplitPane = %v, want %v", m.UseSplitPane, tc.wantSplit)
			}
			if m.ShortHeight != tc.wantShortH {
				t.Errorf("ShortHeight = %v, want %v", m.ShortHeight, tc.wantShortH)
			}
			if m.GridColumns != tc.wantGridCols {
				t.Errorf("GridColumns = %d, want %d", m.GridColumns, tc.wantGridCols)
			}
			if tc.wantSplit {
				detailW := tc.w - tc.l - tc.r - m.RailWidth - m.MasterWidth
				if m.MasterWidth < 220 || detailW < 300 {
					t.Errorf("split pane sizes cramped: master=%.1f detail=%.1f", m.MasterWidth, detailW)
				}
			}
			if tc.checkCreaseMax > 0 {
				dividerX := tc.l + m.RailWidth + m.MasterWidth
				creaseX := tc.w / 2
				if diff := math.Abs(float64(dividerX - creaseX)); diff > float64(tc.checkCreaseMax) {
					t.Errorf("dividerX=%.1f differs from creaseX=%.1f by %.1f (> %.1f)", dividerX, creaseX, diff, tc.checkCreaseMax)
				}
			}
		})
	}
}
