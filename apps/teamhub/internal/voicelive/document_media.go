package voicelive

import (
	"regexp"
	"strings"
)

// TopBlock is one top-level block of a Document, as a rewrite around its
// images and files sees it.
type TopBlock struct {
	ID string
	// AssetID names the Document Asset of an image or file block; empty for
	// text. Media is set for every image, file, video or audio block.
	AssetID string
	Media   bool
}

// mediaLine finds the Asset an exported image or file line points at:
// ![label](document-asset:ID) or [label (type)](document-asset:ID).
var mediaLine = regexp.MustCompile(`^!?\[(?:[^\]\\]|\\.)*\]\(document-asset:([A-Za-z0-9][A-Za-z0-9_-]*)\)$`)

// RewriteAroundMedia turns a whole-document rewrite of a Document that holds
// images or files into block edits that leave every image and file block as
// it is. content keeps each exported media line, in order; the text between
// two of them replaces the text blocks between those two blocks. The edits
// come last run first, so the block IDs each one names are still there.
// problem is media_moved when content leaves out, repeats or reorders a media
// line, and document_has_media when a media block cannot be kept this way.
func RewriteAroundMedia(blocks []TopBlock, content string) (edits []map[string]string, problem string) {
	var media []TopBlock
	runs := [][]string{nil}
	for _, block := range blocks {
		if !block.Media {
			runs[len(runs)-1] = append(runs[len(runs)-1], block.ID)
			continue
		}
		if block.AssetID == "" {
			return nil, "document_has_media"
		}
		media = append(media, block)
		runs = append(runs, nil)
	}
	if len(media) == 0 {
		return nil, "document_has_media"
	}
	segments := []string{""}
	var seen []string
	var fence string
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if fence == "" && (strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~")) {
			fence = trimmed[:len(trimmed)-len(strings.TrimLeft(trimmed, trimmed[:1]))]
		} else if fence != "" && strings.HasPrefix(trimmed, fence) && strings.Trim(trimmed, fence[:1]) == "" {
			fence = ""
		}
		if match := mediaLine.FindStringSubmatch(trimmed); match != nil {
			if fence != "" {
				return nil, "media_moved"
			}
			seen = append(seen, match[1])
			segments = append(segments, "")
			continue
		}
		if strings.Contains(line, "document-asset:") {
			return nil, "media_moved"
		}
		segments[len(segments)-1] += line + "\n"
	}
	if len(seen) != len(media) {
		return nil, "media_moved"
	}
	for index, block := range media {
		if seen[index] != block.AssetID {
			return nil, "media_moved"
		}
	}
	for index := len(runs) - 1; index >= 0; index-- {
		text := strings.TrimSpace(segments[index])
		run := runs[index]
		switch {
		case len(run) > 0 && text != "":
			edit := BlockRunEdit("block_replace", run)
			edit["content"] = text + "\n"
			edits = append(edits, edit)
		case len(run) > 0:
			edits = append(edits, BlockRunEdit("block_delete", run))
		case text != "" && index == 0:
			edits = append(edits, map[string]string{"command": "block_insert_before", "block_id": media[0].ID, "content": text + "\n"})
		case text != "":
			edits = append(edits, map[string]string{"command": "block_insert_after", "block_id": media[index-1].ID, "content": text + "\n"})
		}
	}
	return edits, ""
}

// BlockRunEdit is a block command over consecutive top-level blocks: one
// block_id, or the first and last of a range.
func BlockRunEdit(command string, run []string) map[string]string {
	if len(run) == 1 {
		return map[string]string{"command": command, "block_id": run[0]}
	}
	return map[string]string{"command": command, "start_block_id": run[0], "end_block_id": run[len(run)-1]}
}
