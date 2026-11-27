package herdrcore

import (
	"context"
	"errors"
	"io"
	"sync"
)

// AttachOptions configures flow control and callbacks on an AttachSession.
type AttachOptions struct {
	// ManualCredit disables automatic FrameCredit replenishment on read so a
	// bridge (for example a WebSocket relay) can return credit after downstream
	// writes drain.
	ManualCredit bool
	// OnResize is invoked by Read when herdr-core delivers a server-to-observer
	// FrameResize before a replacement paint.
	OnResize func(cols, rows uint16)
}

// AttachEvent is one framed event received from a live attached terminal.
type AttachEvent struct {
	Kind FrameKind
	Data []byte
	Cols uint16
	Rows uint16
}

// AttachSession bridges bidirectional framed PTY I/O, resize, focus, flow
// control, and clean teardown over `terminal.attach`.
type AttachSession struct {
	Result AttachResult

	conn       *FramedConn
	ownsConn   bool
	frames     <-chan Frame
	options    AttachOptions
	readBuf    []byte
	readMu     sync.Mutex
	closeOnce  sync.Once
	closeErr   error
	closedChan chan struct{}
}

// Attach opens a dedicated framed connection and attaches to one live terminal.
func (c *Client) Attach(ctx context.Context, params TerminalAttachParams) (*AttachSession, error) {
	return c.AttachWithOptions(ctx, params, AttachOptions{})
}

// AttachWithOptions opens a dedicated framed connection and attaches with
// custom credit/callback options.
func (c *Client) AttachWithOptions(ctx context.Context, params TerminalAttachParams, options AttachOptions) (*AttachSession, error) {
	fc, _, err := c.DialFramed(ctx, HelloParams{})
	if err != nil {
		return nil, err
	}
	session, err := fc.AttachWithOptions(ctx, params, options)
	if err != nil {
		_ = fc.Close()
		return nil, err
	}
	session.ownsConn = true
	return session, nil
}

// Attach opens one `terminal.attach` stream on an existing FramedConn.
func (f *FramedConn) Attach(ctx context.Context, params TerminalAttachParams) (*AttachSession, error) {
	return f.AttachWithOptions(ctx, params, AttachOptions{})
}

// AttachWithOptions opens one `terminal.attach` stream on an existing FramedConn
// with custom credit/callback options.
func (f *FramedConn) AttachWithOptions(ctx context.Context, params TerminalAttachParams, options AttachOptions) (*AttachSession, error) {
	if params.Terminal == "" {
		return nil, errors.New("terminal address is required")
	}
	if params.Cols == 0 || params.Rows == 0 {
		return nil, errors.New("attach cols and rows must be positive")
	}
	var result AttachResult
	if err := f.Call(ctx, "terminal.attach", params, &result); err != nil {
		return nil, err
	}
	if result.Channel == ControlChannel {
		return nil, errors.New("herdr-core returned control channel for attach")
	}
	frames := f.registerChannel(result.Channel)
	return &AttachSession{
		Result:     result,
		conn:       f,
		frames:     frames,
		options:    options,
		closedChan: make(chan struct{}),
	}, nil
}

// NextEvent returns the next framed event from the attached terminal (DATA,
// RESIZE, FACTS, or CLOSE). Unless AttachOptions.ManualCredit is true, DATA
// frames automatically return flow-control credit.
func (s *AttachSession) NextEvent(ctx context.Context) (AttachEvent, error) {
	select {
	case <-s.closedChan:
		return AttachEvent{}, io.EOF
	default:
	}
	select {
	case <-ctx.Done():
		return AttachEvent{}, ctx.Err()
	case <-s.closedChan:
		return AttachEvent{}, io.EOF
	case frame, ok := <-s.frames:
		if !ok {
			select {
			case <-s.closedChan:
				return AttachEvent{}, io.EOF
			default:
			}
			if err := s.conn.readError(); err != nil && !errors.Is(err, io.EOF) {
				return AttachEvent{}, err
			}
			return AttachEvent{}, io.EOF
		}
		switch frame.Kind {
		case FrameData:
			if !s.options.ManualCredit && len(frame.Payload) > 0 {
				_ = s.SendCredit(uint32(len(frame.Payload)))
			}
			return AttachEvent{Kind: FrameData, Data: frame.Payload}, nil
		case FrameResize:
			cols, rows, err := DecodeResize(frame.Payload)
			if err != nil {
				return AttachEvent{}, err
			}
			return AttachEvent{Kind: FrameResize, Cols: cols, Rows: rows}, nil
		case FrameFacts:
			return AttachEvent{Kind: FrameFacts, Data: frame.Payload}, nil
		case FrameClose:
			return AttachEvent{Kind: FrameClose, Data: frame.Payload}, io.EOF
		default:
			return AttachEvent{Kind: frame.Kind, Data: frame.Payload}, nil
		}
	}
}

