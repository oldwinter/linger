package herdr

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // RFC 6455 Sec-WebSocket-Accept mandates SHA-1
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
)

const (
	wsOpContinuation = 0x0
	wsOpText         = 0x1
	wsOpBinary       = 0x2
	wsOpClose        = 0x8
	wsOpPing         = 0x9
	wsOpPong         = 0xA
	wsMaxFrameBytes  = 4 << 20
	wsMagicGUID      = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
)

// wsUpgradeError captures a non-101 HTTP response during WebSocket handshake so
// AttachClient can distinguish unsupported/unavailable endpoints and fall back to polling.
type wsUpgradeError struct {
	StatusCode int
	Status     string
}

func (e *wsUpgradeError) Error() string {
	return fmt.Sprintf("herdr ws upgrade rejected: HTTP %d (%s)", e.StatusCode, e.Status)
}

type wsConn struct {
	raw     net.Conn
	br      *bufio.Reader
	writeMu sync.Mutex
	closed  bool
}

func dialWebSocket(ctx context.Context, rawURL string, ac *api.Client) (*wsConn, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "ws" && scheme != "wss" {
		return nil, fmt.Errorf("herdr ws: unsupported scheme %q", u.Scheme)
	}
	if scheme == "ws" && (ac == nil || !ac.AllowPlainHTTP()) {
		return nil, api.ErrPlainHTTPDisallowed
	}

	hostPort := u.Host
	if u.Port() == "" {
		if scheme == "wss" {
			hostPort = net.JoinHostPort(u.Hostname(), "443")
		} else {
			hostPort = net.JoinHostPort(u.Hostname(), "80")
		}
	}

	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	if scheme == "wss" {
		tlsCfg := &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: u.Hostname(),
		}
		if ac != nil && ac.TLSFingerprint() != "" {
			tlsCfg.MinVersion = tls.VersionTLS13
			tlsCfg.InsecureSkipVerify = true //nolint:gosec // Enforced via VerifyPeerCertificate SPKI pin
			tlsCfg.VerifyPeerCertificate = api.VerifySPKIPin(ac.TLSFingerprint())
		}
		tlsDialer := &tls.Dialer{NetDialer: dialer, Config: tlsCfg}
		conn, err = tlsDialer.DialContext(ctx, "tcp", hostPort)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", hostPort)
	}
	if err != nil {
		return nil, err
	}

	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	var keyBytes [16]byte
	if _, err := rand.Read(keyBytes[:]); err != nil {
		_ = conn.Close()
		return nil, err
	}
	secKey := base64.StdEncoding.EncodeToString(keyBytes[:])

	reqURI := u.RequestURI()
	var reqBuf strings.Builder
	reqBuf.WriteString("GET " + reqURI + " HTTP/1.1\r\n")
	reqBuf.WriteString("Host: " + u.Host + "\r\n")
	reqBuf.WriteString("Upgrade: websocket\r\n")
	reqBuf.WriteString("Connection: Upgrade\r\n")
	reqBuf.WriteString("Sec-WebSocket-Key: " + secKey + "\r\n")
	reqBuf.WriteString("Sec-WebSocket-Version: 13\r\n")
	reqBuf.WriteString("User-Agent: " + api.UserAgent + "\r\n")
	// Deliberately omit Origin and Sec-Fetch-Site so Companion Gateway CSRF checks pass.
	if ac != nil && ac.Token() != "" {
		switch ac.Mode() {
		case api.AuthModeCompanion:
			reqBuf.WriteString("Authorization: Bearer " + ac.Token() + "\r\n")
		case api.AuthModeDirect:
			reqBuf.WriteString("Cookie: " + api.SessionCookieName + "=" + ac.Token() + "\r\n")
		}
	}
	reqBuf.WriteString("\r\n")

	if _, err := io.WriteString(conn, reqBuf.String()); err != nil {
		_ = conn.Close()
		return nil, err
	}

	br := bufio.NewReaderSize(conn, 32*1024)
	reqStub := &http.Request{Method: http.MethodGet}
	resp, err := http.ReadResponse(br, reqStub)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusSwitchingProtocols {
		_ = conn.Close()
		return nil, &wsUpgradeError{StatusCode: resp.StatusCode, Status: resp.Status}
	}

	expectedAccept := computeWebSocketAccept(secKey)
	if strings.TrimSpace(resp.Header.Get("Sec-WebSocket-Accept")) != expectedAccept {
		_ = conn.Close()
		return nil, errors.New("herdr ws: invalid Sec-WebSocket-Accept header")
	}

	// Clear handshake deadline for long-lived streaming reads.
	_ = conn.SetDeadline(time.Time{})
	return &wsConn{raw: conn, br: br}, nil
}

