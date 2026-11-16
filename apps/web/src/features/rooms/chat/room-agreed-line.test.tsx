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
    expect(line).toHaveTextContent("Alice");
    expect(line).toHaveTextContent("Wait for Maya");
  });
});
