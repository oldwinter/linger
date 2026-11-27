//go:build darwin && !ios

package voice

import (
	"context"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
)

type audioStreamBasicDescription struct {
	sampleRate       float64
	formatID         uint32
	formatFlags      uint32
	bytesPerPacket   uint32
	framesPerPacket  uint32
	bytesPerFrame    uint32
	channelsPerFrame uint32
	bitsPerChannel   uint32
	reserved         uint32
}

type audioQueueBuffer struct {
	audioDataBytesCapacity uint32
	audioData              unsafe.Pointer
	audioDataByteSize      uint32
	userData               uintptr
	packetDescCapacity     uint32
	packetDescs            uintptr
	packetDescCount        uint32
}

const (
	kAudioFormatLinearPCM     = 0x6C70636D // 'lpcm'
	kAudioFormatFlagIsFloat   = 1
	kAudioFormatFlagIsPacked  = 8
	darwinInputBufferCount    = 6
	darwinDispatchTimeNow     = 0
	darwinWaitSlice           = 80 * time.Millisecond
	darwinStallLimit          = 25 // ~2s with zero buffers implies hardware/permission loss
)

type darwinCCaller struct{ args [6]uintptr }

func (c *darwinCCaller) call(fn uintptr, args ...uintptr) uintptr {
	n := copy(c.args[:], args)
	r, _, _ := purego.SyscallN(fn, c.args[:n]...)
	return r
}

var (
	aqInLoad sync.Once
	aqInErr  error

	audioQueueNewInput         func(format *audioStreamBasicDescription, callback uintptr, user uintptr, runLoop, runLoopMode uintptr, flags uint32, out *uintptr) int32
	audioQueueAllocateBufferIn func(q uintptr, size uint32, out **audioQueueBuffer) int32
	audioQueueStartIn          func(q uintptr, at uintptr) int32
	audioQueueStopIn           func(q uintptr, immediate bool) int32
	audioQueueDisposeIn        func(q uintptr, immediate bool) int32
	dispatchSemaphoreCreateIn  func(value int) uintptr
	dispatchReleaseIn          func(obj uintptr)

	audioQueueEnqueueBufferIn uintptr
	dispatchSemaphoreWaitIn   uintptr
	dispatchSemaphoreSignalIn uintptr
	dispatchTimeIn            uintptr
)

func loadDarwinAudioInput() error {
	aqInLoad.Do(func() {
		lib, err := purego.Dlopen("/System/Library/Frameworks/AudioToolbox.framework/AudioToolbox", purego.RTLD_LAZY|purego.RTLD_GLOBAL)
		if err != nil {
			aqInErr = fmt.Errorf("voice: load AudioToolbox: %w", err)
			return
		}
		purego.RegisterLibFunc(&audioQueueNewInput, lib, "AudioQueueNewInput")
		purego.RegisterLibFunc(&audioQueueAllocateBufferIn, lib, "AudioQueueAllocateBuffer")
		purego.RegisterLibFunc(&audioQueueStartIn, lib, "AudioQueueStart")
		purego.RegisterLibFunc(&audioQueueStopIn, lib, "AudioQueueStop")
		purego.RegisterLibFunc(&audioQueueDisposeIn, lib, "AudioQueueDispose")
		purego.RegisterLibFunc(&dispatchSemaphoreCreateIn, purego.RTLD_DEFAULT, "dispatch_semaphore_create")
		purego.RegisterLibFunc(&dispatchReleaseIn, purego.RTLD_DEFAULT, "dispatch_release")

		var symErr error
		if audioQueueEnqueueBufferIn, symErr = purego.Dlsym(lib, "AudioQueueEnqueueBuffer"); symErr != nil {
			aqInErr = fmt.Errorf("voice: resolve AudioQueueEnqueueBuffer: %w", symErr)
			return
		}
		if dispatchSemaphoreWaitIn, symErr = purego.Dlsym(purego.RTLD_DEFAULT, "dispatch_semaphore_wait"); symErr != nil {
			aqInErr = fmt.Errorf("voice: resolve dispatch_semaphore_wait: %w", symErr)
			return
		}
		if dispatchSemaphoreSignalIn, symErr = purego.Dlsym(purego.RTLD_DEFAULT, "dispatch_semaphore_signal"); symErr != nil {
			aqInErr = fmt.Errorf("voice: resolve dispatch_semaphore_signal: %w", symErr)
			return
		}
		if dispatchTimeIn, symErr = purego.Dlsym(purego.RTLD_DEFAULT, "dispatch_time"); symErr != nil {
			aqInErr = fmt.Errorf("voice: resolve dispatch_time: %w", symErr)
			return
		}
	})
	return aqInErr
}

// darwinAudioCapture reads live microphone PCM frames from macOS CoreAudio
// using an Audio Queue whose C callback is dispatch_semaphore_signal, so no
// Go code runs on CoreAudio's real-time thread and CGO stays disabled.
type darwinAudioCapture struct {
	sampleRate   int
	channels     int
	frameSamples int

	q       uintptr
	sema    uintptr
	bufs    []*audioQueueBuffer
	next    int
	cc      darwinCCaller
	ioMu    sync.Mutex
	closed  atomic.Bool
	closeOp sync.Once
}

