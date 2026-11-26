//go:build !darwin && !linux && !windows

package telemetry

import (
	"context"
	"os"
	"runtime"
	"time"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

type hostSampler struct{}

func newHostSampler() *hostSampler { return &hostSampler{} }

func (h *hostSampler) sample(_ context.Context, _ string, _ time.Time) rawHostSample {
	hostname, _ := os.Hostname()
	cores := uint64(max(runtime.NumCPU(), 1))
	return rawHostSample{
		Architecture:  "uma",
		Platform:      wirePlatform(),
		Arch:          wireArch(),
		Hostname:      clipTelemetryString(hostname, 200),
		ChipName:      runtime.GOARCH,
		OSLabel:       runtime.GOOS,
		CPUTotalCores: cores,
		CPUClusters: []wire.SystemTelemetryCpuCluster{{
			ID:    "cpu0",
			Name:  "CPU",
			Kind:  "generic",
			Cores: cores,
		}},
	}
}
