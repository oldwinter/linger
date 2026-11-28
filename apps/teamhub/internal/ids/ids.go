// Package ids generates TeamHub's random prefixed identifiers.
package ids

import (
	"crypto/rand"
	"encoding/hex"
)

// New returns prefix, an underscore, and 128 random bits as lowercase hex.
func New(prefix string) string {
	return Prefixed(prefix + "_")
}

// Prefixed returns prefix followed directly by 128 random bits as lowercase hex.
func Prefixed(prefix string) string {
	value := make([]byte, 16)
	// crypto/rand.Read never returns an error since Go 1.24.
	_, _ = rand.Read(value)
	return prefix + hex.EncodeToString(value)
}
