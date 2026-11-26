package components_test

import (
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/mobile"
	"github.com/oldwinter/linger/mobile/internal/components"
	"github.com/oldwinter/linger/mobile/internal/testutil"
	"github.com/oldwinter/linger/mobile/internal/theme"
)

func TestActionSheetRendersMessageAndCancelAcrossCupertinoAndMaterial(t *testing.T) {
	looks := []struct {
		name string
		look mobile.Look
	}{
		{"Cupertino", mobile.Cupertino},
		{"Material", mobile.Material},
	}

	for _, tc := range looks {
		t.Run(tc.name, func(t *testing.T) {
			mobile.SetLook(tc.look)
			t.Cleanup(func() { mobile.SetLook(mobile.Automatic) })

			open := true
			confirmed := 0
			disabledTaps := 0
			const msg = "Removes cached Rooms, Messages, Work Items, and Documents from this device. Your 2 unsynced offline items will be preserved."

			tt := testutil.NewPhoneTester(func(c *ui.Context) {
				c.SetTheme(theme.TownLight())
				ui.Column(c).Fill().Background(c.Theme().Background).Children(func() {
					ui.Text(c, "Underlying screen")
				})
				components.ActionSheet(c, &open, mobile.ActionSheetOptions{
					Title:   "Clear Local Cache?",
					Message: msg,
					Cancel:  "Keep Running",
				}, mobile.Action{
					Label:       "Clear Cache",
					Destructive: true,
					OnTap: func() {
						confirmed++
					},
				}, mobile.Action{
					Label:    "Unavailable Action",
					Disabled: true,
					OnTap: func() {
						disabledTaps++
					},
				})
			}, testutil.StandardMobileViewports[1])

			for range 4 {
				tt.Frame()
				tt.Advance(300 * time.Millisecond)
				tt.Frame()
			}

			if !tt.HasText("Clear Local Cache?") {
				t.Fatalf("%s: expected Title visible, texts=%v", tc.name, tt.Texts())
			}
			if !tt.HasText(msg) {
				t.Fatalf("%s: expected full Message visible, texts=%v", tc.name, tt.Texts())
			}
			if !tt.HasText("Keep Running") {
				t.Fatalf("%s: expected explicit Cancel button visible, texts=%v", tc.name, tt.Texts())
			}

			// Clicking Cancel dismisses with zero mutations.
			if err := tt.Click("Keep Running"); err != nil {
				t.Fatalf("%s: click Cancel: %v", tc.name, err)
			}
			for range 4 {
				tt.Frame()
				tt.Advance(300 * time.Millisecond)
				tt.Frame()
			}
			if open {
				t.Fatalf("%s: expected sheet closed after Cancel", tc.name)
			}
			if confirmed != 0 || disabledTaps != 0 {
				t.Fatalf("%s: Cancel triggered unexpected callbacks: confirmed=%d disabled=%d", tc.name, confirmed, disabledTaps)
			}

			// Re-open and confirm destructive action fires OnTap once and closes sheet.
			open = true
			for range 4 {
				tt.Frame()
				tt.Advance(300 * time.Millisecond)
				tt.Frame()
			}
			if err := tt.Click("Clear Cache"); err != nil {
				t.Fatalf("%s: click Clear Cache: %v", tc.name, err)
			}
			for range 4 {
				tt.Frame()
				tt.Advance(300 * time.Millisecond)
				tt.Frame()
			}
			if open {
				t.Fatalf("%s: expected sheet closed after confirming action", tc.name)
			}
			if confirmed != 1 {
				t.Fatalf("%s: confirmed = %d, want 1", tc.name, confirmed)
			}

			// Escape dismisses without invoking callbacks.
			open = true
			for range 4 {
				tt.Frame()
				tt.Advance(300 * time.Millisecond)
				tt.Frame()
			}
			tt.Key(0, ui.KeyEscape)
			for range 4 {
				tt.Frame()
				tt.Advance(300 * time.Millisecond)
				tt.Frame()
			}
			if open {
				t.Fatalf("%s: expected Escape to close ActionSheet", tc.name)
			}
			if confirmed != 1 {
				t.Fatalf("%s: Escape triggered unexpected confirm: %d", tc.name, confirmed)
			}
		})
	}
}
