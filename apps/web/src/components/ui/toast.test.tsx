import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { clearToasts, dismissToast, showToast, ToastViewport } from "./toast";

describe("ToastViewport", () => {
  it("shows a toast with status role and auto-dismisses after 4000ms", () => {
    vi.useFakeTimers();
    render(<ToastViewport />);

    act(() => {
      showToast({ message: "Link copied", tone: "success" });
    });

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Link copied");
    expect(toast).toHaveAttribute("aria-live", "polite");

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Link copied");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses alert role and assertive live region for danger toasts", () => {
    render(<ToastViewport />);

    act(() => {
      showToast({ message: "Copy failed", tone: "danger" });
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Copy failed");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("pauses auto-dismiss on hover and focus and resumes remaining time on leave", () => {
    vi.useFakeTimers();
    render(<ToastViewport />);

    act(() => {
      showToast({ message: "Saved draft" });
    });

    const toast = screen.getByRole("status");
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved draft");

    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved draft");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("caps visible stacked toasts at 3 and supports action and close buttons", () => {
    const onUndo = vi.fn();
    render(<ToastViewport />);

    act(() => {
      showToast({ message: "First" });
      showToast({ message: "Second" });
      showToast({ message: "Third" });
      showToast({
        message: "Fourth",
        action: { label: "Undo", onClick: onUndo },
      });
    });

    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByText("Second")).toBeVisible();
    expect(screen.getByText("Third")).toBeVisible();
    expect(screen.getByText("Fourth")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Fourth")).toBeNull();

    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closeButtons[0]!);
    expect(screen.queryByText("Second")).toBeNull();

    act(() => {
      clearToasts();
    });
    expect(screen.queryByText("Third")).toBeNull();
  });

  it("supports programmatic dismissal by id", () => {
    render(<ToastViewport />);
    let id = "";
    act(() => {
      id = showToast({ message: "Dismiss me" });
    });
    expect(screen.getByText("Dismiss me")).toBeVisible();

    act(() => {
      dismissToast(id);
    });
    expect(screen.queryByText("Dismiss me")).toBeNull();
  });
});
