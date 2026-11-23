import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TeamHubVoiceCapture } from "@/features/teamhub/teamhub-types";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { useVoiceControlState } from "./use-voice-control-state";
import { useVoiceSessionLifecycle } from "./use-voice-session-lifecycle";

const recording = {
  id: "capture-1",
  room_id: "room-1",
  voice_session_id: "voice-1",
  status: "recording",
  created_at: "2026-11-23T08:00:00Z",
  updated_at: "2026-11-23T08:00:00Z",
  requested_start_offset_ms: 0,
  gap_count: 0,
  gap_duration_ms: 0,
} as TeamHubVoiceCapture;

describe("leaving the page", () => {
  it("keeps a recording without a voice session out of saving", async () => {
    const runtime = createTestTeamHubRuntime();
    const { result } = renderHook(() => {
      const state = useVoiceControlState("tenant-northstar", runtime);
      const lifecycle = useVoiceSessionLifecycle(
        state,
        runtime,
        "tenant-northstar",
        async () => undefined,
        async () => undefined,
      );
      return { state, lifecycle };
    });
    // The microphone is still connecting, so no voice session exists yet.
    result.current.state.refs.enablePromiseRef.current = Promise.resolve();
    act(() => result.current.state.setCapture(recording));
    await act(async () => result.current.lifecycle.leavePage());
    // No Stop is sent, so nothing would ever end a saving state.
    expect(result.current.state.captureState.status).toBe("recording");
  });
});
