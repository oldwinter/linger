// Package telemetry samples rootless host hardware and local LLM inference
// telemetry for the Local Computer Daemon. It never stores or forwards prompt
// or completion text.
package telemetry

import (
	"regexp"
	"strings"
)

type gpuBandwidthRule struct {
	pattern *regexp.Regexp
	gbps    float64
}

var (
	gpuVendorWords = regexp.MustCompile(`\b(nvidia|geforce|tesla|quadro|amd|radeon)\b`)
	multiSpace     = regexp.MustCompile(`\s+`)

	// Published vendor memory bandwidth specs ported from llm-inference-lab
	// gpu_specs.py (NVIDIA) plus common AMD discrete accelerators.
	discreteGPUBandwidthRules = []gpuBandwidthRule{
		{regexp.MustCompile(`^rtx 5090$`), 1792.0},
		{regexp.MustCompile(`^rtx 5080$`), 960.0},
		{regexp.MustCompile(`^rtx 5070 ti$`), 896.0},
		{regexp.MustCompile(`^rtx 5070$`), 672.0},
		{regexp.MustCompile(`^rtx 5060 ti$`), 448.0},
		{regexp.MustCompile(`^rtx 4090( d)?$`), 1008.0},
		{regexp.MustCompile(`^rtx 4080 super$`), 736.0},
		{regexp.MustCompile(`^rtx 4080$`), 716.8},
		{regexp.MustCompile(`^rtx 4070 ti super$`), 672.0},
		{regexp.MustCompile(`^rtx 4070 (ti|super)$`), 504.0},
		{regexp.MustCompile(`^rtx 4060 ti$`), 288.0},
		{regexp.MustCompile(`^rtx 4060$`), 272.0},
		{regexp.MustCompile(`^rtx 3090 ti$`), 1008.0},
		{regexp.MustCompile(`^rtx 3090$`), 936.0},
		{regexp.MustCompile(`^rtx 3080 ti$`), 912.0},
		{regexp.MustCompile(`^rtx 3070 ti$`), 608.0},
		{regexp.MustCompile(`^rtx 3070$`), 448.0},
		{regexp.MustCompile(`^rtx 2080 ti$`), 616.0},
		{regexp.MustCompile(`^rtx pro 6000 blackwell( max q)?( workstation| server)?( edition)?$`), 1792.0},
		{regexp.MustCompile(`^rtx 6000 ada generation$`), 960.0},
		{regexp.MustCompile(`^rtx 5000 ada generation$`), 576.0},
		{regexp.MustCompile(`^rtx 4000 ada generation$`), 360.0},
		{regexp.MustCompile(`^(rtx a6000|rtx a5000)$`), 768.0},
		{regexp.MustCompile(`^rtx a4000$`), 448.0},
		{regexp.MustCompile(`^l40s?$`), 864.0},
		{regexp.MustCompile(`^l4$`), 300.0},
		{regexp.MustCompile(`^a40$`), 696.0},
		{regexp.MustCompile(`^a30$`), 933.0},
		{regexp.MustCompile(`^a10g?$`), 600.0},
		{regexp.MustCompile(`^a100 (sxm4|pcie) 40gb$`), 1555.0},
		{regexp.MustCompile(`^a100 80gb pcie$`), 1935.0},
		{regexp.MustCompile(`^a100 sxm4 80gb$`), 2039.0},
		{regexp.MustCompile(`^h100 pcie$`), 2000.0},
		{regexp.MustCompile(`^h100 80gb hbm3$`), 3350.0},
		{regexp.MustCompile(`^h200$`), 4800.0},
		{regexp.MustCompile(`^t4$`), 320.0},
		{regexp.MustCompile(`^v100 (sxm2|pcie) (16|32)gb$`), 900.0},
		{regexp.MustCompile(`^rx 7900 xtx$`), 960.0},
		{regexp.MustCompile(`^rx 7900 xt$`), 800.0},
		{regexp.MustCompile(`^rx 7800 xt$`), 624.0},
		{regexp.MustCompile(`^rx 6900 xt$`), 512.0},
		{regexp.MustCompile(`^instinct mi300x$`), 5300.0},
		{regexp.MustCompile(`^instinct mi250x$`), 3276.0},
	}

	appleSiliconSpecTable = []struct {
		pattern  *regexp.Regexp
		gbps     float64
		aneCores uint64
	}{
		{regexp.MustCompile(`\bapple m6 ultra\b`), 819.0, 32},
		{regexp.MustCompile(`\bapple m6 max\b`), 546.0, 16},
		{regexp.MustCompile(`\bapple m6 pro\b`), 307.0, 16},
		{regexp.MustCompile(`\bapple m6\b`), 153.0, 16},
		{regexp.MustCompile(`\bapple m5 ultra\b`), 819.0, 32},
		{regexp.MustCompile(`\bapple m5 max\b`), 546.0, 16},
		{regexp.MustCompile(`\bapple m5 pro\b`), 307.0, 16},
		{regexp.MustCompile(`\bapple m5\b`), 153.0, 16},
		{regexp.MustCompile(`\bapple m4 ultra\b`), 819.0, 32},
		{regexp.MustCompile(`\bapple m4 max\b`), 546.0, 16},
		{regexp.MustCompile(`\bapple m4 pro\b`), 273.0, 16},
		{regexp.MustCompile(`\bapple m4\b`), 120.0, 16},
		{regexp.MustCompile(`\bapple m3 ultra\b`), 800.0, 32},
		{regexp.MustCompile(`\bapple m3 max\b`), 400.0, 16},
		{regexp.MustCompile(`\bapple m3 pro\b`), 150.0, 16},
		{regexp.MustCompile(`\bapple m3\b`), 100.0, 16},
		{regexp.MustCompile(`\bapple m2 ultra\b`), 800.0, 32},
		{regexp.MustCompile(`\bapple m2 max\b`), 400.0, 16},
		{regexp.MustCompile(`\bapple m2 pro\b`), 200.0, 16},
		{regexp.MustCompile(`\bapple m2\b`), 100.0, 16},
		{regexp.MustCompile(`\bapple m1 ultra\b`), 800.0, 32},
		{regexp.MustCompile(`\bapple m1 max\b`), 400.0, 16},
		{regexp.MustCompile(`\bapple m1 pro\b`), 200.0, 16},
		{regexp.MustCompile(`\bapple m1\b`), 68.25, 16},
	}
)

