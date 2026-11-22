import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import type { TeamHubMessagePresentation } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";
import type { Translate } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";
import {
  releaseLocalImage,
  rememberLocalMessageImage,
} from "@/features/rooms/files/local-message-images";

import { composerMessages } from "./composer.messages";
import type { MessageComposition } from "./message-composer";
import {
  describePendingMessageFailure,
  type PendingMessageFailure,
} from "./pending-message-failure";
import {
  browserRoomMessageOutbox,
  type PersistedRoomMessageIntent,
  type RoomMessageOutbox,
  type RoomMessageOutboxScope,
} from "./room-message-outbox";
import { appendRoomMessage } from "./room-projection";
import { rememberOwnSend } from "./recent-own-sends";
import type { RoomMessageSender } from "./room-message-sender";
import { roomDiagnostic } from "@/lib/room-diagnostics";

type OutgoingMessage = PersistedRoomMessageIntent;

/** Why saved Messages could not be read back or brought up to date. */
interface OutboxFailure {
  reason: "normalization_failed" | "restore_failed";
  detail: string;
}

type RoomMessageComposition = MessageComposition & {
  wireBody?: string;
  contextMessages?: TeamHubMessage[];
};

class RoomMessageOutboxPersistenceError extends Error {
  constructor(override readonly cause: unknown) {
    super("Room Message Outbox persistence failed.");
  }
}

