import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalDialog } from "@/components/ui/modal-dialog";

import { NavigationDrawer } from "./navigation-drawer";

const showModal = HTMLDialogElement.prototype.showModal;
const closeDialog = HTMLDialogElement.prototype.close;

beforeEach(() => {
  const openers = new WeakMap<HTMLDialogElement, Element | null>();
  // jsdom does not implement the browser's modal focus lifecycle.
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    openers.set(this, document.activeElement);
    this.open = true;
    this.querySelector<HTMLElement>("input, button")?.focus();
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
    const opener = openers.get(this);
    const activeModal = [...document.querySelectorAll("dialog[open]")].at(-1);
    if (
      opener instanceof HTMLElement &&
      opener.isConnected &&
      (!activeModal || activeModal.contains(opener))
    ) {
      opener.focus();
    }
  });
});

afterEach(() => {
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = closeDialog;
  vi.unstubAllGlobals();
});

function mobileViewport(initial: boolean) {
  let mobile = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return mobile;
      },
      addEventListener: (_name: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_name: string, listener: () => void) =>
        listeners.delete(listener),
    })),
  );
  return (next: boolean) =>
    act(() => {
      mobile = next;
      listeners.forEach((listener) => listener());
    });
}

function NavigationContent({
  onMount,
  onSelect,
}: {
  onMount: () => (() => void) | void;
  onSelect: () => void;
}) {
  const [filter, setFilter] = useState("");
  useEffect(onMount, [onMount]);
  return (
    <aside aria-label="Collaboration sidebar">
      <input
        aria-label="Filter chats"
        onChange={(event) => setFilter(event.target.value)}
        value={filter}
      />
      <button onClick={onSelect} type="button">
        Open Design room
      </button>
    </aside>
  );
}

function DrawerHarness({
  onClose = () => {},
  onMount = () => {},
}: {
  onClose?: () => void;
  onMount?: () => (() => void) | void;
}) {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const close = () => {
    setOpen(false);
    onClose();
  };
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open Room navigation
      </button>
      <NavigationDrawer
        ariaLabel="Room navigation"
        closeLabel="Close Room navigation"
        onClose={close}
        open={open}
      >
        <NavigationContent onMount={onMount} onSelect={close} />
        <button onClick={() => setNested(true)} type="button">
          Create room
        </button>
        <button
          onClick={() => {
            setNested(true);
            close();
          }}
          type="button"
        >
          Create room and close navigation
        </button>
        {nested ? (
          <ModalDialog onClose={() => setNested(false)} title="Create room">
            <input aria-label="Room name" />
          </ModalDialog>
        ) : null}
      </NavigationDrawer>
      <button type="button">Background action</button>
    </>
  );
}

function openNavigation() {
  const opener = screen.getByRole("button", { name: "Open Room navigation" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Navigation drawer", () => {
  it("uses a native modal on mobile and restores its opener when dismissed", () => {
    mobileViewport(true);
    render(<DrawerHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();

    const opener = openNavigation();
    const dialog = screen.getByRole("dialog", { name: "Room navigation" });
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getByRole("textbox", { name: "Filter chats" }),
    ).toHaveFocus();

    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("dismisses after a room selection, the close control, or a backdrop click", () => {
    mobileViewport(true);
    const onClose = vi.fn();
    render(<DrawerHarness onClose={onClose} />);

    const opener = openNavigation();
    fireEvent.click(screen.getByRole("button", { name: "Open Design room" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();

    openNavigation();
    fireEvent.click(
      screen.getByRole("button", { name: "Close Room navigation" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    openNavigation();
    fireEvent.click(screen.getByRole("dialog", { name: "Room navigation" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("keeps the navigation open when a nested dialog cancels", () => {
    mobileViewport(true);
    render(<DrawerHarness />);
    openNavigation();
    const create = screen.getByRole("button", { name: "Create room" });
    create.focus();
    fireEvent.click(create);
    const nested = screen.getByRole("dialog", { name: "Create room" });
    fireEvent(nested, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "Create room" })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Room navigation" }),
    ).toBeVisible();
    expect(create).toHaveFocus();
  });

  it("keeps a launched dialog visible after its navigation closes", () => {
    mobileViewport(true);
    render(<DrawerHarness />);
    openNavigation();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create room and close navigation",
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Room navigation" }),
    ).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Create room" });
    expect(dialog).toBeVisible();
    expect(
      within(dialog).getByRole("textbox", { name: "Room name" }),
    ).toHaveFocus();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps one navigation tree and its focus across a desktop resize", () => {
    const setMobile = mobileViewport(true);
    const onUnmount = vi.fn();
    const onMount = vi.fn(() => onUnmount);
    render(<DrawerHarness onMount={onMount} />);
    openNavigation();
    const filter = screen.getByRole("textbox", { name: "Filter chats" });
    fireEvent.change(filter, { target: { value: "Design" } });

    setMobile(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Collaboration sidebar" }),
    ).toBeVisible();
    expect(filter).toHaveFocus();
    expect(filter).toHaveValue("Design");
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onUnmount).not.toHaveBeenCalled();

    setMobile(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Filter chats" })).toBeNull();
    openNavigation();
    expect(screen.getByRole("textbox", { name: "Filter chats" })).toBe(filter);
    expect(filter).toHaveValue("Design");
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("leaves desktop navigation nonmodal without taking focus", () => {
    mobileViewport(false);
    const focused = document.createElement("button");
    document.body.append(focused);
    focused.focus();
    const view = render(<DrawerHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Collaboration sidebar" }),
    ).toBeVisible();
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect(focused).toHaveFocus();
    view.unmount();
    focused.remove();
  });
});
