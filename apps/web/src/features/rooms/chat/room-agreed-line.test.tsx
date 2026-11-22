import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";

import { RoomAgreedLine } from "./room-agreed-line";

describe("RoomAgreedLine", () => {
  it("holds the agreed words and who said them", () => {
    render(
      <RoomAgreedLine
        message={
          {
            author: { display_name: "Alice" },
            raw_message: "Wait for Maya",
          } as TeamHubMessage
        }
      />,
    );
    const line = screen.getByRole("region", { name: "The room agreed" });
    expect(line).toHaveTextContent("Agreed");
    expect(line).toHaveTextContent("Alice");
    expect(line).toHaveTextContent("Wait for Maya");
  });

  it("strips raw Markdown syntax from the agreed preview", () => {
    render(
      <RoomAgreedLine
        message={
          {
            author: { display_name: "Alice" },
            raw_message:
              "Ship **v2** after checking [release notes](https://example.com/notes)",
          } as TeamHubMessage
        }
      />,
    );
    const line = screen.getByRole("region", { name: "The room agreed" });
    expect(line).toHaveTextContent("Ship v2 after checking release notes");
    expect(line).not.toHaveTextContent("**");
    expect(line).not.toHaveTextContent("https://example.com/notes");
    const preview = screen.getByText("Ship v2 after checking release notes");
    expect(preview).toHaveClass("line-clamp-2");
    expect(preview.className).not.toMatch(/(^|\s)block(\s|$)/);
  });
});
