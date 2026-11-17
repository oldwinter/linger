package documenttext

import "strings"

// LongestLineBytes is the UTF-8 size of the longest line of the Markdown. A
// text over one Wiki source budget enters the Wiki only when no line is over
// it, so it can be cut at line breaks into pieces within the budget. The
// migration that filled in the existing texts splits at every \n the same
// way.
func LongestLineBytes(markdown string) int64 {
	longest := 0
	for len(markdown) > 0 {
		line, rest, _ := strings.Cut(markdown, "\n")
		longest = max(longest, len(line))
		markdown = rest
	}
	return int64(longest)
}
