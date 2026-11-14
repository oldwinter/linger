import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";

import { type RecentDocument, writeRecentDocuments } from "./recent-documents";
import { RecentDocumentsStrip } from "./recent-documents-strip";

const STORAGE_KEY = "library-recent-documents.v1:account-a";

function entry(id: string, name: string): RecentDocument {
  return { formatLabel: "md", id, name, openedAt: "2026-07-24T10:00:00Z" };
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
        <RecentDocumentsStrip tenantId="tenant-a" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Recently opened strip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows stored Documents with their format and a link", () => {
    writeRecentDocuments("account-a", [
      entry("document-design", "Design notes"),
      entry("document-plan", "Q3 plan"),
    ]);
    renderStrip();

    const strip = screen.getByRole("region", { name: "Recently opened" });
    const links = within(strip).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/t/tenant-a/documents/document-design",
      "/t/tenant-a/documents/document-plan",
    ]);
    expect(
      within(strip).getByRole("link", { name: "Design notes, md" }),
    ).toBeVisible();
    expect(within(strip).getByRole("button", { name: "Clear" })).toBeVisible();
  });

  it("renders nothing before the person has opened a Document", () => {
    renderStrip();

    expect(
      screen.queryByRole("region", { name: "Recently opened" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();
  });

  it("clears the strip and the stored list", () => {
    writeRecentDocuments("account-a", [
      entry("document-design", "Design notes"),
    ]);
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(
      screen.queryByRole("region", { name: "Recently opened" }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
