package voice

import (
	"encoding/binary"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/darui3018823/opus"
)

// WebRTC Opus voice audio pipeline constants.
const (
	SampleRate    = 48000
	Channels      = 1
	FrameDuration = 20 * time.Millisecond
	FrameSamples  = SampleRate / 50 // 960 samples per 20 ms mono frame
)

// OpusEncoder encodes 48 kHz mono float32 PCM frames into RFC 6716 Opus packets
// tuned for low-latency WebRTC voice streaming without CGO.
type OpusEncoder struct {
	mu  sync.Mutex
	enc *opus.Encoder
}

// NewOpusEncoder creates a pure-Go VoIP Opus encoder configured for 48 kHz mono speech.
func NewOpusEncoder() (*OpusEncoder, error) {
	enc, err := opus.NewEncoderWithProfile(SampleRate, Channels, opus.ApplicationVOIP, opus.EncoderProfileLibopus)
	if err != nil {
		return nil, fmt.Errorf("voice: create opus encoder: %w", err)
	}
	_ = enc.SetBitrate(32000)
	enc.SetInbandFEC(true)
	enc.SetPacketLossPerc(5)
	// Match Linger Web's dtx:false so Voice Runtime VAD/ASR receives continuous audio.
	enc.SetDTX(false)
	return &OpusEncoder{enc: enc}, nil
}

// EncodeFloat32 encodes one 20 ms mono float32 frame (960 samples) to an Opus packet.
func (e *OpusEncoder) EncodeFloat32(pcm []float32) ([]byte, error) {
	if len(pcm) < FrameSamples {
		return nil, fmt.Errorf("voice: short PCM frame (%d < %d)", len(pcm), FrameSamples)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	pkt, err := e.enc.EncodeFloat32(pcm[:FrameSamples], FrameSamples)
	if err != nil {
		return nil, fmt.Errorf("voice: opus encode: %w", err)
	}
	out := make([]byte, len(pkt))
	copy(out, pkt)
	return out, nil
}

// OpusDecoder decodes RFC 6716 Opus packets (including PLC for dropped RTP frames)
// into 48 kHz mono float32 PCM samples.
type OpusDecoder struct {
	mu  sync.Mutex
	dec *opus.Decoder
}

// NewOpusDecoder creates a pure-Go 48 kHz mono Opus decoder.
func NewOpusDecoder() (*OpusDecoder, error) {
	dec, err := opus.NewDecoder(SampleRate, Channels)
	if err != nil {
		return nil, fmt.Errorf("voice: create opus decoder: %w", err)
	}
	return &OpusDecoder{dec: dec}, nil
}

// DecodeFloat32 decodes one Opus packet into normalized float32 samples in [-1, 1].
func (d *OpusDecoder) DecodeFloat32(packet []byte) ([]float32, error) {
	if len(packet) == 0 {
		return d.DecodePLC(FrameSamples)
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	samples, err := d.dec.DecodeFloat32(packet)
	if err != nil {
		return nil, fmt.Errorf("voice: opus decode: %w", err)
	}
	return samples, nil
}

// DecodePLC generates packet-loss concealment samples for one missed frame.
func (d *OpusDecoder) DecodePLC(frameSamples int) ([]float32, error) {
	if frameSamples <= 0 {
		frameSamples = FrameSamples
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	samples, err := d.dec.DecodePLCFloat32(frameSamples)
	if err != nil {
		return nil, fmt.Errorf("voice: opus plc: %w", err)
	}
	return samples, nil
}

// ComputeRMSLevel maps a PCM float32 frame onto a perceptual [0, 1] meter level.
func ComputeRMSLevel(samples []float32) float32 {
	if len(samples) == 0 {
		return 0
	}
	var sum float64
	for _, s := range samples {
		v := float64(s)
		sum += v * v
	}
	rms := math.Sqrt(sum / float64(len(samples)))
	if rms < 1e-6 {
		return 0
	}
	// Map -55 dBFS..0 dBFS linearly into [0, 1] for responsive voice UI metering.
	db := 20.0 * math.Log10(rms)
	norm := (db + 55.0) / 55.0
	if norm < 0 {
		return 0
	}
	if norm > 1 {
		return 1
	}
	return float32(norm)
}

// PCM16ToFloat32 converts little-endian signed 16-bit PCM bytes to normalized float32 samples.
func PCM16ToFloat32(raw []byte) []float32 {
	n := len(raw) / 2
	out := make([]float32, n)
	for i := 0; i < n; i++ {
		s := int16(binary.LittleEndian.Uint16(raw[2*i : 2*i+2]))
		out[i] = float32(s) / 32768.0
	}
	return out
}

// Float32ToPCM16 converts normalized float32 samples to little-endian signed 16-bit PCM bytes.
func Float32ToPCM16(samples []float32) []byte {
	out := make([]byte, len(samples)*2)
	for i, s := range samples {
		if s > 1 {
			s = 1
		} else if s < -1 {
			s = -1
		}
		v := int16(math.Round(float64(s) * 32767.0))
		binary.LittleEndian.PutUint16(out[2*i:2*i+2], uint16(v))
	}
	return out
}
