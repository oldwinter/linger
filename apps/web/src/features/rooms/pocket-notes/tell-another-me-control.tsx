import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import {
  sendPocketNoteToAnotherMe,
  pocketTellMessage,
} from "./tell-another-me";

/**
 * Saves today's note if it is still dirty, then posts that text into Another
 * Me's room. Open chat is how you see the message that was just sent.
 */
export function TellAnotherMe({
  note,
  onEnsureSaved,
  onOpenChat,
  roomId,
}: {
  note: string;
  onEnsureSaved: () => Promise<void>;
  onOpenChat: () => void;
  roomId: string;
}) {
  const { client } = useTeamHubRuntime();
  const [step, setStep] = useState<"note" | "confirm" | "sent">("note");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const attempt = useRef<{ key: string; message: string } | undefined>(
    undefined,
  );
  const trimmed = note.trim();
  if (!trimmed) return null;
  const message = pocketTellMessage(trimmed);

  async function send() {
    if (sending) return;
    const current = attempt.current;
    const key =
      current?.message === message
        ? current.key
        : createTeamHubIdempotencyKey();
    attempt.current = { key, message };
    setSending(true);
    setFailed(false);
    try {
      await onEnsureSaved();
      await sendPocketNoteToAnotherMe({
        client,
        idempotencyKey: key,
        note: trimmed,
        roomId,
      });
      setStep("sent");
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  if (step === "note") {
    return (
      <Button
        className="pointer-events-auto absolute bottom-3 left-3"
        onClick={() => setStep("confirm")}
        size="compact"
        tone="secondary"
      >
        Tell Another Me
      </Button>
    );
  }

  return (
    <section
      aria-label="Tell Another Me"
      className="absolute inset-0 z-10 flex flex-col gap-3 bg-popover px-5 py-4"
    >
      {step === "sent" ? (
        <>
          <h2 className="text-sm font-semibold text-foreground">
            Sent to Another Me
          </h2>
          <p className="text-sm text-muted-foreground">
            Today's note is in that chat.
          </p>
          <div className="mt-auto flex items-center gap-2">
            <Button onClick={onOpenChat} size="compact" tone="primary">
              Open chat
            </Button>
            <Button onClick={() => setStep("note")} size="compact" tone="ghost">
              Back to the note
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-foreground">
            Tell Another Me
          </h2>
          <p className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-sm text-foreground">
            {message}
          </p>
          {failed ? (
            <p className="text-sm text-destructive" role="alert">
              Could not send. Try again.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              disabled={sending}
              onClick={() => void send()}
              size="compact"
              tone="primary"
            >
              {sending ? "Sending" : "Send"}
            </Button>
            <Button
              disabled={sending}
              onClick={() => setStep("note")}
              size="compact"
              tone="ghost"
            >
              Back
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
