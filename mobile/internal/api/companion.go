package api

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strings"
	"time"

	"github.com/oldwinter/linger/mobile/internal/discovery"
)

// CompanionAddresses lists LAN and Tailscale addresses advertised by Desktop.
type CompanionAddresses struct {
	LAN       []string `json:"lan"`
	Tailscale []string `json:"tailscale"`
}

// CompanionInfo is returned by GET /companion/v1/info (unauthenticated).
type CompanionInfo struct {
	ProtocolVersion int                `json:"protocol_version"`
	HostID          string             `json:"host_id"`
	HostName        string             `json:"host_name"`
	DesktopVersion  string             `json:"desktop_version"`
	PairingOpen     bool               `json:"pairing_open"`
	TLS             bool               `json:"tls"`
	TLSFingerprint  string             `json:"tls_fingerprint"`
	Addresses       CompanionAddresses `json:"addresses"`
}

// PairRequest is sent to POST /companion/v1/pair with either Code (QR/deep link) or PIN (6 digits).
type PairRequest struct {
	Code       string `json:"code,omitempty"`
	PIN        string `json:"pin,omitempty"`
	DeviceName string `json:"device_name"`
	Platform   string `json:"platform"`
	AppVersion string `json:"app_version"`
}

// FlexString accepts either a JSON string ("v0") or a JSON number (1) when unmarshaling
// wire fields that may differ across Desktop Companion Gateway versions.
type FlexString string

// UnmarshalJSON decodes a JSON string, number, or null into FlexString.
func (f *FlexString) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" || trimmed == "null" {
		*f = ""
		return nil
	}
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		*f = FlexString(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(data, &n); err == nil {
		*f = FlexString(n.String())
		return nil
	}
	return fmt.Errorf("api: invalid string/number value %s", trimmed)
}

// PairResponse is returned by POST /companion/v1/pair on success.
type PairResponse struct {
	DeviceID       string     `json:"device_id"`
	Token          string     `json:"token"`
	HostID         string     `json:"host_id"`
	HostName       string     `json:"host_name"`
	TLSFingerprint string     `json:"tls_fingerprint"`
	TenantID       string     `json:"tenant_id"`
	APIVersion     FlexString `json:"api_version"`
	SessionMode    string     `json:"session_mode"`
}

// CompanionStatus is returned by GET /companion/v1/status (Bearer auth).
type CompanionStatus struct {
	HostID              string `json:"host_id"`
	HostName            string `json:"host_name"`
	DesktopVersion      string `json:"desktop_version"`
	ComputerID          string `json:"computer_id"`
	DaemonConnection    string `json:"daemon_connection"`
	RuntimeState        string `json:"runtime_state"`
	ActiveOperations    int    `json:"active_operations"`
	PreventSleep        bool   `json:"prevent_sleep"`
	LocalServerPhase    string `json:"local_server_phase"`
	LocalModelsDegraded bool   `json:"local_models_degraded"`
	ServerURLMode       string `json:"server_url_mode"`
	DeviceID            string `json:"device_id"`
	PairedDevicesCount  int    `json:"paired_devices_count"`
}

// TokenRotateResponse is returned by POST /companion/v1/token/rotate.
type TokenRotateResponse struct {
	DeviceID string `json:"device_id"`
	Token    string `json:"token"`
}

// UnpairResponse is returned by POST /companion/v1/unpair.
type UnpairResponse struct {
	Unpaired bool `json:"unpaired"`
}

// GetCompanionInfo fetches GET /companion/v1/info using the client's configured TLS pin.
func (c *Client) GetCompanionInfo(ctx context.Context) (CompanionInfo, error) {
	var out CompanionInfo
	err := c.DoJSON(ctx, http.MethodGet, "/companion/v1/info", nil, &out)
	return out, err
}

// Pair exchanges a pairing code or 6-digit PIN at POST /companion/v1/pair.
func (c *Client) Pair(ctx context.Context, req PairRequest) (PairResponse, error) {
	if req.Platform == "" {
		req.Platform = runtime.GOOS
	}
	if req.AppVersion == "" {
		req.AppVersion = "0.1.0"
	}
	var out PairResponse
	err := c.DoJSON(ctx, http.MethodPost, "/companion/v1/pair", req, &out)
	if err == nil && out.Token != "" {
		c.mu.Lock()
		c.mode = AuthModeCompanion
		c.mu.Unlock()
		c.SetToken(out.Token)
	}
	return out, err
}

