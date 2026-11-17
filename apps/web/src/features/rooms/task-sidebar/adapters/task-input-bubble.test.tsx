import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskInputBubble } from "./task-input-bubble";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** jsdom has no layout; every observed element reports this height. */
function measureContent(height: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      #callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.#callback = callback;
      }
      observe(target: Element) {
        this.#callback(
          [
            {
              contentRect: { height, width: 320 },
              target,
            } as ResizeObserverEntry,
          ],
          this,
        );
      }
      disconnect() {}
      unobserve() {}
    },
  );
}

describe("TaskInputBubble", () => {
  it("shows an input that fits whole, without a fold", async () => {
    measureContent(22);
    render(<TaskInputBubble authorKind="agent" body="Add a closing letter." />);
    await act(() => new Promise(requestAnimationFrame));

    expect(screen.getByText("Add a closing letter.")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("folds a long input to its first lines and opens it in place", async () => {
    measureContent(400);
    render(
      <TaskInputBubble
        authorKind="agent"
        body={"Write the report.\n\n1. Opening\n2. Events\n3. Finances"}
      />,
    );

    const more = await screen.findByRole("button", { name: "Show more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    const region = document.getElementById(more.getAttribute("aria-controls")!);
    expect(region).toHaveTextContent("Finances");
    expect(region!.className).toContain("mask-image");

    fireEvent.click(more);

    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(region!.className).not.toContain("mask-image");

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(screen.getByRole("button", { name: "Show more" })).toBeVisible();
    expect(region!.className).toContain("mask-image");
  });

  it("caps the width on a wrapper, since the bubble's own max-width outranks utilities", () => {
    render(<TaskInputBubble authorKind="human" body="Hi" />);
    const bubble = screen
      .getByText("Hi")
      .closest(".room-message-bubble") as HTMLElement;

    expect(bubble.className).not.toContain("max-w-");
    expect(bubble.parentElement).toHaveClass("max-w-[85%]");
  });
});
