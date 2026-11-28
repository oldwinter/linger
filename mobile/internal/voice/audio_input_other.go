//go:build !darwin && !ios && !android

package voice

import "context"

func openPlatformCapture(_ context.Context, _, _, _ int) (AudioCapture, error) {
	return nil, ErrCaptureUnavailable
}
