import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalDialog } from "./modal-dialog";

// jsdom does not move focus on showModal, so mimic browsers: open the dialog and focus its first control.
function stubShowModal() {
  const original = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function showModal(
    this: HTMLDialogElement,
  ) {
    this.open = true;
    this.querySelector<HTMLElement>("button, input")?.focus();
  };
  return () => {
    HTMLDialogElement.prototype.showModal = original;
  };
}

describe("ModalDialog", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = stubShowModal();
  });

  afterEach(() => {
    restore();
  });

  it("moves initial focus from the header close button into the body", () => {
    render(
      <ModalDialog onClose={vi.fn()} title="Rename">
        <input aria-label="File name" />
      </ModalDialog>,
    );

    expect(screen.getByRole("textbox", { name: "File name" })).toHaveFocus();
  });

  it("falls back to the footer when the body has nothing focusable", () => {
    render(
      <ModalDialog
        footer={<button type="button">Save</button>}
        onClose={vi.fn()}
        title="Notice"
      >
        <p>Read only</p>
      </ModalDialog>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  });

  it("keeps focus on the close button when nothing else is focusable", () => {
    render(
      <ModalDialog onClose={vi.fn()} title="Info">
        <p>Read only</p>
      </ModalDialog>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("closes only the nested dialog when its native cancel event crosses the React portal", () => {
    const closeParent = vi.fn();
    const closeChild = vi.fn();
    function NestedDialogs() {
      const [parentOpen, setParentOpen] = useState(true);
      const [childOpen, setChildOpen] = useState(false);
      return parentOpen ? (
        <ModalDialog
          onClose={() => {
            closeParent();
            setParentOpen(false);
          }}
          title="Connector details"
        >
          <input aria-label="Account label" defaultValue="Audit account" />
          <button onClick={() => setChildOpen(true)} type="button">
            Connect account
          </button>
          {childOpen ? (
            <ModalDialog
              onClose={() => {
                closeChild();
                setChildOpen(false);
              }}
              title="Connection unavailable"
            >
              <p>Configure this connection before trying again.</p>
            </ModalDialog>
          ) : null}
        </ModalDialog>
      ) : null;
    }
    render(<NestedDialogs />);
    const parent = screen.getByRole("dialog", {
      name: "Connector details",
    });
    fireEvent.click(
      within(parent).getByRole("button", { name: "Connect account" }),
    );
    const child = screen.getByRole("dialog", {
      name: "Connection unavailable",
    });
    expect(child.parentElement).toBe(document.body);
    expect(parent.contains(child)).toBe(false);

    fireEvent(child, new Event("cancel", { cancelable: true }));

    expect(closeChild).toHaveBeenCalledOnce();
    expect(closeParent).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Connection unavailable" }),
    ).toBeNull();
    expect(parent).toBeVisible();
    expect(
      within(parent).getByRole("textbox", { name: "Account label" }),
    ).toHaveValue("Audit account");

    fireEvent(parent, new Event("cancel", { cancelable: true }));

    expect(closeParent).toHaveBeenCalledOnce();
    expect(closeChild).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the native modal before removing it so the browser can restore focus", () => {
    const originalClose = HTMLDialogElement.prototype.close;
    const connectedWhenClosed: boolean[] = [];
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      connectedWhenClosed.push(this.isConnected);
      this.open = false;
    };
    try {
      const { unmount } = render(
        <ModalDialog onClose={vi.fn()} title="Daily report">
          <button type="button">Copy report</button>
        </ModalDialog>,
      );
      unmount();

      expect(connectedWhenClosed).toEqual([true]);
    } finally {
      HTMLDialogElement.prototype.close = originalClose;
    }
  });

  it("restores focus to the opener button on close and falls back to returnFocusTo if opener unmounted", async () => {
    const originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.open = false;
    };
    try {
      function Harness() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button onClick={() => setOpen(true)} type="button">
              Open dialog
            </button>
            {open ? (
              <ModalDialog onClose={() => setOpen(false)} title="Create Room">
                <input aria-label="Room name" />
              </ModalDialog>
            ) : null}
          </>
        );
      }

      render(<Harness />);
      const opener = screen.getByRole("button", { name: "Open dialog" });
      opener.focus();
      fireEvent.click(opener);
      expect(screen.getByRole("textbox", { name: "Room name" })).toHaveFocus();

      fireEvent(
        screen.getByRole("dialog", { name: "Create Room" }),
        new Event("cancel", { cancelable: true }),
      );
      await waitFor(() => expect(opener).toHaveFocus());
    } finally {
      HTMLDialogElement.prototype.close = originalClose;
    }
  });
});
