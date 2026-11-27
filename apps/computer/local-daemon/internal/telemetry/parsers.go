package telemetry

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"

	wire "github.com/simplexai-labs/linger/contracts-go/runnergateway"
)

// VMStatSample holds parsed macOS vm_stat page counters.
type VMStatSample struct {
	PageSize        uint64
	FreePages       uint64
	ActivePages     uint64
	InactivePages   uint64
	Speculative     uint64
	WiredPages      uint64
	CompressedPages uint64
	Swapins         uint64
	Swapouts        uint64
}

// AGXSample holds parsed rootless macOS AGXAccelerator ioreg counters.
type AGXSample struct {
	Model            string
	GPUCoreCount     *uint64
	DeviceUtilPct    *float64
	RendererUtilPct  *float64
	TilerUtilPct     *float64
	InUseSystemBytes *uint64
	AllocSystemBytes *uint64
}

// PMSetThermSample holds parsed rootless macOS pmset -g therm thermal data.
type PMSetThermSample struct {
	CPUSpeedLimitPct *float64
	ThermalState     string
	Throttling       bool
	ThrottleReason   string
}

// NvidiaGPUSample holds one parsed nvidia-smi CSV row.
type NvidiaGPUSample struct {
	Index           int
	Name            string
	MemoryTotalMB   *float64
	MemoryUsedMB    *float64
	MemoryFreeMB    *float64
	UtilPct         *float64
	PowerDrawW      *float64
	PowerLimitW     *float64
	TempC           *float64
	ClockMHz        *float64
	MaxClockMHz     *float64
	FanPct          *float64
	ThrottleReasons string
}

// ProcMeminfo holds parsed Linux /proc/meminfo counters in bytes.
type ProcMeminfo struct {
	MemTotal     uint64
	MemFree      uint64
	MemAvailable uint64
	Buffers      uint64
	Cached       uint64
	Active       uint64
	Inactive     uint64
	Unevictable  uint64
	Mlocked      uint64
	Slab         uint64
	SwapTotal    uint64
	SwapFree     uint64
	Zswap        uint64
}

// ProcCPUTimes holds cumulative Linux /proc/stat aggregate CPU jiffies.
type ProcCPUTimes struct {
	Total uint64
	Idle  uint64
}

// ProcVMStat holds Linux /proc/vmstat swap page counters.
type ProcVMStat struct {
	Pswpin  uint64
	Pswpout uint64
}

// LlamaCounters holds parsed llama-server Prometheus /metrics counters.
type LlamaCounters struct {
	PromptTokens     float64
	PromptSeconds    float64
	PredictedTokens  float64
	PredictedSeconds float64
	Processing       float64
}

var (
	vmStatPageSizeRE = regexp.MustCompile(`page size of (\d+) bytes\)`)
	swapFieldRE      = regexp.MustCompile(`(total|used|free)\s*=\s*([0-9]+(?:\.[0-9]+)?)([KMGTkmgt]?)`)
	ioregModelRE     = regexp.MustCompile(`"model"\s*=\s*"([^"]+)"`)
	ioregGPUCoresRE  = regexp.MustCompile(`"gpu-core-count"\s*=\s*(\d+)`)
	ioregPerfKVRE    = regexp.MustCompile(`"([^"]+)"\s*=\s*(-?\d+)`)
	pmsetSpeedLimRE  = regexp.MustCompile(`CPU_Speed_Limit\s*=\s*(\d+)`)
	pmsetThermLvlRE  = regexp.MustCompile(`Thermal_Level\s*=\s*(\d+)`)
)

// ParseVMStat parses macOS /usr/bin/vm_stat output.
func ParseVMStat(text string) (VMStatSample, bool) {
	var sample VMStatSample
	match := vmStatPageSizeRE.FindStringSubmatch(text)
	if len(match) != 2 {
		return VMStatSample{}, false
	}
	pageSize, err := strconv.ParseUint(match[1], 10, 64)
	if err != nil || pageSize == 0 {
		return VMStatSample{}, false
	}
	sample.PageSize = pageSize
	seen := 0
	for _, line := range strings.Split(text, "\n") {
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(strings.Trim(key, `"`))
		val = strings.TrimSuffix(strings.TrimSpace(val), ".")
		parsed, err := strconv.ParseUint(val, 10, 64)
		if err != nil {
			continue
		}
		switch key {
		case "Pages free":
			sample.FreePages = parsed
			seen++
		case "Pages active":
			sample.ActivePages = parsed
			seen++
		case "Pages inactive":
			sample.InactivePages = parsed
			seen++
		case "Pages speculative":
			sample.Speculative = parsed
		case "Pages wired down":
			sample.WiredPages = parsed
			seen++
		case "Pages occupied by compressor":
			sample.CompressedPages = parsed
		case "Swapins":
			sample.Swapins = parsed
		case "Swapouts":
			sample.Swapouts = parsed
		}
	}
	return sample, seen >= 3
}

