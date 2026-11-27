package herdrcore

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"
)

func TestAttachSessionBidirectionalFramedStream(t *testing.T) {
	srv := newFakeCoreServer(t)
	srv.setTerminal(Terminal{Address: "vps/t7", State: TerminalStateLive, Cwd: "/srv/app", Cols: 120, Rows: 40})
	// Early paint emitted right after terminal.attach reply before client finishes registering.
	srv.earlyPaintBytes = []byte("\x1b[2Jinitial-paint")

	client := &Client{Socket: srv.socket}
	var observedResize [2]uint16
	session, err := client.AttachWithOptions(context.Background(), TerminalAttachParams{
		Terminal:            "vps/t7",
		Cols:                100,
		Rows:                30,
		Observe:             true,
		History:             200,
		ResizeNotifications: true,
		Resumed:             true,
	}, AttachOptions{
		OnResize: func(cols, rows uint16) {
			observedResize = [2]uint16{cols, rows}
		},
	})
	if err != nil {
		t.Fatalf("AttachWithOptions: %v", err)
	}
	defer session.Close()

	if !session.Result.ResizeNotifications || !session.Result.AutomaticInput || session.Result.Channel == 0 {
		t.Fatalf("AttachResult=%+v", session.Result)
	}

	// Verify exact terminal.attach params reached the fake core.
	reqs := srv.recordedRequests()
	var attachParams map[string]any
	for _, r := range reqs {
		if r.Method == "terminal.attach" {
			attachParams = r.Params
		}
	}
	if attachParams["terminal"] != "vps/t7" || attachParams["observe"] != true ||
		attachParams["resize_notifications"] != true || attachParams["resumed"] != true {
		t.Fatalf("attachParams=%+v", attachParams)
	}

	// Read initial paint (must not be dropped even though server wrote it immediately).
	buf := make([]byte, 64)
	n, err := session.Read(buf)
	if err != nil || string(buf[:n]) != "\x1b[2Jinitial-paint" {
		t.Fatalf("initial Read=%q err=%v", string(buf[:n]), err)
	}

	srv.mu.Lock()
	peer := srv.attachChannels[session.Result.Channel]
	srv.mu.Unlock()
	if peer == nil {
		t.Fatal("missing fake attach peer")
	}

	// Auto-credit for initial paint must arrive on server.
	creditFrame := receiveFrame(t, peer.received)
	if creditFrame.Kind != FrameCredit {
		t.Fatalf("expected FrameCredit, got kind=%d", creditFrame.Kind)
	}
	if credit, err := DecodeCredit(creditFrame.Payload); err != nil || credit != uint32(len(srv.earlyPaintBytes)) {
		t.Fatalf("credit=%d err=%v", credit, err)
	}

	// Send viewer input, automatic input, resize, and focus.
	if _, err := session.Write([]byte("ls\r")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if _, err := session.WriteAutomatic([]byte("auto")); err != nil {
		t.Fatalf("WriteAutomatic: %v", err)
	}
	if err := session.Resize(132, 42); err != nil {
		t.Fatalf("Resize: %v", err)
	}
	if err := session.SetFocus(true); err != nil {
		t.Fatalf("SetFocus: %v", err)
	}

	fData := receiveFrame(t, peer.received)
	if fData.Kind != FrameData || string(fData.Payload) != "ls\r" {
		t.Fatalf("fData=%+v", fData)
	}
	fAuto := receiveFrame(t, peer.received)
	if fAuto.Kind != FrameAutomaticInput || string(fAuto.Payload) != "auto" {
		t.Fatalf("fAuto=%+v", fAuto)
	}
	fResize := receiveFrame(t, peer.received)
	if cols, rows, err := DecodeResize(fResize.Payload); fResize.Kind != FrameResize || err != nil || cols != 132 || rows != 42 {
		t.Fatalf("fResize=%+v (%d,%d) err=%v", fResize, cols, rows, err)
	}
	fFocus := receiveFrame(t, peer.received)
	if focused, err := DecodeFocus(fFocus.Payload); fFocus.Kind != FrameFocus || err != nil || !focused {
		t.Fatalf("fFocus=%+v focused=%v err=%v", fFocus, focused, err)
	}

	// Server sends observer RESIZE followed by replacement paint.
	peer.writeMu.Lock()
	_ = WriteFrame(peer.conn, Frame{Channel: peer.channel, Kind: FrameResize, Payload: EncodeResize(95, 28)})
	_ = WriteFrame(peer.conn, Frame{Channel: peer.channel, Kind: FrameData, Payload: []byte("repainted")})
	peer.writeMu.Unlock()

	n, err = session.Read(buf)
	if err != nil || string(buf[:n]) != "repainted" {
		t.Fatalf("repainted Read=%q err=%v", string(buf[:n]), err)
	}
	if observedResize != [2]uint16{95, 28} {
		t.Fatalf("observedResize=%v, want [95 28]", observedResize)
	}

	// Close sends FrameClose and ends subsequent reads cleanly.
	if err := session.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	// Drain auto-credit from "repainted" then expect FrameClose.
	var sawClose bool
	for range 4 {
		frame := receiveFrame(t, peer.received)
		if frame.Kind == FrameClose {
			sawClose = true
			break
		}
	}
	if !sawClose {
		t.Fatal("expected FrameClose on session.Close")
	}
	if _, err := session.Read(buf); !errors.Is(err, io.EOF) {
		t.Fatalf("post-close Read err=%v, want EOF", err)
	}
	if _, err := session.Write([]byte("late")); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("post-close Write err=%v, want ErrClosedPipe", err)
	}
}

