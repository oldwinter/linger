package roomdocument

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/contracts-go/nodeservicesinternal"
)

func appliedResult(t *testing.T, body string) nodeservicesinternal.ApplyDocumentChangeResult {
	t.Helper()
	var result nodeservicesinternal.ApplyDocumentChangeResult
	if err := json.Unmarshal([]byte(body), &result); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	return result
}

func TestValidateApplyResultAcceptsAnEmptyTitle(t *testing.T) {
	t.Parallel()

	const references = `"complete_references":{"document_asset_ids":[],"document_thread_ids":[]}`
	const hash = `"state_hash":"` + "0000000000000000000000000000000000000000000000000000000000000000" + `"`
	// A restore or a comment anchor answers with an empty title, which the
	// contract allows; rejecting it failed those two features on every call.
	for _, body := range []string{
		`{"status":"applied","seq":1,` + hash + `,"title":"",` + references + `}`,
		`{"status":"applied","seq":1,` + hash + `,"title":"` + strings.Repeat("\u6c49", 255) + `",` + references + `}`,
	} {
		if _, err := validateApplyResult(appliedResult(t, body)); err != nil {
			t.Fatalf("valid answer refused: %v", err)
		}
	}
	tooLong := `{"status":"applied","seq":1,` + hash + `,"title":"` + strings.Repeat("\u6c49", 256) + `",` + references + `}`
	if _, err := validateApplyResult(appliedResult(t, tooLong)); err == nil {
		t.Fatal("a title of 256 characters was accepted")
	}
}