// ParseSwapUsage parses macOS `sysctl -n vm.swapusage` output.
func ParseSwapUsage(text string) (usedBytes, totalBytes uint64, ok bool) {
	matches := swapFieldRE.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return 0, 0, false
	}
	var seenTotal, seenUsed bool
	for _, m := range matches {
		value, err := strconv.ParseFloat(m[2], 64)
		if err != nil || value < 0 {
			continue
		}
		mult := float64(1)
		switch strings.ToUpper(m[3]) {
		case "K":
			mult = 1 << 10
		case "M":
			mult = 1 << 20
		case "G":
			mult = 1 << 30
		case "T":
			mult = 1 << 40
		}
		bytes := uint64(math.Round(value * mult))
		switch m[1] {
		case "total":
			totalBytes = bytes
			seenTotal = true
		case "used":
			usedBytes = bytes
			seenUsed = true
		}
	}
	return usedBytes, totalBytes, seenTotal && seenUsed
}

// ParseLoadAvg parses macOS `{ 1.23 4.56 7.89 }` or Linux `1.23 4.56 7.89 ...`.
func ParseLoadAvg(text string) ([]float64, bool) {
	cleaned := strings.TrimSpace(strings.Trim(text, "{}"))
	fields := strings.Fields(cleaned)
	if len(fields) < 3 {
		return nil, false
	}
	out := make([]float64, 3)
	for i := range 3 {
		v, err := strconv.ParseFloat(fields[i], 64)
		if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return nil, false
		}
		out[i] = math.Round(v*100) / 100
	}
	return out, true
}

// ParseMemoryPressureLevel maps macOS kern.memorystatus_vm_pressure_level.
func ParseMemoryPressureLevel(text string) (string, bool) {
	level, err := strconv.Atoi(strings.TrimSpace(text))
	if err != nil {
		return "", false
	}
	switch level {
	case 1:
		return "normal", true
	case 2:
		return "warning", true
	case 4:
		return "critical", true
	default:
		return "", false
	}
}

// ParseAGXAccelerator parses `/usr/sbin/ioreg -r -c AGXAccelerator -d 1`.
func ParseAGXAccelerator(text string) (AGXSample, bool) {
	var sample AGXSample
	var found bool
	if m := ioregModelRE.FindStringSubmatch(text); len(m) == 2 {
		sample.Model = strings.TrimSpace(m[1])
		found = true
	}
	if m := ioregGPUCoresRE.FindStringSubmatch(text); len(m) == 2 {
		if n, err := strconv.ParseUint(m[1], 10, 64); err == nil {
			sample.GPUCoreCount = &n
			found = true
		}
	}
	for _, line := range strings.Split(text, "\n") {
		if !strings.Contains(line, `"PerformanceStatistics"`) {
			continue
		}
		for _, kv := range ioregPerfKVRE.FindAllStringSubmatch(line, -1) {
			key := kv[1]
			raw, err := strconv.ParseInt(kv[2], 10, 64)
			if err != nil || raw < 0 {
				continue
			}
			switch key {
			case "Device Utilization %":
				v := clampFloat(float64(raw), 0, 100)
				sample.DeviceUtilPct = &v
				found = true
			case "Renderer Utilization %":
				v := clampFloat(float64(raw), 0, 100)
				sample.RendererUtilPct = &v
				found = true
			case "Tiler Utilization %":
				v := clampFloat(float64(raw), 0, 100)
				sample.TilerUtilPct = &v
				found = true
			case "In use system memory":
				v := uint64(raw)
				sample.InUseSystemBytes = &v
				found = true
			case "Alloc system memory":
				v := uint64(raw)
				sample.AllocSystemBytes = &v
				found = true
			}
		}
	}
	return sample, found
}

