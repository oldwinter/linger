package voice

import (
	"testing"
	"time"
)

func TestParsePocketNoteExpectedUpdatedAt(t *testing.T) {
	t.Run("nil means unconditional write", func(t *testing.T) {
		got, err := ParsePocketNoteExpectedUpdatedAt(nil)
		if err != nil || got != nil {
			t.Fatalf("got=(%+v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("empty or whitespace expects empty page", func(t *testing.T) {
		for _, raw := range []string{"", "   "} {
			v := raw
			got, err := ParsePocketNoteExpectedUpdatedAt(&v)
			if err != nil || got == nil || !got.Empty {
				t.Fatalf("raw=%q got=(%+v, %v), want Empty=true", raw, got, err)
			}
		}
	})

	t.Run("parses RFC3339Nano timestamp", func(t *testing.T) {
		raw := "2026-10-01T10:15:30.123456Z"
		got, err := ParsePocketNoteExpectedUpdatedAt(&raw)
		if err != nil || got == nil || got.Empty {
			t.Fatalf("got=(%+v, %v), want parsed time", got, err)
		}
		want := time.Date(2026, 10, 1, 10, 15, 30, 123456000, time.UTC)
		if !got.UpdatedAt.Equal(want) {
			t.Fatalf("UpdatedAt=%v, want %v", got.UpdatedAt, want)
		}
	})

	t.Run("rejects malformed timestamp", func(t *testing.T) {
		raw := "not-a-timestamp"
		if got, err := ParsePocketNoteExpectedUpdatedAt(&raw); err == nil {
			t.Fatalf("got=(%+v, nil), want error", got)
		}
	})
}