export function useRoomMessageDelivery({
  composition,
  documentsQueryKey,
  messagesQueryKey,
  onMessageCommitted,
  onMessagePresented,
  outbox = browserRoomMessageOutbox,
  outboxScope,
  roomId,
}: {
  composition: RoomMessageSender;
  documentsQueryKey?: QueryKey;
  messagesQueryKey: QueryKey;
  onMessageCommitted?: (message: {
    body: string;
    contextMessageIds: readonly string[];
    messageId: string;
    mentions: readonly import("@/features/teamhub/teamhub-types").TeamHubActorRef[];
  }) => void;
  onMessagePresented?: (
    messageId: string,
    presentation: TeamHubMessagePresentation,
  ) => void;
  outbox?: RoomMessageOutbox;
  /** An empty `roomId` restores nothing until the Room exists. */
  outboxScope: RoomMessageOutboxScope;
  roomId: string;
}) {
  const queryClient = useQueryClient();
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const t = useT();
  const [outboxFailure, setOutboxFailure] = useState<OutboxFailure>();
  const [presentations, setPresentations] = useState<
    Record<string, TeamHubMessagePresentation>
  >({});
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const durableWritesRef = useRef(new Map<string, Promise<void>>());
  const deliveryTailRef = useRef<Promise<void> | undefined>(undefined);
  const networkStartedRef = useRef(new Set<string>());
  const attemptsRef = useRef(new Map<string, number>());
  const cancelWritesRef = useRef(new Map<string, Promise<void>>());
  const outgoingRef = useRef(outgoing);
  const commitRef = useRef<(intent: OutgoingMessage) => Promise<unknown>>(
    async () => undefined,
  );
  const outboxAccountId = outboxScope.accountId;
  const outboxRoomId = outboxScope.roomId;
  const outboxTenantId = outboxScope.tenantId;

  useEffect(() => {
    if (!outboxAccountId || !outboxRoomId || !outboxTenantId) return;
    const scope = {
      accountId: outboxAccountId,
      roomId: outboxRoomId,
      tenantId: outboxTenantId,
    };
    let canceled = false;
    setOutboxFailure(undefined);
    async function restore() {
      try {
        const restored = await outbox.list(scope);
        if (canceled) return;
        const normalized = restored.map(normalizeRestoredIntent);
        setOutgoing((current) => {
          const currentIds = new Set(current.map((item) => item.clientId));
          return [
            ...current,
            ...normalized.filter((item) => !currentIds.has(item.clientId)),
          ];
        });
        const normalizationWrites = normalized.flatMap((intent, index) =>
          intent === restored[index] ? [] : [outbox.put(intent)],
        );
        const results = await Promise.allSettled(normalizationWrites);
        if (canceled) return;
        if (results.every((result) => result.status === "fulfilled")) {
          return;
        }
        const failure = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        setOutboxFailure({
          detail: storageFailureDetail(failure?.reason),
          reason: "normalization_failed",
        });
      } catch (error) {
        if (canceled) return;
        setOutboxFailure({
          detail: storageFailureDetail(error),
          reason: "restore_failed",
        });
      }
    }
    void restore();
    return () => {
      canceled = true;
    };
  }, [outbox, outboxAccountId, outboxRoomId, outboxTenantId]);

  useEffect(
    () => () => {
      for (const controller of abortControllersRef.current.values()) {
        controller.abort();
      }
      abortControllersRef.current.clear();
      durableWritesRef.current.clear();
      networkStartedRef.current.clear();
      attemptsRef.current.clear();
      cancelWritesRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    outgoingRef.current = outgoing;
    commitRef.current = commitOutgoing;
  });

  useEffect(() => {
    let away = false;
    function onVisibility() {
      if (document.hidden) {
        away = true;
        return;
      }
      if (!away) return;
      away = false;
      for (const item of outgoingRef.current) {
        if (item.status !== "unknown" || item.heldByPerson) continue;
        void commitRef.current(item).catch(() => undefined);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  async function commitOutgoing(
    current: OutgoingMessage,
    onAccepted?: () => void,
  ) {
    if (abortControllersRef.current.has(current.clientId)) {
      return;
    }

    const previousDelivery = deliveryTailRef.current;
    let releaseDelivery!: () => void;
    deliveryTailRef.current = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const controller = new AbortController();
    abortControllersRef.current.set(current.clientId, controller);
    const sending = sendingIntent(current);
    replaceOutgoing(sending);

    try {
      try {
        const durableWrite = outbox.put(sending);
        durableWritesRef.current.set(current.clientId, durableWrite);
        await durableWrite;
        durableWritesRef.current.delete(current.clientId);
      } catch (error) {
        const failed = outboxPersistenceFailedIntent(sending, error);
        replaceOutgoing(failed);
        throw new RoomMessageOutboxPersistenceError(error);
      }
      // Acceptance is durable locally; a slow server must not own the next draft.
      onAccepted?.();
      await previousDelivery;
      if (controller.signal.aborted) {
        return;
      }
      const attempt = (attemptsRef.current.get(current.clientId) ?? 0) + 1;
      attemptsRef.current.set(current.clientId, attempt);
      roomDiagnostic("room.message_network_started", {
        roomId,
        clientId: current.clientId,
        attempt,
        at_unix_ms: Date.now(),
        at_perf_ms: performance.now(),
      });
      networkStartedRef.current.add(current.clientId);
      const result = await composition.createMessage({
        attachments: sending.attachmentInputs,
        body: sending.wireBody,
        voiceLiveTurn: sending.voiceLiveTurn,
        contextDocumentVersionIds: sending.contextDocumentVersionIds,
        documentReferences: sending.documentReferences,
        idempotencyKey: sending.idempotencyKey,
        mentions: sending.mentions,
        skillReferences: sending.skillReferences,
        contextMessageIds: sending.contextMessages.map((message) => message.id),
        onAttachmentProgress: (clientId, progress) => {
          updateAttachmentProgress(current.clientId, clientId, progress);
        },
        roomId,
        signal: controller.signal,
      });
      networkStartedRef.current.delete(current.clientId);
      attemptsRef.current.delete(current.clientId);
      rememberOwnSend(result.message.id, sending.createdAt);
      // Attachments come back in upload order.
      sending.attachmentInputs.forEach(({ file }, index) => {
        const attachment = result.message.attachments?.[index];
        if (attachment && file.type.startsWith("image/"))
          rememberLocalMessageImage(attachment.document_id, file);
      });

      if (
        documentsQueryKey &&
        (result.presentation.attachments.length > 0 ||
          sending.documentReferences.length > 0)
      ) {
        void queryClient
          .invalidateQueries({ queryKey: documentsQueryKey })
          .catch(() => undefined);
      }

      if (
        result.presentation.attachments.length ||
        result.presentation.mentions.length
      ) {
        onMessagePresented?.(result.message.id, result.presentation);
        setPresentations((currentPresentations) => ({
          ...currentPresentations,
          [result.message.id]: result.presentation,
        }));
      }
      setOutgoing((items) =>
        items.filter((item) => item.clientId !== sending.clientId),
      );
      appendRoomMessage(queryClient, messagesQueryKey, result.message);
      onMessageCommitted?.({
        body: sending.body,
        contextMessageIds: sending.contextMessages.map((message) => message.id),
        messageId: result.message.id,
        mentions: sending.mentions,
      });
      try {
        await cancelWritesRef.current.get(sending.clientId);
        await outbox.remove(sending.scope, sending.clientId);
      } catch (error) {
        const cleanupFailed = outboxCleanupFailedIntent(sending, error);
        setOutgoing((items) =>
          items.some((item) => item.clientId === sending.clientId)
            ? items.map((item) =>
                item.clientId === sending.clientId ? cleanupFailed : item,
              )
            : [...items, cleanupFailed],
        );
        throw new RoomMessageOutboxPersistenceError(error);
      }
      // The response is authoritative and already appended. Realtime gap and
      // reconnect recovery still refresh history when it is actually missing.
    } catch (error) {
      if (error instanceof RoomMessageOutboxPersistenceError) {
        throw error.cause;
      }
      if (!controller.signal.aborted) {
        const failed = failedIntent(sending, error);
        replaceOutgoing(failed);
        try {
          await outbox.put(failed);
        } catch (persistenceError) {
          replaceOutgoing(
            outboxPersistenceFailedIntent(failed, persistenceError),
          );
        }
        throw error;
      }
    } finally {
      await previousDelivery;
      releaseDelivery();
      if (abortControllersRef.current.get(current.clientId) === controller) {
        abortControllersRef.current.delete(current.clientId);
      }
      durableWritesRef.current.delete(current.clientId);
      networkStartedRef.current.delete(current.clientId);
      cancelWritesRef.current.delete(current.clientId);
    }
  }

  function replaceOutgoing(intent: OutgoingMessage) {
    setOutgoing((items) =>
      items.map((item) => (item.clientId === intent.clientId ? intent : item)),
    );
  }

  function updateAttachmentProgress(
    messageClientId: string,
    attachmentClientId: string,
    progress: number,
  ) {
    setOutgoing((items) =>
      items.map((item) =>
        item.clientId === messageClientId
          ? {
              ...item,
              attachments: item.attachments.map((attachment) =>
                attachment.clientId === attachmentClientId
                  ? {
                      ...attachment,
                      progress,
                      status:
                        progress >= 1
                          ? ("ready" as const)
                          : ("staging" as const),
                    }
                  : attachment,
              ),
            }
          : item,
      ),
    );
  }

  async function sendMessage(
    value: RoomMessageComposition,
    onAccepted?: () => void,
  ) {
    const attachmentsWereStaged = value.attachmentInputs !== undefined;
    const attachmentInputs =
      value.attachmentInputs ??
      value.files.map((file) => ({
        clientId: createLocalMessageId(),
        file,
      }));
    const current: OutgoingMessage = {
      attachmentInputs,
      attachments: attachmentInputs.map(({ clientId, file }) => ({
        clientId,
        file,
        filename: file.name,
        progress: attachmentsWereStaged ? 1 : 0,
        sizeBytes: file.size,
        status: attachmentsWereStaged ? "ready" : "staging",
      })),
      body: value.body,
      clientId: value.messageIdempotencyKey ?? createLocalMessageId(),
      contextDocumentVersionIds:
        value.documentContexts?.map((context) => context.documentVersionId) ??
        [],
      contextMessages: value.contextMessages ?? [],
      createdAt: Date.now(),
      idempotencyKey:
        value.messageIdempotencyKey ??
        value.attachmentIdempotencyKey ??
        createTeamHubIdempotencyKey(),
      mentions: value.mentions,
      scope: outboxScope,
      documentReferences: value.documentReferences ?? [],
      skillReferences: value.skillReferences ?? [],
      status: "sending",
      wireBody: value.wireBody ?? value.body,
      voiceLiveTurn: value.voiceLiveTurn,
    };

    setOutgoing((items) => [
      ...items.filter((item) => item.clientId !== current.clientId),
      current,
    ]);
    try {
      await commitOutgoing(current, onAccepted);
      return { ok: true as const };
    } catch (error) {
      return { error, ok: false as const };
    }
  }

  function enqueueMessage(value: RoomMessageComposition) {
    return new Promise<{ ok: true } | { ok: false; error: unknown }>(
      (resolve) => {
        // Later delivery failures live on the Outbox row, never in a newer composer.
        void sendMessage(value, () => resolve({ ok: true })).then(resolve);
      },
    );
  }

  function retryMessage(clientId: string) {
    const current = outgoing.find((item) => item.clientId === clientId);
    if (current) {
      void commitOutgoing(current).catch(() => undefined);
    }
  }

  async function cancelMessage(clientId: string) {
    const current = outgoing.find((item) => item.clientId === clientId);
    if (!current) return;
    abortControllersRef.current.get(clientId)?.abort();
    if (networkStartedRef.current.has(clientId)) {
      const unknown = canceledAfterNetworkStartedIntent(current);
      replaceOutgoing(unknown);
      const cancelWrite = outbox.put(unknown).catch((error) => {
        replaceOutgoing(outboxPersistenceFailedIntent(unknown, error));
      });
      cancelWritesRef.current.set(clientId, cancelWrite);
      await cancelWrite;
      return;
    }
    try {
      await durableWritesRef.current.get(clientId);
      await outbox.remove(current.scope, clientId);
    } catch (error) {
      replaceOutgoing(outboxCancelFailedIntent(current, error));
      return;
    }
    setOutgoing((items) => items.filter((item) => item.clientId !== clientId));
    // Nothing shows a canceled Message's images again.
    for (const { file } of current.attachmentInputs ?? []) {
      releaseLocalImage(file);
    }
  }

  const stageAttachment = useCallback(
    async (input: {
      attachment: import("@/features/teamhub/teamhub-runtime").TeamHubCompositionAttachmentInput;
      idempotencyKey: string;
      onProgress?: (progress: number) => void;
      signal?: AbortSignal;
    }) => {
      await composition.stageAttachment({
        ...input,
        roomId,
      });
    },
    [composition, roomId],
  );

  const cancelAttachment = useCallback(
    async (input: { attachmentClientId: string; idempotencyKey: string }) => {
      await composition.cancelAttachment({
        ...input,
        roomId,
      });
    },
    [composition, roomId],
  );

  // The stored intents carry reasons; the sentences are made here, so they
  // follow the language on screen.
  const shownOutgoing = useMemo(
    () => outgoing.map((intent) => withFailureText(intent, t)),
    [outgoing, t],
  );

  return {
    cancelAttachment,
    cancelMessage,
    enqueueMessage,
    outboxError: outboxFailure
      ? describeOutboxFailure(outboxFailure, t)
      : undefined,
    outgoing: shownOutgoing,
    presentations,
    retryMessage,
    sendMessage,
    stageAttachment,
  };
}

/** What the browser said about a storage failure, when it said anything. */
function storageFailureDetail(error: unknown) {
  return error instanceof Error ? error.message.trim() : "";
}

function describeOutboxFailure(
  { detail, reason }: OutboxFailure,
  t: Translate,
) {
  if (reason === "restore_failed")
    return detail
      ? t(composerMessages.outboxRestoreFailedDetail, { detail })
      : t(composerMessages.outboxRestoreFailed);
  return detail
    ? t(composerMessages.outboxNormalizationFailedDetail, { detail })
    : t(composerMessages.outboxNormalizationFailed);
}

/** The intent as a row shows it: its failure worded in the language on screen. */
function withFailureText(intent: OutgoingMessage, t: Translate) {
  if (!intent.failure) return intent;
  const error = describePendingMessageFailure(intent.failure, t);
  return error ? { ...intent, error } : intent;
}

/** A failure this client words itself; any earlier sentence is dropped. */
function clientFailure(
  reason: PendingMessageFailure["reason"],
  detail?: string,
): Pick<OutgoingMessage, "error" | "failure"> {
  return {
    error: undefined,
    failure: detail ? { detail, reason } : { reason },
  };
}

function canceledAfterNetworkStartedIntent(
  intent: OutgoingMessage,
): OutgoingMessage {
  return {
    ...intent,
    ...clientFailure("delivery_may_have_reached"),
    heldByPerson: true,
    status: "unknown",
  };
}

function outboxCleanupFailedIntent(
  intent: OutgoingMessage,
  error: unknown,
): OutgoingMessage {
  return {
    ...intent,
    ...clientFailure("outbox_cleanup_failed", storageFailureDetail(error)),
    status: "unknown",
  };
}

function outboxCancelFailedIntent(
  intent: OutgoingMessage,
  error: unknown,
): OutgoingMessage {
  return {
    ...intent,
    ...clientFailure("outbox_cancel_failed", storageFailureDetail(error)),
    status: "failed",
  };
}

function sendingIntent(intent: OutgoingMessage): OutgoingMessage {
  return {
    ...intent,
    attachments: intent.attachments.map((attachment) => ({
      ...attachment,
      error: undefined,
      progress: 0,
      status: "staging",
    })),
    error: undefined,
    failure: undefined,
    status: "sending",
  };
}

function failedIntent(
  intent: OutgoingMessage,
  error: unknown,
): OutgoingMessage {
  // TeamHub's refusal is final and says why in its own words; anything else
  // leaves the outcome open, which is a reason this client words itself.
  const refused = error instanceof TeamHubError;
  const message = refused ? error.message : undefined;
  return {
    ...intent,
    attachments: intent.attachments.map((attachment) => ({
      ...attachment,
      error: message,
      status: "failed",
    })),
    ...(refused
      ? { error: message, failure: undefined }
      : clientFailure("delivery_unconfirmed")),
    status: refused ? "failed" : "unknown",
  };
}

function outboxPersistenceFailedIntent(
  intent: OutgoingMessage,
  error: unknown,
): OutgoingMessage {
  return {
    ...intent,
    attachments: intent.attachments.map((attachment) => ({
      ...attachment,
      error: undefined,
      status: "failed",
    })),
    ...(error instanceof DOMException && error.name === "QuotaExceededError"
      ? clientFailure("local_storage_full")
      : clientFailure("local_save_failed", storageFailureDetail(error))),
    status: "failed",
  };
}

function normalizeRestoredIntent(intent: PersistedRoomMessageIntent) {
  if (intent.status !== "sending") return intent;
  return {
    ...intent,
    ...clientFailure("delivery_interrupted"),
    status: "unknown" as const,
  };
}

function createLocalMessageId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return randomUuid;
  }

  localMessageSequence =
    localMessageSequence >= Number.MAX_SAFE_INTEGER
      ? 1
      : localMessageSequence + 1;
  return `local:${Date.now()}:${localMessageSequence}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

let localMessageSequence = 0;
