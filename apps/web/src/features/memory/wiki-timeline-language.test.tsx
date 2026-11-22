import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { buildTimeline, type WikiGraphData } from "./wiki-graph-model";
import { WikiKnowledgeGraph } from "./wiki-knowledge-graph";

const words = zhCN.wikiTimeline;

function session(day: string) {
  return {
    id: `sessions/${day}/capture`,
    title: `Session ${day}`,
    category: "Session",
    description: "",
    tags: [],
    body: "",
    size: 400,
    links: [],
    backlinks: [],
  };
}

const graph: WikiGraphData = {
  types: ["Session"],
  nodes: [session("2026-08-31"), session("2026-09-03")],
  edges: [],
};

function chinese(day: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("zh-CN", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

function withYear(date: string) {
  return words.dateWithYear.replace("{year}", "2026").replace("{date}", date);
}

describe("Wiki Timeline in the language on screen", () => {
  // The timeline runs through today; pin today to the last Session day.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T12:00:00+08:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
    resetLanguageForTest();
  });

  it("names the months of the ruler in that language", async () => {
    const moments = new Map([
      ["a", [{ day: "2026-08-31", strength: "session" as const }]],
    ]);
    const months = () =>
      buildTimeline(moments, "day", "2026-09-01").buckets.map(
        (bucket) => bucket.monthLabel,
      );
    expect(months()).toEqual(["Aug", "Sep"]);
    await setLanguage("zh-CN");
    expect(months()).toEqual([
      chinese("2026-08-31", { month: "short" }),
      chinese("2026-09-01", { month: "short" }),
    ]);
    expect(
      buildTimeline(moments, "day", "2026-09-01", "en-US").buckets[0]!
        .monthLabel,
    ).toBe("Aug");
  });

  it("words the toolbar and the playhead in Chinese and switches back in place", async () => {
    await setLanguage("zh-CN");
    render(<WikiKnowledgeGraph graph={graph} />);
    const playhead = screen.getByRole("slider", { name: words.playhead });
    const monthDay = { month: "short", day: "numeric" } as const;
    expect(
      screen.getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual([words.day, words.week]);
    expect(
      screen.getByRole("searchbox", { name: words.searchPages }),
    ).toHaveAttribute("placeholder", words.searchPages);
    expect(screen.getByText(words.noReports)).toBeVisible();
    expect(
      screen.getByRole("button", { name: words.jumpToLatest }),
    ).toHaveTextContent(words.latest);
    expect(playhead).toHaveAttribute(
      "aria-valuetext",
      withYear(chinese("2026-09-03", monthDay)),
    );

    fireEvent.click(screen.getByRole("radio", { name: words.week }));
    expect(playhead).toHaveAttribute(
      "aria-valuetext",
      withYear(
        `${chinese("2026-08-31", monthDay)} – ${chinese("2026-09-06", monthDay)}`,
      ),
    );

    await act(() => setLanguage("en"));
    expect(
      screen.getByRole("slider", { name: "Timeline playhead" }),
    ).toHaveAttribute("aria-valuetext", "AUG 31 – SEP 6, 2026");
    expect(screen.getByRole("radio", { name: "Week" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
