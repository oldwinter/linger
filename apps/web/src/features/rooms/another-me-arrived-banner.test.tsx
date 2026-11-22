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
    const banner = screen.getByRole("complementary", {
      name: "Another Me arrived",
    });
    expect(banner).toHaveTextContent("I finished the notes.");
    expect(banner).toHaveClass(
      "w-[min(20rem,calc(100vw-2rem))]",
      "max-md:top-4",
      "max-md:bottom-auto",
      "max-md:right-4",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    const preview = screen.getByText("I finished the notes.");
    expect(preview).toHaveClass("line-clamp-3");
    expect(preview).not.toHaveClass("block");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
