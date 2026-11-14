import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoomUnreadJump } from "./room-unread-jump";

describe("Jump to new messages", () => {
  it("reports the jump and keeps the positioning on its wrapper", () => {
    const onJump = vi.fn();
    render(<RoomUnreadJump onJump={onJump} />);
    const button = screen.getByRole("button", { name: "Jump to new messages" });
    // Button already carries `relative`, so the wrapper owns the absolute spot.
    expect(button).not.toHaveClass("absolute");
    expect(button.parentElement).toHaveClass("absolute");
    fireEvent.click(button);
    expect(onJump).toHaveBeenCalledOnce();
  });
});
