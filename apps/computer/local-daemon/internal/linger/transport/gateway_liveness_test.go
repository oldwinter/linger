package transport

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const (
	testPingInterval = 20 * time.Millisecond
	testReadTimeout  = 400 * time.Millisecond
)

// livenessGatewayStream connects to a peer that reads forever and sends
// nothing; answerPings selects whether it replies to Pings with Pongs.
func livenessGatewayStream(t *testing.T, answerPings bool) (*gatewayStream, *atomic.Int32) {
	t.Helper()
	var pings atomic.Int32
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		peer, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer peer.Close()
		peer.SetPingHandler(func(data string) error {
			pings.Add(1)
			if !answerPings {
				return nil
			}
			return peer.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(time.Second))
		})
		for {
			if _, _, err := peer.ReadMessage(); err != nil {
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	stream, err := (GatewayControlPlane{
		URL: "ws" + strings.TrimPrefix(server.URL, "http"), BearerToken: "test-token",
		PingInterval: testPingInterval, ReadTimeout: testReadTimeout,
	}).Connect(context.Background(), Hello{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = stream.Close() })
	return stream.(*gatewayStream), &pings
}

func TestGatewayIdleConnectionAnsweringPingsStaysOpen(t *testing.T) {
	stream, pings := livenessGatewayStream(t, true)
	idle := 6 * testReadTimeout
	ctx, cancel := context.WithTimeout(context.Background(), idle)
	defer cancel()
	started := time.Now()
	_, err := stream.Receive(ctx)
	if err == nil {
		t.Fatal("Receive returned a command from a silent peer")
	}
	if elapsed := time.Since(started); elapsed < idle-10*time.Millisecond {
		t.Fatalf("Receive ended after %v, before the %v context deadline: %v", elapsed, idle, err)
	}
	if pings.Load() == 0 {
		t.Fatal("peer observed no liveness pings")
	}
}

func TestGatewaySilentPeerEndsReceiveAsUnavailable(t *testing.T) {
	stream, pings := livenessGatewayStream(t, false)
	result := make(chan error, 1)
	started := time.Now()
	go func() {
		_, err := stream.Receive(context.Background())
		result <- err
	}()
	var err error
	select {
	case err = <-result:
	case <-time.After(5 * time.Second):
		t.Fatal("Receive kept waiting on a peer that stopped answering pings")
	}
	if err == nil {
		t.Fatal("Receive returned no error from a dead peer")
	}
	if elapsed := time.Since(started); elapsed < testReadTimeout {
		t.Fatalf("Receive ended after %v, before the %v read timeout", elapsed, testReadTimeout)
	}
	if got := ClassifyConnectionFailure(err); got != FailureUnavailable {
		t.Fatalf("ClassifyConnectionFailure(%v)=%v, want FailureUnavailable", err, got)
	}
	if pings.Load() == 0 {
		t.Fatal("peer observed no liveness pings")
	}
	if !stream.closed.Load() {
		t.Fatal("liveness timeout left the stream open")
	}
}

// A context deadline bounds only its own Receive call.
func TestGatewayContextDeadlineDoesNotShortenLaterReceive(t *testing.T) {
	stream, _ := livenessGatewayStream(t, true)
	if err := stream.extendReadDeadline(); err != nil {
		t.Fatal(err)
	}
	stream.contextDeadline = time.Now().Add(-time.Second)
	if err := stream.extendReadDeadline(); err != nil {
		t.Fatal(err)
	}
	stream.contextDeadline = time.Time{}
	ctx, cancel := context.WithTimeout(context.Background(), 4*testReadTimeout)
	defer cancel()
	started := time.Now()
	_, _ = stream.Receive(ctx)
	if elapsed := time.Since(started); elapsed < 4*testReadTimeout-10*time.Millisecond {
		t.Fatalf("Receive ended after %v, an earlier deadline leaked into it", elapsed)
	}
}

func TestGatewayCloseStopsPings(t *testing.T) {
	stream, pings := livenessGatewayStream(t, true)
	deadline := time.Now().Add(5 * time.Second)
	for pings.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if pings.Load() == 0 {
		t.Fatal("peer observed no liveness pings")
	}
	// Concurrent Close calls race the ping goroutine without panicking.
	closed := make(chan struct{})
	for range 4 {
		go func() {
			_ = stream.Close()
			closed <- struct{}{}
		}()
	}
	for range 4 {
		<-closed
	}
	after := pings.Load()
	time.Sleep(5 * testPingInterval)
	if got := pings.Load(); got != after {
		t.Fatalf("peer observed %d pings after Close", got-after)
	}
	select {
	case <-stream.done:
	default:
		t.Fatal("Close left the ping goroutine running")
	}
}

// A large command trickling in on a slow downlink keeps the connection alive
// even though the peer's Pongs queue behind it.
func TestGatewaySlowLargeCommandIsNotALivenessTimeout(t *testing.T) {
	const chunkBytes = 4096
	const chunks = 40
	// NextWriter holds back one buffered chunk, so gaps reach twice the pause;
	// a tenth of the read timeout leaves room for a descheduled writer.
	const pause = testReadTimeout / 10
	body := `{"type":"runtime.registration.snapshot","protocol_version":"2",` +
		`"command_id":"snapshot-slow","runner_id":"computer-local","connection_epoch":3,` +
		strings.Repeat(" ", chunkBytes*chunks) + `"registrations":[]}`
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		peer, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer peer.Close()
		// The peer never reads while it writes, so it answers no Ping.
		message, err := peer.NextWriter(websocket.TextMessage)
		if err != nil {
			return
		}
		for offset := 0; offset < len(body); offset += chunkBytes {
			end := min(offset+chunkBytes, len(body))
			if _, err := message.Write([]byte(body[offset:end])); err != nil {
				return
			}
			time.Sleep(pause)
		}
		_ = message.Close()
		_, _, _ = peer.ReadMessage()
	}))
	t.Cleanup(server.Close)
	stream, err := (GatewayControlPlane{
		URL: "ws" + strings.TrimPrefix(server.URL, "http"), BearerToken: "test-token",
		PingInterval: testPingInterval, ReadTimeout: testReadTimeout,
	}).Connect(context.Background(), Hello{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = stream.Close() })
	started := time.Now()
	command, err := stream.Receive(context.Background())
	if err != nil {
		t.Fatalf("Receive failed after %v: %v", time.Since(started), err)
	}
	if elapsed := time.Since(started); elapsed < 3*testReadTimeout {
		t.Fatalf("command arrived after %v, too fast to exercise the read timeout", elapsed)
	}
	if command.CommandID != "snapshot-slow" {
		t.Fatalf("command=%+v, want snapshot-slow", command)
	}
}
