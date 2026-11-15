import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";

import {
  type RecentWikiPage,
  readRecentWikiPages,
  writeRecentWikiPages,
} from "./recent-wiki-pages";
import { RecentWikiPagesStrip } from "./recent-wiki-pages-strip";

const STORAGE_KEY = "wiki-recent-pages.v1:account-a";

function entry(id: string, name: string, path: string): RecentWikiPage {
  return { id, name, openedAt: "2026-07-24T10:00:00Z", path };
}

function pageEntries() {
  return [
    entry("document-design", "Design notes", "/t/tenant-a/documents/design"),
    entry("document-plan", "Q3 plan", "/t/tenant-a/documents/plan"),
    entry("document-brief", "Brief", "/t/tenant-a/documents/brief"),
  ];
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
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
      <MemoryRouter initialEntries={["/t/tenant-a/wiki"]}>
        <LocationProbe />
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
    expect(
      screen.queryByText("No recently opened pages"),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("forgets one page and keeps the rest in order", () => {
    writeRecentWikiPages("account-a", pageEntries());
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Forget Q3 plan" }));

    const strip = screen.getByRole("region", {
      name: "Recently opened Wiki pages",
    });
    expect(
      within(strip)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Design notes", "/t/tenant-a/documents/design"],
      ["Brief", "/t/tenant-a/documents/brief"],
    ]);
    expect(readRecentWikiPages("account-a").map((row) => row.id)).toEqual([
      "document-design",
      "document-brief",
    ]);
  });

  it("does not open the page when it is forgotten", () => {
    writeRecentWikiPages("account-a", pageEntries());
    renderStrip();

    fireEvent.click(
      screen.getByRole("button", { name: "Forget Design notes" }),
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-a/wiki",
    );
  });

  it("moves focus to the next entry when one is forgotten", () => {
    writeRecentWikiPages("account-a", pageEntries());
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Forget Q3 plan" }));

    expect(screen.getByRole("button", { name: "Forget Brief" })).toHaveFocus();
  });

  it("moves focus to the previous entry when the last one is forgotten", () => {
    writeRecentWikiPages("account-a", pageEntries());
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Forget Brief" }));

    expect(
      screen.getByRole("button", { name: "Forget Q3 plan" }),
    ).toHaveFocus();
  });

  it("announces an empty strip after the last page is forgotten", () => {
    writeRecentWikiPages("account-a", [
      entry("document-design", "Design notes", "/t/tenant-a/documents/design"),
    ]);
    renderStrip();

    fireEvent.click(
      screen.getByRole("button", { name: "Forget Design notes" }),
    );

    const strip = screen.getByRole("region", {
      name: "Recently opened Wiki pages",
    });
    expect(within(strip).queryAllByRole("link")).toHaveLength(0);
    expect(within(strip).queryByRole("button", { name: "Clear" })).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No recently opened pages");
    expect(status).toHaveFocus();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("gives the Forget control a comfortable target", () => {
    writeRecentWikiPages("account-a", pageEntries());
    renderStrip();

    expect(
      screen.getByRole("button", { name: "Forget Design notes" }),
    ).toHaveClass("size-6");
  });
});
