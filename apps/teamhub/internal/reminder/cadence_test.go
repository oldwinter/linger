package reminder

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestNextRunAtDailySkipsTheCurrentSlot(t *testing.T) {
	hour, minute := 9, 0
	after := time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC)
	next, err := nextRunAt(Cadence{
		Kind: "daily", Timezone: "UTC", Hour: &hour, Minute: &minute,
	}, after)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 9, 22, 9, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next=%s want=%s", next, want)
	}
}

func TestNextRunAtWeeklyAdvancesAFullWeekWhenDue(t *testing.T) {
	hour, minute := 9, 30
	after := time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC) // Monday
	next, err := nextRunAt(Cadence{
		Kind: "weekly", Timezone: "UTC", Hour: &hour, Minute: &minute, Weekdays: []string{"monday"},
	}, after)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 9, 28, 9, 30, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next=%s want=%s", next, want)
	}
}

func TestNextRunAtIntervalMinutes(t *testing.T) {
	minutes := 10
	after := time.Date(2026, 9, 21, 8, 0, 0, 0, time.UTC)
	next, err := nextRunAt(Cadence{
		Kind: "every_n_minutes", Timezone: "Asia/Shanghai", IntervalMinutes: &minutes,
	}, after)
	if err != nil {
		t.Fatal(err)
	}
	want := after.Add(10 * time.Minute)
	if !next.Equal(want) {
		t.Fatalf("next=%s want=%s", next, want)
	}
}

func TestNextOccurrenceAtIntervalGrid(t *testing.T) {
	minutes := 10
	cadence := Cadence{Kind: "every_n_minutes", Timezone: "UTC", IntervalMinutes: &minutes}
	dueAt := time.Date(2026, 9, 21, 8, 10, 0, 0, time.UTC)
	cases := []struct {
		name string
		now  time.Time
		want time.Time
	}{
		{"slight early wake keeps grid", dueAt.Add(-200 * time.Millisecond), dueAt.Add(10 * time.Minute)},
		{"exact due time advances one step", dueAt, dueAt.Add(10 * time.Minute)},
		{"scheduling delay does not drift", dueAt.Add(3*time.Second + 450*time.Millisecond), dueAt.Add(10 * time.Minute)},
		{"just before next slot keeps next slot", dueAt.Add(9*time.Minute + 59*time.Second), dueAt.Add(10 * time.Minute)},
		{"exactly on next slot skips to following slot", dueAt.Add(10 * time.Minute), dueAt.Add(20 * time.Minute)},
		{"downtime skips missed slots without catch-up", dueAt.Add(33*time.Minute + 12*time.Second), dueAt.Add(40 * time.Minute)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			next, err := nextOccurrenceAt(cadence, dueAt, tc.now)
			if err != nil {
				t.Fatal(err)
			}
			if !next.Equal(tc.want) {
				t.Fatalf("next=%s want=%s", next, tc.want)
			}
			if !next.After(tc.now) {
				t.Fatalf("next=%s must be strictly after now=%s", next, tc.now)
			}
		})
	}
}

func TestValidateIntervalMinutesBoundsAndStep(t *testing.T) {
	for _, valid := range []int{10, 20, 60, 120, 10080} {
		minutes := valid
		cadence, err := ParseSchedule(Schedule{Kind: "every_n_minutes", IntervalMinutes: &minutes})
		if err != nil {
			t.Fatalf("minutes=%d rejected: %v", valid, err)
		}
		if cadence.Kind != "every_n_minutes" || cadence.IntervalMinutes == nil || *cadence.IntervalMinutes != valid {
			t.Fatalf("minutes=%d cadence=%+v", valid, cadence)
		}
		roundTrip := ScheduleFromCadence(cadence)
		if roundTrip.Kind != "every_n_minutes" || roundTrip.IntervalMinutes == nil || *roundTrip.IntervalMinutes != valid {
			t.Fatalf("minutes=%d roundTrip=%+v", valid, roundTrip)
		}
	}
	for _, invalid := range []int{-10, 0, 1, 5, 9, 11, 15, 25, 59, 61, 10075, 10090, 20000} {
		minutes := invalid
		if _, err := ParseSchedule(Schedule{Kind: "every_n_minutes", IntervalMinutes: &minutes}); !errors.Is(err, ErrIntervalInvalid) {
			t.Fatalf("minutes=%d err=%v want ErrIntervalInvalid", invalid, err)
		}
	}
	if _, err := ParseSchedule(Schedule{Kind: "every_n_minutes"}); !errors.Is(err, ErrIntervalInvalid) {
		t.Fatalf("missing interval_minutes err=%v want ErrIntervalInvalid", err)
	}
}

