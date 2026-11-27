package telemetry

import (
	"bytes"
	"context"
	"os/exec"
	"runtime"
	"time"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

const (
	hostCommandTimeout = 1500 * time.Millisecond
	nvidiaSMIColumns   = "index,name,memory.total,memory.used,memory.free,utilization.gpu,power.draw,power.limit,temperature.gpu,clocks.current.graphics,clocks.max.graphics,fan.speed,clocks_throttle_reasons.active"
)

// rawHostSample carries platform-probed host facts prior to merging with local
// model runtime state.
type rawHostSample struct {
	Architecture               string
	Platform                   string
	Arch                       string
	Hostname                   string
	ChipName                   string
	OSLabel                    string
	GPUName                    string
	GPUCoreCount               *uint64
	ANECores                   *uint64
	RecommendedWorkingSetBytes *uint64
	SystemRAMTotalBytes        uint64
	SystemRAMAvailableBytes    uint64
	OSWiredBytes               uint64
	ActiveAppsBytes            uint64
	CompressedBytes            uint64
	MemoryPressure             string
	SwapUsedBytes              *uint64
	SwapTotalBytes             *uint64
	SwapIOMBs                  *float64
	VRAMTotalBytes             *uint64
	VRAMUsedBytes              *uint64
	VRAMFreeBytes              *uint64
	DiskTotalBytes             *uint64
	DiskFreeBytes              *uint64
	CPUTotalCores              uint64
	CPULogicalThreads          *uint64
	CPULoadPct                 *float64
	LoadAvg                    []float64
	CPUClusters                []wire.SystemTelemetryCpuCluster
	GPU                        wire.SystemTelemetryGpu
	Power                      wire.SystemTelemetryPower
	Thermal                    wire.SystemTelemetryThermal
}

func wireArch() string {
	switch runtime.GOARCH {
	case "arm64":
		return "arm64"
	default:
		return "x86_64"
	}
}

func runCommandBounded(ctx context.Context, timeout time.Duration, name string, args ...string) (string, bool) {
	if timeout <= 0 {
		timeout = hostCommandTimeout
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, name, args...)
	configureSubprocess(cmd)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return "", false
	}
	return out.String(), true
}
