import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WritingSeatRow } from "./writing-seat-row";

describe("WritingSeatRow", () => {
  it("sits the unsent words in the writer's place", () => {
    render(
      <WritingSeatRow
        actorId="actor-jenny"
        name="Jenny"
        text={"Wait for Maya\nShe has the notes."}
      />,
    );
    const seat = screen.getByRole("article", { name: "Still writing" });
    expect(seat).toHaveTextContent("Wait for Maya");
    expect(seat).toHaveTextContent("She has the notes.");
  });
});
