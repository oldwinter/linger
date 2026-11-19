import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { FormFeedback } from "./form-feedback";
import { UnderlineTabs } from "./underline-tabs";

describe("UI primitives", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supports roving tabIndex, arrow/Home/End navigation, and ResizeObserver re-measurement in UnderlineTabs", () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    function Harness() {
      const [tab, setTab] = useState<"first" | "second" | "third">("first");
      return (
        <UnderlineTabs
          items={[
            { id: "first", label: "First" },
            { id: "second", label: "Second" },
            { id: "third", label: "Third" },
          ]}
          label="Views"
          onChange={setTab}
          value={tab}
        />
      );
    }

    const { container } = render(<Harness />);
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });
    const third = screen.getByRole("tab", { name: "Third" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    expect(third).toHaveAttribute("tabindex", "-1");

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(second, { key: "End" });
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(third, { key: "Home" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute("aria-selected", "true");

    Object.defineProperty(third, "offsetLeft", {
      configurable: true,
      value: 140,
    });
    Object.defineProperty(third, "offsetWidth", {
      configurable: true,
      value: 84,
    });
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    const indicator = container.querySelector(".workspace-tab-indicator");
    expect(indicator).toHaveStyle({ left: "152px", width: "60px" });
  });

  it("hides icon-only Button children while loading and uses token classes for danger and info tones", () => {
    const { rerender } = render(
      <Button aria-label="Save" loading size="icon">
        <span data-testid="icon-child">icon</span>
      </Button>,
    );
    expect(screen.queryByTestId("icon-child")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    rerender(
      <Button aria-label="Compact save" loading size="compactIcon">
        <span data-testid="compact-icon-child">icon</span>
      </Button>,
    );
    expect(screen.queryByTestId("compact-icon-child")).toBeNull();

    rerender(
      <Button loading tone="danger">
        Delete
      </Button>,
    );
    const danger = screen.getByRole("button", { name: "Delete" });
    expect(danger).toHaveTextContent("Delete");
    expect(danger).toHaveClass(
      "hover:bg-(--app-danger-hover)",
      "hover:border-(--app-danger-border-hover)",
    );

    rerender(<Button tone="info">Notify</Button>);
    const info = screen.getByRole("button", { name: "Notify" });
    expect(info).toHaveClass("text-primary-foreground");
    expect(info).not.toHaveClass("text-white");
  });

  it("renders FormFeedback in a div container so rich block content is valid HTML", () => {
    render(
      <FormFeedback tone="danger">
        <div>Details</div>
      </FormFeedback>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.tagName).toBe("DIV");
    expect(alert).toHaveTextContent("Details");
  });
});