// ParsePMSetTherm parses rootless `pmset -g therm` output.
func ParsePMSetTherm(text string) (PMSetThermSample, bool) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return PMSetThermSample{}, false
	}
	sample := PMSetThermSample{
		ThermalState: "nominal",
	}
	if m := pmsetSpeedLimRE.FindStringSubmatch(trimmed); len(m) == 2 {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			clamped := clampFloat(v, 0, 100)
			sample.CPUSpeedLimitPct = &clamped
			if clamped < 100 {
				sample.Throttling = true
				sample.ThrottleReason = "cpu_speed_limit"
				if clamped <= 60 {
					sample.ThermalState = "critical"
				} else if clamped <= 85 {
					sample.ThermalState = "serious"
				} else {
					sample.ThermalState = "fair"
				}
			}
		}
	}
	if m := pmsetThermLvlRE.FindStringSubmatch(trimmed); len(m) == 2 {
		if lvl, err := strconv.Atoi(m[1]); err == nil && lvl > 0 {
			sample.Throttling = true
			if sample.ThrottleReason == "" {
				sample.ThrottleReason = "thermal_level"
			}
			if lvl >= 3 {
				sample.ThermalState = "critical"
			} else if lvl >= 2 && sample.ThermalState != "critical" {
				sample.ThermalState = "serious"
			} else if sample.ThermalState == "nominal" {
				sample.ThermalState = "fair"
			}
		}
	}
	if sample.CPUSpeedLimitPct == nil && strings.Contains(trimmed, "No thermal warning level has been recorded") {
		full := 100.0
		sample.CPUSpeedLimitPct = &full
		return sample, true
	}
	return sample, sample.CPUSpeedLimitPct != nil || sample.Throttling
}

// ParseNvidiaSMI parses the 13-column CSV output of nvidia-smi.
func ParseNvidiaSMI(text string) ([]NvidiaGPUSample, bool) {
	var out []NvidiaGPUSample
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		cells := strings.Split(trimmed, ",")
		if len(cells) < 13 {
			continue
		}
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		idx, err := strconv.Atoi(cells[0])
		if err != nil || idx < 0 {
			continue
		}
		sample := NvidiaGPUSample{
			Index:           idx,
			Name:            cells[1],
			MemoryTotalMB:   parseOptionalNonNegFloat(cells[2]),
			MemoryUsedMB:    parseOptionalNonNegFloat(cells[3]),
			MemoryFreeMB:    parseOptionalNonNegFloat(cells[4]),
			UtilPct:         parseOptionalPercent(cells[5]),
			PowerDrawW:      parseOptionalNonNegFloat(cells[6]),
			PowerLimitW:     parseOptionalNonNegFloat(cells[7]),
			TempC:           parseOptionalFloat(cells[8]),
			ClockMHz:        parseOptionalNonNegFloat(cells[9]),
			MaxClockMHz:     parseOptionalNonNegFloat(cells[10]),
			FanPct:          parseOptionalPercent(cells[11]),
			ThrottleReasons: normalizeNvidiaThrottleReason(cells[12]),
		}
		out = append(out, sample)
	}
	return out, len(out) > 0
}

func normalizeNvidiaThrottleReason(raw string) string {
	cleaned := strings.TrimSpace(raw)
	if cleaned == "" || strings.EqualFold(cleaned, "[N/A]") || strings.EqualFold(cleaned, "[Not Supported]") {
		return ""
	}
	if val, err := strconv.ParseUint(strings.TrimPrefix(strings.ToLower(cleaned), "0x"), 16, 64); err == nil {
		// Bit 0x1 is gpuIdle, 0x2 is applicationsClocksSetting, 0x4 is swPowerCap.
		// Thermal/hardware slowdowns live in bits 0x8 (hwSlowdown), 0x40 (swThermal), 0x80 (hwThermal), 0x100 (hwPowerBrake).
		const activeThrottleMask = 0x08 | 0x40 | 0x80 | 0x100
		if val&activeThrottleMask == 0 {
			return ""
		}
		if val&0x80 != 0 {
			return "hw_thermal_slowdown"
		}
		if val&0x40 != 0 {
			return "sw_thermal_slowdown"
		}
		if val&0x100 != 0 {
			return "hw_power_brake"
		}
		return "hw_slowdown"
	}
	return ""
}

