package composio

import (
	"context"
	"errors"
	"regexp"
	"strconv"
)

type desktopCallbackKey struct{}

var desktopCallbackPattern = regexp.MustCompile(`^http://127\.0\.0\.1:([1-9][0-9]{0,4})/oauth/connector/[a-f0-9]{48}$`)

// WithDesktopOAuthCallback accepts only the desktop's one-time loopback URL.
// The hosted browser follows the URL; TeamHub never connects to it.
func WithDesktopOAuthCallback(ctx context.Context, callback *string) (context.Context, error) {
	if callback == nil {
		return ctx, nil
	}
	match := desktopCallbackPattern.FindStringSubmatch(*callback)
	if len(match) == 2 {
		if _, err := strconv.ParseUint(match[1], 10, 16); err == nil {
			return context.WithValue(ctx, desktopCallbackKey{}, *callback), nil
		}
	}
	return nil, errors.New("invalid desktop OAuth callback")
}
