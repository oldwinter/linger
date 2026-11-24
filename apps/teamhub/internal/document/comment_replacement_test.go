package document

import (
	"strings"
	"testing"
)

func TestValidCommentReplacementCountsCharacters(t *testing.T) {
	t.Parallel()

	han := strings.Repeat("\u6c49", MaxCommentReplacementCharacters)
	if !ValidCommentReplacement(han) {
		t.Fatal("a replacement of 50000 characters must be valid")
	}
	if ValidCommentReplacement(han + "\u6c49") {
		t.Fatal("a replacement of one character more must be rejected")
	}
	if !ValidCommentReplacement(strings.Repeat("t", MaxCommentReplacementCharacters)) {
		t.Fatal("the ASCII bound must stay 50000 characters")
	}
	if ValidCommentReplacement("") || ValidCommentReplacement(string([]byte{0xff})) {
		t.Fatal("an empty or invalid UTF-8 replacement must be rejected")
	}
}
