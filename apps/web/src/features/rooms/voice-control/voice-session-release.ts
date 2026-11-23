import { teamHubData } from "@/features/teamhub/teamhub-api";
import {
  TeamHubError,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import type {
  TeamHubVoiceCapture,
  TeamHubVoiceSession,
} from "@/features/teamhub/teamhub-types";
import {
  VoiceRequestScope,
  waitForVoiceDelay,
} from "@/features/teamhub/voice-request-scope";
import { asError } from "@linger/service-kit";

/** Stop attempts that leave the Capture recording before the release gives up. */
const voiceStopAttempts = 3;
// Stop attempts start at least this far apart, so a blip of a few seconds
// passes unreported, while a lasting failure, even one whose requests hang
// until they time out, is reported within about 30 seconds.
const voiceStopRetryDelayMs = 5_000;

/**
 * The Capture kept recording through every Stop attempt, so it was not saved;
 * the caller may run the release again.
 */
export class VoiceStopError extends Error {
  constructor(cause: unknown) {
    super(asError(cause).message, { cause });
    this.name = "VoiceStopError";
  }
}

export async function releaseVoiceSession(
  client: TeamHubClient,
  session: TeamHubVoiceSession,
  initialCapture: TeamHubVoiceCapture | undefined,
  onStopped?: (capture: TeamHubVoiceCapture) => void,
) {
  let capture = initialCapture;
  const requests = new VoiceRequestScope();
  const deadline = Date.now() + 60_000;
  let failure: unknown;
  let stopFailures = 0;
  let stopStartedAt = 0;
  const recording = () =>
    capture?.voice_session_id === session.id &&
    (capture.status === "starting" || capture.status === "recording");
  for (const delay of [0, 250, 500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000]) {
    let stopping = false;
    if (Date.now() >= deadline) break;
    const wait =
      stopFailures > 0 && recording()
        ? Math.max(delay, stopStartedAt + voiceStopRetryDelayMs - Date.now())
        : delay;
    if (wait > 0) await waitForVoiceDelay(wait);
    try {
      if (capture && recording()) {
        stopping = true;
        stopStartedAt = Date.now();
        try {
          const captureId = capture.id;
          capture = await requests.run((signal) =>
            teamHubData(
              client.api.POST("/v0/voice-captures/{captureSessionId}/stop", {
                params: { path: { captureSessionId: captureId } },
                signal,
                keepalive: true,
              }),
            ),
          );
          onStopped?.(capture);
        } catch (error) {
          if (!(error instanceof TeamHubError) || error.status !== 404)
            throw error;
          capture = undefined;
        }
      }
      await requests.run((signal) =>
        teamHubData(
          client.api.DELETE("/v0/voice-sessions/{voiceSessionId}", {
            params: { path: { voiceSessionId: session.id } },
            signal,
            keepalive: true,
          }),
        ),
      );
      return;
    } catch (error) {
      if (error instanceof TeamHubError && error.status === 404) return;
      failure = error;
      const rejected =
        error instanceof TeamHubError &&
        error.status < 500 &&
        error.status !== 409;
      if (!rejected) {
        try {
          const active = await requests.run((signal) =>
            teamHubData(
              client.api.GET("/v0/rooms/{roomId}/active-voice-capture", {
                params: { path: { roomId: session.room_id } },
                signal,
              }),
            ),
          );
          capture =
            active?.voice_session_id === session.id ? active : undefined;
        } catch {
          // An unread Capture is still the one this release must stop.
        }
      }
      // Only a Stop that left the Capture recording fails the release.
      if (
        stopping &&
        recording() &&
        (rejected || ++stopFailures >= voiceStopAttempts)
      )
        throw new VoiceStopError(error);
      if (rejected) throw error;
    }
  }
  throw asError(failure ?? new Error("Voice session cleanup timed out"));
}
