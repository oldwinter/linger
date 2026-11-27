// Package voice implements Linger Mobile's bidirectional LiveKit WebRTC voice
// session engine, Voice Media Policy enforcement, microphone permission bridge,
// pure-Go Opus encoding/decoding, native audio capture/playback abstractions,
// and background/suspend-safe session lifecycle management.
package voice

import (
	"strings"

	"github.com/oldwinter/linger/mobile/internal/api"
)

// PolicyBlockReason classifies why TeamHub's Voice Media Policy disallows a requested voice mode.
type PolicyBlockReason string

const (
	PolicyBlockNone             PolicyBlockReason = ""
	PolicyBlockUnavailable      PolicyBlockReason = "voice_unavailable"
	PolicyBlockLiveDisabled     PolicyBlockReason = "live_disabled"
	PolicyBlockXAIKeyMissing    PolicyBlockReason = "xai_key_missing"
	PolicyBlockSonioxKeyMissing PolicyBlockReason = "soniox_key_missing"
	PolicyBlockNoRoomAgent      PolicyBlockReason = "no_room_agent"
)

// PolicyDecision is the structured outcome of checking VoiceMediaPolicy before joining.
type PolicyDecision struct {
	Allowed         bool
	Purpose         string
	Reason          PolicyBlockReason
	FallbackPurpose string
}

// NormalizePurpose resolves an empty or unrecognized purpose to chat_live.
func NormalizePurpose(purpose string) string {
	switch strings.TrimSpace(purpose) {
	case api.VoicePurposeChatLive, api.VoicePurposeChatDictation, api.VoicePurposeHardwareControl:
		return strings.TrimSpace(purpose)
	default:
		return api.VoicePurposeChatLive
	}
}

// EvaluatePolicy checks whether requestedPurpose is permitted by policy without
// ever bypassing disabled deployment flags or missing provider keys.
func EvaluatePolicy(policy *api.VoiceMediaPolicyC2, requestedPurpose string) PolicyDecision {
	purpose := NormalizePurpose(requestedPurpose)
	if policy == nil {
		return PolicyDecision{
			Allowed: false,
			Purpose: purpose,
			Reason:  PolicyBlockUnavailable,
		}
	}
	if policy.VoiceAvailable != nil && !*policy.VoiceAvailable {
		return PolicyDecision{
			Allowed: false,
			Purpose: purpose,
			Reason:  PolicyBlockUnavailable,
		}
	}

	liveSupported := policy.LiveSupported != nil && *policy.LiveSupported
	liveEnabled := policy.LiveEnabled != nil && *policy.LiveEnabled
	// Backward compatibility: older servers may populate only live_enabled or xai_key.
	if policy.LiveSupported == nil && policy.XaiKey != nil && policy.XaiKey.Configured {
		liveSupported = true
	}
	if policy.LiveEnabled == nil && liveSupported {
		liveEnabled = true
	}
	liveAllowed := liveSupported && liveEnabled
	dictationAllowed := policy.VoiceMediaSupported

	switch purpose {
	case api.VoicePurposeChatLive:
		if liveAllowed {
			return PolicyDecision{Allowed: true, Purpose: purpose}
		}
		reason := PolicyBlockXAIKeyMissing
		if liveSupported && !liveEnabled {
			reason = PolicyBlockLiveDisabled
		} else if policy.VoiceAvailable == nil && !dictationAllowed && !liveSupported && policy.XaiKey == nil && policy.SonioxKey == nil {
			reason = PolicyBlockUnavailable
		}
		fallback := ""
		if dictationAllowed {
			fallback = api.VoicePurposeChatDictation
		}
		return PolicyDecision{
			Allowed:         false,
			Purpose:         purpose,
			Reason:          reason,
			FallbackPurpose: fallback,
		}

	case api.VoicePurposeChatDictation, api.VoicePurposeHardwareControl:
		if dictationAllowed {
			return PolicyDecision{Allowed: true, Purpose: purpose}
		}
		fallback := ""
		if liveAllowed {
			fallback = api.VoicePurposeChatLive
		}
		return PolicyDecision{
			Allowed:         false,
			Purpose:         purpose,
			Reason:          PolicyBlockSonioxKeyMissing,
			FallbackPurpose: fallback,
		}
	default:
		return PolicyDecision{
			Allowed: false,
			Purpose: purpose,
			Reason:  PolicyBlockUnavailable,
		}
	}
}

// SelectDefaultPurpose picks the best policy-allowed voice session purpose for a room.
// It prefers bidirectional chat_live when allowed, falling back to chat_dictation.
func SelectDefaultPurpose(policy *api.VoiceMediaPolicyC2) (string, PolicyDecision) {
	liveDecision := EvaluatePolicy(policy, api.VoicePurposeChatLive)
	if liveDecision.Allowed {
		return api.VoicePurposeChatLive, liveDecision
	}
	dictDecision := EvaluatePolicy(policy, api.VoicePurposeChatDictation)
	if dictDecision.Allowed {
		return api.VoicePurposeChatDictation, dictDecision
	}
	return api.VoicePurposeChatLive, liveDecision
}
