import { fetchDouble } from "@/features/teamhub/teamhub-client-test-support";
import {
  act,
  fireEvent,
  render as renderUi,
  screen,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHttpTeamHubClient,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubVoiceCapture } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { VoiceRecoveryPanel } from "./voice-recovery-panel";

let client: TeamHubClient;
const transport = vi.fn<typeof fetch>();
const render = (ui: ReactElement) => {
  const runtime = { ...createTestTeamHubRuntime(), client };
  return renderUi(ui, {
    wrapper: ({ children }) => (
      <TeamHubRuntimeProvider runtime={runtime}>
        {children}
      </TeamHubRuntimeProvider>
    ),
  });
};
const capture = (id = "capture-a"): TeamHubVoiceCapture => ({
  id,
  room_id: "room",
  voice_session_id: "voice",
  requested_start_offset_ms: 0,
  status: "recovering",
  created_at: "2026-09-10T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
  gap_count: 0,
  gap_duration_ms: 0,
  transcript_recovery_status: "failed",
});
const advance = async (ms = 0) => {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
};
const hang =
  (signals: AbortSignal[]) =>
  async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    if (options?.signal) signals.push(options.signal);
    return new Promise<Response>((_resolve, reject) =>
      options?.signal?.addEventListener(
        "abort",
        () => reject(options.signal?.reason),
        { once: true },
      ),
    );
  };
beforeEach(() => {
  vi.useFakeTimers();
  transport.mockReset();
  client = createHttpTeamHubClient({
    baseUrl: "https://voice.test",
    fetchRequest: fetchDouble((url, init) => transport(url, init)),
  });
});
// src/test/setup.ts unmounts, runs the pending fake timers and frames, then
// restores real timers; dropping them here would stall later files' frames.

describe("transcript recovery request lifecycle", () => {
  it("unlocks a hung recovery request and lets the user retry", async () => {
    const signals: AbortSignal[] = [];
    transport.mockImplementationOnce(hang(signals)).mockResolvedValue(
      new Response(JSON.stringify(capture()), {
        headers: { "content-type": "application/json" },
      }),
    );
    render(<VoiceRecoveryPanel capture={capture()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry transcription" }),
    );
    await advance(5_000);
    expect(signals[0]?.aborted).toBe(true);
    expect(
      screen.getByRole("button", { name: "Retry transcription" }),
    ).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The retry request was not confirmed",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry transcription" }),
    );
    await advance();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts a recovery request on unmount", async () => {
    const signals: AbortSignal[] = [];
    transport.mockImplementation(hang(signals));
    const view = render(<VoiceRecoveryPanel capture={capture()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry transcription" }),
    );
    view.unmount();
    await advance(10_000);
    expect(signals[0]?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("cancels the old Capture request without carrying its pending or error state into the next", async () => {
    const signals: AbortSignal[] = [];
    transport.mockImplementation(hang(signals));
    const view = render(<VoiceRecoveryPanel capture={capture()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry transcription" }),
    );
    view.rerender(<VoiceRecoveryPanel capture={capture("capture-b")} />);
    await advance();
    expect(signals[0]?.aborted).toBe(true);
    expect(
      screen.getByRole("button", { name: "Retry transcription" }),
    ).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("transcript recovery progress", () => {
  it("shows the attempt beside the progress while recovering", () => {
    render(
      <VoiceRecoveryPanel
        capture={{
          ...capture(),
          transcript_recovery_status: "running",
          transcript_recovery_progress_ms: 250,
          transcript_recovery_total_ms: 1000,
          transcript_recovery_attempt: 3,
          transcript_recovery_max_attempts: 8,
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Recovering transcript 25%",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Attempt 3 of 8");
  });
});
