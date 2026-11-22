package document

import "testing"

func TestMarkdownToSearchText(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		markdown string
		want     string
	}{
		{
			name:     "headings lists and emphasis",
			markdown: "# Release checklist\n\n- **Freeze** at 4pm\n2. Run the _smoke_ test\n> - [ ] nested task\n",
			want:     "Release checklist Freeze at 4pm Run the _smoke_ test nested task",
		},
		{
			name:     "links images and html",
			markdown: "See [Voice Call v2 plan](https://example.com/doc) ![architecture](assets/a.png) <br/> <span class=\"x\">inline</span> a < b",
			want:     "See Voice Call v2 plan architecture inline a < b",
		},
		{
			name:     "code fences keep content and identifiers",
			markdown: "```sql\nSELECT room_id FROM messages;\n```\nUse `strpos` on `body_text`.",
			want:     "SELECT room_id FROM messages; Use strpos on body_text.",
		},
		{
			name:     "tables",
			markdown: "| Field | Meaning |\n| --- | :---: |\n| status | index state |\n",
			want:     "Field Meaning status index state",
		},
		{
			name:     "escaped identifiers",
			markdown: `room\_id first\_last@corp.com`,
			want:     "room_id first_last@corp.com",
		},
		{
			name:     "escaped and literal backslashes",
			markdown: `C:\\temp C:\temp`,
			want:     `C:\temp C:\temp`,
		},
		{
			name:     "escaped punctuation stays literal",
			markdown: `a\*b \*\*bold\*\* \[label\](target) left\|right \_\_raw\_\_`,
			want:     `a*b **bold** [label](target) left|right __raw__`,
		},
		{
			name:     "escapes inside emphasis and link labels",
			markdown: `**room\_id** [first\_last@corp.com](mailto:user@example.com)`,
			want:     "room_id first_last@corp.com",
		},
		{
			name:     "code keeps its literal backslashes",
			markdown: "Use `C:\\\\temp room\\_id`.\n\n```text\nC:\\\\temp room\\_id\n```\n\n    C:\\\\temp room\\_id\n",
			want:     `Use C:\\temp room\_id. C:\\temp room\_id C:\\temp room\_id`,
		},
		{
			name:     "NUL boundaries do not collide with escaped punctuation",
			markdown: "\x000\x00 room\\_id",
			want:     "0 room_id",
		},
		{
			name:     "whitespace collapses across lines",
			markdown: "Barge-in policy: when the user speaks\nstop playback within 200ms\n\n\nand drop unplayed frames.",
			want:     "Barge-in policy: when the user speaks stop playback within 200ms and drop unplayed frames.",
		},
		{
			name:     "NUL bytes become word boundaries",
			markdown: "\x00# Release\x00\x00checklist\n- **Deploy**\x00done 🚀\x00",
			want:     "Release checklist Deploy done 🚀",
		},
		{
			name:     "NUL-only input",
			markdown: "\x00\x00\n\x00",
			want:     "",
		},
		{
			name:     "empty",
			markdown: "\n\n```\n```\n",
			want:     "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := MarkdownToSearchText(tc.markdown); got != tc.want {
				t.Fatalf("MarkdownToSearchText(%q)\n got: %q\nwant: %q", tc.markdown, got, tc.want)
			}
		})
	}
}
