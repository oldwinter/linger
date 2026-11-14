import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from "react-router";

import {
  VoiceControlContext,
  type VoiceCaptureState,
  type VoiceControlContextValue,
  type VoiceTranscriptItem,
} from "./voice-control-context";
import { readSpeakerNames } from "./speaker-names";
import { VoiceFocusSurface } from "./voice-focus-surface";
import { WhoIsSpeakingPage } from "./who-is-speaking-page";

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

function line(
  id: string,
  speakerId: string,
  text: string,
): VoiceTranscriptItem {
  const number = speakerId.slice("spk_".length);
  return {
    captureId: capture.id,
    createdAtMs: 1,
    id,
    speakerId,
    speakerLabel: `Speaker ${number}`,
    text,
  };
}

function voiceValue(
  transcriptItems: VoiceTranscriptItem[],
): VoiceControlContextValue {
  const captureState: VoiceCaptureState = {
    capture,
    status: "recording",
  };
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

describe("Who is speaking", () => {
  it("names a voice and the open recording uses that name", async () => {
    localStorage.clear();
    const items = [
      line("a", "spk_2", "The budget is set."),
      line("b", "spk_1", "I can send the note."),
    ];
    const router = createMemoryRouter(
      [
        {
          element: (
            <VoiceControlContext.Provider value={voiceValue(items)}>
              <WhoIsSpeakingPage />
            </VoiceControlContext.Provider>
          ),
          path: "/t/:tenantId/voices",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/voices"] },
    );
    const page = render(<RouterProvider router={router} />);

    const field = await screen.findByLabelText("Speaker 2");
    fireEvent.change(field, { target: { value: "Maya Chen" } });
    expect(screen.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
    expect(screen.getByText("The budget is set.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Use these names" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "This recording will use those names.",
    );
    expect(readSpeakerNames("capture-1")).toEqual({ spk_2: "Maya Chen" });
    page.unmount();

    render(
      <MemoryRouter initialEntries={["/t/tenant-northstar/rooms/room-1/chat"]}>
        <Routes>
          <Route
            element={
              <VoiceControlContext.Provider value={voiceValue(items)}>
                <VoiceFocusSurface onExit={() => undefined} />
              </VoiceControlContext.Provider>
            }
            path="/t/:tenantId/*"
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Maya Chen")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Name the voices" }),
    ).toHaveAttribute("href", "/t/tenant-northstar/voices");
    localStorage.clear();
  });

  it("says when a recording has not heard anyone yet", async () => {
    const router = createMemoryRouter(
      [
        {
          element: (
            <VoiceControlContext.Provider value={voiceValue([])}>
              <WhoIsSpeakingPage />
            </VoiceControlContext.Provider>
          ),
          path: "/t/:tenantId/voices",
        },
      ],
      { initialEntries: ["/t/tenant-northstar/voices"] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "No voices yet.",
    );
  });
});