// ParseNvidiaSMITemperature extracts the primary GPU's absolute thermal throttle
// limit in degrees Celsius from `nvidia-smi -q -d TEMPERATURE` output.
// Modern drivers report headroom-to-limit in `GPU T.Limit Temp`; this parser
// never treats bare headroom values as absolute Celsius thresholds.
func ParseNvidiaSMITemperature(text string) (float64, bool) {
	var seenGPU bool
	var targetTemp, maxOpTemp, slowdownTemp *float64
	var currentTemp, tLimitTemp, maxOpTLimit *float64

	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") && strings.HasPrefix(line, "GPU ") {
			if seenGPU {
				break
			}
			seenGPU = true
			continue
		}
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		k := strings.TrimSpace(key)
		parsed, hasVal := parseNvidiaCelsius(val)
		if !hasVal {
			continue
		}
		switch k {
		case "GPU Target Temperature":
			v := parsed
			targetTemp = &v
		case "GPU Max Operating Temp":
			v := parsed
			maxOpTemp = &v
		case "GPU Slowdown Temp":
			v := parsed
			slowdownTemp = &v
		case "GPU Current Temp":
			v := parsed
			currentTemp = &v
		case "GPU T.Limit Temp":
			v := parsed
			tLimitTemp = &v
		case "GPU Max Operating T.Limit Temp":
			v := parsed
			maxOpTLimit = &v
		}
	}

	validLimit := func(v float64) bool {
		return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 30 && v <= 125
	}
	if targetTemp != nil && validLimit(*targetTemp) {
		return *targetTemp, true
	}
	if maxOpTemp != nil && validLimit(*maxOpTemp) {
		return *maxOpTemp, true
	}
	if slowdownTemp != nil && validLimit(*slowdownTemp) {
		return *slowdownTemp, true
	}
	if currentTemp != nil && tLimitTemp != nil {
		offset := 0.0
		if maxOpTLimit != nil {
			offset = *maxOpTLimit
		}
		absLimit := *currentTemp + *tLimitTemp - offset
		if validLimit(absLimit) {
			return math.Round(absLimit*10) / 10, true
		}
	}
	return 0, false
}

func parseNvidiaCelsius(raw string) (float64, bool) {
	cleaned := strings.TrimSpace(raw)
	if cleaned == "" || strings.EqualFold(cleaned, "N/A") || strings.EqualFold(cleaned, "[N/A]") || strings.EqualFold(cleaned, "[Not Supported]") {
		return 0, false
	}
	fields := strings.Fields(cleaned)
	if len(fields) == 0 {
		return 0, false
	}
	v, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, false
	}
	return v, true
}

// ParseWindowsPagefileInfo decodes the SYSTEM_PAGEFILE_INFORMATION array returned
// by Windows NtQuerySystemInformation(SystemPageFileInformation) into used and
// total pagefile bytes.
func ParseWindowsPagefileInfo(buf []byte, pageSize uint64) (usedBytes, totalBytes uint64, ok bool) {
	if pageSize == 0 {
		return 0, 0, false
	}
	if len(buf) == 0 {
		return 0, 0, true
	}
	const minHeaderBytes = 16
	offset := 0
	for {
		if offset+minHeaderBytes > len(buf) {
			return 0, 0, false
		}
		nextOffset := binary.LittleEndian.Uint32(buf[offset : offset+4])
		totalPages := binary.LittleEndian.Uint32(buf[offset+4 : offset+8])
		inUsePages := binary.LittleEndian.Uint32(buf[offset+8 : offset+12])
		totalBytes += uint64(totalPages) * pageSize
		usedBytes += uint64(min(inUsePages, totalPages)) * pageSize
		if nextOffset == 0 {
			return usedBytes, totalBytes, true
		}
		if int(nextOffset) < minHeaderBytes || offset+int(nextOffset) > len(buf) {
			return 0, 0, false
		}
		offset += int(nextOffset)
	}
}

