package discovery

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// DefaultLANProbeTimeout bounds how long mobile waits on LAN before failing over to Tailscale.
const DefaultLANProbeTimeout = 1500 * time.Millisecond

// EndpointTarget describes one candidate transport endpoint for a host.
type EndpointTarget struct {
	URL            string
	TLS            bool
	TLSFingerprint string
	AllowPlainHTTP bool
	Via            string // "lan", "tailscale", or "direct"
}

// ReachableResult reports which endpoint succeeded and how fast it responded.
type ReachableResult struct {
	Target EndpointTarget
	RTT    time.Duration
}

// ProbeFunc checks reachability of a candidate endpoint (for example GET /companion/v1/info).
type ProbeFunc func(ctx context.Context, target EndpointTarget) error

// ResolveReachableEndpoint probes LAN first with a bounded timeout and
// automatically fails over to Tailscale if LAN is unreachable.
func ResolveReachableEndpoint(
	ctx context.Context,
	lan *EndpointTarget,
	tailscale *EndpointTarget,
	probe ProbeFunc,
	lanTimeout time.Duration,
) (ReachableResult, error) {
	if probe == nil {
		return ReachableResult{}, errors.New("discovery: probe function is required")
	}
	if lanTimeout <= 0 {
		lanTimeout = DefaultLANProbeTimeout
	}

	var lanErr error
	if lan != nil && lan.URL != "" {
		lanCtx, cancel := context.WithTimeout(ctx, lanTimeout)
		start := time.Now()
		lanErr = probe(lanCtx, *lan)
		rtt := time.Since(start)
		cancel()
		if lanErr == nil {
			return ReachableResult{Target: *lan, RTT: rtt}, nil
		}
	}

	if tailscale != nil && tailscale.URL != "" {
		if ctx.Err() != nil {
			return ReachableResult{}, ctx.Err()
		}
		start := time.Now()
		tsErr := probe(ctx, *tailscale)
		rtt := time.Since(start)
		if tsErr == nil {
			return ReachableResult{Target: *tailscale, RTT: rtt}, nil
		}
		if lanErr != nil {
			return ReachableResult{}, fmt.Errorf("discovery: lan failed (%v) and tailscale failed (%w)", lanErr, tsErr)
		}
		return ReachableResult{}, fmt.Errorf("discovery: tailscale failed: %w", tsErr)
	}

	if lanErr != nil {
		return ReachableResult{}, fmt.Errorf("discovery: lan failed: %w", lanErr)
	}
	return ReachableResult{}, errors.New("discovery: no candidate endpoints provided")
}
