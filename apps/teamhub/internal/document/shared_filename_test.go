package document

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestResolveSharedDownloadFilename(t *testing.T) {
	longCJK := strings.Repeat("\u4e2d", 100)
	for _, tc := range []struct {
		name   string
		title  string
		stored string
		want   string
	}{
		{name: "native ascii title without extension", title: "WIN015-DOC-TITLE", stored: "latest.md", want: "WIN015-DOC-TITLE.md"},
		{name: "native ascii title with extension", title: "WIN015-DOC-TITLE.md", stored: "latest.md", want: "WIN015-DOC-TITLE.md"},
		{name: "native ascii title with uppercase extension", title: "WIN015-DOC-TITLE.MD", stored: "latest.md", want: "WIN015-DOC-TITLE.MD"},
		{name: "renamed ordinary document", title: "WIN015-DOC-TITLE.md", stored: "document.md", want: "WIN015-DOC-TITLE.md"},
		{name: "native utf8 cjk title without extension", title: "\u4e2d\u6587\u6587\u6863", stored: "latest.md", want: "\u4e2d\u6587\u6587\u6863.md"},
		{name: "native utf8 cjk title with extension", title: "\u4e2d\u6587\u6587\u6863.md", stored: "latest.md", want: "\u4e2d\u6587\u6587\u6863.md"},
		{name: "mixed ascii and utf8 cjk title", title: "WIN015 \u6d4b\u8bd5\u6807\u9898", stored: "latest.md", want: "WIN015 \u6d4b\u8bd5\u6807\u9898.md"},
		{name: "ordinary utf8 title preserves pdf extension", title: "\u9879\u76ee\u62a5\u544a", stored: "upload.pdf", want: "\u9879\u76ee\u62a5\u544a.pdf"},
		{name: "neutralizes separators and control characters", title: "Q3 / Q4\\Plan\x00\t\n2026", stored: "latest.md", want: "Q3 - Q4-Plan 2026.md"},
		{name: "neutralizes crlf in title", title: "Report\r\nX-Injected: yes", stored: "latest.md", want: "Report X-Injected: yes.md"},
		{name: "neutralizes crlf in stored filename", title: "Report", stored: "dir/latest\r\n.md\r\n", want: "Report.md"},
		{name: "neutralizes backslash in stored extension", title: "Report", stored: "file.a\\b", want: "Report.a-b"},
		{name: "neutralizes backslash in stored fallback", title: "   ", stored: "dir\\file.a\\b", want: "dir-file.a-b"},
		{name: "preserves quotes and semicolons in title", title: `report "Q1"; draft`, stored: "latest.md", want: `report "Q1"; draft.md`},
		{name: "preserves percent signs in title", title: "100% Complete", stored: "latest.md", want: "100% Complete.md"},
		{name: "does not append lone trailing dot from stored filename", title: "Report", stored: "foo.", want: "Report"},
		{name: "does not append lone trailing dot to title ending in dot", title: "foo.", stored: "foo.", want: "foo."},
		{name: "does not append lone trailing dot to non-ascii title ending in dot", title: "\u4e2d\u6587.", stored: "foo.", want: "\u4e2d\u6587."},
		{name: "dot title and dot stored filename fall back to document", title: ".", stored: ".", want: "document"},
		{name: "dotdot title and dotdot stored filename fall back to document", title: "..", stored: "..", want: "document"},
		{name: "blank title and empty stored filename fall back to document", title: "   ", stored: "", want: "document"},
		{name: "dotfile stored filename is not appended as extension", title: "Report", stored: ".env", want: "Report"},
		{name: "blank title falls back to dotfile without duplicating extension", title: "   ", stored: ".env", want: ".env"},
		{name: "blank title falls back to stored filename", title: "   ", stored: "shared.txt", want: "shared.txt"},
		{name: "dotdot title falls back to stored filename", title: "..", stored: "report.pdf", want: "report.pdf"},
		{name: "extensionless document keeps title", title: "README", stored: "README", want: "README"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveSharedDownloadFilename(tc.title, tc.stored)
			if got != tc.want {
				t.Fatalf("resolveSharedDownloadFilename(%q, %q) = %q, want %q", tc.title, tc.stored, got, tc.want)
			}
			if strings.ContainsAny(got, "/\\\r\n\x00") {
				t.Fatalf("resolved filename %q contains disallowed path or control characters", got)
			}
		})
	}

	got := resolveSharedDownloadFilename(longCJK, "latest.md")
	if len(got) > maxSourceFilenameBytes || !utf8.ValidString(got) || !strings.HasSuffix(got, ".md") {
		t.Fatalf("overlong UTF-8 filename = %q (len=%d, valid=%v)", got, len(got), utf8.ValidString(got))
	}
}
