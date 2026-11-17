package agentregistry

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// EffectiveResourcesDigest folds the connected app capability and the apps the
// Agent may query into the Skill digest, so saving a Composio key or
// connecting an app changes it and the Agent Service rebuilds the next Run's
// instructions. With connected apps and no app account it stays the Skill
// digest.
func EffectiveResourcesDigest(skillDigest string, connectedApps bool, appKeys []string) string {
	if connectedApps && len(appKeys) == 0 {
		return skillDigest
	}
	text := skillDigest + "\nconnected_apps=false"
	if connectedApps {
		text = skillDigest + "\nconnected_app_keys=" + strings.Join(appKeys, ",")
	}
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}
