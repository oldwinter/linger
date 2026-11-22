import { useCallback } from "react";

import { translate } from "@/i18n/language";

import { composerMessages } from "../chat/composer.messages";
import { tryAcquireVoicePublisherLease } from "./voice-publisher-lease";
import type { VoiceControlState } from "./use-voice-control-state";

/**
 * Lends the microphone to chat dictation; releasing the lease resumes the
 * hardware listener when it was not disabled.
 */
export function useComposerMicrophone(
  state: VoiceControlState,
  tenantId: string,
  enable: (automatic?: boolean) => Promise<void>,
  leavePage: () => Promise<void>,
  cleanupMedia: () => Promise<void>,
) {
  const { refs, setComposerMicrophoneActive, setListenerStatus } = state;

  return useCallback(
    async (options?: { resumeListening?: boolean }) => {
      const recording = () => {
        const status = refs.captureRef.current?.status;
        return status === "starting" || status === "recording";
      };
      if (
        refs.composerLeaseRef.current ||
        refs.startPromiseRef.current ||
        refs.enablePromiseRef.current
      )
        throw new Error(translate(composerMessages.microphoneInUse));
      if (recording()) {
        throw new Error(
          translate(composerMessages.microphoneHardwareRecording),
        );
      }
      // Chat dictation has a separate purpose and must not reuse a hardware
      // session or re-enable its listener when the dictation lease is released.
      if (options?.resumeListening === false) await leavePage();
      if (
        refs.composerLeaseRef.current ||
        refs.startPromiseRef.current ||
        refs.enablePromiseRef.current ||
        recording()
      )
        throw new Error(translate(composerMessages.microphoneInUse));
      if (!refs.publisherLeaseRef.current) {
        const release = await tryAcquireVoicePublisherLease(tenantId);
        if (!release)
          throw new Error(translate(composerMessages.microphoneOtherTab));
        if (
          refs.composerLeaseRef.current ||
          refs.startPromiseRef.current ||
          refs.enablePromiseRef.current ||
          recording()
        ) {
          release();
          throw new Error(translate(composerMessages.microphoneInUse));
        }
        refs.publisherLeaseRef.current = release;
      }
      refs.composerLeaseRef.current = true;
      setComposerMicrophoneActive(true);
      await cleanupMedia();
      setListenerStatus("composer_recording");
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        refs.composerLeaseRef.current = false;
        setComposerMicrophoneActive(false);
        if (refs.bindingRef.current && !refs.manuallyDisabledRef.current)
          await enable(true);
        else {
          refs.publisherLeaseRef.current?.();
          refs.publisherLeaseRef.current = undefined;
          setListenerStatus("disabled");
        }
      };
    },
    [
      cleanupMedia,
      enable,
      leavePage,
      refs,
      setComposerMicrophoneActive,
      setListenerStatus,
      tenantId,
    ],
  );
}
