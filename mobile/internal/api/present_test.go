package api_test

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/config"
	"github.com/oldwinter/linger/mobile/internal/i18n"
)

func TestPresentErrorHumanizes413AndStructuredErrors(t *testing.T) {
	t.Cleanup(func() {
		i18n.SetPreference(config.LanguageEN)
	})
	i18n.SetPreference(config.LanguageEN)

	// TeamHub 413 PAYLOAD_TOO_LARGE with structured details[0].limit_bytes (25 MB)
	err413 := &api.APIError{
		StatusCode: http.StatusRequestEntityTooLarge,
		Code:       "PAYLOAD_TOO_LARGE",
		Message:    "request body exceeds size limit",
		Details:    json.RawMessage(`[{"field":"content","code":"too_large","reason":"file exceeds limit","limit_bytes":26214400}]`),
	}
	if limit, ok := err413.LimitBytes(); !ok || limit != 26214400 {
		t.Fatalf("LimitBytes() = (%d, %v), want (26214400, true)", limit, ok)
	}
	gotEN := api.PresentError(err413)
	if !strings.Contains(gotEN, "25 MB") || strings.Contains(gotEN, "PAYLOAD_TOO_LARGE") || strings.Contains(gotEN, "api 413") {
		t.Fatalf("unexpected EN 413 presentation: %q", gotEN)
	}

	// Verify zh-Hans localization of 413 with limit_bytes.
	i18n.SetPreference(config.LanguageZhHans)
	gotZH := api.PresentError(err413)
	if !strings.Contains(gotZH, "25 MB") || strings.Contains(gotZH, "PAYLOAD_TOO_LARGE") {
		t.Fatalf("unexpected zh-Hans 413 presentation: %q", gotZH)
	}

	i18n.SetPreference(config.LanguageEN)

	// 413 without limit_bytes falls back cleanly.
	err413NoLimit := &api.APIError{
		StatusCode: http.StatusRequestEntityTooLarge,
		Code:       "DOCUMENT_ASSET_TOO_LARGE",
		Message:    "too big",
	}
	if got := api.PresentError(err413NoLimit); strings.Contains(got, "api 413") || strings.Contains(got, "DOCUMENT_ASSET_TOO_LARGE") {
		t.Fatalf("unexpected 413 fallback presentation: %q", got)
	}

	// 401 / 403 / 404 / 429 / 503 / timeout / network errors never leak raw "api NNN CODE:" prefixes.
	cases := []struct {
		name string
		err  error
	}{
		{"401", &api.APIError{StatusCode: 401, Code: "SESSION_EXPIRED", Message: "expired"}},
		{"403", &api.APIError{StatusCode: 403, Code: "FORBIDDEN", Message: "denied"}},
		{"404", &api.APIError{StatusCode: 404, Code: "NOT_FOUND", Message: "missing"}},
		{"429", &api.APIError{StatusCode: 429, Code: "RATE_LIMITED", Message: "slow down"}},
		{"503", &api.APIError{StatusCode: 503, Code: "UNAVAILABLE", Message: "restarting"}},
		{"tls", api.ErrTLSFingerprintMismatch},
		{"plain_http", api.ErrPlainHTTPDisallowed},
		{"timeout", context.DeadlineExceeded},
		{"net_op", &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("connection refused")}},
	}
	for _, tc := range cases {
		got := api.PresentError(tc.err)
		if got == "" {
			t.Errorf("%s: empty presentation", tc.name)
		}
		if strings.HasPrefix(got, "api ") {
			t.Errorf("%s: leaked raw API prefix: %q", tc.name, got)
		}
	}
}
