import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { RecordingEntry } from "@/features/rooms/voice-control/recording-entry";
import {
  openRecordingWindow,
  resetRecordingWindowForTest,
} from "@/features/rooms/voice-control/recording-window-store";
import {
  VoiceControlContext,
  type VoiceControlContextValue,
} from "@/features/rooms/voice-control/voice-control-context";
import type { VoiceModeEvent } from "./voice-mode-controller";
import {
  useOptionalVoiceModeSession,
  VoiceModeSessionProvider,
} from "./voice-mode-session";
import { voiceModeExitCeilingMs } from "./voice-mode-session-engine";

const transport = vi.hoisted(() => ({
  receive: undefined as undefined | ((event: VoiceModeEvent) => void),
  close: vi.fn<() => Promise<void>>(async () => undefined),
  open: vi.fn(async () => undefined),
  openLive: vi.fn(async () => undefined),
}));
vi.mock("./live/voice-live-transport", () => ({
  openVoiceLive: async () => {
    await transport.openLive();
    return {
      close: transport.close,
      commit: async () => undefined,
      setMuted: async () => undefined,
    };
  },
}));
vi.mock("./voice-mode-transport", () => ({
  openVoiceMode: async (input: {
    receive: (event: VoiceModeEvent) => void;
  }) => {
    transport.receive = input.receive;
    await transport.open();
    return {
      close: transport.close,
      commit: async () => undefined,
      setMuted: async () => undefined,
    };
  },
}));
const sender = vi.hoisted(() => ({
  keepUnsentVoiceText: vi.fn(),
  sendVoiceTurnToRoom: vi.fn(async () => undefined),
}));
vi.mock("./voice-mode-room-sender", () => sender);

const target = {
  accountId: "account-1",
  roomId: "room-voice",
  roomName: "Codex",
  tenantId: "tenant-northstar",
};
const prefix = { body: "", documentReferences: [], mentions: [] };

type Api = NonNullable<ReturnType<typeof useOptionalVoiceModeSession>>;
let api: Api;
function CaptureApi() {
  const value = useOptionalVoiceModeSession()!;
  api = value;
  return null;
}

/** Stands in for the voice Room's composer while that Room is on screen. */
function VoiceRoomComposer({
  prepareSend,
}: {
  prepareSend: (text: string, id: string) => () => Promise<void>;
}) {
  const { bind } = useOptionalVoiceModeSession()!;
  useEffect(
    () => bind(target.roomId, { onChange: () => undefined, prepareSend }),
    [bind, prepareSend],
  );
  return null;
}

const runtime = createTestTeamHubRuntime();

function renderSession(children?: ReactNode) {
  return render(
    <TeamHubRuntimeProvider runtime={runtime}>
      <VoiceModeSessionProvider>
        <CaptureApi />
        {children}
      </VoiceModeSessionProvider>
    </TeamHubRuntimeProvider>,
  );
}

afterEach(async () => {
  cleanup();
  resetRecordingWindowForTest();
  await act(async () => undefined);
  vi.clearAllMocks();
});

