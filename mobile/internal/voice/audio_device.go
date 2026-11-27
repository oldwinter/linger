package voice

import (
	"context"
	"errors"
	"io"
	"sync"

	"github.com/egoist/mygo/audio"
)

// AudioFrame is one captured or decoded chunk of interleaved float32 PCM samples.
type AudioFrame struct {
	Samples    []float32
	SampleRate int
	Channels   int
}

// AudioCapture streams microphone PCM frames from the active OS input device.
type AudioCapture interface {
	ReadFrame(ctx context.Context) (AudioFrame, error)
	Close() error
}

// AudioPlayback plays decoded remote PCM audio on the active OS output device.
type AudioPlayback interface {
	WriteSamples(samples []float32, sampleRate, channels int) error
	SetMuted(muted bool)
	Close() error
}

// AudioDevice opens native (or test loopback) microphone capture and speaker playback streams.
type AudioDevice interface {
	OpenCapture(ctx context.Context, sampleRate, channels, frameSamples int) (AudioCapture, error)
	OpenPlayback(ctx context.Context, sampleRate, channels int) (AudioPlayback, error)
}

// SystemAudioDevice binds platform-native microphone capture (CoreAudio on macOS,
// AVAudioEngine on iOS, AudioRecord on Android) with MyGo's native audio output player.
type SystemAudioDevice struct{}

// DefaultAudioDevice returns the platform-native audio capture & playback device.
func DefaultAudioDevice() AudioDevice {
	return SystemAudioDevice{}
}

// OpenCapture opens the platform-native microphone capture stream.
func (SystemAudioDevice) OpenCapture(ctx context.Context, sampleRate, channels, frameSamples int) (AudioCapture, error) {
	if sampleRate <= 0 {
		sampleRate = SampleRate
	}
	if channels <= 0 {
		channels = Channels
	}
	if frameSamples <= 0 {
		frameSamples = FrameSamples
	}
	return openPlatformCapture(ctx, sampleRate, channels, frameSamples)
}

// OpenPlayback opens a low-latency real-time audio player backed by mygo/audio.
func (SystemAudioDevice) OpenPlayback(_ context.Context, sampleRate, channels int) (AudioPlayback, error) {
	if sampleRate <= 0 {
		sampleRate = SampleRate
	}
	if channels <= 0 {
		channels = Channels
	}
	return NewMyGoAudioPlayback(sampleRate, channels), nil
}

// MyGoAudioPlayback streams decoded WebRTC float32 PCM directly into MyGo's native
// audio output (AudioToolbox on macOS, AVAudioEngine on iOS, AudioTrack on Android).
type MyGoAudioPlayback struct {
	dec    *livePCMDecoder
	player *audio.Player
	once   sync.Once
}

// NewMyGoAudioPlayback starts a live streaming playback sink at sampleRate/channels.
func NewMyGoAudioPlayback(sampleRate, channels int) *MyGoAudioPlayback {
	dec := newLivePCMDecoder(sampleRate, channels, sampleRate/4*channels) // ~250 ms bounded jitter ring
	player := audio.NewPlayer(dec)
	player.Play()
	return &MyGoAudioPlayback{
		dec:    dec,
		player: player,
	}
}

// WriteSamples appends decoded PCM frames to the live playback ring buffer.
func (p *MyGoAudioPlayback) WriteSamples(samples []float32, sampleRate, channels int) error {
	if len(samples) == 0 {
		return nil
	}
	if sampleRate != p.dec.rate || channels != p.dec.channels {
		samples = adaptPCM(samples, sampleRate, channels, p.dec.rate, p.dec.channels)
	}
	return p.dec.Push(samples)
}

// SetMuted silences output without tearing down the underlying audio session.
func (p *MyGoAudioPlayback) SetMuted(muted bool) {
	p.dec.SetMuted(muted)
}

// Close stops playback and unblocks the decoder goroutine synchronously.
func (p *MyGoAudioPlayback) Close() error {
	p.once.Do(func() {
		p.dec.Close()
		if p.player != nil {
			p.player.Stop()
			p.player.Close()
		}
	})
	return nil
}

// livePCMDecoder implements audio.Decoder over a bounded ring buffer.
// Read waits until real samples arrive (or Close returns io.EOF) so mygo/audio's
// background decode goroutine never pre-fills silence latency and always exits cleanly.
type livePCMDecoder struct {
	rate     int
	channels int

	mu     sync.Mutex
	cond   *sync.Cond
	ring   []float32
	head   int
	count  int
	muted  bool
	closed bool
}

