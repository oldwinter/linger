import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MeetingSpeakerPart } from "./meeting-speaker-part";

const speakers = ["Speaker 1", "Speaker 2"];
const lines = [
  { kind: "said" as const, text: "First." },
  { kind: "passed" as const, text: "4 minutes passed" },
  { kind: "said" as const, text: "Again." },
];

describe("MeetingSpeakerPart", () => {
  it("offers each voice and shows the one that is chosen", () => {
    const onSelect = vi.fn();
    const view = render(
      <MeetingSpeakerPart lines={[]} onSelect={onSelect} speakers={speakers} />,
    );
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Speaker 1" }));
    expect(onSelect).toHaveBeenCalledWith("Speaker 1");

    view.rerender(
      <MeetingSpeakerPart
        lines={lines}
        onSelect={onSelect}
        speaker="Speaker 1"
        speakers={speakers}
      />,
    );
    const part = screen.getByRole("article", { name: "Speaker 1's part" });
    expect(part).toHaveTextContent("First.");
    expect(part).toHaveTextContent("4 minutes passed");
    expect(part).toHaveTextContent("Again.");
    expect(screen.getByRole("button", { name: "Speaker 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("stays out of a meeting that has one voice", () => {
    render(
      <MeetingSpeakerPart
        lines={[]}
        onSelect={vi.fn()}
        speakers={["Speaker 1"]}
      />,
    );
    expect(screen.queryByRole("group", { name: "Whose part" })).toBeNull();
  });
});
