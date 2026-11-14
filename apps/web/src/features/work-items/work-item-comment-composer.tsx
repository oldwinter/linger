import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";

import { useCreateWorkItemComment } from "./work-item-queries";

/**
 * Adds one Comment to the open Work Item. The text keeps its idempotency key
 * until it changes, so retrying a failed send cannot post it twice.
 */
export function WorkItemCommentComposer({
  tenantId,
  workItemId,
}: {
  tenantId: string;
  workItemId: string;
}) {
  const createComment = useCreateWorkItemComment(tenantId, workItemId);
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const intent = useRef<{ body: string; key: string } | undefined>(undefined);
  const inputId = useId();
  const text = body.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text || createComment.isPending) return;
    if (intent.current?.body !== text) {
      intent.current = { body: text, key: createTeamHubIdempotencyKey() };
    }
    try {
      await createComment.mutateAsync({
        body: text,
        idempotencyKey: intent.current.key,
      });
      // The sent text is done; the next one is a new comment, not a replay.
      intent.current = undefined;
      setBody("");
      textareaRef.current?.focus();
    } catch {
      // The text and its key stay for a retry; the error line explains why.
    }
  }

  return (
    <form className="space-y-2" onSubmit={(event) => void submit(event)}>
      <label
        className="block text-xs font-medium text-app-muted"
        htmlFor={inputId}
      >
        Add a comment
      </label>
      <textarea
        className="block min-h-16 w-full resize-y rounded-lg border border-app-border bg-app-surface px-2.5 py-2 text-sm text-app-ink outline-none placeholder:text-app-muted focus-visible:border-app-border-strong focus-visible:ring-2 focus-visible:ring-app-focus"
        disabled={createComment.isPending}
        id={inputId}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a comment…"
        ref={textareaRef}
        rows={2}
        value={body}
      />
      <div className="flex justify-end">
        <Button
          disabled={!text}
          loading={createComment.isPending}
          size="compact"
          tone="primary"
          type="submit"
        >
          Submit
        </Button>
      </div>
      {createComment.error ? (
        <p className="text-xs text-app-danger" role="alert">
          {createComment.error instanceof Error && createComment.error.message
            ? createComment.error.message
            : "The comment could not be added."}
        </p>
      ) : null}
    </form>
  );
}
