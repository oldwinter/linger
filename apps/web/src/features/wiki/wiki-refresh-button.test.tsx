import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import {
  deferred,
  loggedInWikiRuntime,
  renderWikiSurfaces,
  serveWikiDocuments,
  serveWikiStatus,
  wikiDocument,
  wikiStatus,
} from "./wiki.test-support";

const refreshPath = "/v0/tenants/{tenantId}/personal-wiki/refresh" as const;

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

it("asks for a refresh, disables the button, and reloads the Wiki queries", async () => {
  const runtime = await loggedInWikiRuntime();
  const documents = serveWikiDocuments(runtime).mockResolvedValue({
    items: [wikiDocument("project-one", "Launch", "wiki_page")],
    page: { has_more: false },
  });
  const status = serveWikiStatus(runtime).mockResolvedValue(wikiStatus());
  const response = deferred<unknown>();
  runtime.server.on("POST", refreshPath, () => response.promise);
  renderWikiSurfaces(runtime);
  const button = await screen.findByRole("button", { name: "Refresh Wiki" });
  await waitFor(() => expect(status).toHaveBeenCalled());
  const statusReads = status.mock.calls.length;
  const documentReads = documents.mock.calls.length;

  fireEvent.click(button);

  await waitFor(() => expect(button).toBeDisabled());
  expect(runtime.server.requestsTo("POST", refreshPath)).toHaveLength(1);
  response.resolve({ outcome: "accepted" });
  expect(await screen.findByText("Wiki refresh started.")).toBeVisible();
  await waitFor(() =>
    expect(status.mock.calls.length).toBeGreaterThan(statusReads),
  );
  expect(documents.mock.calls.length).toBeGreaterThan(documentReads);
});

it("disables Refresh Wiki while a refresh runs", async () => {
  const runtime = await loggedInWikiRuntime();
  serveWikiStatus(runtime).mockResolvedValue(
    wikiStatus({ state: "refreshing" }),
  );
  renderWikiSurfaces(runtime);
  expect(
    await screen.findByRole("button", { name: "Refreshing…" }),
  ).toBeDisabled();
});

it("shows a refused refresh instead of ignoring it", async () => {
  const runtime = await loggedInWikiRuntime();
  serveWikiStatus(runtime).mockResolvedValue(wikiStatus());
  runtime.server.on("POST", refreshPath, () =>
    teamHubErrorResponse(
      409,
      "CONFLICT",
      "Wiki refresh conflicts with current state",
    ),
  );
  renderWikiSurfaces(runtime);
  fireEvent.click(await screen.findByRole("button", { name: "Refresh Wiki" }));
  expect(
    await screen.findByText("Wiki refresh conflicts with current state"),
  ).toBeVisible();
});