describe("Voice Mode session", () => {
  it.each(["recording", "finalizing"] as const)(
    "releases a %s Meeting before opening Voice Mode",
    async (status) => {
      let released!: () => void;
      const leavePage = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            released = resolve;
          }),
      );
      const hardware = {
        captureState: { status },
        leavePage,
      } as unknown as VoiceControlContextValue;
      render(
        <TeamHubRuntimeProvider runtime={runtime}>
          <VoiceControlContext value={hardware}>
            <VoiceModeSessionProvider>
              <CaptureApi />
            </VoiceModeSessionProvider>
          </VoiceControlContext>
        </TeamHubRuntimeProvider>,
      );
      openRecordingWindow();
      const openWindow = vi.fn();
      act(() => {
        void api.start(
          target,
          prefix,
          { dictation: false, live: true },
          openWindow,
        );
      });
      expect(leavePage).toHaveBeenCalledOnce();
      expect(openWindow).not.toHaveBeenCalled();
      expect(transport.openLive).not.toHaveBeenCalled();

      await act(async () => released());
      await waitFor(() => expect(transport.openLive).toHaveBeenCalledOnce());
      expect(openWindow).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["idle", "Meetings"],
    ["finalizing", "Start a new Meeting"],
  ])(
    "switches from Voice Mode with Meeting %s using %s",
    async (status, label) => {
      let floated!: () => void;
      const floating = new Promise<void>((resolve) => {
        floated = resolve;
      });
      let released!: () => void;
      transport.close.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            released = resolve;
          }),
      );
      const selectTargetRoom = vi.fn(async () => undefined);
      const hardware = {
        captureState: { status },
        composerMicrophoneActive: true,
        leavePage: vi.fn(async () => undefined),
        selectTargetRoom,
      } as unknown as VoiceControlContextValue;
      render(
        <TeamHubRuntimeProvider runtime={runtime}>
          <VoiceControlContext value={hardware}>
            <VoiceModeSessionProvider>
              <CaptureApi />
              <RecordingEntry
                anotherMeRoomId="room-meeting"
                tenantId={target.tenantId}
              />
            </VoiceModeSessionProvider>
          </VoiceControlContext>
        </TeamHubRuntimeProvider>,
      );
      act(() => {
        void api.start(
          target,
          prefix,
          { dictation: false, live: true },
          () => floating,
        );
      });
      await waitFor(() => expect(transport.openLive).toHaveBeenCalledOnce());
      const meetings = screen.getByRole("button", { name: label });
      expect(meetings).toBeEnabled();
      fireEvent.click(meetings);
      expect(transport.close).not.toHaveBeenCalled();
      await act(async () => floated());
      expect(transport.close).toHaveBeenCalledOnce();
      expect(selectTargetRoom).not.toHaveBeenCalled();

      await act(async () => released());
      await waitFor(() =>
        expect(selectTargetRoom).toHaveBeenCalledExactlyOnceWith(
          "room-meeting",
        ),
      );
      expect(api.session).toBeUndefined();
    },
  );

  it("keeps one transport across Room navigation and sends there directly", async () => {
    const dispatch = vi.fn(async () => undefined);
    const prepareSend = vi.fn(() => dispatch);
    const view = renderSession(<VoiceRoomComposer prepareSend={prepareSend} />);
    await act(() => api.start(target, prefix));
    await waitFor(() => expect(transport.open).toHaveBeenCalledOnce());

    act(() =>
      transport.receive?.({
        kind: "turn",
        id: "turn-1",
        text: "First",
        endOffsetMs: 100,
      }),
    );
    expect(prepareSend).toHaveBeenCalledExactlyOnceWith("First", "turn-1");

    // Navigating away unmounts the voice Room's composer, not the session.
    view.rerender(
      <TeamHubRuntimeProvider runtime={runtime}>
        <VoiceModeSessionProvider>
          <CaptureApi />
        </VoiceModeSessionProvider>
      </TeamHubRuntimeProvider>,
    );
    await act(async () => undefined);
    act(() =>
      transport.receive?.({
        kind: "turn",
        id: "turn-2",
        text: "Second",
        endOffsetMs: 200,
      }),
    );
    await waitFor(() =>
      expect(sender.sendVoiceTurnToRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "turn-2",
          target,
          text: "Second",
        }),
      ),
    );
    expect(prepareSend).toHaveBeenCalledOnce();
    expect(transport.open).toHaveBeenCalledOnce();
    expect(transport.close).not.toHaveBeenCalled();
    expect(api.session?.target.roomId).toBe(target.roomId);
  });

  it("ends from anywhere, closing once and keeping unsent words for the Room", async () => {
    renderSession();
    await act(() => api.start(target, prefix));
    await waitFor(() => expect(transport.open).toHaveBeenCalledOnce());
    act(() =>
      transport.receive?.({
        kind: "partial",
        text: "half a thought",
        endOffsetMs: 100,
      }),
    );

    act(() => {
      void api.exit();
    });
    expect(api.session?.closing).toBe(true);
    await waitFor(() => expect(api.session).toBeUndefined());
    expect(transport.close).toHaveBeenCalledOnce();
    expect(sender.keepUnsentVoiceText).toHaveBeenCalledWith(
      target,
      prefix,
      "half a thought",
    );
  });

  it("closes the window after the exit ceiling even when shutdown hangs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      transport.close.mockImplementationOnce(
        () => new Promise(() => undefined),
      );
      renderSession();
      await act(() => api.start(target, prefix));
      await vi.waitFor(() => expect(transport.open).toHaveBeenCalledOnce());
      await act(async () => undefined);
      act(() =>
        transport.receive?.({
          kind: "partial",
          text: "still unsent",
          endOffsetMs: 100,
        }),
      );

      act(() => {
        void api.exit();
      });
      expect(api.session?.closing).toBe(true);
      await act(async () => vi.advanceTimersByTime(voiceModeExitCeilingMs - 1));
      expect(api.session?.closing).toBe(true);
      await act(async () => vi.advanceTimersByTime(1));
      expect(api.session).toBeUndefined();
      expect(sender.keepUnsentVoiceText).toHaveBeenCalledWith(
        target,
        prefix,
        "still unsent",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows only one session at a time", async () => {
    renderSession();
    await act(async () => {
      const started = api.start(target, prefix);
      await api.start({ ...target, roomId: "room-other" }, prefix);
      await started;
    });
    await waitFor(() => expect(transport.open).toHaveBeenCalledOnce());
    expect(api.session?.target.roomId).toBe("room-voice");
  });
});