// ParseWindowsLogicalProcessorInfoEx counts RelationProcessorCore records in a
// Windows GetLogicalProcessorInformationEx buffer to report physical CPU cores.
func ParseWindowsLogicalProcessorInfoEx(buf []byte) (uint64, bool) {
	if len(buf) < 8 {
		return 0, false
	}
	var cores uint64
	offset := 0
	for offset < len(buf) {
		if offset+8 > len(buf) {
			return 0, false
		}
		relationship := binary.LittleEndian.Uint32(buf[offset : offset+4])
		size := binary.LittleEndian.Uint32(buf[offset+4 : offset+8])
		if size < 8 || offset+int(size) > len(buf) {
			return 0, false
		}
		if relationship == 0 {
			cores++
		}
		offset += int(size)
	}
	return cores, cores > 0
}

// NormalizeWindowsCPUBrand trims padding and collapses internal spaces from the
// Windows ProcessorNameString registry value.
func NormalizeWindowsCPUBrand(raw string) string {
	return strings.TrimSpace(multiSpace.ReplaceAllString(raw, " "))
}

// FormatWindowsOSLabel builds a human-readable Windows version string from
// HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion values, normalizing the
// Windows 11 registry ProductName quirk for builds >= 22000.
func FormatWindowsOSLabel(productName, displayVersion, currentBuildNumber string) string {
	product := strings.TrimSpace(multiSpace.ReplaceAllString(productName, " "))
	display := strings.TrimSpace(displayVersion)
	buildStr := strings.TrimSpace(currentBuildNumber)

	build, buildErr := strconv.Atoi(buildStr)
	if buildErr == nil && build >= 22000 {
		if strings.HasPrefix(product, "Windows 10") {
			product = "Windows 11" + strings.TrimPrefix(product, "Windows 10")
		} else if product == "" {
			product = "Windows 11"
		}
	}
	if product == "" {
		product = "Windows"
	}
	label := product
	if display != "" && !strings.Contains(strings.ToLower(label), strings.ToLower(display)) {
		label += " " + display
	}
	if buildErr == nil && build > 0 {
		label += " (" + strconv.Itoa(build) + ")"
	}
	return label
}

// ParseProcMeminfo parses Linux /proc/meminfo into byte counts.
func ParseProcMeminfo(text string) (ProcMeminfo, bool) {
	var info ProcMeminfo
	seen := 0
	for _, line := range strings.Split(text, "\n") {
		key, rest, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		value, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		bytes := value
		if len(fields) >= 2 && strings.EqualFold(fields[1], "kB") {
			bytes *= 1024
		}
		switch strings.TrimSpace(key) {
		case "MemTotal":
			info.MemTotal = bytes
			seen++
		case "MemFree":
			info.MemFree = bytes
			seen++
		case "MemAvailable":
			info.MemAvailable = bytes
			seen++
		case "Buffers":
			info.Buffers = bytes
		case "Cached":
			info.Cached = bytes
		case "Active":
			info.Active = bytes
		case "Inactive":
			info.Inactive = bytes
		case "Unevictable":
			info.Unevictable = bytes
		case "Mlocked":
			info.Mlocked = bytes
		case "Slab":
			info.Slab = bytes
		case "SwapTotal":
			info.SwapTotal = bytes
		case "SwapFree":
			info.SwapFree = bytes
		case "Zswap":
			info.Zswap = bytes
		}
	}
	return info, seen >= 2 && info.MemTotal > 0
}

// ParseProcStatCPU parses the aggregate `cpu` line of Linux /proc/stat.
func ParseProcStatCPU(text string) (ProcCPUTimes, bool) {
	for _, line := range strings.Split(text, "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			return ProcCPUTimes{}, false
		}
		var total, idle uint64
		for i := 1; i < len(fields); i++ {
			v, err := strconv.ParseUint(fields[i], 10, 64)
			if err != nil {
				return ProcCPUTimes{}, false
			}
			total += v
			if i == 4 || i == 5 { // idle + iowait
				idle += v
			}
		}
		return ProcCPUTimes{Total: total, Idle: idle}, total > 0
	}
	return ProcCPUTimes{}, false
}

// ParseProcVMStat parses pswpin and pswpout from Linux /proc/vmstat.
func ParseProcVMStat(text string) (ProcVMStat, bool) {
	var stat ProcVMStat
	var seenIn, seenOut bool
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		v, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "pswpin":
			stat.Pswpin = v
			seenIn = true
		case "pswpout":
			stat.Pswpout = v
			seenOut = true
		}
	}
	return stat, seenIn && seenOut
}

