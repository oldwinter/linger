import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";

import { type RecentWikiPage, writeRecentWikiPages } from "./recent-wiki-pages";
import { RecentWikiPagesStrip } from "./recent-wiki-pages-strip";

const STORAGE_KEY = "wiki-recent-pages.v1:account-a";

function entry(id: string, name: string, path: string): RecentWikiPage {
  return { id, name, openedAt: "2026-07-24T10:00:00Z", path };
}

function renderStrip() {
  const queryClient = new QueryClient();
  // The shell's route loader caches the identity before any page renders.
  queryClient.setQueryData(teamHubIdentityQueryKey, {
    account: {
      created_at: "2026-07-24T09:00:00Z",
      email: "jenny@northstar.example",
      id: "account-a",
    },
    actors: [],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RecentWikiPagesStrip />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Recently opened Wiki pages strip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("links the stored pages in their recorded order", () => {
    writeRecentWikiPages("account-a", [
      entry("document-design", "Design notes", "/t/tenant-a/documents/design"),
      entry(
        "projects/lev8.md",
        "Lev8",
        "/t/tenant-a/wiki-preview?page=projects%2Flev8.md",
      ),
    ]);
    renderStrip();

    const strip = screen.getByRole("region", {
      name: "Recently opened Wiki pages",
    });
    expect(
      within(strip)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Design notes", "/t/tenant-a/documents/design"],
      ["Lev8", "/t/tenant-a/wiki-preview?page=projects%2Flev8.md"],
    ]);
    expect(within(strip).getByRole("button", { name: "Clear" })).toBeVisible();
  });

  it("renders nothing before the person has opened a Wiki page", () => {
    renderStrip();

    expect(
      screen.queryByRole("region", { name: "Recently opened Wiki pages" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();
  });

  it("clears the strip and the stored list", () => {
    writeRecentWikiPages("account-a", [
      entry("document-design", "Design notes", "/t/tenant-a/documents/design"),
    ]);
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(
      screen.queryByRole("region", { name: "Recently opened Wiki pages" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
