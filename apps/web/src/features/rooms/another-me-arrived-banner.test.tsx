import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnotherMeArrivedBanner } from "./another-me-arrived-banner";

const arrival = {
  actorId: "actor-me",
  messageId: "message-2",
  name: "Another Me",
  text: "I finished the notes.",
};

describe("AnotherMeArrivedBanner", () => {
  it("shows the words and can be opened or dismissed", () => {
    const onDismiss = vi.fn();
    const onOpen = vi.fn();
    render(
      <AnotherMeArrivedBanner
        arrival={arrival}
        onDismiss={onDismiss}
        onOpen={onOpen}
      />,
    );
    expect(
      screen.getByRole("complementary", { name: "Another Me arrived" }),
    ).toHaveTextContent("I finished the notes.");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