// ParseLlamaMetrics parses llama-server Prometheus /metrics counters.
func ParseLlamaMetrics(text string) (LlamaCounters, bool) {
	totals := map[string]float64{}
	for _, line := range strings.Split(text, "\n") {
		if !strings.HasPrefix(line, "llamacpp:") {
			continue
		}
		name, rest, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		val, err := strconv.ParseFloat(fields[0], 64)
		if err != nil || math.IsNaN(val) || math.IsInf(val, 0) {
			continue
		}
		metricName, _, _ := strings.Cut(strings.TrimPrefix(name, "llamacpp:"), "{")
		totals[metricName] += val
	}
	if len(totals) == 0 {
		return LlamaCounters{}, false
	}
	return LlamaCounters{
		PromptTokens:     totals["prompt_tokens_total"],
		PromptSeconds:    totals["prompt_seconds_total"],
		PredictedTokens:  totals["tokens_predicted_total"],
		PredictedSeconds: totals["tokens_predicted_seconds_total"],
		Processing:       totals["requests_processing"],
	}, true
}

// ParseLlamaSlots parses llama-server GET /slots into privacy-stripped slot
// telemetry. Prompt and completion text fields are never decoded or retained.
func ParseLlamaSlots(data []byte, modelID string) ([]wire.SystemTelemetrySlot, bool) {
	type nextTokenCounters struct {
		NDecoded *int64 `json:"n_decoded"`
	}
	type rawSlot struct {
		ID                     *int64              `json:"id"`
		NCtx                   *int64              `json:"n_ctx"`
		IsProcessing           bool                `json:"is_processing"`
		NPromptTokens          *int64              `json:"n_prompt_tokens"`
		NPromptTokensProcessed *int64              `json:"n_prompt_tokens_processed"`
		NPromptTokensCache     *int64              `json:"n_prompt_tokens_cache"`
		NextToken              []nextTokenCounters `json:"next_token"`
	}
	var raw []rawSlot
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, false
	}
	slots := make([]wire.SystemTelemetrySlot, 0, len(raw))
	for _, row := range raw {
		if row.ID == nil || *row.ID < 0 || *row.ID > 256 {
			continue
		}
		slot := wire.SystemTelemetrySlot{
			ID:      uint64(*row.ID),
			ModelID: modelID,
			Busy:    row.IsProcessing,
		}
		if row.NCtx != nil && *row.NCtx >= 0 {
			v := uint64(*row.NCtx)
			slot.NCtx = &v
		}
		if row.NPromptTokens != nil && *row.NPromptTokens >= 0 {
			v := uint64(*row.NPromptTokens)
			slot.PromptTokens = &v
		}
		if row.NPromptTokensProcessed != nil && *row.NPromptTokensProcessed >= 0 {
			v := uint64(*row.NPromptTokensProcessed)
			slot.PromptProcessed = &v
		}
		if row.NPromptTokensCache != nil && *row.NPromptTokensCache >= 0 {
			v := uint64(*row.NPromptTokensCache)
			slot.CachedPromptTokens = &v
		}
		if len(row.NextToken) > 0 && row.NextToken[0].NDecoded != nil && *row.NextToken[0].NDecoded >= 0 {
			v := uint64(*row.NextToken[0].NDecoded)
			slot.DecodedTokens = &v
		}
		slots = append(slots, slot)
		if len(slots) >= 64 {
			break
		}
	}
	return slots, true
}

func parseOptionalFloat(raw string) *float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}

func parseOptionalNonNegFloat(raw string) *float64 {
	v := parseOptionalFloat(raw)
	if v == nil || *v < 0 {
		return nil
	}
	return v
}

func parseOptionalPercent(raw string) *float64 {
	v := parseOptionalNonNegFloat(raw)
	if v == nil {
		return nil
	}
	clamped := clampFloat(*v, 0, 100)
	return &clamped
}

func clampFloat(v, low, high float64) float64 {
	if math.IsNaN(v) {
		return low
	}
	if v < low {
		return low
	}
	if v > high {
		return high
	}
	return v
}
