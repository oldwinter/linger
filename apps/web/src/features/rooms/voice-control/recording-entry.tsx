import {
  Loading03Icon,
  AiTranscribeAudioIcon,
} from "@hugeicons/core-free-icons";
import { use, useEffect, useEffectEvent, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

import { useOptionalVoiceModeSession } from "../chat/voice-mode/voice-mode-session";
import { LazyVoiceKeyDialog } from "./lazy-voice-key-dialog";
import { openRecordingWindow } from "./recording-window-store";
import {
  isTranscriptRecoveryPaused,
  useOptionalVoiceControl,
  VoiceCapabilitiesContext,
  VoiceConnectionRetryContext,
} from "./voice-control-context";

/**
 * The sidebar's Meeting tool. Every recording is kept with Another Me, so
 * its audio and transcript arrive in that chat when it finishes. Clicking it
 * opens the Recording window and starts recording when none is running.
 */
export function RecordingEntry({
  anotherMeRoomId,
  tenantId,
}: {
  anotherMeRoomId?: string;
  tenantId: string;
}) {
  const livekit = useOptionalVoiceControl();
  const voice = livekit;
  const voiceMode = useOptionalVoiceModeSession();
  const voiceInputBusy = voice?.composerMicrophoneActive && !voiceMode?.session;
  // Recording transcribes with Soniox; xAI alone does not offer it.
  const capabilities = use(VoiceCapabilitiesContext);
  const retryConnection = use(VoiceConnectionRetryContext);
  const connectionFailed = Boolean(retryConnection);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  // Without a Soniox key the entry asks for one, then starts once voice runs.
  const needsKey = capabilities?.voiceMedia === false;
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const startWhenReady = useRef(false);
  const status = voice?.captureState?.status;
  const recording = status === "recording" || status === "starting";
  const saving =
    status === "finalizing" ||
    (status === "recovering" &&
      !(voice && isTranscriptRecoveryPaused(voice.captureState)));
  const switchFromLive = Boolean(voiceMode?.session);
  const standby = voice?.listenerStatus === "standby";
  // Until voice connects, including while it reconnects, the icon spins.
  const connecting = !voice && !connectionFailed && !needsKey;
  const label = recording
    ? "Return to recording"
    : saving && switchFromLive
      ? "Start a new Meeting"
      : saving
        ? "View save progress"
        : connectionFailed
          ? "Retry voice connection"
          : "Meetings";
  const hint =
    error ??
    (connectionFailed
      ? "Voice connection is unavailable. Click to retry."
      : needsKey
        ? label
        : !voice || !anotherMeRoomId
          ? "Meeting is loading"
          : voiceInputBusy
            ? "Finish voice input first"
            : standby
              ? "Recording is active in another tab"
              : label);
  function start() {
    if (retryConnection) {
      retryConnection();
      return;
    }
    if (needsKey) {
      setKeyDialogOpen(true);
      return;
    }
    if (!voice || !anotherMeRoomId || pending || voiceInputBusy) return;
    setPending(true);
    setError(undefined);
    // Only this click may open the window that floats over other apps;
    // the browser allows it for a few seconds after, enough to load it.
    const startRecording = async () => {
      const pip = import("../chat/voice-mode/voice-pip");
      // A new Meeting opens expanded, even if the browser remembers a small
      // window from a recording that ended while minimized.
      const opened = pip.then(({ openVoicePip }) =>
        openVoicePip("recording", { preferInitialWindowPlacement: true }),
      );
      try {
        await voice.selectTargetRoom?.(anotherMeRoomId);
        await opened;
        openRecordingWindow({
          autoStart: !saving || switchFromLive,
        });
      } catch (cause) {
        await opened;
        const { closeVoicePip } = await pip;
        closeVoicePip("recording");
        throw cause;
      }
    };
    void (voiceMode ? voiceMode.startMeeting(startRecording) : startRecording())
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error ? cause.message : "Unable to open recording",
        );
      })
      .finally(() => setPending(false));
  }

  // The engine for a just-saved key loads after the dialog closes; the
  // recording the Human asked for starts once it is here.
  const startSaved = useEffectEvent(() => start());
  const engineReady = Boolean(voice && anotherMeRoomId) && !needsKey;
  useEffect(() => {
    if (!startWhenReady.current || !engineReady) return;
    startWhenReady.current = false;
    startSaved();
  }, [engineReady]);

  if (capabilities?.voiceAvailable === false) return null;

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- aria-description is a valid ARIA global attribute missing from the rule data. */}
      <button
        aria-description={hint === label ? undefined : hint}
        aria-label={label}
        className="xs-nav-btn relative"
        disabled={
          !connectionFailed &&
          !needsKey &&
          (pending || !voice || !anotherMeRoomId || voiceInputBusy)
        }
        onClick={start}
        title={hint}
        type="button"
      >
        {(saving && !switchFromLive) || connecting ? (
          <Icon icon={Loading03Icon} className="animate-spin" size={16} />
        ) : (
          <Icon icon={AiTranscribeAudioIcon} size={16} />
        )}
        <span className="xs-nav-btn-label">
          {saving && switchFromLive ? "New Meeting" : "Meetings"}
        </span>
        {recording || connectionFailed ? (
          <span
            aria-hidden="true"
            className={`absolute top-1 right-1 size-2 rounded-full ring-2 ring-app-sidebar ${recording ? "bg-app-danger" : "bg-app-warning"}`}
          />
        ) : null}
        {error ? (
          <span className="sr-only" role="alert">
            {error}
          </span>
        ) : null}
      </button>
      {keyDialogOpen ? (
        <LazyVoiceKeyDialog
          onClose={() => setKeyDialogOpen(false)}
          onReady={() => {
            setKeyDialogOpen(false);
            startWhenReady.current = true;
          }}
          policy={capabilities?.policy}
          providers={["soniox"]}
          tenantId={tenantId}
        />
      ) : null}
    </>
  );
}
