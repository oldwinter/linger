package voicelive

import (
	"strings"
	"testing"
	"time"
)

func TestRoutineCadenceReadsEachKind(t *testing.T) {
	future := time.Now().Add(48 * time.Hour).In(time.FixedZone("CST", 8*3600))
	once, err := RoutineCadence(RoutineArguments{Kind: "once", RunAt: future.Format(time.RFC3339), Timezone: "Asia/Shanghai"})
	if err != nil || once.Kind != "once" || once.RunAt == nil || !once.RunAt.Equal(future.Truncate(time.Second)) {
		t.Fatalf("once=%+v err=%v", once, err)
	}
	// A local time without an offset is read in the zone the model gave.
	local, err := RoutineCadence(RoutineArguments{Kind: "once", RunAt: future.Format("2006-01-02 15:04"), Timezone: "Asia/Shanghai"})
	if err != nil || local.RunAt.Format("15:04") != future.UTC().Format("15:04") {
		t.Fatalf("local once=%+v err=%v", local, err)
	}
	daily, err := RoutineCadence(RoutineArguments{Kind: "daily", Time: "08:30", Timezone: "Asia/Shanghai"})
	if err != nil || *daily.Hour != 8 || *daily.Minute != 30 || RoutineWhen(daily) != "every day at 08:30 (Asia/Shanghai)" {
		t.Fatalf("daily=%+v err=%v when=%q", daily, err, RoutineWhen(daily))
	}
	weekly, err := RoutineCadence(RoutineArguments{Kind: "weekly", Time: "09:00", Timezone: "Asia/Shanghai", Weekdays: []string{"friday", "monday"}})
	if err != nil || RoutineWhen(weekly) != "every monday, friday at 09:00 (Asia/Shanghai)" {
		t.Fatalf("weekly=%+v err=%v when=%q", weekly, err, RoutineWhen(weekly))
	}
	tenMin, err := RoutineCadence(RoutineArguments{Kind: "every_n_minutes", IntervalMinutes: 10})
	if err != nil || RoutineWhen(tenMin) != "every 10 minutes" {
		t.Fatalf("tenMin=%+v err=%v when=%q", tenMin, err, RoutineWhen(tenMin))
	}
	sixtyMin, err := RoutineCadence(RoutineArguments{Kind: "every_n_minutes", IntervalMinutes: 60})
	if err != nil || RoutineWhen(sixtyMin) != "every 60 minutes" {
		t.Fatalf("sixtyMin=%+v err=%v when=%q", sixtyMin, err, RoutineWhen(sixtyMin))
	}
	legacyHours, err := RoutineCadence(RoutineArguments{Kind: "every_n_hours", IntervalHours: 2})
	if err != nil || RoutineWhen(legacyHours) != "every 120 minutes" {
		t.Fatalf("legacyHours=%+v err=%v when=%q", legacyHours, err, RoutineWhen(legacyHours))
	}
}

func TestRoutineCadenceRejectsIncompleteSchedules(t *testing.T) {
	for name, args := range map[string]RoutineArguments{
		"no kind":             {},
		"once without at":     {Kind: "once"},
		"once in the past":    {Kind: "once", RunAt: time.Now().Add(-time.Hour).Format(time.RFC3339)},
		"local without tz":    {Kind: "once", RunAt: "2099-01-01 08:00"},
		"daily no time":       {Kind: "daily", Timezone: "Asia/Shanghai"},
		"daily bad zone":      {Kind: "daily", Time: "08:00", Timezone: "Mars/Base"},
		"weekly no days":      {Kind: "weekly", Time: "08:00", Timezone: "Asia/Shanghai"},
		"minutes zero":        {Kind: "every_n_minutes"},
		"minutes under ten":   {Kind: "every_n_minutes", IntervalMinutes: 5},
		"minutes not step 10": {Kind: "every_n_minutes", IntervalMinutes: 15},
		"minutes over 7 days": {Kind: "every_n_minutes", IntervalMinutes: 10090},
		"hours zero":          {Kind: "every_n_hours"},
		"hours over 7 days":   {Kind: "every_n_hours", IntervalHours: 169},
	} {
		if _, err := RoutineCadence(args); err == nil && name != "once in the past" {
			t.Fatalf("%s accepted", name)
		}
	}
}

func TestRoutineSummarySaysWhenAndWhat(t *testing.T) {
	cadence, _ := RoutineCadence(RoutineArguments{Kind: "daily", Time: "20:00", Timezone: "Asia/Shanghai"})
	reminder := RoutineSummary("Call", "Reminder: call Mom", cadence, false)
	work := RoutineSummary("Schedule", "Read today's schedule", cadence, true)
	if !strings.Contains(reminder, "every day at 20:00") || !strings.Contains(reminder, "post this reminder") ||
		!strings.Contains(work, "wake the Agent") || reminder == work {
		t.Fatalf("summaries %q %q", reminder, work)
	}
}
