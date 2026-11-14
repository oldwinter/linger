import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MeetingTopic } from "./meeting-overview";
import {
  MeetingKeywords,
  MeetingOutcomes,
  MeetingOverviewCard,
} from "./meeting-overview-card";

const topics: MeetingTopic[] = [
  {
    title: "Target users",
    time: "00:00:33 – 00:03:51",
    intro: "Who the first release serves.",
    points: [
      { text: "**Founders**: early adopters.", children: [] },
      { text: "Sales teams.", children: ["Inbound first."] },
      { text: "Local services.", children: [] },
      { text: "Agencies.", children: [] },
      { text: "Creators.", children: [] },
    ],
  },
  {
    title: "Release plan",
    time: null,
    intro: null,
    points: [{ text: "Open source by October.", children: [] }],
  },
];

describe("MeetingOverviewCard", () => {
  it("shows the Meeting Summary heading and every topic completely, in order", () => {
    render(<MeetingOverviewCard topics={topics} />);
    const card = screen.getByRole("region", { name: "Meeting overview" });
    expect(
      within(card).getByRole("heading", { level: 2, name: "Meeting Summary" }),
    ).toBeVisible();
    const items = within(screen.getByRole("list", { name: "Topics" }))
      .getAllByRole("listitem")
      .filter((item) => item.parentElement?.getAttribute("aria-label"));
    expect(items.map((item) => item.textContent)).toEqual([
      "01Target users00:00:33 – 00:03:51Who the first release serves.Founders: early adopters.Sales teams.Inbound first.Local services.Agencies.Creators.",
      "02Release planOpen source by October.",
    ]);
    expect(within(items[0]!).getByText("Founders").tagName).toBe("STRONG");
    // Only the Meeting Summary content: no keywords, conclusions, or next steps.
    expect(screen.queryByRole("list", { name: "Keywords" })).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
    expect(card).not.toHaveTextContent(/more/u);
  });

  it("uses two columns when topic text is long", () => {
    const { rerender } = render(
      <MeetingOverviewCard topics={topics.slice(1)} />,
    );
    expect(screen.getByRole("list", { name: "Topics" })).toHaveClass(
      "@3xl:grid-cols-3",
    );
    rerender(
      <MeetingOverviewCard
        topics={[
          { title: "Long", time: null, intro: "x".repeat(200), points: [] },
        ]}
      />,
    );
    expect(screen.getByRole("list", { name: "Topics" })).not.toHaveClass(
      "@3xl:grid-cols-3",
    );
  });

  it("shows Keywords as tags", () => {
    render(
      <MeetingKeywords
        keywords={["dogfooding", "GitLab.com"]}
        title="Keywords"
      />,
    );
    expect(
      within(screen.getByRole("list", { name: "Keywords" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["dogfooding", "GitLab.com"]);
  });

  it("leads each outcome with its kind as a tag", () => {
    render(
      <MeetingOutcomes
        outcomes={[
          {
            label: "Decision",
            text: "Ship the **web** app first.",
            children: [],
          },
          {
            label: "Action",
            text: "Prepare designs.",
            children: ["Owner: Lin"],
          },
          { label: null, text: "Noted context.", children: [] },
        ]}
        title="Decisions And Outcomes"
      />,
    );
    const section = screen.getByRole("region", {
      name: "Decisions And Outcomes",
    });
    const items = within(section)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement?.parentElement === section);
    expect(items.map((item) => item.textContent)).toEqual([
      "DecisionShip the web app first.",
      "ActionPrepare designs.Owner: Lin",
      "Noted context.",
    ]);
    expect(section).not.toHaveTextContent("Decision:");
  });

  it("offers Track on Action items only, and only with a handler", () => {
    const onTrack = vi.fn();
    const outcomes = [
      {
        label: "Decision" as const,
        text: "Ship the web app first.",
        children: [],
      },
      { label: "Action" as const, text: "Prepare designs.", children: [] },
      { label: null, text: "Noted context.", children: [] },
    ];
    const { rerender } = render(
      <MeetingOutcomes outcomes={outcomes} title="To-do list" />,
    );
    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <MeetingOutcomes
        onTrack={onTrack}
        outcomes={outcomes}
        title="To-do list"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Track action: Prepare designs." }),
    );
    expect(onTrack).toHaveBeenCalledWith("Prepare designs.");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("offers Copy actions only when the section has Actions and a handler", () => {
    const onCopyActions = vi.fn();
    const outcomes = [
      {
        label: "Decision" as const,
        text: "Ship the web app first.",
        children: [],
      },
      {
        label: "Action" as const,
        text: "Prepare designs.",
        children: ["Owner: Lin"],
      },
    ];
    const { rerender } = render(
      <MeetingOutcomes outcomes={outcomes} title="To-do list" />,
    );
    expect(screen.queryByRole("button", { name: "Copy actions" })).toBeNull();

    rerender(
      <MeetingOutcomes
        onCopyActions={onCopyActions}
        outcomes={outcomes}
        title="To-do list"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy actions" }));
    expect(onCopyActions).toHaveBeenCalledWith(
      "- [ ] Prepare designs.\n  - [ ] Owner: Lin",
    );
  });

  it("shows Copied or the failure message from the copy result", () => {
    const outcomes = [
      { label: "Action" as const, text: "Prepare designs.", children: [] },
    ];
    const { rerender } = render(
      <MeetingOutcomes
        copyStatus="copied"
        onCopyActions={() => {}}
        outcomes={outcomes}
        title="To-do list"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Copied");

    rerender(
      <MeetingOutcomes
        copyStatus="failed"
        onCopyActions={() => {}}
        outcomes={outcomes}
        title="To-do list"
      />,
    );
    expect(screen.queryByText("Copied")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Copy failed. Select the actions and copy them yourself.",
    );
  });

  it("says None observed for an empty to-do list", () => {
    render(<MeetingOutcomes outcomes={[]} title="To-do list" />);
    expect(
      screen.getByRole("region", { name: "To-do list" }),
    ).toHaveTextContent("To-do listNone observed.");
  });
});