func TestParseScheduleAcceptsTheThreeShapes(t *testing.T) {
	daily, err := ParseSchedule(Schedule{Kind: "daily", Time: "09:05", Timezone: "Asia/Shanghai"})
	if err != nil || daily.Kind != "daily" || *daily.Hour != 9 || *daily.Minute != 5 || daily.Timezone != "Asia/Shanghai" {
		t.Fatalf("daily=%+v err=%v", daily, err)
	}
	minutes := 60
	interval, err := ParseSchedule(Schedule{Kind: "every_n_minutes", IntervalMinutes: &minutes})
	if err != nil || interval.Timezone != "UTC" || *interval.IntervalMinutes != 60 {
		t.Fatalf("interval=%+v err=%v", interval, err)
	}
	shown := ScheduleFromCadence(interval)
	if shown.Timezone != "" || shown.Time != "" || *shown.IntervalMinutes != 60 {
		t.Fatalf("shown=%+v", shown)
	}
}

func TestParseScheduleRejectsEasyMistakes(t *testing.T) {
	minutes := 20
	cases := []Schedule{
		{Kind: "daily", Time: "9:00", Timezone: "Asia/Shanghai"},
		{Kind: "daily", Time: "09:00", Timezone: "Not/AZone"},
		{Kind: "daily", Time: "09:00", Timezone: "UTC", Weekdays: []string{"monday"}},
		{Kind: "weekly", Time: "09:00", Timezone: "UTC"},
		{Kind: "every_n_minutes", Timezone: "UTC", IntervalMinutes: &minutes},
		{Kind: "every_n_hours", IntervalMinutes: &minutes},
		{Kind: "hourly", Time: "09:00", Timezone: "UTC"},
	}
	for _, schedule := range cases {
		if _, err := ParseSchedule(schedule); !errors.Is(err, ErrInvalid) {
			t.Fatalf("schedule=%+v err=%v", schedule, err)
		}
	}
}

func TestValidateCadenceRejectsMixedFields(t *testing.T) {
	hour, minutes := 9, 20
	_, err := validateCadence(Cadence{
		Kind: "every_n_minutes", Timezone: "UTC", Hour: &hour, IntervalMinutes: &minutes,
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v", err)
	}
}

func TestNextRunAtSelectedWeekdays(t *testing.T) {
	cases := []struct{ name, days, zone, after, want string }{
		{"friday advances to monday", `["monday","tuesday","wednesday","thursday","friday"]`, "Asia/Shanghai", "2026-10-02T13:00:00Z", "2026-10-05T13:00:00Z"},
		{"today before the slot", `["friday","monday"]`, "Asia/Shanghai", "2026-10-02T12:59:59Z", "2026-10-02T13:00:00Z"},
		{"sparse days", `["wednesday","monday"]`, "Asia/Shanghai", "2026-10-05T13:00:00Z", "2026-10-07T13:00:00Z"},
		{"weekend skips to monday", `["monday","friday"]`, "Asia/Shanghai", "2026-10-03T13:00:00Z", "2026-10-05T13:00:00Z"},
		{"local date differs from UTC", `["monday"]`, "Pacific/Auckland", "2026-10-04T12:00:00Z", "2026-10-05T08:00:00Z"},
		{"DST keeps local clock", `["monday","friday"]`, "Europe/Berlin", "2026-10-23T19:00:00Z", "2026-10-26T20:00:00Z"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var cadence Cadence
			if err := json.Unmarshal([]byte(`{"kind":"weekly","timezone":"`+tc.zone+`","hour":21,"minute":0,"weekdays":`+tc.days+`}`), &cadence); err != nil {
				t.Fatal(err)
			}
			after, _ := time.Parse(time.RFC3339, tc.after)
			want, _ := time.Parse(time.RFC3339, tc.want)
			next, err := nextRunAt(cadence, after)
			if err != nil || !next.Equal(want) {
				t.Fatalf("next=%s want=%s err=%v", next, want, err)
			}
		})
	}
}

