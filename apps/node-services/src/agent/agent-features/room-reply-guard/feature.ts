import { defineFeature, type FeatureDeclaration } from "../contracts.js";
import { encodeExecutionContextRef } from "../../executor/context-ref.js";
import { awaitsReply } from "../../executor/reply-delivery.js";
import type { AgentLogger } from "../../observability/agent-log.js";

export const ROOM_REPLY_GUARD_FEATURE_ID = "room-reply-guard";

const DEFAULT_REPLY_CHECK_TIMEOUT_MS = 5_000;

export const ROOM_REPLY_REMINDER =
  "You have not sent a visible reply to the Room yet for this turn. Room participants cannot see your final assistant text; only messages sent through the `teamhub message` command (such as `teamhub message send`, `teamhub message card`, `teamhub message ask-user`, `teamhub message sequence`, or an emoji reaction) appear in the Room. Send your reply to the Room now, then finish.";

export interface RoomReplyGuardFeatureDeps {
  readonly hasRunReplied: (
    contextKey: string,
    runId: string,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  readonly logger?: AgentLogger;
  readonly checkTimeoutMs?: number;
}

/**
 * Intercepts a Room Run right before the Runtime finishes when a Human
 * mentioned this Agent and TeamHub has no persisted visible reply for the Run.
 * Blocks at most once per Run so the model can send its reply via `teamhub
 * message` in the same turn without risking an infinite loop.
 */
export function createRoomReplyGuardFeature(
  deps: RoomReplyGuardFeatureDeps,
): FeatureDeclaration {
  if (typeof deps?.hasRunReplied !== "function") {
    throw new Error("room-reply-guard feature requires hasRunReplied");
  }
  const checkTimeoutMs = deps.checkTimeoutMs ?? DEFAULT_REPLY_CHECK_TIMEOUT_MS;
  return defineFeature({
    id: ROOM_REPLY_GUARD_FEATURE_ID,
    match: {
      contextKinds: ["meta"],
    },
    context: {
      ports: {
        onRunBeforeStop: {},
        onRunTerminal: {},
      },
      create: (boundContext) => {
        const contextKey = encodeExecutionContextRef(boundContext.ref);
        const blockedRuns = new Set<string>();
        return {
          async onRunBeforeStop(context, input, signal) {
            if (input.stopHookActive || blockedRuns.has(input.runId)) {
              return { action: "allow" };
            }
            if (!input.inputs.some(awaitsReply)) {
              return { action: "allow" };
            }
            const checkSignal = AbortSignal.any([
              signal,
              context.signal,
              AbortSignal.timeout(checkTimeoutMs),
            ]);
            let replied: boolean;
            try {
              replied = await deps.hasRunReplied(
                contextKey,
                input.runId,
                checkSignal,
              );
            } catch (error) {
              deps.logger?.log("warn", "room_reply_guard.check_failed", {
                contextKey,
                runId: input.runId,
                error,
              });
              return { action: "allow" };
            }
            if (replied) {
              return { action: "allow", replyConfirmed: true };
            }
            blockedRuns.add(input.runId);
            deps.logger?.log("info", "room_reply_guard.blocked", {
              contextKey,
              runId: input.runId,
              attempt: input.attempt,
            });
            return { action: "block", reason: ROOM_REPLY_REMINDER };
          },
          onRunTerminal(_context, event) {
            blockedRuns.delete(event.runId);
          },
        };
      },
    },
  });
}
