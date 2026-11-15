import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import {
  VoiceControlContext,
  type VoiceCaptureState,
  type VoiceControlContextValue,
  type VoiceTranscriptItem,
} from "./voice-control-context";
import { VoiceFocusSurface } from "./voice-focus-surface";
import { HearingPage } from "./hearing-page";

const capture = {
  created_at: "2026-11-14T09:00:00Z",
  gap_count: 0,
  gap_duration_ms: 0,
  id: "capture-1",
  requested_start_offset_ms: 0,
  room_id: "room-1",
  status: "recording" as const,
  updated_at: "2026-11-14T09:00:00Z",
  voice_session_id: "voice-1",
};

function line(id: string, text: string): VoiceTranscriptItem {
  return { createdAtMs: 1, id, text };
}

function voiceValue(
  transcriptItems: VoiceTranscriptItem[],
  partialTranscript?: string,
): VoiceControlContextValue {
  const captureState: VoiceCaptureState = { capture, status: "recording" };
  return {
    acquireComposerMicrophone: async () => async () => undefined,
    captureState,
    captureSyncStatus: "live",
    composerMicrophoneActive: false,
    connectDevice: async () => undefined,
    devices: [],
    discoverDevices: async () => [],
    disconnectDevice: async () => undefined,
    disable: async () => undefined,
    enable: async () => undefined,
    listenerStatus: "listening",
    microphoneMuted: false,
    partialTranscript,
    selectDevice: async () => undefined,
    selectedDeviceId: "",
    setMicrophoneMuted: async () => undefined,
    startCapture: async () => undefined,
    startNewCapture: async () => undefined,
    stopCapture: async () => undefined,
    transcriptItems,
    transcriptStatus: "live",
  };
}

function renderHearing(value?: VoiceControlContextValue) {
  const router = createMemoryRouter(
    [
      {
        element: value ? (
          <VoiceControlContext.Provider value={value}>
            <HearingPage />
          </VoiceControlContext.Provider>
        ) : (
          <HearingPage />
        ),
        path: "/t/:tenantId/hearing",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/hearing"] },
  );
  render(<RouterProvider router={router} />);
}

describe("Right now", () => {
  it("shows the latest words and the ones still arriving", async () => {
    renderHearing(
      voiceValue(
        [line("a", "Hello"), line("b", "The budget is set")],
        "and the date",
      ),
    );
    expect(await screen.findByText("The budget is set")).toHaveClass(
      "text-2xl",
    );
    expect(screen.getByText("and the date")).toBeVisible();
    expect(
      screen.getByRole("list", { name: "Earlier in this recording" }),
    ).toHaveTextContent("Hello");
  });

  it("says when nothing is being heard", async () => {
    renderHearing();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nothing is being heard.",
    );
  });

  it("opens from a recording that is underway", async () => {
    const router = createMemoryRouter(
      [
        {
          element: (
            <VoiceControlContext.Provider
              value={voiceValue([line("a", "Hello")])}
            >
              <VoiceFocusSurface onExit={() => undefined} />
            </VoiceControlContext.Provider>
          ),
          path: "/t/:tenantId/rooms/:roomId/chat",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/rooms/room-1/chat"] },
    );
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole("link", { name: "See it large" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/hearing");
  });
});
