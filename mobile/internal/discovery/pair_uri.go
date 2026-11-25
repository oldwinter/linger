// Package discovery handles LAN mDNS discovery (_linger._tcp.local.),
// linger://pair URI parsing and validation, SPKI fingerprint formatting,
// and LAN-to-Tailscale endpoint failover probing.
package discovery

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

const (
	// DefaultCompanionPort is the locked Companion Gateway default port.
	DefaultCompanionPort = 48210
	// PairingScheme is the registered custom URL scheme for LingerX Mobile.
	PairingScheme = "lingerx"
	// LegacyPairingScheme keeps pairing links from earlier Linger builds accepted.
	LegacyPairingScheme = "linger"
	// PairingHost is the authority component of lingerx://pair URIs.
	PairingHost = "pair"
	// CompanionProtocolVersion is the locked Companion wire protocol version.
	CompanionProtocolVersion = 1
)

// PairingPayload represents a validated linger://pair?... deep-link or QR payload.
type PairingPayload struct {
	Version        int
	Host           string
	Port           int
	TLS            bool
	TLSFingerprint string
	Code           string
	Name           string
	TailscaleHost  string
}

// PrimaryURL builds the primary HTTP(S) base URL for this pairing payload.
func (p PairingPayload) PrimaryURL() string {
	return formatHostURL(p.Host, p.Port, p.TLS)
}

// TailscaleURL builds the optional Tailscale fallback URL, or empty if unset.
func (p PairingPayload) TailscaleURL() string {
	if p.TailscaleHost == "" {
		return ""
	}
	return formatHostURL(p.TailscaleHost, p.Port, p.TLS)
}

func formatHostURL(host string, port int, tlsEnabled bool) string {
	scheme := "http"
	if tlsEnabled {
		scheme = "https"
	}
	if port <= 0 {
		port = DefaultCompanionPort
	}
	return fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(host, strconv.Itoa(port)))
}

// ValidateFingerprint validates an unpadded base64url SHA-256 SPKI fingerprint
// (43 characters decoding to 32 bytes) and returns the raw digest.
func ValidateFingerprint(fp string) ([]byte, error) {
	if len(fp) != 43 {
		return nil, fmt.Errorf("discovery: invalid tls fingerprint length %d (want 43)", len(fp))
	}
	raw, err := base64.RawURLEncoding.DecodeString(fp)
	if err != nil {
		return nil, fmt.Errorf("discovery: invalid base64url tls fingerprint: %w", err)
	}
	if len(raw) != sha256.Size {
		return nil, fmt.Errorf("discovery: invalid tls fingerprint digest length %d", len(raw))
	}
	return raw, nil
}

