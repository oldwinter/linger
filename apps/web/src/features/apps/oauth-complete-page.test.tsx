import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";

import { OAuthCompletePage } from "./oauth-complete-page";

describe("OAuth completion page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  function renderPage(outcome: Promise<void> = Promise.resolve()) {
    const runtime = createTestTeamHubRuntime();
    const complete = vi
      .spyOn(runtime.client, "completeExternalConnectionAuthorization")
      .mockReturnValue(outcome);
    render(
      <TeamHubRuntimeProvider runtime={runtime}>
        <OAuthCompletePage />
      </TeamHubRuntimeProvider>,
    );
    return complete;
  }

  it("shows Finishing authorization while pending, then Authorization complete and closes on success", async () => {
    window.history.replaceState(
      null,
      "",
      "/oauth/composio-complete?status=success&connected_account_id=ca_returned",
    );
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    let resolveComplete!: () => void;
    const outcome = new Promise<void>((resolve) => {
      resolveComplete = resolve;
    });

    const complete = renderPage(outcome);

    expect(complete).toHaveBeenCalledWith("ca_returned");
    expect(
      screen.getByRole("heading", { name: "Finishing authorization…" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Authorization complete" }),
    ).toBeNull();
    expect(close).not.toHaveBeenCalled();

    resolveComplete();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(
      screen.getByRole("heading", { name: "Authorization complete" }),
    ).toBeVisible();
    expect(screen.getByText("You can close this window.")).toBeVisible();
  });

  it("checks every pending authorization when the callback names none, shows an error state, and closes on failure", async () => {
    window.history.replaceState(null, "", "/oauth/composio-complete");
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);

    const complete = renderPage(Promise.reject(new Error("offline")));

    expect(complete).toHaveBeenCalledWith(undefined);
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Authorization could not be confirmed",
    );
    expect(
      screen.queryByRole("heading", { name: "Authorization complete" }),
    ).toBeNull();
  });
});
