package herdrcore

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// ControlChannel carries multiplexed JSON-RPC 2.0 requests and responses on a
// framed herdr-core connection.
const ControlChannel uint32 = 0

// frameHeaderSize is the 9-byte little-endian header: channel(u32), kind(u8), length(u32).
const (
	frameHeaderSize = 9
	maxFrameBytes   = 20 << 20
)

// FrameKind identifies the payload type of one framed herdr-core message.
type FrameKind uint8

const (
	// FrameData carries JSON-RPC UTF-8 messages on channel 0, PTY bytes on attach
	// channels, or JSON-RPC event lines on framed events.subscribe channels.
	FrameData FrameKind = 0
	// FrameCredit carries a 4-byte little-endian uint32 byte count for flow control.
	FrameCredit FrameKind = 1
	// FrameClose closes a multiplexed channel cleanly.
	FrameClose FrameKind = 2
	// FrameResize carries a 4-byte little-endian (cols uint16, rows uint16) size update.
	FrameResize FrameKind = 3
	// FrameFocus carries a 1-byte boolean (0 unfocused, 1 focused) focus notification.
	FrameFocus FrameKind = 4
	// FrameFacts carries stream fact updates.
	FrameFacts FrameKind = 5
	// FrameAutomaticInput carries automated input bytes when AttachResult.AutomaticInput is true.
	FrameAutomaticInput FrameKind = 6
)

// Frame is one wire frame on a framed herdr-core connection.
type Frame struct {
	Channel uint32
	Kind    FrameKind
	Payload []byte
}

// WriteFrame encodes and writes one 9-byte-header frame to w.
func WriteFrame(w io.Writer, frame Frame) error {
	if len(frame.Payload) > maxFrameBytes {
		return fmt.Errorf("herdr-core frame payload too large (%d bytes)", len(frame.Payload))
	}
	header := make([]byte, 0, frameHeaderSize)
	header = binary.LittleEndian.AppendUint32(header, frame.Channel)
	header = append(header, byte(frame.Kind))
	header = binary.LittleEndian.AppendUint32(header, uint32(len(frame.Payload)))
	if _, err := w.Write(header); err != nil {
		return err
	}
	if len(frame.Payload) == 0 {
		return nil
	}
	_, err := w.Write(frame.Payload)
	return err
}

// ReadFrame reads one 9-byte-header frame from r.
func ReadFrame(r io.Reader) (Frame, error) {
	var header [frameHeaderSize]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return Frame{}, err
	}
	channel := binary.LittleEndian.Uint32(header[0:4])
	kind := FrameKind(header[4])
	length := binary.LittleEndian.Uint32(header[5:9])
	if length > maxFrameBytes {
		return Frame{}, fmt.Errorf("herdr-core frame payload too large (%d bytes)", length)
	}
	var payload []byte
	if length > 0 {
		payload = make([]byte, length)
		if _, err := io.ReadFull(r, payload); err != nil {
			return Frame{}, err
		}
	}
	return Frame{
		Channel: channel,
		Kind:    kind,
		Payload: payload,
	}, nil
}

// EncodeCredit encodes a FrameCredit payload.
func EncodeCredit(bytes uint32) []byte {
	payload := make([]byte, 4)
	binary.LittleEndian.PutUint32(payload, bytes)
	return payload
}

// DecodeCredit decodes a FrameCredit payload.
func DecodeCredit(payload []byte) (uint32, error) {
	if len(payload) != 4 {
		return 0, errors.New("invalid herdr-core credit frame length")
	}
	return binary.LittleEndian.Uint32(payload), nil
}

// EncodeResize encodes a FrameResize payload as little-endian cols and rows.
func EncodeResize(cols, rows uint16) []byte {
	payload := make([]byte, 4)
	binary.LittleEndian.PutUint16(payload[0:2], cols)
	binary.LittleEndian.PutUint16(payload[2:4], rows)
	return payload
}

// DecodeResize decodes a FrameResize payload into cols and rows.
func DecodeResize(payload []byte) (cols, rows uint16, err error) {
	if len(payload) != 4 {
		return 0, 0, errors.New("invalid herdr-core resize frame length")
	}
	return binary.LittleEndian.Uint16(payload[0:2]), binary.LittleEndian.Uint16(payload[2:4]), nil
}

// EncodeFocus encodes a FrameFocus payload.
func EncodeFocus(focused bool) []byte {
	if focused {
		return []byte{1}
	}
	return []byte{0}
}

// DecodeFocus decodes a FrameFocus payload.
func DecodeFocus(payload []byte) (bool, error) {
	if len(payload) != 1 {
		return false, errors.New("invalid herdr-core focus frame length")
	}
	return payload[0] != 0, nil
}