func openPlatformCapture(ctx context.Context, sampleRate, channels, frameSamples int) (AudioCapture, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := loadDarwinAudioInput(); err != nil {
		return nil, err
	}

	desc := audioStreamBasicDescription{
		sampleRate:       float64(sampleRate),
		formatID:         kAudioFormatLinearPCM,
		formatFlags:      kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
		bytesPerPacket:   uint32(channels * 4),
		framesPerPacket:  1,
		bytesPerFrame:    uint32(channels * 4),
		channelsPerFrame: uint32(channels),
		bitsPerChannel:   32,
	}

	d := &darwinAudioCapture{
		sampleRate:   sampleRate,
		channels:     channels,
		frameSamples: frameSamples,
		sema:         dispatchSemaphoreCreateIn(0),
		bufs:         make([]*audioQueueBuffer, darwinInputBufferCount),
	}
	if st := audioQueueNewInput(&desc, dispatchSemaphoreSignalIn, d.sema, 0, 0, 0, &d.q); st != 0 {
		dispatchReleaseIn(d.sema)
		return nil, fmt.Errorf("voice: AudioQueueNewInput failed (OSStatus %d)", st)
	}

	bufBytes := uint32(frameSamples * channels * 4)
	for i := range d.bufs {
		if st := audioQueueAllocateBufferIn(d.q, bufBytes, &d.bufs[i]); st != 0 {
			_ = d.Close()
			return nil, fmt.Errorf("voice: AudioQueueAllocateBuffer failed (OSStatus %d)", st)
		}
		if st := int32(d.cc.call(audioQueueEnqueueBufferIn, d.q, uintptr(unsafe.Pointer(d.bufs[i])), 0, 0)); st != 0 {
			_ = d.Close()
			return nil, fmt.Errorf("voice: AudioQueueEnqueueBuffer failed (OSStatus %d)", st)
		}
	}
	if st := audioQueueStartIn(d.q, 0); st != 0 {
		_ = d.Close()
		return nil, fmt.Errorf("voice: AudioQueueStart failed (OSStatus %d)", st)
	}
	return d, nil
}

func (d *darwinAudioCapture) ReadFrame(ctx context.Context) (AudioFrame, error) {
	stalls := 0
	for {
		if d.closed.Load() {
			return AudioFrame{}, io.EOF
		}
		if err := ctx.Err(); err != nil {
			return AudioFrame{}, err
		}

		d.ioMu.Lock()
		if d.closed.Load() {
			d.ioMu.Unlock()
			return AudioFrame{}, io.EOF
		}
		deadline := d.cc.call(dispatchTimeIn, darwinDispatchTimeNow, uintptr(darwinWaitSlice))
		waitRes := d.cc.call(dispatchSemaphoreWaitIn, d.sema, deadline)
		if d.closed.Load() {
			d.ioMu.Unlock()
			return AudioFrame{}, io.EOF
		}
		if waitRes != 0 {
			d.ioMu.Unlock()
			stalls++
			if stalls >= darwinStallLimit {
				return AudioFrame{}, ErrPermissionRevoked
			}
			continue
		}

		b := d.bufs[d.next]
		d.next = (d.next + 1) % len(d.bufs)
		sampleCount := int(b.audioDataByteSize) / 4
		if sampleCount > d.frameSamples*d.channels {
			sampleCount = d.frameSamples * d.channels
		}
		samples := make([]float32, sampleCount)
		if sampleCount > 0 && b.audioData != nil {
			copy(samples, unsafe.Slice((*float32)(b.audioData), sampleCount))
		}
		st := int32(d.cc.call(audioQueueEnqueueBufferIn, d.q, uintptr(unsafe.Pointer(b)), 0, 0))
		d.ioMu.Unlock()

		if st != 0 && !d.closed.Load() {
			return AudioFrame{}, fmt.Errorf("voice: AudioQueueEnqueueBuffer failed (OSStatus %d)", st)
		}
		if len(samples) == 0 {
			continue
		}
		return AudioFrame{
			Samples:    samples,
			SampleRate: d.sampleRate,
			Channels:   d.channels,
		}, nil
	}
}

func (d *darwinAudioCapture) Close() error {
	d.closeOp.Do(func() {
		d.closed.Store(true)
		// Wake any blocked ReadFrame wait slice immediately.
		d.cc.call(dispatchSemaphoreSignalIn, d.sema)
		d.ioMu.Lock()
		defer d.ioMu.Unlock()
		if d.q != 0 {
			audioQueueStopIn(d.q, true)
			audioQueueDisposeIn(d.q, true)
			d.q = 0
		}
		if d.sema != 0 {
			dispatchReleaseIn(d.sema)
			d.sema = 0
		}
	})
	return nil
}