func TestAttachManualCreditAndServerClose(t *testing.T) {
	srv := newFakeCoreServer(t)
	srv.attachAutomatic = false
	srv.setTerminal(Terminal{Address: "t1", State: TerminalStateLive, Cwd: "/repo"})

	client := &Client{Socket: srv.socket}
	session, err := client.AttachWithOptions(context.Background(), TerminalAttachParams{
		Terminal: "t1",
		Cols:     80,
		Rows:     24,
	}, AttachOptions{ManualCredit: true})
	if err != nil {
		t.Fatalf("AttachWithOptions: %v", err)
	}
	defer session.Close()

	srv.mu.Lock()
	peer := srv.attachChannels[session.Result.Channel]
	srv.mu.Unlock()

	// WriteAutomatic falls back to FrameData when AutomaticInput is false.
	if _, err := session.WriteAutomatic([]byte("fallback")); err != nil {
		t.Fatalf("WriteAutomatic: %v", err)
	}
	frame := receiveFrame(t, peer.received)
	if frame.Kind != FrameData || !bytes.Equal(frame.Payload, []byte("fallback")) {
		t.Fatalf("expected FrameData fallback, got %+v", frame)
	}

	// Server emits DATA then CLOSE; manual credit must NOT send credit automatically.
	peer.writeMu.Lock()
	_ = WriteFrame(peer.conn, Frame{Channel: peer.channel, Kind: FrameData, Payload: []byte("chunk")})
	_ = WriteFrame(peer.conn, Frame{Channel: peer.channel, Kind: FrameClose})
	peer.writeMu.Unlock()

	ev, err := session.NextEvent(context.Background())
	if err != nil || ev.Kind != FrameData || string(ev.Data) != "chunk" {
		t.Fatalf("NextEvent=%+v err=%v", ev, err)
	}
	select {
	case unexpected := <-peer.received:
		t.Fatalf("unexpected auto frame in manual credit mode: %+v", unexpected)
	case <-time.After(50 * time.Millisecond):
	}

	if err := session.SendCredit(5); err != nil {
		t.Fatalf("SendCredit: %v", err)
	}
	creditFrame := receiveFrame(t, peer.received)
	if c, err := DecodeCredit(creditFrame.Payload); creditFrame.Kind != FrameCredit || err != nil || c != 5 {
		t.Fatalf("manual credit=%+v c=%d err=%v", creditFrame, c, err)
	}

	ev, err = session.NextEvent(context.Background())
	if !errors.Is(err, io.EOF) || ev.Kind != FrameClose {
		t.Fatalf("expected server close EOF, got ev=%+v err=%v", ev, err)
	}
}

func receiveFrame(t *testing.T, ch <-chan Frame) Frame {
	t.Helper()
	select {
	case frame := <-ch:
		return frame
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for frame")
		return Frame{}
	}
}
