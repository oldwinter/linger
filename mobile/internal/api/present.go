package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/oldwinter/linger/mobile/internal/i18n"
)

// PresentError translates transport, timeout, and structured APIError values
// into calm, localized user-facing copy without raw HTTP status/code prefixes.
func PresentError(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, ErrTLSFingerprintMismatch) {
		return i18n.T("err.tls_mismatch")
	}
	if errors.Is(err, ErrPlainHTTPDisallowed) {
		return i18n.T("err.plain_http_disallowed")
	}

	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return presentAPIError(apiErr)
	}

	if errors.Is(err, ErrUnauthorized) {
		return i18n.T("err.session_expired")
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return i18n.T("err.timeout")
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() {
			return i18n.T("err.timeout")
		}
		return i18n.T("err.network_unreachable")
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return i18n.T("err.network_unreachable")
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return i18n.T("err.network_unreachable")
	}
	return strings.TrimSpace(err.Error())
}

func presentAPIError(e *APIError) string {
	if e == nil {
		return ""
	}
	if e.IsPayloadTooLarge() {
		if limit, ok := e.LimitBytes(); ok {
			return i18n.Tf("err.payload_too_large_limit", map[string]any{
				"limit": formatByteLimit(limit),
			})
		}
		return i18n.T("err.payload_too_large")
	}
	if e.IsUnauthenticated() {
		return i18n.T("err.session_expired")
	}
	code := strings.ToUpper(strings.TrimSpace(e.Code))
	switch {
	case e.StatusCode == http.StatusForbidden || code == "FORBIDDEN":
		return i18n.T("err.forbidden")
	case e.StatusCode == http.StatusNotFound || code == "NOT_FOUND":
		return i18n.T("err.not_found")
	case e.StatusCode == http.StatusConflict || code == "CONFLICT" || code == "REVISION_CONFLICT":
		if msg := strings.TrimSpace(e.Message); msg != "" {
			return msg
		}
		return i18n.T("err.conflict")
	case e.StatusCode == http.StatusTooManyRequests || code == "RATE_LIMITED":
		return i18n.T("err.rate_limited")
	case e.StatusCode == http.StatusBadGateway || e.StatusCode == http.StatusServiceUnavailable || e.StatusCode == http.StatusGatewayTimeout:
		return i18n.T("err.service_unavailable")
	case e.StatusCode >= 500:
		return i18n.T("err.server_error")
	}
	if msg := strings.TrimSpace(e.Message); msg != "" {
		return msg
	}
	return i18n.T("err.server_error")
}

func formatByteLimit(b int64) string {
	const (
		kb = int64(1024)
		mb = 1024 * kb
		gb = 1024 * mb
	)
	switch {
	case b >= gb && b%gb == 0:
		return i18n.Tf("size.gb", map[string]any{"value": fmt.Sprintf("%d", b/gb)})
	case b >= gb:
		return i18n.Tf("size.gb", map[string]any{"value": fmt.Sprintf("%.1f", float64(b)/float64(gb))})
	case b >= mb && b%mb == 0:
		return i18n.Tf("size.mb", map[string]any{"value": fmt.Sprintf("%d", b/mb)})
	case b >= mb:
		return i18n.Tf("size.mb", map[string]any{"value": fmt.Sprintf("%.1f", float64(b)/float64(mb))})
	case b >= kb:
		return i18n.Tf("size.kb", map[string]any{"value": fmt.Sprintf("%d", (b+kb-1)/kb)})
	default:
		return i18n.Tf("size.kb", map[string]any{"value": "1"})
	}
}