// NormalizeGPUName canonicalizes a GPU name for spec-table lookup.
func NormalizeGPUName(name string) string {
	lower := strings.ToLower(strings.ReplaceAll(name, "-", " "))
	stripped := gpuVendorWords.ReplaceAllString(lower, " ")
	return strings.TrimSpace(multiSpace.ReplaceAllString(stripped, " "))
}

// TheoreticalBandwidthGBs returns the published peak memory bandwidth in GB/s
// for a recognized discrete GPU or Apple Silicon SoC, or (0, false) if unknown.
func TheoreticalBandwidthGBs(chipName, gpuName string) (float64, bool) {
	if key := NormalizeGPUName(gpuName); key != "" {
		for _, rule := range discreteGPUBandwidthRules {
			if rule.pattern.MatchString(key) {
				return rule.gbps, true
			}
		}
	}
	for _, candidate := range []string{chipName, gpuName} {
		normalized := strings.TrimSpace(multiSpace.ReplaceAllString(strings.ToLower(candidate), " "))
		if normalized == "" {
			continue
		}
		for _, spec := range appleSiliconSpecTable {
			if spec.pattern.MatchString(normalized) {
				return spec.gbps, true
			}
		}
	}
	return 0, false
}

// AppleSiliconANECores returns the known Neural Engine core count for an Apple
// Silicon chip name, or (0, false) on non-Apple hardware.
func AppleSiliconANECores(chipName string) (uint64, bool) {
	normalized := strings.TrimSpace(multiSpace.ReplaceAllString(strings.ToLower(chipName), " "))
	for _, spec := range appleSiliconSpecTable {
		if spec.pattern.MatchString(normalized) {
			return spec.aneCores, true
		}
	}
	return 0, false
}