func newLivePCMDecoder(rate, channels, capacity int) *livePCMDecoder {
	if capacity < FrameSamples*channels*4 {
		capacity = FrameSamples * channels * 4
	}
	d := &livePCMDecoder{
		rate:     rate,
		channels: channels,
		ring:     make([]float32, capacity),
	}
	d.cond = sync.NewCond(&d.mu)
	return d
}

func (d *livePCMDecoder) SampleRate() int { return d.rate }
func (d *livePCMDecoder) Channels() int   { return d.channels }
func (d *livePCMDecoder) Len() int64      { return -1 }

func (d *livePCMDecoder) SetPosition(_ int64) error {
	return errors.New("voice: live PCM stream is not seekable")
}

func (d *livePCMDecoder) SetMuted(muted bool) {
	d.mu.Lock()
	d.muted = muted
	d.mu.Unlock()
}

func (d *livePCMDecoder) Push(samples []float32) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return io.ErrClosedPipe
	}
	capLen := len(d.ring)
	if len(samples) >= capLen {
		// Keep the freshest window if burst exceeds buffer capacity.
		samples = samples[len(samples)-capLen:]
		d.head = 0
		d.count = 0
	} else if overflow := d.count + len(samples) - capLen; overflow > 0 {
		overflow -= overflow % d.channels
		if overflow == 0 && d.count+len(samples) > capLen {
			overflow = d.channels
		}
		d.head = (d.head + overflow) % capLen
		d.count -= overflow
	}
	for _, v := range samples {
		idx := (d.head + d.count) % capLen
		d.ring[idx] = v
		d.count++
	}
	d.cond.Signal()
	return nil
}

func (d *livePCMDecoder) Read(buf []float32) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for d.count < d.channels && !d.closed {
		d.cond.Wait()
	}
	if d.closed {
		return 0, io.EOF
	}
	n := len(buf)
	if d.count < n {
		n = d.count
	}
	n -= n % d.channels
	if n == 0 {
		return 0, nil
	}
	capLen := len(d.ring)
	for i := 0; i < n; i++ {
		v := d.ring[d.head]
		d.head = (d.head + 1) % capLen
		if d.muted {
			buf[i] = 0
		} else {
			buf[i] = v
		}
	}
	d.count -= n
	return n, nil
}

func (d *livePCMDecoder) Close() error {
	d.mu.Lock()
	if !d.closed {
		d.closed = true
		d.cond.Broadcast()
	}
	d.mu.Unlock()
	return nil
}

func adaptPCM(in []float32, inRate, inCh, outRate, outCh int) []float32 {
	if inCh <= 0 {
		inCh = 1
	}
	if outCh <= 0 {
		outCh = 1
	}
	if inRate <= 0 {
		inRate = outRate
	}
	inFrames := len(in) / inCh
	if inFrames == 0 {
		return nil
	}
	// Channel remix first.
	chOut := in
	if inCh != outCh {
		chOut = make([]float32, inFrames*outCh)
		for f := 0; f < inFrames; f++ {
			if inCh == 1 && outCh == 2 {
				s := in[f]
				chOut[2*f] = s
				chOut[2*f+1] = s
			} else if inCh >= 2 && outCh == 1 {
				chOut[f] = 0.5 * (in[f*inCh] + in[f*inCh+1])
			} else {
				for c := 0; c < outCh; c++ {
					srcC := c
					if srcC >= inCh {
						srcC = inCh - 1
					}
					chOut[f*outCh+c] = in[f*inCh+srcC]
				}
			}
		}
	}
	if inRate == outRate {
		return chOut
	}
	outFrames := int(int64(inFrames) * int64(outRate) / int64(inRate))
	if outFrames <= 0 {
		return nil
	}
	out := make([]float32, outFrames*outCh)
	ratio := float64(inFrames) / float64(outFrames)
	for f := 0; f < outFrames; f++ {
		pos := float64(f) * ratio
		i0 := int(pos)
		i1 := i0 + 1
		if i1 >= inFrames {
			i1 = inFrames - 1
		}
		frac := float32(pos - float64(i0))
		for c := 0; c < outCh; c++ {
			a := chOut[i0*outCh+c]
			b := chOut[i1*outCh+c]
			out[f*outCh+c] = a + (b-a)*frac
		}
	}
	return out
}
