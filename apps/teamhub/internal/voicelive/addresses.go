package voicelive

import (
	"regexp"
	"strings"
)

// knownSentLimit bounds the recent recipients the live voice is given.
const knownSentLimit = 10

// emailInText finds addresses written inside free text, such as a Profile.
var emailInText = regexp.MustCompile(`[^\s@,;:<>"'()\[\]]+@[^\s@,;:<>"'()\[\]]+\.[A-Za-z]{2,}`)

// KnownAddresses is what the live voice checks a heard recipient against:
// the user's own addresses found in own, then the distinct recipients in sent
// (address fields, newest first) that are not their own, at most ten.
func KnownAddresses(own, sent []string) (mine, recent []string) {
	seen := map[string]bool{}
	for _, text := range own {
		for _, address := range emailInText.FindAllString(text, -1) {
			if key := strings.ToLower(address); !seen[key] {
				seen[key] = true
				mine = append(mine, address)
			}
		}
	}
	for _, field := range sent {
		for _, address := range strings.FieldsFunc(field, recipientSeparator) {
			address = strings.TrimSpace(address)
			key := strings.ToLower(address)
			if !emailAddress.MatchString(address) || seen[key] {
				continue
			}
			seen[key] = true
			recent = append(recent, address)
			if len(recent) == knownSentLimit {
				return mine, recent
			}
		}
	}
	return mine, recent
}
