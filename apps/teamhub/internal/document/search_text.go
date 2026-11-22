package document

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/yuin/goldmark/ast"
	gmtext "github.com/yuin/goldmark/text"
)

var (
	fenceLine          = regexp.MustCompile("(?m)^[ \t]*(```|~~~)[^\n]*$")
	image              = regexp.MustCompile(`!\[([^\]]*)\]\([^)\n]*\)`)
	link               = regexp.MustCompile(`\[([^\]\n]+)\]\([^)\n]*\)`)
	htmlTag            = regexp.MustCompile(`</?[A-Za-z][^>\n]{0,200}>`)
	tableSeparator     = regexp.MustCompile(`(?m)^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|?)+[ \t]*$`)
	linePrefix         = regexp.MustCompile(`(?m)^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,3}[.)][ \t]+)`)
	emphasis           = regexp.MustCompile("\\*+|~~|__|`+")
	whitespace         = regexp.MustCompile(`\s+`)
	escapedPunctuation = regexp.MustCompile(`\\[[:punct:]]`)
)

// MarkdownToSearchText flattens Markdown into one line of plain words for
// keyword matching and snippets. It drops syntax and link targets, keeps
// alt text and code contents, and leaves single underscores alone so
// identifiers such as room_id stay searchable.
func MarkdownToSearchText(markdown string) string {
	// PostgreSQL text rejects NUL; preserve the surrounding words as separate tokens.
	markdown = strings.ReplaceAll(markdown, "\x00", " ")
	markdown, escapes := protectSearchEscapes(markdown)
	text := fenceLine.ReplaceAllString(markdown, "")
	text = image.ReplaceAllString(text, " $1 ")
	text = link.ReplaceAllString(text, "$1")
	text = htmlTag.ReplaceAllString(text, " ")
	text = tableSeparator.ReplaceAllString(text, "")
	// Nested prefixes such as "> - [ ] item" or "- ## heading" need one pass per level.
	for range 3 {
		stripped := linePrefix.ReplaceAllString(text, "")
		if stripped == text {
			break
		}
		text = stripped
	}
	text = strings.ReplaceAll(text, "|", " ")
	text = emphasis.ReplaceAllString(text, "")
	if escapes != nil {
		text = escapes.Replace(text)
	}
	return strings.TrimSpace(whitespace.ReplaceAllString(text, " "))
}

func protectSearchEscapes(content string) (string, *strings.Replacer) {
	matches := escapedPunctuation.FindAllStringIndex(content, -1)
	if len(matches) == 0 {
		return content, nil
	}
	var code [][2]int
	// Plain table cells need no parse when neither code delimiters nor code indentation can occur.
	if strings.ContainsAny(content, "`\t") || strings.Contains(content, "~~~") || strings.Contains(content, "    ") {
		root := markdown.Parser().Parse(gmtext.NewReader([]byte(content)))
		_ = ast.Walk(root, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
			if entering {
				code = append(code, codeRanges(node)...)
			}
			return ast.WalkContinue, nil
		})
	}
	var output strings.Builder
	var replacements []string
	markers := make(map[byte]string)
	offset, codeIndex := 0, 0
	for _, match := range matches {
		for codeIndex < len(code) && code[codeIndex][1] <= match[0] {
			codeIndex++
		}
		if codeIndex < len(code) && code[codeIndex][0] <= match[0] {
			continue
		}
		punctuation := content[match[0]+1]
		marker, exists := markers[punctuation]
		if !exists {
			// Input NULs are already gone, so these markers cannot collide with source text.
			marker = "\x00" + strconv.Itoa(len(markers)) + "\x00"
			markers[punctuation] = marker
			replacements = append(replacements, marker, string(punctuation))
		}
		output.WriteString(content[offset:match[0]])
		output.WriteString(marker)
		offset = match[1]
	}
	if len(replacements) == 0 {
		return content, nil
	}
	output.WriteString(content[offset:])
	return output.String(), strings.NewReplacer(replacements...)
}
