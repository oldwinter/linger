package app

import (
	"strings"
	"testing"

	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

func TestValidLocalComputerEnrollmentCreateCountsCharacters(t *testing.T) {
	t.Parallel()

	valid := httpapi.LocalComputerEnrollmentCreateRequest{
		DisplayName:   "Laptop",
		CodeChallenge: strings.Repeat("c", 43),
		RedirectUri:   "http://127.0.0.1:4319/callback",
	}
	if !validLocalComputerEnrollmentCreate(valid) {
		t.Fatal("a completed request must be valid")
	}

	han := strings.Repeat("\u6c49", localComputerDisplayNameRunes)
	valid.DisplayName = han
	if !validLocalComputerEnrollmentCreate(valid) {
		t.Fatal("a Computer name of 120 characters must be valid")
	}
	valid.DisplayName = han + "\u6c49"
	if validLocalComputerEnrollmentCreate(valid) {
		t.Fatal("a Computer name of 121 characters must be rejected")
	}
	valid.DisplayName = strings.Repeat("t", 120)
	if !validLocalComputerEnrollmentCreate(valid) {
		t.Fatal("the ASCII bound must stay 120 characters")
	}
	valid.DisplayName = "   "
	if validLocalComputerEnrollmentCreate(valid) {
		t.Fatal("a blank Computer name must be rejected")
	}
}
