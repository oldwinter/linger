package privatefs

import (
	"encoding/json"
	"strconv"
	"strings"
)

// parseCodexCapSIDs returns the write capability SIDs in a Codex cap_sid file.
// Only entries with the shape Codex generates are kept, so a corrupted file
// cannot make a well-known, builtin or well-known domain SID trusted.
func parseCodexCapSIDs(data []byte) map[string]bool {
	var caps struct {
		Workspace          string            `json:"workspace"`
		WorkspaceByCWD     map[string]string `json:"workspace_by_cwd"`
		WritableRootByPath map[string]string `json:"writable_root_by_path"`
	}
	sids := map[string]bool{}
	if json.Unmarshal(data, &caps) != nil {
		return sids
	}
	values := []string{caps.Workspace}
	for _, roots := range []map[string]string{caps.WorkspaceByCWD, caps.WritableRootByPath} {
		for _, sid := range roots {
			values = append(values, sid)
		}
	}
	for _, sid := range values {
		if isCodexCapabilitySID(sid) {
			sids[sid] = true
		}
	}
	return sids
}

// isCodexCapabilitySID reports whether value is S-1-5-21 followed by four
// 32-bit values, the form Codex draws at random for capability SIDs. A last
// value below 1000 is a well-known domain RID such as Domain Users (513), so it
// is rejected; a random value lands there with negligible probability.
func isCodexCapabilitySID(value string) bool {
	parts := strings.Split(value, "-")
	if len(parts) != 8 || strings.Join(parts[:4], "-") != "S-1-5-21" {
		return false
	}
	var last uint64
	for _, part := range parts[4:] {
		number, err := strconv.ParseUint(part, 10, 32)
		if err != nil {
			return false
		}
		last = number
	}
	return last >= 1000
}