// ComputeSPKIFingerprint returns the unpadded base64url SHA-256 digest of a
// certificate's RawSubjectPublicKeyInfo DER bytes.
func ComputeSPKIFingerprint(spkiDER []byte) string {
	sum := sha256.Sum256(spkiDER)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// ShortFingerprint formats a 43-char unpadded base64url SHA-256 SPKI fingerprint
// as 16 uppercase hex characters grouped XXXX-XXXX-XXXX-XXXX for human verification.
func ShortFingerprint(fp string) (string, error) {
	raw, err := ValidateFingerprint(fp)
	if err != nil {
		return "", err
	}
	h := strings.ToUpper(hex.EncodeToString(raw[:8]))
	return fmt.Sprintf("%s-%s-%s-%s", h[0:4], h[4:8], h[8:12], h[12:16]), nil
}

// ParsePairingURI parses and strictly validates a linger://pair?... URI.
func ParsePairingURI(raw string) (PairingPayload, error) {
	raw = strings.Trim(raw, " \t")
	if raw == "" {
		return PairingPayload{}, errors.New("discovery: empty pairing URI")
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] < 0x20 || raw[i] == 0x7f {
			return PairingPayload{}, errors.New("discovery: pairing URI contains control characters")
		}
	}

	u, err := url.Parse(raw)
	if err != nil {
		return PairingPayload{}, fmt.Errorf("discovery: invalid pairing URI: %w", err)
	}
	if !strings.EqualFold(u.Scheme, PairingScheme) && !strings.EqualFold(u.Scheme, LegacyPairingScheme) {
		return PairingPayload{}, fmt.Errorf("discovery: unsupported pairing scheme %q", u.Scheme)
	}
	if !strings.EqualFold(u.Host, PairingHost) || (u.Path != "" && u.Path != "/") {
		return PairingPayload{}, fmt.Errorf("discovery: invalid pairing URI target %q%s", u.Host, u.Path)
	}
	if u.User != nil {
		return PairingPayload{}, errors.New("discovery: pairing URI must not contain userinfo")
	}

	q := u.Query()
	vStr := q.Get("v")
	if vStr == "" {
		return PairingPayload{}, errors.New("discovery: missing protocol version v")
	}
	v, err := strconv.Atoi(vStr)
	if err != nil || v != CompanionProtocolVersion {
		return PairingPayload{}, fmt.Errorf("discovery: unsupported protocol version %q", vStr)
	}

	host := strings.TrimSpace(q.Get("host"))
	if err := validateHost(host); err != nil {
		return PairingPayload{}, fmt.Errorf("discovery: invalid host: %w", err)
	}

	port := DefaultCompanionPort
	if pStr := strings.TrimSpace(q.Get("port")); pStr != "" {
		p, err := strconv.Atoi(pStr)
		if err != nil || p < 1 || p > 65535 {
			return PairingPayload{}, fmt.Errorf("discovery: invalid port %q", pStr)
		}
		port = p
	}

	tlsVal := strings.TrimSpace(q.Get("tls"))
	var tlsEnabled bool
	switch tlsVal {
	case "1", "true":
		tlsEnabled = true
	case "0", "false":
		tlsEnabled = false
	default:
		return PairingPayload{}, fmt.Errorf("discovery: invalid tls flag %q", tlsVal)
	}

	fp := strings.TrimSpace(q.Get("fp"))
	if tlsEnabled {
		if _, err := ValidateFingerprint(fp); err != nil {
			return PairingPayload{}, err
		}
	} else if fp != "" {
		if _, err := ValidateFingerprint(fp); err != nil {
			return PairingPayload{}, err
		}
	}

	code := strings.TrimSpace(q.Get("code"))
	if code == "" {
		return PairingPayload{}, errors.New("discovery: missing pairing code")
	}
	if len(code) > 256 || !isSafeToken(code) {
		return PairingPayload{}, errors.New("discovery: invalid pairing code")
	}

	name := strings.TrimSpace(q.Get("name"))
	if name == "" {
		name = host
	}
	if len(name) > 128 {
		name = name[:128]
	}

	ts := strings.TrimSpace(q.Get("ts"))
	if ts != "" {
		if err := validateHost(ts); err != nil {
			return PairingPayload{}, fmt.Errorf("discovery: invalid tailscale host: %w", err)
		}
	}

	return PairingPayload{
		Version:        v,
		Host:           host,
		Port:           port,
		TLS:            tlsEnabled,
		TLSFingerprint: fp,
		Code:           code,
		Name:           name,
		TailscaleHost:  ts,
	}, nil
}

// FormatPairingURI serializes a validated PairingPayload into canonical linger://pair?... form.
func FormatPairingURI(p PairingPayload) (string, error) {
	if p.Version == 0 {
		p.Version = CompanionProtocolVersion
	}
	if p.Port == 0 {
		p.Port = DefaultCompanionPort
	}
	if err := validateHost(p.Host); err != nil {
		return "", err
	}
	if p.Port < 1 || p.Port > 65535 {
		return "", fmt.Errorf("discovery: invalid port %d", p.Port)
	}
	if p.TLS {
		if _, err := ValidateFingerprint(p.TLSFingerprint); err != nil {
			return "", err
		}
	}
	if p.Code == "" || !isSafeToken(p.Code) {
		return "", errors.New("discovery: invalid pairing code")
	}
	if p.TailscaleHost != "" {
		if err := validateHost(p.TailscaleHost); err != nil {
			return "", err
		}
	}

	q := url.Values{}
	q.Set("v", strconv.Itoa(p.Version))
	q.Set("host", p.Host)
	q.Set("port", strconv.Itoa(p.Port))
	if p.TLS {
		q.Set("tls", "1")
	} else {
		q.Set("tls", "0")
	}
	if p.TLSFingerprint != "" {
		q.Set("fp", p.TLSFingerprint)
	}
	q.Set("code", p.Code)
	if p.Name != "" {
		q.Set("name", p.Name)
	}
	if p.TailscaleHost != "" {
		q.Set("ts", p.TailscaleHost)
	}
	return (&url.URL{
		Scheme:   PairingScheme,
		Host:     PairingHost,
		RawQuery: q.Encode(),
	}).String(), nil
}

func validateHost(h string) error {
	if h == "" || len(h) > 253 {
		return errors.New("host must be 1..253 chars")
	}
	if strings.ContainsAny(h, " \t\r\n/@?#\\") {
		return errors.New("host contains forbidden characters")
	}
	if ip := net.ParseIP(h); ip != nil {
		return nil
	}
	labels := strings.Split(strings.TrimSuffix(h, "."), ".")
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 {
			return errors.New("invalid DNS label length")
		}
		if label[0] == '-' || label[len(label)-1] == '-' {
			return errors.New("DNS label cannot start or end with hyphen")
		}
		for i := 0; i < len(label); i++ {
			ch := label[i]
			ok := (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-'
			if !ok {
				return fmt.Errorf("invalid character %q in host", ch)
			}
		}
	}
	return nil
}

func isSafeToken(s string) bool {
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch <= 0x20 || ch >= 0x7f {
			return false
		}
	}
	return true
}
