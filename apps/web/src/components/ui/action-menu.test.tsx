import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineGlobalProperty } from "@/test/global-properties";

import { ActionMenu, type MenuPlacement } from "./action-menu";

describe("ActionMenu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps hover menus reachable without stealing focus and closes after leaving", async () => {
    render(
      <>
        <input aria-label="Composer" />
        <ActionMenu
          openOnHover
          label="Agent"
          items={[{ label: "Open Agent Info" }]}
        />
      </>,
    );
    const composer = screen.getByRole("textbox", { name: "Composer" });
    composer.focus();
    const trigger = screen.getByRole("button", { name: "Agent" });
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    expect(screen.getByRole("menu")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(composer).toHaveFocus();
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(screen.getByRole("menu"));
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.pointerLeave(screen.getByRole("menu"));
    await vi.waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
  it("dismisses a hover card with Escape while retaining the original input focus", () => {
    render(
      <>
        <input aria-label="Composer" />
        <ActionMenu
          openOnHover
          label="Agent"
          items={[{ label: "Open Agent Info" }]}
        />
      </>,
    );
    const composer = screen.getByRole("textbox", { name: "Composer" });
    composer.focus();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Agent" }), {
      pointerType: "mouse",
    });
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.keyDown(composer, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(composer).toHaveFocus();
  });
  it.each([
    { initialFocusIndex: 1, disabled: false, expected: "Read" },
    { initialFocusIndex: 1, disabled: true, expected: "Edit" },
    { initialFocusIndex: 5, disabled: false, expected: "Edit" },
    { initialFocusIndex: undefined, disabled: false, expected: "Edit" },
  ])(
    "opens on $expected with initial focus $initialFocusIndex (disabled=$disabled)",
    async ({ initialFocusIndex, disabled, expected }) => {
      render(
        <ActionMenu
          initialFocusIndex={initialFocusIndex}
          items={[{ label: "Edit" }, { label: "Read", disabled }]}
          label="Mode"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Mode" }));
      await vi.waitFor(() =>
        expect(screen.getByRole("menuitem", { name: expected })).toHaveFocus(),
      );
    },
  );

  it("shows a non-action identity header and restores focus on Escape", async () => {
    render(
      <ActionMenu
        header={<p>Jenny Bin · jenny@example.com</p>}
        label="Account menu"
        items={[{ label: "Settings" }, { label: "Log out" }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Account menu" });
    fireEvent.click(trigger);
    expect(screen.getByText("Jenny Bin · jenny@example.com")).toBeVisible();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it.each([
    { triggerLeft: 180, expectedLeft: 218 },
    { triggerLeft: 960, expectedLeft: 722 },
  ])(
    "positions right-start beside the trigger with edge fallback: $triggerLeft",
    ({ triggerLeft, expectedLeft }) => {
      const originalWidth = window.innerWidth;
      const originalHeight = window.innerHeight;
      defineGlobalProperty(window, "innerWidth", {
        configurable: true,
        value: 1024,
      });
      defineGlobalProperty(window, "innerHeight", {
        configurable: true,
        value: 768,
      });
      const bounds = vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: HTMLElement) {
          const trigger = this.tagName === "BUTTON";
          return {
            x: trigger ? triggerLeft : 0,
            y: 700,
            left: trigger ? triggerLeft : 0,
            right: trigger ? triggerLeft + 32 : 232,
            top: 700,
            bottom: trigger ? 732 : 900,
            width: trigger ? 32 : 232,
            height: trigger ? 32 : 200,
            toJSON: () => undefined,
          };
        });
      try {
        render(
          <ActionMenu
            placement="right-start"
            label="Create beside"
            items={[{ label: "New Folder" }]}
          />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Create beside" }));
        expect(screen.getByRole("menu", { name: "Create beside" })).toHaveStyle(
          { left: `${expectedLeft}px`, top: "560px" },
        );
      } finally {
        bounds.mockRestore();
        defineGlobalProperty(window, "innerWidth", {
          configurable: true,
          value: originalWidth,
        });
        defineGlobalProperty(window, "innerHeight", {
          configurable: true,
          value: originalHeight,
        });
      }
    },
  );

  it.each<MenuPlacement>([
    "bottom-end",
    "bottom-start",
    "right-start",
    "top-start",
  ])(
    "keeps %s within a narrow viewport during its entrance animation",
    (placement) => {
      vi.stubGlobal("innerWidth", 390);
      vi.stubGlobal("innerHeight", 640);
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        return this.tagName === "BUTTON"
          ? new DOMRect(350, 590, 32, 32)
          : new DOMRect(0, 0, 220.4, 425.6);
      });
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
        232,
      );
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
        448,
      );
      render(
        <ActionMenu
          placement={placement}
          label="Send to Room"
          items={[{ label: "product-v0" }]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Send to Room" }));

      const menu = screen.getByRole("menu");
      expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(menu.style.left) + 232).toBeLessThanOrEqual(382);
      expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(menu.style.top) + 448).toBeLessThanOrEqual(632);
    },
  );

  it("lets keyboard users reach the last room in a long scrollable menu", async () => {
    const send = vi.fn();
    render(
      <ActionMenu
        label="Send to Room"
        items={Array.from({ length: 30 }, (_, index) => ({
          label: `Room ${index + 1}`,
          onSelect: () => send(index + 1),
        }))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send to Room" }));
    const menu = screen.getByRole("menu");
    const scroller = menu.firstElementChild;
    expect(scroller).toHaveClass(
      "max-h-[min(28rem,calc(100dvh-32px))]",
      "overflow-y-auto",
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Room 1" })).toHaveFocus(),
    );

    fireEvent.keyDown(menu, { key: "End" });
    const lastRoom = screen.getByRole("menuitem", { name: "Room 30" });
    expect(lastRoom).toHaveFocus();
    fireEvent.scroll(scroller!);
    expect(menu).toBeVisible();
    fireEvent.click(lastRoom);

    expect(send).toHaveBeenCalledWith(30);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens nested choices with pointer and keyboard navigation", async () => {
    const selectMarkdown = vi.fn();
    render(
      <ActionMenu
        items={[
          {
            children: [
              { label: "md", onSelect: selectMarkdown },
              { label: "pdf", disabled: true },
              { label: "html", onSelect: vi.fn() },
            ],
            label: "New File",
          },
        ]}
        label="Create"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const menu = await screen.findByRole("menu", { name: "Create" });
    const newFile = within(menu).getByRole("menuitem", { name: "New File" });
    expect(newFile).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.keyDown(newFile, { key: "ArrowRight" });

    let submenu = await screen.findByRole("menu", { name: "New File" });
    expect(submenu).toHaveClass("fixed", "overflow-y-auto");
    expect(menu).not.toContainElement(submenu);
    expect(submenu.parentElement).toBe(menu.parentElement);
    await vi.waitFor(() =>
      expect(
        within(submenu).getByRole("menuitem", { name: "md" }),
      ).toHaveFocus(),
    );
    fireEvent.keyDown(submenu, { key: "ArrowDown" });
    expect(
      within(submenu).getByRole("menuitem", { name: "html" }),
    ).toHaveFocus();
    fireEvent.keyDown(submenu, { key: "Home" });
    expect(within(submenu).getByRole("menuitem", { name: "md" })).toHaveFocus();
    fireEvent.keyDown(submenu, { key: "End" });
    expect(
      within(submenu).getByRole("menuitem", { name: "html" }),
    ).toHaveFocus();
    fireEvent.scroll(submenu);
    expect(submenu).toBeVisible();
    fireEvent.keyDown(submenu, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "New File" })).toBeNull();
    expect(newFile).toHaveFocus();
    fireEvent.keyDown(newFile, { key: "ArrowRight" });
    submenu = await screen.findByRole("menu", { name: "New File" });
    fireEvent.click(within(submenu).getByRole("menuitem", { name: "md" }));
    expect(selectMarkdown).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps a nested menu inside the right and bottom edges", async () => {
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.getAttribute("aria-label") === "Create") {
          return this.tagName === "BUTTON"
            ? new DOMRect(960, 8, 32, 32)
            : new DOMRect(760, 46, 232, 448);
        }
        return this.getAttribute("role") === "menu"
          ? new DOMRect(0, 0, 180, 200)
          : new DOMRect(764, 450, 224, 33);
      },
    );
    render(
      <ActionMenu
        items={[{ children: [{ label: "md" }], label: "New Page" }]}
        label="Create"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "New Page" }));

    expect(screen.getByRole("menu", { name: "New Page" })).toHaveStyle({
      left: "574px",
      top: "392px",
    });
  });

  it("repositions an open submenu with a following parent menu", () => {
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 768);
    let triggerLeft = 40;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.getAttribute("aria-label") === "Create") {
          return this.tagName === "BUTTON"
            ? new DOMRect(triggerLeft, 40, 32, 32)
            : new DOMRect(
                Number.parseFloat(this.style.left),
                Number.parseFloat(this.style.top),
                232,
                120,
              );
        }
        return this.getAttribute("role") === "menu"
          ? new DOMRect(0, 0, 180, 90)
          : new DOMRect(triggerLeft + 4, 82, 224, 33);
      },
    );
    render(
      <ActionMenu
        followAnchor
        items={[{ children: [{ label: "md" }], label: "New Page" }]}
        label="Create"
        placement="bottom-start"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New Page" }));
    expect(screen.getByRole("menu", { name: "New Page" })).toHaveStyle({
      left: "278px",
      top: "82px",
    });

    triggerLeft = 680;
    fireEvent.scroll(window);

    expect(screen.getByRole("menu", { name: "Create" })).toHaveStyle({
      left: "680px",
    });
    expect(screen.getByRole("menu", { name: "New Page" })).toHaveStyle({
      left: "494px",
      top: "82px",
    });
  });

  it("keeps the menu open for an item that asks to stay, then closes on the next", () => {
    const retry = vi.fn();
    render(
      <ActionMenu
        label="Send to Room"
        items={[
          { keepOpen: true, label: "product-v0", onSelect: retry },
          { label: "all" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send to Room" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "product-v0" }));

    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "all" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open when a nested surface scrolls and still closes on viewport resize", () => {
    render(
      <div data-testid="nested-scroll" style={{ height: 48, overflow: "auto" }}>
        <div style={{ height: 240 }}>tall content</div>
        <ActionMenu
          label="Create"
          items={[{ label: "Create Agent" }, { label: "Create Room" }]}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(
      screen.getByRole("menuitem", { name: "Create Agent" }),
    ).toBeVisible();
    screen.getByTestId("nested-scroll").dispatchEvent(new Event("scroll"));
    expect(
      screen.getByRole("menuitem", { name: "Create Agent" }),
    ).toBeVisible();
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps scrollable menus and nested choices inside the open dialog", () => {
    render(
      <dialog aria-label="Peek" open>
        <ActionMenu
          label="Send to Room"
          items={[
            {
              label: "Project",
              children: [{ label: "product-v0" }],
            },
          ]}
        />
      </dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send to Room" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Project" }));

    const dialog = screen.getByRole("dialog", { name: "Peek" });
    const menu = screen.getByRole("menu", { name: "Send to Room" });
    const submenu = screen.getByRole("menu", { name: "Project" });
    expect(dialog).toContainElement(menu);
    expect(dialog).toContainElement(submenu);
    expect(menu).not.toContainElement(submenu);

    fireEvent.scroll(menu.firstElementChild!);
    expect(screen.queryByRole("menu", { name: "Project" })).toBeNull();
    expect(menu).toBeVisible();
  });

  it("omits empty icon columns, marks separators, supports submenu danger/separators and Enter/Space focus, and click-toggles openOnHover", async () => {
    render(
      <ActionMenu
        items={[
          {
            children: [
              { label: "Archive" },
              { danger: true, label: "Delete", separatorBefore: true },
            ],
            label: "More",
          },
          { label: "Rename", separatorBefore: true },
        ]}
        label="Row actions"
        openOnHover
      />,
    );

    const trigger = screen.getByRole("button", { name: "Row actions" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Row actions" });
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
    const rename = within(menu).getByRole("menuitem", { name: "Rename" });
    // No items have icons, so only the label span is rendered inside the item.
    expect(rename.children).toHaveLength(1);

    const more = within(menu).getByRole("menuitem", { name: "More" });
    fireEvent.keyDown(more, { key: "Enter" });
    const submenu = await screen.findByRole("menu", { name: "More" });
    await vi.waitFor(() =>
      expect(
        within(submenu).getByRole("menuitem", { name: "Archive" }),
      ).toHaveFocus(),
    );
    expect(within(submenu).getByRole("separator")).toBeInTheDocument();
    expect(
      within(submenu).getByRole("menuitem", { name: "Delete" }),
    ).toHaveClass("text-destructive");

    // Clicking an openOnHover trigger toggles the menu closed.
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
