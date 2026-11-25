package discovery

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"net"
	"strings"
	"testing"
	"time"
)

func testFingerprint(seed string) string {
	sum := sha256.Sum256([]byte(seed))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func TestShortFingerprintAndValidation(t *testing.T) {
	// SHA-256 of empty bytes: e3b0c442 98fc1c14 ...
	fp := testFingerprint("")
	if len(fp) != 43 {
		t.Fatalf("expected 43-char fingerprint, got %d", len(fp))
	}
	short, err := ShortFingerprint(fp)
	if err != nil {
		t.Fatalf("ShortFingerprint: %v", err)
	}
	want := "E3B0-C442-98FC-1C14"
	if short != want {
		t.Fatalf("ShortFingerprint = %q, want %q", short, want)
	}

	if _, err := ShortFingerprint("too-short"); err == nil {
		t.Fatal("expected error for short fingerprint")
	}
	if _, err := ShortFingerprint(fp + "="); err == nil {
		t.Fatal("expected error for padded fingerprint")
	}
}

func TestParseAndFormatPairingURI(t *testing.T) {
	fp := testFingerprint("spki-demo-key")
	raw := "lingerx://pair?v=1&host=192.168.1.42&port=48210&tls=1&fp=" + fp + "&code=pair_secret_xyz&name=Studio+Mac&ts=100.64.1.8"
	got, err := ParsePairingURI(raw)
	if err != nil {
		t.Fatalf("ParsePairingURI: %v", err)
	}
	if got.Version != 1 || got.Host != "192.168.1.42" || got.Port != 48210 || !got.TLS {
		t.Fatalf("unexpected parsed payload: %+v", got)
	}
	if got.TLSFingerprint != fp || got.Code != "pair_secret_xyz" || got.Name != "Studio Mac" || got.TailscaleHost != "100.64.1.8" {
		t.Fatalf("unexpected parsed fields: %+v", got)
	}
	if got.PrimaryURL() != "https://192.168.1.42:48210" {
		t.Fatalf("PrimaryURL = %q", got.PrimaryURL())
	}
	if got.TailscaleURL() != "https://100.64.1.8:48210" {
		t.Fatalf("TailscaleURL = %q", got.TailscaleURL())
	}

	// Legacy linger://pair links remain accepted for backwards compatibility.
	legacyRaw := strings.Replace(raw, "lingerx://", "linger://", 1)
	legacyGot, err := ParsePairingURI(legacyRaw)
	if err != nil {
		t.Fatalf("ParsePairingURI legacy: %v", err)
	}
	if legacyGot != got {
		t.Fatalf("legacy mismatch:\ngot:  %+v\nwant: %+v", legacyGot, got)
	}

	formatted, err := FormatPairingURI(got)
	if err != nil {
		t.Fatalf("FormatPairingURI: %v", err)
	}
	if !strings.HasPrefix(formatted, "lingerx://pair?") {
		t.Fatalf("expected lingerx://pair prefix, got %q", formatted)
	}
	reparsed, err := ParsePairingURI(formatted)
	if err != nil {
		t.Fatalf("reparse formatted URI: %v", err)
	}
	if reparsed != got {
		t.Fatalf("round-trip mismatch:\ngot:  %+v\nwant: %+v", reparsed, got)
	}
}

func TestParsePairingURIRejectsMalformedAndInjections(t *testing.T) {
	fp := testFingerprint("good")
	cases := []struct {
		name string
		uri  string
	}{
		{"empty", ""},
		{"wrong scheme", "https://pair?v=1&host=192.168.1.2&port=48210&tls=0&code=abc"},
		{"wrong authority", "linger://evil?v=1&host=192.168.1.2&port=48210&tls=0&code=abc"},
		{"unsupported version", "linger://pair?v=2&host=192.168.1.2&port=48210&tls=0&code=abc"},
		{"missing fp when tls=1", "linger://pair?v=1&host=192.168.1.2&port=48210&tls=1&code=abc"},
		{"bad port", "linger://pair?v=1&host=192.168.1.2&port=70000&tls=0&code=abc"},
		{"missing code", "linger://pair?v=1&host=192.168.1.2&port=48210&tls=1&fp=" + fp},
		{"host injection", "linger://pair?v=1&host=evil.com/path&port=48210&tls=0&code=abc"},
		{"userinfo injection", "linger://user@pair?v=1&host=192.168.1.2&port=48210&tls=0&code=abc"},
		{"control char", "linger://pair?v=1&host=192.168.1.2&port=48210&tls=0&code=abc\r\n"},
		{"bad ts host", "linger://pair?v=1&host=192.168.1.2&port=48210&tls=0&code=abc&ts=bad/host"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ParsePairingURI(tc.uri); err == nil {
				t.Fatalf("expected error for %q", tc.uri)
			}
		})
	}
}

