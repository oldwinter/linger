import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { LibrarySubpageShell } from "./library-subpage-shell";
import { WorkspaceTreeContext } from "./workspace-tree";

function renderShell(options: { hasList: boolean; setOpen?: () => void }) {
  const setOpen = options.setOpen ?? vi.fn();
  const router = createMemoryRouter(
    [
      {
        element: (
          <WorkspaceTreeContext
            value={{ hasList: options.hasList, open: false, setOpen }}
          >
            <LibrarySubpageShell
              backLabel="Back to meetings"
              backTo="/t/tenant-northstar/library?tab=meetings"
              headerActions={<a href="/related">Related view</a>}
              subtitle="Check the details below."
              title="Subpage title"
            >
              <p>Body content</p>
            </LibrarySubpageShell>
          </WorkspaceTreeContext>
        ),
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return { setOpen };
}

describe("LibrarySubpageShell", () => {
  it("renders scrollable main, top Back link, heading, and mobile drawer trigger when a sidebar exists", () => {
    const setOpen = vi.fn();
    renderShell({ hasList: true, setOpen });

    expect(screen.getByRole("main")).toHaveClass("overflow-y-auto");
    expect(
      screen.getByRole("heading", { level: 1, name: "Subpage title" }),
    ).toBeVisible();
    expect(screen.getByText("Check the details below.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to meetings" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/library?tab=meetings");

    const opener = screen.getByRole("button", { name: "Open Library pages" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(opener);
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it("omits the mobile drawer trigger when the route has no Library sidebar", () => {
    renderShell({ hasList: false });

    expect(
      screen.queryByRole("button", { name: "Open Library pages" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Back to meetings" }),
    ).toBeVisible();
  });
});
