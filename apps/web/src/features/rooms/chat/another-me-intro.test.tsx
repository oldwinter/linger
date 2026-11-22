import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";

import { AnotherMeIntro } from "./another-me-intro";

function renderIntro(onDone = vi.fn(), name = "Linger") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamHubRuntimeProvider runtime={createTestTeamHubRuntime()}>
        <AnotherMeIntro
          agent={{ display_name: name, id: "actor-another-me" }}
          humanName="Bob"
          onDone={onDone}
        />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return onDone;
}

describe("AnotherMeIntro", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("greets the Human by name, then finishes on its own", async () => {
    const onDone = renderIntro();

    expect(screen.getByRole("status")).toHaveTextContent("Hi, BobI'm Linger.");
    await act(() => vi.advanceTimersByTime(2000));
    expect(onDone).not.toHaveBeenCalled();
    // jsdom has no Web Animations, so leaving completes at once.
    await act(() => vi.advanceTimersByTime(400));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("introduces a custom Agent name", () => {
    renderIntro(vi.fn(), "Helper");
    expect(screen.getByRole("status")).toHaveTextContent("Hi, BobI'm Helper.");
  });

  it("can be skipped with Escape", () => {
    const onEscape = renderIntro();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
