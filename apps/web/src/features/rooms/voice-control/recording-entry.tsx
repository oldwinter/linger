import {
  AiTranscribeAudioIcon,
  AlertCircleIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import {
  use,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n/use-translation";

import { roomListMessages } from "../room-list.messages";
import { useOptionalVoiceModeSession } from "../chat/voice-mode/voice-mode-session";
import { LazyVoiceKeyDialog } from "./lazy-voice-key-dialog";
import { openRecordingWindow } from "./recording-window-store";
import {
  isTranscriptRecoveryPaused,
  transcriptRecoveryPercent,
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
  const t = useT();
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const status = voice?.captureState?.status;
  const recording = status === "recording" || status === "starting";
  const recoveryFailed = Boolean(
    voice &&
    status === "recovering" &&
    isTranscriptRecoveryPaused(voice.captureState),
  );
  const recovering = status === "recovering" && !recoveryFailed;
  const saving = status === "finalizing" || recovering;
  // Stop gave up with the recording still running; the window offers Retry.
  const stopFailed = Boolean(voice?.retryStop);
  const capture =
    voice?.captureState && "capture" in voice.captureState
      ? voice.captureState.capture
      : undefined;
  // Older TeamHub releases report the progress but not the attempt.
  const attempt =
    recovering &&
    capture?.transcript_recovery_attempt &&
    capture.transcript_recovery_max_attempts
      ? {
          attempt: capture.transcript_recovery_attempt,
          max: capture.transcript_recovery_max_attempts,
        }
      : undefined;
  const switchFromLive = Boolean(voiceMode?.session);
  const standby = voice?.listenerStatus === "standby";
  // Until voice connects, including while it reconnects, the icon spins.
  const connecting = !voice && !connectionFailed && !needsKey;
  const label = t(
    recording
      ? roomListMessages.returnToRecording
      : saving && switchFromLive
        ? roomListMessages.startNewMeeting
        : saving
          ? roomListMessages.viewSaveProgress
          : connectionFailed
            ? roomListMessages.retryVoiceConnection
            : roomListMessages.meetings,
  );
  const hint =
    error ??
    (connectionFailed
      ? t(roomListMessages.voiceUnavailable)
      : needsKey
        ? label
        : !voice || !anotherMeRoomId
          ? t(roomListMessages.meetingLoading)
          : voiceInputBusy
            ? t(roomListMessages.finishVoiceInput)
            : standby
              ? t(roomListMessages.recordingElsewhere)
              : stopFailed
                ? t(roomListMessages.stopFailedHint)
                : recoveryFailed
                  ? t(roomListMessages.recoveryFailedHint)
                  : attempt
                    ? t(roomListMessages.recoveringAttemptHint, attempt)
                    : recovering
                      ? t(roomListMessages.recoveringProgressHint, {
                          progress: capture
                            ? transcriptRecoveryPercent(capture)
                            : 0,
                        })
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
        // A failed save or recovery opens on its Retry instead.
        openRecordingWindow({
          autoStart: !(saving || recoveryFailed) || switchFromLive,
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
          cause instanceof Error
            ? cause.message
            : t(roomListMessages.recordingFailed),
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

  useLayoutEffect(() => {
    if (!error || !buttonRef.current || !alertRef.current) return;
    const anchor = buttonRef.current;
    const popover = alertRef.current;
    function positionPopover() {
      const gap = 8;
      const anchorBounds = anchor.getBoundingClientRect();
      const { width, height } = popover.getBoundingClientRect();
      const maxWidth = Math.max(0, window.innerWidth - gap * 2);
      popover.style.maxWidth = `${Math.min(288, maxWidth)}px`;
      const left = Math.max(
        gap,
        Math.min(anchorBounds.left, window.innerWidth - width - gap),
      );
      const below = anchorBounds.bottom + gap;
      const top =
        height > 0 && below + height > window.innerHeight - gap
          ? Math.max(gap, anchorBounds.top - height - gap)
          : Math.max(gap, below);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    }
    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [error]);

  useEffect(() => {
    if (!error) return;
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        return;
      }
      event.preventDefault();
      setError(undefined);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [error]);

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
        ref={buttonRef}
        title={hint}
        type="button"
      >
        {(status === "finalizing" && !stopFailed && !switchFromLive) ||
        connecting ? (
          <Spinner size={16} />
        ) : (
          <Icon icon={AiTranscribeAudioIcon} size={16} />
        )}
        <span className="xs-nav-btn-label">
          {attempt
            ? t(roomListMessages.recoveringLabel, attempt)
            : saving && switchFromLive
              ? t(roomListMessages.newMeeting)
              : label}
        </span>
        {recording ||
        connectionFailed ||
        recovering ||
        recoveryFailed ||
        stopFailed ? (
          <span
            aria-hidden="true"
            className={`absolute top-1 right-1 size-2 rounded-full ring-2 ring-app-sidebar ${recording || recoveryFailed || stopFailed ? "bg-app-danger" : "bg-app-warning"}`}
          />
        ) : null}
      </button>
      {error
        ? createPortal(
            <div
              className="app-popover-card fixed z-50 flex items-start gap-2 rounded-lg border border-app-danger/30 bg-app-surface px-3 py-2 text-xs text-app-danger shadow-md"
              ref={alertRef}
              role="alert"
            >
              <Icon
                className="mt-0.5 shrink-0"
                icon={AlertCircleIcon}
                size={14}
              />
              <span className="min-w-0 flex-1">{error}</span>
              <button
                aria-label="Dismiss recording error"
                className="flex size-5 shrink-0 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                onClick={() => setError(undefined)}
                type="button"
              >
                <Icon icon={Cancel01Icon} size={12} />
              </button>
            </div>,
            buttonRef.current?.closest("dialog[open]") ?? document.body,
          )
        : null}
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