func computeWebSocketAccept(key string) string {
	h := sha1.New() //nolint:gosec // RFC 6455 handshake requires SHA-1
	_, _ = io.WriteString(h, key+wsMagicGUID)
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

func (w *wsConn) WriteFrame(opcode byte, payload []byte) error {
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	if w.closed {
		return net.ErrClosed
	}

	var hdr [14]byte
	hdr[0] = 0x80 | (opcode & 0x0f)
	n := len(payload)
	idx := 2
	switch {
	case n < 126:
		hdr[1] = 0x80 | byte(n)
	case n <= 0xFFFF:
		hdr[1] = 0x80 | 126
		binary.BigEndian.PutUint16(hdr[2:4], uint16(n))
		idx = 4
	default:
		hdr[1] = 0x80 | 127
		binary.BigEndian.PutUint64(hdr[2:10], uint64(n))
		idx = 10
	}

	var maskKey [4]byte
	if _, err := rand.Read(maskKey[:]); err != nil {
		return err
	}
	copy(hdr[idx:idx+4], maskKey[:])
	idx += 4

	masked := make([]byte, n)
	for i := 0; i < n; i++ {
		masked[i] = payload[i] ^ maskKey[i%4]
	}

	if _, err := w.raw.Write(hdr[:idx]); err != nil {
		return err
	}
	if n > 0 {
		if _, err := w.raw.Write(masked); err != nil {
			return err
		}
	}
	return nil
}

func (w *wsConn) WriteText(payload []byte) error {
	return w.WriteFrame(wsOpText, payload)
}

func (w *wsConn) ReadMessage() (byte, []byte, error) {
	var msgOp byte
	var assembled []byte
	for {
		fin, op, payload, err := w.readFrame()
		if err != nil {
			return 0, nil, err
		}
		switch op {
		case wsOpPing:
			_ = w.WriteFrame(wsOpPong, payload)
			continue
		case wsOpPong:
			continue
		case wsOpClose:
			return wsOpClose, payload, io.EOF
		case wsOpText, wsOpBinary:
			msgOp = op
			assembled = append(assembled[:0], payload...)
			if fin {
				return msgOp, assembled, nil
			}
		case wsOpContinuation:
			if msgOp == 0 {
				return 0, nil, errors.New("herdr ws: unexpected continuation frame")
			}
			if len(assembled)+len(payload) > wsMaxFrameBytes {
				return 0, nil, errors.New("herdr ws: message exceeds limit")
			}
			assembled = append(assembled, payload...)
			if fin {
				return msgOp, assembled, nil
			}
		}
	}
}

func (w *wsConn) readFrame() (bool, byte, []byte, error) {
	var hdr [2]byte
	if _, err := io.ReadFull(w.br, hdr[:]); err != nil {
		return false, 0, nil, err
	}
	fin := (hdr[0] & 0x80) != 0
	op := hdr[0] & 0x0f
	masked := (hdr[1] & 0x80) != 0
	length := uint64(hdr[1] & 0x7f)

	switch length {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(w.br, ext[:]); err != nil {
			return false, 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(w.br, ext[:]); err != nil {
			return false, 0, nil, err
		}
		length = binary.BigEndian.Uint64(ext[:])
	}
	if length > wsMaxFrameBytes {
		return false, 0, nil, errors.New("herdr ws: frame exceeds limit")
	}

	var maskKey [4]byte
	if masked {
		if _, err := io.ReadFull(w.br, maskKey[:]); err != nil {
			return false, 0, nil, err
		}
	}

	payload := make([]byte, int(length))
	if length > 0 {
		if _, err := io.ReadFull(w.br, payload); err != nil {
			return false, 0, nil, err
		}
	}
	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}
	return fin, op, payload, nil
}

func (w *wsConn) Close() error {
	w.writeMu.Lock()
	if w.closed {
		w.writeMu.Unlock()
		return nil
	}
	w.closed = true
	w.writeMu.Unlock()
	_ = w.raw.SetWriteDeadline(time.Now().Add(200 * time.Millisecond))
	var closeFrame [6]byte
	closeFrame[0] = 0x80 | wsOpClose
	closeFrame[1] = 0x80 // 0-length masked frame
	_, _ = w.raw.Write(closeFrame[:])
	return w.raw.Close()
}
