package documenttext

import "testing"

func TestLongestLineBytesCountsUTF8BytesPerLine(t *testing.T) {
	for markdown, want := range map[string]int64{
		"":                         0,
		"one line":                 8,
		"# One\nbody":              5,
		"a\n\nlonger line\nb\n":    11,
		"trailing\n":               8,
		"x\r\nyy":                  2,
		"caf\u00e9\nx":             5,
		"\U0001F600\U0001F600\nab": 8,
	} {
		if got := LongestLineBytes(markdown); got != want {
			t.Errorf("LongestLineBytes(%q)=%d, want %d", markdown, got, want)
		}
	}
}
