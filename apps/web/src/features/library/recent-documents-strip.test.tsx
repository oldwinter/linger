import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";

import {
  type RecentDocument,
  readRecentDocuments,
  writeRecentDocuments,
} from "./recent-documents";
import { RecentDocumentsStrip } from "./recent-documents-strip";

const STORAGE_KEY = "library-recent-documents.v1:account-a";

function entry(id: string, name: string): RecentDocument {
  return { formatLabel: "md", id, name, openedAt: "2026-07-24T10:00:00Z" };
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
      <MemoryRouter initialEntries={["/t/tenant-a/library"]}>
        <LocationProbe />
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

  it("forgets one Document and keeps the rest in order", () => {
    writeRecentDocuments("account-a", [
      entry("document-design", "Design notes"),
      entry("document-plan", "Q3 plan"),
      entry("document-brief", "Brief"),
    ]);
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Forget Q3 plan" }));

    const strip = screen.getByRole("region", { name: "Recently opened" });
    expect(
      within(strip)
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual(["Design notes, md", "Brief, md"]);
    expect(readRecentDocuments("account-a").map((row) => row.id)).toEqual([
      "document-design",
      "document-brief",
    ]);
  });

  it("does not open the Document when it is forgotten", () => {
    writeRecentDocuments("account-a", [
      entry("document-design", "Design notes"),
      entry("document-plan", "Q3 plan"),
    ]);
    renderStrip();

    fireEvent.click(
      screen.getByRole("button", { name: "Forget Design notes" }),
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-a/library",
    );
  });

  it("moves focus to the next entry when one is forgotten", () => {
    writeRecentDocuments("account-a", [
      entry("document-design", "Design notes"),
      entry("document-plan", "Q3 plan"),
      entry("document-brief", "Brief"),
    ]);
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Forget Q3 plan" }));

    expect(screen.getByRole("button", { name: "Forget Brief" })).toHaveFocus();
  });

  it("moves focus to the previous entry when the last one is forgotten", () => {
    writeRecentDocuments("account-a", [
      entry("document-design", "Design notes"),
      entry("document-plan", "Q3 plan"),
      entry("document-brief", "Brief"),
    ]);
    renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Forget Brief" }));

    expect(
      screen.getByRole("button", { name: "Forget Q3 plan" }),
    ).toHaveFocus();
  });

  it("announces an empty strip after the last Document is forgotten", () => {
    writeRecentDocuments("account-a", [
      entry("document-design", "Design notes"),
    ]);
    renderStrip();

    fireEvent.click(
      screen.getByRole("button", { name: "Forget Design notes" }),
    );

    const strip = screen.getByRole("region", { name: "Recently opened" });
    expect(within(strip).queryAllByRole("link")).toHaveLength(0);
    expect(within(strip).queryByRole("button", { name: "Clear" })).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No recently opened documents");
    expect(status).toHaveFocus();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("navigates when the format label is clicked", () => {
    writeRecentDocuments("account-a", [
      entry("document-design", "Design notes"),
    ]);
    renderStrip();

    const strip = screen.getByRole("region", { name: "Recently opened" });
    fireEvent.click(within(strip).getByText("md"));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/t/tenant-a/documents/document-design",
    );
  });

  it("gives the Forget control a comfortable target", () => {
    writeRecentDocuments("account-a", [
      entry("document-design", "Design notes"),
    ]);
    renderStrip();

    expect(
      screen.getByRole("button", { name: "Forget Design notes" }),
    ).toHaveClass("size-6");
  });
});