func TestWeeklyRejectsInvalidSelections(t *testing.T) {
	for _, fields := range []string{
		`"weekdays":[]`, `"weekdays":["monday","monday"]`, `"weekdays":["funday"]`,
	} {
		var cadence Cadence
		if err := json.Unmarshal([]byte(`{"kind":"weekly","timezone":"UTC","hour":9,"minute":0,`+fields+`}`), &cadence); err != nil {
			t.Fatal(err)
		}
		if _, err := validateCadence(cadence); !errors.Is(err, ErrInvalid) {
			t.Fatalf("accepted %s: %v", fields, err)
		}
	}
}

func TestOnceRunsAtItsTimeAndNeverAfter(t *testing.T) {
	runAt := time.Date(2026, 10, 22, 6, 30, 0, 0, time.UTC)
	cadence, err := ParseSchedule(Schedule{Kind: "once", Timezone: "Asia/Shanghai", RunAt: &runAt})
	if err != nil {
		t.Fatal(err)
	}
	next, err := nextRunAt(cadence, runAt.Add(-time.Hour))
	if err != nil || !next.Equal(runAt) {
		t.Fatalf("next=%s err=%v", next, err)
	}
	if _, err := nextRunAt(cadence, runAt); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a one-shot time already reached has no next occurrence, err=%v", err)
	}
	if back := ScheduleFromCadence(cadence); back.Kind != "once" || back.RunAt == nil || !back.RunAt.Equal(runAt) {
		t.Fatalf("schedule=%+v", back)
	}
	defaulted, err := ParseSchedule(Schedule{Kind: "once", RunAt: &runAt})
	if err != nil || defaulted.Timezone != "UTC" {
		t.Fatalf("timezone defaults to UTC: %+v err=%v", defaulted, err)
	}
	minutes := 30
	for _, bad := range []Schedule{
		{Kind: "once"},
		{Kind: "once", RunAt: &runAt, Time: "09:00"},
		{Kind: "once", RunAt: &runAt, IntervalMinutes: &minutes},
		{Kind: "once", RunAt: &runAt, Weekdays: []string{"monday"}},
	} {
		if _, err := ParseSchedule(bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("schedule %+v must be rejected, err=%v", bad, err)
		}
	}
}

func TestParseScheduleAcceptsHourlyAliasForCompatibility(t *testing.T) {
	hours := 2
	cadence, err := ParseSchedule(Schedule{Kind: "every_n_hours", IntervalHours: &hours})
	if err != nil {
		t.Fatalf("ParseSchedule every_n_hours: %v", err)
	}
	if cadence.Kind != "every_n_minutes" || cadence.IntervalMinutes == nil || *cadence.IntervalMinutes != 120 {
		t.Fatalf("cadence=%+v want every_n_minutes=120", cadence)
	}
	if back := ScheduleFromCadence(cadence); back.Kind != "every_n_minutes" || back.IntervalMinutes == nil || *back.IntervalMinutes != 120 || back.IntervalHours != nil {
		t.Fatalf("ScheduleFromCadence=%+v want every_n_minutes=120", back)
	}
	for _, badHours := range []int{0, 169} {
		h := badHours
		if _, err := ParseSchedule(Schedule{Kind: "every_n_hours", IntervalHours: &h}); !errors.Is(err, ErrIntervalInvalid) {
			t.Fatalf("hours=%d err=%v want ErrIntervalInvalid", badHours, err)
		}
	}
	minutes := 60
	if _, err := ParseSchedule(Schedule{Kind: "every_n_hours", IntervalHours: &hours, IntervalMinutes: &minutes}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("mixing interval_hours and interval_minutes err=%v want ErrInvalid", err)
	}
	if _, err := ParseSchedule(Schedule{Kind: "every_n_minutes", IntervalHours: &hours, IntervalMinutes: &minutes}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("every_n_minutes with interval_hours err=%v want ErrInvalid", err)
	}
}
