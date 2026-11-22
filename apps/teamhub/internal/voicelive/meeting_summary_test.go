package voicelive

import "testing"

func TestMeetingSummaryTextWritesTitleAndBullets(t *testing.T) {
	raw := []byte(`{"title":"Weekly sync","sections":[{"heading":"Product","bullets":["Rebuild ships Monday","Search redesign today"]},{"heading":"Next","bullets":["Test the client"]}]}`)
	want := "\nMeeting summary: Weekly sync\n- Product: Rebuild ships Monday; Search redesign today\n- Next: Test the client"
	if got := meetingSummaryText(raw); got != want {
		t.Fatalf("summary=%q", got)
	}
	// A recording without a ready summary adds nothing to its Message.
	for _, empty := range [][]byte{nil, []byte("null"), []byte(`{"sections":[]}`), []byte("not json")} {
		if got := meetingSummaryText(empty); got != "" {
			t.Fatalf("%s gave %q", empty, got)
		}
	}
}
