// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { cadenceLabel, dayHeading, weekdayName } from "./routine-cadence";

const words = zhCN.routines;

function weekly(...weekdays: Parameters<typeof weekdayName>[0][]) {
  return {
    kind: "weekly" as const,
    timezone: "UTC",
    hour: 9,
    minute: 0,
    weekdays,
  };
}

function clock(locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, 9, 0));
}

describe("Routine schedules in the language on screen", () => {
  afterEach(() => resetLanguageForTest());

  it("keeps the English sentences", () => {
    expect(cadenceLabel(weekly("monday"))).toBe("Monday · 9:00 AM");
    expect(cadenceLabel(weekly("friday", "monday", "wednesday"))).toBe(
      "Mon, Wed, Fri · 9:00 AM",
    );
    expect(
      cadenceLabel(
        weekly("monday", "tuesday", "wednesday", "thursday", "friday"),
      ),
    ).toBe("Mon–Fri · 9:00 AM");
    expect(cadenceLabel(weekly())).toBe("Weekly · 9:00 AM");
    expect(
      cadenceLabel({ kind: "daily", timezone: "UTC", hour: 18, minute: 30 }),
    ).toBe("Daily · 6:30 PM");
    expect(cadenceLabel({ kind: "every_n_hours", timezone: "UTC" })).toBe(
      "Every hour",
    );
    expect(
      cadenceLabel({
        kind: "every_n_hours",
        timezone: "UTC",
        interval_hours: 3,
      }),
    ).toBe("Every 3 hours");
    expect(dayHeading(new Date(2026, 9, 30), new Date(2026, 9, 28))).toEqual({
      day: "Oct 30",
      distance: "in 2 days",
    });
  });

  it("words the pattern from the catalog and names days and times with Intl", async () => {
    await setLanguage("zh-CN");
    const time = clock("zh-CN");
    expect(
      cadenceLabel(
        weekly("monday", "tuesday", "wednesday", "thursday", "friday"),
      ),
    ).toBe(words.mondayToFridayAt.replace("{time}", time));
    const days = (["monday", "wednesday"] as const)
      .map((day) => weekdayName(day, "short"))
      .join(words.weekdaySeparator);
    expect(weekdayName("monday", "short")).not.toBe("Mon");
    expect(cadenceLabel(weekly("wednesday", "monday"))).toBe(
      words.weekdaysAt.replace("{days}", days).replace("{time}", time),
    );
    expect(
      cadenceLabel({
        kind: "every_n_hours",
        timezone: "UTC",
        interval_hours: 3,
      }),
    ).toBe(words.everyHours.other.replace("{count}", "3"));
    expect(dayHeading(new Date(2026, 9, 29), new Date(2026, 9, 28)).day).toBe(
      words.tomorrow,
    );
    expect(
      dayHeading(new Date(2026, 9, 30), new Date(2026, 9, 28)).distance,
    ).toBe(words.inDays.other.replace("{count}", "2"));
  });
});