// Read implements io.Reader over the attached terminal's PTY output byte
// stream. Non-DATA resize notifications invoke AttachOptions.OnResize when set.
func (s *AttachSession) Read(p []byte) (int, error) {
	s.readMu.Lock()
	defer s.readMu.Unlock()
	for len(s.readBuf) == 0 {
		event, err := s.NextEvent(context.Background())
		if err != nil {
			return 0, err
		}
		switch event.Kind {
		case FrameData:
			s.readBuf = event.Data
		case FrameResize:
			if s.options.OnResize != nil {
				s.options.OnResize(event.Cols, event.Rows)
			}
		}
	}
	n := copy(p, s.readBuf)
	s.readBuf = s.readBuf[n:]
	return n, nil
}

// Write sends raw viewer input bytes as a FrameData frame.
func (s *AttachSession) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	select {
	case <-s.closedChan:
		return 0, io.ErrClosedPipe
	default:
	}
	if err := s.conn.WriteFrame(Frame{
		Channel: s.Result.Channel,
		Kind:    FrameData,
		Payload: p,
	}); err != nil {
		return 0, err
	}
	return len(p), nil
}

// WriteAutomatic sends automated input using FrameAutomaticInput when the full
// attach path supports it, falling back to FrameData otherwise.
func (s *AttachSession) WriteAutomatic(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	select {
	case <-s.closedChan:
		return 0, io.ErrClosedPipe
	default:
	}
	kind := FrameData
	if s.Result.AutomaticInput {
		kind = FrameAutomaticInput
	}
	if err := s.conn.WriteFrame(Frame{
		Channel: s.Result.Channel,
		Kind:    kind,
		Payload: p,
	}); err != nil {
		return 0, err
	}
	return len(p), nil
}

// Resize sends a FrameResize update for an interactive attach session.
func (s *AttachSession) Resize(cols, rows uint16) error {
	if cols == 0 || rows == 0 {
		return errors.New("resize cols and rows must be positive")
	}
	select {
	case <-s.closedChan:
		return io.ErrClosedPipe
	default:
	}
	return s.conn.WriteFrame(Frame{
		Channel: s.Result.Channel,
		Kind:    FrameResize,
		Payload: EncodeResize(cols, rows),
	})
}

// SetFocus sends a FrameFocus notification to the attached terminal.
func (s *AttachSession) SetFocus(focused bool) error {
	select {
	case <-s.closedChan:
		return io.ErrClosedPipe
	default:
	}
	return s.conn.WriteFrame(Frame{
		Channel: s.Result.Channel,
		Kind:    FrameFocus,
		Payload: EncodeFocus(focused),
	})
}

// SendCredit returns flow-control credit for consumed bytes.
func (s *AttachSession) SendCredit(byteCount uint32) error {
	select {
	case <-s.closedChan:
		return io.ErrClosedPipe
	default:
	}
	return s.conn.SendCredit(s.Result.Channel, byteCount)
}

// Close detaches cleanly by sending FrameClose, unregistering the channel, and
// closing the underlying FramedConn if this session owns it.
func (s *AttachSession) Close() error {
	s.closeOnce.Do(func() {
		close(s.closedChan)
		_ = s.conn.SendClose(s.Result.Channel)
		s.conn.unregisterChannel(s.Result.Channel)
		if s.ownsConn {
			s.closeErr = s.conn.Close()
		}
	})
	return s.closeErr
}