// GetCompanionStatus fetches Desktop runtime health from GET /companion/v1/status.
func (c *Client) GetCompanionStatus(ctx context.Context) (CompanionStatus, error) {
	var out CompanionStatus
	err := c.DoJSON(ctx, http.MethodGet, "/companion/v1/status", nil, &out)
	return out, err
}

// RotateCompanionToken rotates the device bearer token via POST /companion/v1/token/rotate.
func (c *Client) RotateCompanionToken(ctx context.Context) (TokenRotateResponse, error) {
	var out TokenRotateResponse
	err := c.DoJSON(ctx, http.MethodPost, "/companion/v1/token/rotate", struct{}{}, &out)
	if err == nil && out.Token != "" {
		c.SetToken(out.Token)
	}
	return out, err
}

// UnpairCompanion self-revokes this device token via POST /companion/v1/unpair.
func (c *Client) UnpairCompanion(ctx context.Context) (UnpairResponse, error) {
	var out UnpairResponse
	err := c.DoJSON(ctx, http.MethodPost, "/companion/v1/unpair", struct{}{}, &out)
	return out, err
}

// TOFUProbeResult contains the observed TLS SPKI fingerprint (when HTTPS) and
// /companion/v1/info metadata so the user can verify ShortFingerprint before PIN pairing.
type TOFUProbeResult struct {
	Info                CompanionInfo
	ObservedFingerprint string
	ShortCode           string
	RTT                 time.Duration
}

// ProbeCompanionTOFU performs a Trust-On-First-Use probe of GET /companion/v1/info
// for manual/mDNS PIN pairing where the user hasn't scanned a QR code yet.
// For HTTPS endpoints, it captures the leaf SPKI SHA-256 directly from the TLS
// handshake and verifies it matches info.TLSFingerprint before returning.
func ProbeCompanionTOFU(ctx context.Context, baseURL string, allowPlainHTTP bool) (TOFUProbeResult, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if err := validateEndpointPolicy(baseURL, allowPlainHTTP); err != nil {
		return TOFUProbeResult{}, err
	}

	var observedFP string
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if strings.HasPrefix(strings.ToLower(baseURL), "https://") {
		tr.TLSClientConfig = &tls.Config{
			MinVersion:         tls.VersionTLS13,
			InsecureSkipVerify: true, //nolint:gosec // TOFU probe captures leaf SPKI for human verification
			VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
				if len(rawCerts) == 0 {
					return errors.New("api: TOFU probe received no peer certificate")
				}
				leaf, err := x509.ParseCertificate(rawCerts[0])
				if err != nil {
					return fmt.Errorf("api: TOFU probe parse certificate: %w", err)
				}
				observedFP = discovery.ComputeSPKIFingerprint(leaf.RawSubjectPublicKeyInfo)
				return nil
			},
		}
	}

	httpClient := &http.Client{
		Transport:     tr,
		Timeout:       5 * time.Second,
		CheckRedirect: disallowRedirects,
	}
	defer tr.CloseIdleConnections()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/companion/v1/info", nil)
	if err != nil {
		return TOFUProbeResult{}, err
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")

	start := time.Now()
	resp, err := httpClient.Do(req)
	rtt := time.Since(start)
	if err != nil {
		return TOFUProbeResult{}, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return TOFUProbeResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return TOFUProbeResult{}, parseAPIError(resp.StatusCode, raw)
	}

	var info CompanionInfo
	if err := json.Unmarshal(raw, &info); err != nil {
		return TOFUProbeResult{}, fmt.Errorf("api: decode companion info: %w", err)
	}

	if observedFP != "" {
		if info.TLSFingerprint != "" && info.TLSFingerprint != observedFP {
			return TOFUProbeResult{}, fmt.Errorf("%w: info advertised %s, TLS leaf is %s", ErrTLSFingerprintMismatch, info.TLSFingerprint, observedFP)
		}
		if info.TLSFingerprint == "" {
			info.TLSFingerprint = observedFP
		}
	}

	shortCode := ""
	if observedFP != "" {
		shortCode, err = discovery.ShortFingerprint(observedFP)
		if err != nil {
			return TOFUProbeResult{}, err
		}
	}
	return TOFUProbeResult{
		Info:                info,
		ObservedFingerprint: observedFP,
		ShortCode:           shortCode,
		RTT:                 rtt,
	}, nil
}
