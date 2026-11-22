import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingEntry } from "./recording-entry";
import {
  VoiceCapabilitiesContext,
  VoiceConnectionRetryContext,
  VoiceControlContext,
  type VoiceControlContextValue,
} from "./voice-control-context";

afterEach(cleanup);

function renderEntry(retryConnection?: () => void) {
  return render(
    <VoiceCapabilitiesContext value={undefined}>
      <VoiceConnectionRetryContext value={retryConnection}>
        <RecordingEntry
          anotherMeRoomId="another-me"
          tenantId="tenant-northstar"
        />
      </VoiceConnectionRetryContext>
    </VoiceCapabilitiesContext>,
  );
}

describe("RecordingEntry voice connection", () => {
  it("spins without offering a retry while voice connects", () => {
    renderEntry();
    const button = screen.getByRole("button", { name: "Meetings" });
    expect(button).toBeDisabled();
    expect(button.querySelector(".town-spinner")).not.toBeNull();
    expect(button.querySelector(".xs-nav-btn-label")).toHaveTextContent(
      "Meetings",
    );
  });

  it("retries a failed connection from the Meetings entry and keeps visible label aligned", () => {
    const retry = vi.fn();
    renderEntry(retry);
    const button = screen.getByRole("button", {
      name: "Retry voice connection",
    });
    expect(button).toBeEnabled();
    expect(button.querySelector(".xs-nav-btn-label")).toHaveTextContent(
      "Retry voice connection",
    );
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("aligns visible label with active recording state and renders start errors visibly with dismiss", async () => {
    const selectTargetRoom = vi
      .fn()
      .mockRejectedValueOnce(new Error("Microphone is busy"));
    const voice = {
      captureState: { status: "idle" },
      composerMicrophoneActive: false,
      listenerStatus: "listening",
      selectTargetRoom,
    } as unknown as VoiceControlContextValue;

    const { rerender } = render(
      <VoiceControlContext value={voice}>
        <RecordingEntry
          anotherMeRoomId="another-me"
          tenantId="tenant-northstar"
        />
      </VoiceControlContext>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Meetings" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent("Microphone is busy");
    expect(alert.className).not.toMatch(/\bsr-only\b/);

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss recording error" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <VoiceControlContext
        value={{
          ...voice,
          captureState: {
            status: "recording",
            capture: {
              created_at: "2026-10-12T02:00:00Z",
              gap_count: 0,
              gap_duration_ms: 0,
              id: "capture-1",
              requested_start_offset_ms: 0,
              room_id: "another-me",
              status: "recording",
              updated_at: "2026-10-12T02:00:00Z",
              voice_session_id: "voice-session-1",
            },
          },
        }}
      >
        <RecordingEntry
          anotherMeRoomId="another-me"
          tenantId="tenant-northstar"
        />
      </VoiceControlContext>,
    );
    const activeButton = screen.getByRole("button", {
      name: "Return to recording",
    });
    expect(activeButton.querySelector(".xs-nav-btn-label")).toHaveTextContent(
      "Return to recording",
    );
  });
});
