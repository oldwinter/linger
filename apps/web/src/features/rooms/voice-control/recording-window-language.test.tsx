import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubVoiceCaptureQuestion } from "@/features/teamhub/teamhub-types";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { resetVoicePipForTest } from "../chat/voice-mode/voice-pip";
import RecordingWindow from "./recording-window";
import {
  openRecordingWindow,
  resetRecordingWindowForTest,
} from "./recording-window-store";
import {
  VoiceControlContext,
  type VoiceControlContextValue,
} from "./voice-control-context";

const zh = zhCN.recording;
const common = zhCN.common;

const capture = {
  created_at: "2026-10-12T02:00:00Z",
  gap_count: 2,
  gap_duration_ms: 4_000,
  id: "capture-1",
  requested_start_offset_ms: 60_000,
  room_id: "room-1",
  status: "recording" as const,
  updated_at: "2026-10-12T02:00:00Z",
  voice_session_id: "voice-session-1",
};

function voiceValue(
  overrides: Partial<VoiceControlContextValue> = {},
): VoiceControlContextValue {
  return {
    acquireComposerMicrophone: vi.fn(async () => async () => undefined),
    boundDevice: { deviceId: "mic", groupId: "group", label: "Mic" },
    captureSyncStatus: "live",
    captureState: { status: "recording", capture },
    composerMicrophoneActive: false,
    connectDevice: vi.fn(async () => undefined),
    devices: [],
    discoverDevices: vi.fn(async () => []),
    disconnectDevice: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    leavePage: vi.fn(async () => undefined),
    listenerStatus: "listening",
    selectedDeviceId: "mic",
    microphoneMuted: false,
    setMicrophoneMuted: vi.fn(async () => undefined),
    selectDevice: vi.fn(async () => undefined),
    startCapture: vi.fn(async () => undefined),
    startNewCapture: vi.fn(async () => undefined),
    stopCapture: vi.fn(async () => undefined),
    targetAgentName: "Another Me",
    transcriptItems: [
      {
        createdAtMs: 1,
        id: "speech",
        speakerLabel: "Speaker 2",
        text: "Budget set at 200k",
      },
    ],
    transcriptStatus: "live",
    ...overrides,
  };
}

function renderWindow(voice: VoiceControlContextValue) {
  const runtime = createTestTeamHubRuntime();
  const asked: TeamHubVoiceCaptureQuestion[] = [];
  runtime.server
    .on("GET", "/v0/voice-captures/{captureSessionId}/questions", () => ({
      items: structuredClone(asked),
    }))
    .on("POST", "/v0/voice-captures/{captureSessionId}/questions", () => {
      const answer: TeamHubVoiceCaptureQuestion = {
        answer: "Budget is 200k.",
        answered: true,
        created_at: "2026-10-12T02:03:00Z",
        cutoff_offset_ms: 185_000,
        id: "q1",
        kind: "answer",
        question: "How was the budget settled?",
        sources: [],
      };
      asked.push(answer);
      return answer;
    });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <VoiceControlContext value={voice}>
          <RecordingWindow />
        </VoiceControlContext>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetRecordingWindowForTest();
  resetVoicePipForTest();
  openRecordingWindow();
});

afterEach(() => {
  cleanup();
  resetLanguageForTest();
});

describe("Recording window in the language on screen", () => {
  it("words a running recording in Chinese and keeps Stop unmarked", async () => {
    await setLanguage("zh-CN");
    renderWindow(voiceValue());

    const frame = screen.getByRole("region", { name: zh.window });
    expect(within(frame).getByText(zh.meeting)).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: zh.surface }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh.minimize })).toHaveAttribute(
      "title",
      zh.minimizeHint,
    );
    expect(
      screen.getByRole("button", { name: zh.pauseRecording }),
    ).toHaveTextContent(zh.pause);
    // Stopping asks first, so the button is no voice close and no risk.
    const stop = screen.getByRole("button", { name: zh.stopRecording });
    expect(stop).toHaveTextContent(zh.stop);
    expect(stop).not.toHaveAttribute("data-voice-close");
    expect(stop).not.toHaveAttribute("data-voice-risk");

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      zh.transcriptTab,
      zh.askTab,
    ]);
    const transcript = screen.getByRole("log", { name: zh.transcript });
    expect(
      within(transcript).getByText(zh.speaker.replace("{number}", "2")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        zh.inputMissed.other.replace("{count}", "2").replace("{seconds}", "4"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: zh.resizeWindow }),
    ).toHaveAttribute("title", zhCN.voiceWindow.resizeHint);

    fireEvent.click(stop);
    expect(
      screen.getByRole("alertdialog", { name: zh.confirmStopTitle }),
    ).toHaveTextContent(zh.confirmStopBody);
    expect(
      screen.getByRole("button", { name: zh.stopAndSave }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: zh.keepRecording }),
    ).toBeInTheDocument();
  });

  it("marks Close as the window's close once the recording is over", async () => {
    await setLanguage("zh-CN");
    renderWindow(voiceValue({ captureState: { status: "idle" } }));

    const close = screen.getByRole("button", { name: zh.closeRecording });
    expect(close).toHaveTextContent(common.close);
    expect(close).toHaveAttribute("data-voice-close");
    expect(
      screen.getByRole("button", { name: zh.startRecording }),
    ).toBeInTheDocument();
  });

  it("asks in Chinese, marks sending a question, and times the answer", async () => {
    await setLanguage("zh-CN");
    renderWindow(voiceValue());

    fireEvent.click(screen.getByRole("tab", { name: zh.askTab }));
    expect(screen.getByRole("list", { name: zh.answers })).toHaveTextContent(
      zh.askEmpty,
    );
    const box = screen.getByRole("textbox", { name: zh.askLabel });
    expect(box).toHaveAttribute("placeholder", zh.askPlaceholder);
    const send = screen.getByRole("button", { name: zh.sendQuestion });
    expect(send).toHaveAttribute("data-voice-risk", "never");

    fireEvent.change(box, { target: { value: "How was the budget settled?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    const answers = screen.getByRole("list", { name: zh.answers });
    expect(await within(answers).findByText("Budget is 200k.")).toBeVisible();
    expect(
      within(answers).getByText(zh.basedOnRecording.replace("{time}", "02:05")),
    ).toBeVisible();
  });
});
