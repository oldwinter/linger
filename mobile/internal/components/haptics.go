package components

import (
	"sync/atomic"

	"github.com/egoist/mygo"
)

var hapticsOn atomic.Bool

func init() {
	hapticsOn.Store(true)
}

// SetHapticsEnabled enables or disables tactile haptic feedback app-wide.
func SetHapticsEnabled(enabled bool) {
	hapticsOn.Store(enabled)
}

// HapticsEnabled reports whether tactile haptic feedback is currently enabled.
func HapticsEnabled() bool {
	return hapticsOn.Load()
}

// HapticLight triggers a subtle light impact haptic if haptic feedback is enabled.
func HapticLight() {
	if hapticsOn.Load() {
		mygo.Haptics.Light()
	}
}

// HapticSuccess triggers a success notification haptic if haptic feedback is enabled.
func HapticSuccess() {
	if hapticsOn.Load() {
		mygo.Haptics.Success()
	}
}

// HapticWarning triggers a warning notification haptic if haptic feedback is enabled.
func HapticWarning() {
	if hapticsOn.Load() {
		mygo.Haptics.Warning()
	}
}
