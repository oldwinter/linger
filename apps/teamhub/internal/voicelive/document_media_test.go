package voicelive

import (
	"reflect"
	"testing"
)

func TestRewriteAroundMediaPreservesMediaAndReplacesTextRuns(t *testing.T) {
	blocks := []TopBlock{{ID: "p1"}, {ID: "p2"}, {ID: "image", Media: true, AssetID: "asset_image"}, {ID: "p3"}, {ID: "file", Media: true, AssetID: "asset_file"}, {ID: "p4"}}
	edits, problem := RewriteAroundMedia(blocks, "New introduction\n\n![Photo](document-asset:asset_image)\n\nNew middle\n\n[Guide (application/pdf)](document-asset:asset_file)\n\nNew ending")
	want := []map[string]string{
		{"command": "block_replace", "block_id": "p4", "content": "New ending\n"},
		{"command": "block_replace", "block_id": "p3", "content": "New middle\n"},
		{"command": "block_replace", "start_block_id": "p1", "end_block_id": "p2", "content": "New introduction\n"},
	}
	if problem != "" || !reflect.DeepEqual(edits, want) {
		t.Fatalf("edits=%v problem=%s", edits, problem)
	}
}

func TestRewriteAroundMediaInsertsAndDeletesTextWithoutDeletingMedia(t *testing.T) {
	for _, tt := range []struct {
		name    string
		blocks  []TopBlock
		content string
		want    []map[string]string
	}{
		{"insert around adjacent media", []TopBlock{{ID: "i", Media: true, AssetID: "a"}, {ID: "f", Media: true, AssetID: "b"}}, "Before\n![A](document-asset:a)\nBetween\n[B](document-asset:b)\nAfter", []map[string]string{
			{"command": "block_insert_after", "block_id": "f", "content": "After\n"},
			{"command": "block_insert_after", "block_id": "i", "content": "Between\n"},
			{"command": "block_insert_before", "block_id": "i", "content": "Before\n"},
		}},
		{"delete text", []TopBlock{{ID: "p"}, {ID: "i", Media: true, AssetID: "a"}, {ID: "q"}}, "![A](document-asset:a)", []map[string]string{{"command": "block_delete", "block_id": "q"}, {"command": "block_delete", "block_id": "p"}}},
		{"media only", []TopBlock{{ID: "i", Media: true, AssetID: "a"}}, "![A](document-asset:a)", nil},
		{"same asset twice", []TopBlock{{ID: "i", Media: true, AssetID: "a"}, {ID: "j", Media: true, AssetID: "a"}}, "![A](document-asset:a)\n![A](document-asset:a)", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			edits, problem := RewriteAroundMedia(tt.blocks, tt.content)
			if problem != "" || !reflect.DeepEqual(edits, tt.want) {
				t.Fatalf("edits=%v problem=%s", edits, problem)
			}
		})
	}
}

func TestRewriteAroundMediaRejectsAmbiguousOrMissingMarkersBeforeWriting(t *testing.T) {
	blocks := []TopBlock{{ID: "p"}, {ID: "i", Media: true, AssetID: "a"}, {ID: "f", Media: true, AssetID: "b"}}
	for _, content := range []string{
		"No images", "![A](document-asset:a)", "[B](document-asset:b)\n![A](document-asset:a)",
		"![A](document-asset:a)\n![A](document-asset:a)\n[B](document-asset:b)",
		"![A](document-asset:unknown)\n[B](document-asset:b)",
		"Do not discard this text ![A](document-asset:a)\n[B](document-asset:b)",
		"![A](document-asset:a) extra words\n[B](document-asset:b)",
		"```markdown\n![A](document-asset:a)\n```\n[B](document-asset:b)",
		"~~~\n![A](document-asset:a)\n~~~\n[B](document-asset:b)",
	} {
		edits, problem := RewriteAroundMedia(blocks, content)
		if problem != "media_moved" || len(edits) != 0 {
			t.Fatalf("content=%q edits=%v problem=%s", content, edits, problem)
		}
	}
	for _, blocks := range [][]TopBlock{nil, {{ID: "p"}}, {{ID: "i", Media: true}}} {
		if edits, problem := RewriteAroundMedia(blocks, "text"); problem != "document_has_media" || len(edits) != 0 {
			t.Fatalf("unsupported blocks=%v edits=%v problem=%s", blocks, edits, problem)
		}
	}
}
