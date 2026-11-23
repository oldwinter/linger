package native

import (
	"slices"
	"strings"
)

// canonicalEffortOrder defines the reasoning-effort ladder from lowest to
// highest. "off" is normalized to "none" for comparison so Pi and product
// vocabularies align.
var canonicalEffortOrder = []string{
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
}

// NormalizeReasoningEffort clamps a requested reasoning effort to a model's
// declared allowed efforts and optional default effort.
//
// Matching is case-insensitive and treats "off" and "none" as aliases.
// An empty requested effort or an empty allowed list returns requested
// unchanged. When requested is not allowed, the nearest allowed effort on the
// canonical ladder is selected; equal-distance ties prefer defaultEffort when
// tied, and otherwise prefer the higher effort.
func NormalizeReasoningEffort(requested string, allowed []string, defaultEffort string) string {
	requested = strings.TrimSpace(requested)
	if requested == "" || len(allowed) == 0 {
		return requested
	}
	reqCanonical := canonicalEffortName(requested)
	for _, option := range allowed {
		trimmed := strings.TrimSpace(option)
		if trimmed == "" {
			continue
		}
		if trimmed == requested || canonicalEffortName(trimmed) == reqCanonical {
			return trimmed
		}
	}

	defaultCanonical := canonicalEffortName(defaultEffort)
	matchedDefault := ""
	firstValid := ""
	for _, option := range allowed {
		trimmed := strings.TrimSpace(option)
		if trimmed == "" {
			continue
		}
		if firstValid == "" {
			firstValid = trimmed
		}
		if defaultCanonical != "" && matchedDefault == "" && canonicalEffortName(trimmed) == defaultCanonical {
			matchedDefault = trimmed
		}
	}
	if firstValid == "" {
		return requested
	}

	reqIdx := slices.Index(canonicalEffortOrder, reqCanonical)
	if reqIdx < 0 {
		if matchedDefault != "" {
			return matchedDefault
		}
		return firstValid
	}

	bestOption := ""
	bestDist := len(canonicalEffortOrder) + 1
	bestIdx := -1
	bestIsDefault := false
	for _, option := range allowed {
		trimmed := strings.TrimSpace(option)
		idx := slices.Index(canonicalEffortOrder, canonicalEffortName(trimmed))
		if idx < 0 {
			continue
		}
		dist := reqIdx - idx
		if dist < 0 {
			dist = -dist
		}
		isDefault := defaultCanonical != "" && canonicalEffortName(trimmed) == defaultCanonical
		if dist < bestDist ||
			(dist == bestDist && isDefault && !bestIsDefault) ||
			(dist == bestDist && isDefault == bestIsDefault && idx > bestIdx) {
			bestOption = trimmed
			bestDist = dist
			bestIdx = idx
			bestIsDefault = isDefault
		}
	}
	if bestOption != "" {
		return bestOption
	}
	if matchedDefault != "" {
		return matchedDefault
	}
	return firstValid
}

func canonicalEffortName(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "off" {
		return "none"
	}
	return normalized
}

func piEffortToThinkingFlag(value string) string {
	if canonicalEffortName(value) == "none" {
		return "off"
	}
	return strings.ToLower(strings.TrimSpace(value))
}

func finalizeEffortSupport(efforts effortCatalog, defaultLevel string) *EffortSupport {
	support := efforts.support("")
	if support == nil {
		return nil
	}
	for i := range support.Options {
		if support.Options[i].Value == "off" {
			support.Options[i].Value = "none"
		}
	}
	defaultLevel = strings.TrimSpace(defaultLevel)
	if defaultLevel != "" {
		allowed := make([]string, len(support.Options))
		for i, option := range support.Options {
			allowed[i] = option.Value
		}
		support.Default = NormalizeReasoningEffort(defaultLevel, allowed, "")
	}
	return support
}

// piStateThinkingLevel checks the active model reported by Pi's get_state RPC
// and reports whether set_thinking_level is needed to keep the turn within
// that model's declared capabilities.
func piStateThinkingLevel(state piCatalogState, requestedThinking string) (string, bool) {
	model := state.Model
	if model.ID == "" {
		return "", false
	}
	stateLevel := strings.TrimSpace(state.ThinkingLevel)
	if !model.Reasoning {
		if stateLevel != "" && canonicalEffortName(stateLevel) != "none" {
			return "off", true
		}
		return "", false
	}
	support := piEffortSupport(model.ThinkingLevelMap, "")
	if support == nil {
		if stateLevel != "" && canonicalEffortName(stateLevel) != "none" {
			return "off", true
		}
		return "", false
	}
	target := strings.TrimSpace(requestedThinking)
	if target == "" {
		target = stateLevel
	}
	if target == "" {
		return "", false
	}
	clamped := piClampThinkingToSupport(target, support)
	if clamped == "" ||
		canonicalEffortName(clamped) == canonicalEffortName(stateLevel) ||
		(stateLevel == "" && canonicalEffortName(clamped) == canonicalEffortName(requestedThinking)) {
		return "", false
	}
	return clamped, true
}

func piClampThinkingToSupport(thinking string, support *EffortSupport) string {
	if support == nil || len(support.Options) == 0 {
		return ""
	}
	allowed := make([]string, len(support.Options))
	for i, option := range support.Options {
		allowed[i] = option.Value
	}
	normalized := NormalizeReasoningEffort(thinking, allowed, support.Default)
	return piEffortToThinkingFlag(normalized)
}
