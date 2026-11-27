//go:build ios || android

package voice

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"sync"

	"github.com/egoist/mygo"
)

const mobileMicPluginID = "linger_voice_mic"

type mobileMicFrameEvent struct {
	PCM      string `json:"pcm"`
	Rate     int    `json:"rate"`
	Channels int    `json:"channels"`
}

type mobileMicErrorEvent struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type mobileAudioCapture struct {
	frames    chan AudioFrame
	errCh     chan error
	done      chan struct{}
	offFrame  func()
	offErr    func()
	offInt    func()
	closeOnce sync.Once
}

func openPlatformCapture(ctx context.Context, sampleRate, channels, frameSamples int) (AudioCapture, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p := mygo.Native(mobileMicPluginID)
	capStream := &mobileAudioCapture{
		frames: make(chan AudioFrame, 16),
		errCh:  make(chan error, 1),
		done:   make(chan struct{}),
	}
	pushErr := func(err error) {
		select {
		case capStream.errCh <- err:
		default:
		}
	}

	capStream.offFrame = p.On("frame", func(data []byte) {
		var ev mobileMicFrameEvent
		if json.Unmarshal(data, &ev) != nil || ev.PCM == "" {
			return
		}
		raw, err := base64.StdEncoding.DecodeString(ev.PCM)
		if err != nil || len(raw) < 2 {
			return
		}
		rate := ev.Rate
		if rate <= 0 {
			rate = sampleRate
		}
		ch := ev.Channels
		if ch <= 0 {
			ch = channels
		}
		frame := AudioFrame{
			Samples:    PCM16ToFloat32(raw),
			SampleRate: rate,
			Channels:   ch,
		}
		select {
		case capStream.frames <- frame:
		default:
			// Drop oldest queued frame to preserve real-time voice latency.
			select {
			case <-capStream.frames:
			default:
			}
			select {
			case capStream.frames <- frame:
			default:
			}
		}
	})
	capStream.offInt = p.On("interrupted", func(_ []byte) {
		pushErr(ErrPermissionRevoked)
	})
	capStream.offErr = p.On("error", func(data []byte) {
		var ev mobileMicErrorEvent
		if json.Unmarshal(data, &ev) == nil && (ev.Code == "PermissionDenied" || ev.Code == "Interrupted") {
			pushErr(ErrPermissionRevoked)
			return
		}
		if ev.Message != "" {
			pushErr(errors.New("voice: " + ev.Message))
			return
		}
		pushErr(ErrPermissionRevoked)
	})

	args := map[string]any{
		"sampleRate":   sampleRate,
		"channels":     channels,
		"frameSamples": frameSamples,
	}
	if err := p.Call(ctx, "start", args, nil); err != nil {
		capStream.cleanupListeners()
		var nErr *mygo.NativeError
		if errors.As(err, &nErr) && nErr.Code == "PermissionDenied" {
			return nil, ErrPermissionDenied
		}
		return nil, err
	}
	return capStream, nil
}

func (m *mobileAudioCapture) ReadFrame(ctx context.Context) (AudioFrame, error) {
	select {
	case <-m.done:
		return AudioFrame{}, io.EOF
	case err := <-m.errCh:
		return AudioFrame{}, err
	case <-ctx.Done():
		return AudioFrame{}, ctx.Err()
	case frame := <-m.frames:
		return frame, nil
	}
}

func (m *mobileAudioCapture) cleanupListeners() {
	if m.offFrame != nil {
		m.offFrame()
		m.offFrame = nil
	}
	if m.offErr != nil {
		m.offErr()
		m.offErr = nil
	}
	if m.offInt != nil {
		m.offInt()
		m.offInt = nil
	}
}

func (m *mobileAudioCapture) Close() error {
	m.closeOnce.Do(func() {
		close(m.done)
		m.cleanupListeners()
		_ = mygo.Native(mobileMicPluginID).Call(context.Background(), "stop", nil, nil)
	})
	return nil
}