func buildSyntheticMDNSResponse(instance, target string, ip net.IP, port uint16, txt []string) []byte {
	var pkt []byte
	hdr := make([]byte, 12)
	binary.BigEndian.PutUint16(hdr[2:4], 0x8400) // response + authoritative
	binary.BigEndian.PutUint16(hdr[6:8], 4)      // 4 answer RRs: PTR, SRV, TXT, A
	pkt = append(pkt, hdr...)

	appendRR := func(name string, rtype uint16, ttl uint32, rdata []byte) {
		pkt = appendDNSName(pkt, name)
		var meta [10]byte
		binary.BigEndian.PutUint16(meta[0:2], rtype)
		binary.BigEndian.PutUint16(meta[2:4], dnsClassIN)
		binary.BigEndian.PutUint32(meta[4:8], ttl)
		binary.BigEndian.PutUint16(meta[8:10], uint16(len(rdata)))
		pkt = append(pkt, meta[:]...)
		pkt = append(pkt, rdata...)
	}

	// PTR
	ptrData := appendDNSName(nil, instance)
	appendRR(ServiceType, dnsTypePTR, 120, ptrData)

	// SRV
	var srvData []byte
	var srvHdr [6]byte
	binary.BigEndian.PutUint16(srvHdr[4:6], port)
	srvData = append(srvData, srvHdr[:]...)
	srvData = appendDNSName(srvData, target)
	appendRR(instance, dnsTypeSRV, 120, srvData)

	// TXT
	var txtData []byte
	for _, s := range txt {
		txtData = append(txtData, byte(len(s)))
		txtData = append(txtData, s...)
	}
	appendRR(instance, dnsTypeTXT, 120, txtData)

	// A
	appendRR(target, dnsTypeA, 120, ip.To4())
	return pkt
}

func TestParseMDNSPacketAndBrowser(t *testing.T) {
	fp := testFingerprint("studio-mac-spki")
	pkt := buildSyntheticMDNSResponse(
		"studio-mac._linger._tcp.local.",
		"studio-mac.local.",
		net.ParseIP("192.168.1.55"),
		48210,
		[]string{
			"v=1",
			"host_id=host_studio_1",
			"name=Studio Mac",
			"tls=1",
			"fp=" + fp,
			"pair=1",
		},
	)

	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	hosts, err := ParseMDNSPacket(pkt, now)
	if err != nil {
		t.Fatalf("ParseMDNSPacket: %v", err)
	}
	if len(hosts) != 1 {
		t.Fatalf("expected 1 host, got %d", len(hosts))
	}
	h := hosts[0]
	if h.HostID != "host_studio_1" || h.Name != "Studio Mac" || h.Host != "192.168.1.55" || h.Port != 48210 {
		t.Fatalf("unexpected discovered host: %+v", h)
	}
	if !h.TLS || h.TLSFingerprint != fp || !h.PairingOpen {
		t.Fatalf("unexpected TLS/pair flags: %+v", h)
	}
	if h.BaseURL() != "https://192.168.1.55:48210" {
		t.Fatalf("BaseURL = %q", h.BaseURL())
	}

	var lastSnap []DiscoveredHost
	browser := NewBrowser(func(s []DiscoveredHost) { lastSnap = s })
	browser.IngestPacket(pkt, now)
	if len(lastSnap) != 1 {
		t.Fatalf("expected browser callback with 1 host, got %d", len(lastSnap))
	}
	browser.PruneExpired(now.Add(31 * time.Second))
	if len(browser.Snapshot()) != 0 {
		t.Fatal("expected expired host to be pruned")
	}

	// BuildBrowseQuery should encode _linger._tcp.local.
	q := BuildBrowseQuery(ServiceType)
	if !strings.Contains(string(q), "_linger") || !strings.Contains(string(q), "_tcp") {
		t.Fatalf("unexpected browse query bytes: %q", string(q))
	}
}

func TestResolveReachableEndpointFailover(t *testing.T) {
	lan := &EndpointTarget{URL: "https://192.168.1.42:48210", TLS: true, Via: "lan"}
	ts := &EndpointTarget{URL: "https://100.64.1.8:48210", TLS: true, Via: "tailscale"}

	// Case 1: LAN times out -> automatic failover to Tailscale.
	res, err := ResolveReachableEndpoint(context.Background(), lan, ts, func(ctx context.Context, target EndpointTarget) error {
		if target.Via == "lan" {
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	}, 40*time.Millisecond)
	if err != nil {
		t.Fatalf("expected failover to succeed, got %v", err)
	}
	if res.Target.Via != "tailscale" {
		t.Fatalf("expected tailscale target, got %q", res.Target.Via)
	}

	// Case 2: Both fail -> combined error.
	_, err = ResolveReachableEndpoint(context.Background(), lan, ts, func(ctx context.Context, target EndpointTarget) error {
		return errors.New("unreachable")
	}, 40*time.Millisecond)
	if err == nil {
		t.Fatal("expected error when both LAN and Tailscale fail")
	}
}
