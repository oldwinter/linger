package document

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentcredential"
)

func TestValidateSemanticMutationInputRejectsInvalidOperations(t *testing.T) {
	t.Parallel()

	validInput := ApplySemanticMutationInput{
		Principal:          &agentcredential.Principal{AgentActorID: "actor"},
		TargetKind:         "document",
		TargetID:           "document_plan",
		DocumentID:         "document_plan",
		SourceInvocationID: "invocation",
		SchemaVersion:      "blocknote-semantic-v1",
	}
	testCases := map[string]json.RawMessage{
		"invalid JSON":         json.RawMessage(`{"kind":"set_title"}`),
		"empty operations":     json.RawMessage(`[]`),
		"empty append":         json.RawMessage(`[{"kind":"append_blocks","blocks":[]}]`),
		"append with anchor":   json.RawMessage(`[{"kind":"append_blocks","stable_block_id":"guessed","blocks":[{}]}]`),
		"unknown operation":    json.RawMessage(`[{"kind":"unknown","title":"Agent title"}]`),
		"unknown field":        json.RawMessage(`[{"kind":"set_title","title":"Agent title","document_id":"override"}]`),
		"empty title":          json.RawMessage(`[{"kind":"set_title","title":""}]`),
		"invalid position":     json.RawMessage(`[{"kind":"insert_blocks","position":"inside","stable_block_id":"block","blocks":[{}]}]`),
		"missing block IDs":    json.RawMessage(`[{"kind":"delete_blocks","stable_block_ids":[]}]`),
		"null updated block":   json.RawMessage(`[{"kind":"update_block","stable_block_id":"block","block":null}]`),
		"new block missing id": json.RawMessage(`[{"kind":"insert_blocks","position":"after","stable_block_id":"block","blocks":[{"type":"paragraph","content":"New"}]}]`),
		"child missing id":     json.RawMessage(`[{"kind":"insert_blocks","position":"after","stable_block_id":"block","blocks":[{"id":"new","children":[{"type":"paragraph"}]}]}]`),
		"duplicate block id":   json.RawMessage(`[{"kind":"insert_blocks","position":"after","stable_block_id":"block","blocks":[{"id":"new"},{"id":"new"}]}]`),
		"invalid new block id": json.RawMessage(`[{"kind":"insert_blocks","position":"after","stable_block_id":"block","blocks":[{"id":"new block"}]}]`),
	}

	for name, semanticChange := range testCases {

		t.Run(name, func(t *testing.T) {
			t.Parallel()
			input := validInput
			input.SemanticChange = semanticChange
			if _, _, err := validateSemanticMutationInput(input); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("validateSemanticMutationInput() error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestValidateSemanticMutationInputCanonicalizesEquivalentOperations(t *testing.T) {
	t.Parallel()

	base := ApplySemanticMutationInput{
		Principal:          &agentcredential.Principal{AgentActorID: "actor"},
		TargetKind:         "document",
		TargetID:           "document_plan",
		DocumentID:         "document_plan",
		SourceInvocationID: "invocation",
		SchemaVersion:      "blocknote-semantic-v1",
	}
	first := base
	first.SemanticChange = json.RawMessage("[ { \"title\" : \"Agent title\", \"kind\" : \"set_title\" } ]")
	second := base
	second.SemanticChange = json.RawMessage(`[{"title":"Agent title","kind":"set_title"}]`)

	firstCanonical, firstHash, firstErr := validateSemanticMutationInput(first)
	secondCanonical, secondHash, secondErr := validateSemanticMutationInput(second)
	if firstErr != nil || secondErr != nil {
		t.Fatalf("validateSemanticMutationInput() errors = %v, %v", firstErr, secondErr)
	}
	if string(firstCanonical) != string(secondCanonical) || firstHash != secondHash {
		t.Fatalf("equivalent operations differ: canonical %q/%q hash %x/%x", firstCanonical, secondCanonical, firstHash, secondHash)
	}
}

func TestValidateAppendBlocksNeedsNoExistingAnchor(t *testing.T) {
	if err := validateSemanticOperation(json.RawMessage(`{"kind":"append_blocks","blocks":[{"id":"new-block","type":"paragraph","content":"Appended"}]}`)); err != nil {
		t.Fatal(err)
	}
}

func TestSetTitleCountsCharacters(t *testing.T) {
	t.Parallel()

	fits, err := json.Marshal(map[string]string{
		"kind":  "set_title",
		"title": strings.Repeat("\u6c49", MaxDocumentTitleCharacters),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := validateSemanticOperation(json.RawMessage(fits)); err != nil {
		t.Fatalf("a title of 255 characters was refused: %v", err)
	}
	tooLong, err := json.Marshal(map[string]string{
		"kind":  "set_title",
		"title": strings.Repeat("\u6c49", MaxDocumentTitleCharacters+1),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := validateSemanticOperation(json.RawMessage(tooLong)); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("a title of one character more was accepted: %v", err)
	}
}

func TestValidateSemanticOperationAcceptsAReplacementThatFitsInCharacters(t *testing.T) {
	t.Parallel()

	// 16667 Han characters are 50001 bytes and well inside the 50000 characters
	// the contract allows, so a byte bound would refuse a replacement the tool
	// accepts.
	fits, err := json.Marshal(map[string]string{
		"kind":        "replace_comment_text",
		"thread_id":   "thread_1",
		"replacement": strings.Repeat("\u6c49", 16667),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := validateSemanticOperation(json.RawMessage(fits)); err != nil {
		t.Fatalf("a replacement of 16667 characters was refused: %v", err)
	}
	tooLong, err := json.Marshal(map[string]string{
		"kind":        "replace_comment_text",
		"thread_id":   "thread_1",
		"replacement": strings.Repeat("\u6c49", MaxCommentReplacementCharacters+1),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := validateSemanticOperation(json.RawMessage(tooLong)); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("a replacement of one character more was accepted: %v", err)
	}
}
