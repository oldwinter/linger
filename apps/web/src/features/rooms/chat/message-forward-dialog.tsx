import {
  Cancel01Icon,
  Search01Icon,
  SentIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { idempotencyHeader, teamHubData } from "@/features/teamhub/teamhub-api";
import {
  createTeamHubIdempotencyKey,
  TeamHubError,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { translate } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";
import { tenantActorsQueryOptions } from "../room-queries";
import { chatMessages } from "./chat.messages";

type TargetKind = "agent" | "room";

interface ForwardTarget {
  id: string;
  kind: TargetKind;
  label: string;
}

function forwardTargetKey(target: Pick<ForwardTarget, "id" | "kind">) {
  return `${target.kind}:${target.id}`;
}

export function MessageForwardDialog({
  client,
  message,
  onClose,
  tenantId,
}: {
  client: TeamHubClient;
  message: TeamHubMessage;
  onClose: () => void;
  tenantId: string;
}) {
  const [kind, setKind] = useState<TargetKind>("agent");
  const [selected, setSelected] = useState<ForwardTarget[]>([]);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const [forwarded, setForwarded] = useState<string[]>([]);
  const t = useT();
  const actors = useQuery(tenantActorsQueryOptions(client, tenantId));
  const rooms = useQuery({
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/rooms", {
          params: { path: { tenantId }, query: { limit: 100 } },
        }),
      ),
    queryKey: ["teamhub", tenantId, "message-forward-rooms"],
    staleTime: 60_000,
  });
  const activeQuery = kind === "room" ? rooms : actors;
  const targets = useMemo(() => {
    const values: ForwardTarget[] = [];
    if (kind === "room") {
      for (const room of rooms.data?.items ?? []) {
        if (room.id === message.room_id) continue;
        values.push({ id: room.id, kind: "room", label: room.name });
      }
    } else {
      for (const actor of actors.data?.items ?? []) {
        if (actor.kind === kind) {
          values.push({
            id: actor.id,
            kind: "agent",
            label: actor.display_name,
          });
        }
      }
    }
    const needle = query.trim().toLowerCase();
    return needle
      ? values.filter((target) => target.label.toLowerCase().includes(needle))
      : values;
  }, [actors.data, kind, message.room_id, query, rooms.data]);
  const selectedKeys = new Set(selected.map(forwardTargetKey));

  function close() {
    if (!sendingRef.current) onClose();
  }

  function toggleTarget(target: ForwardTarget) {
    const key = forwardTargetKey(target);
    if (sendingRef.current || forwarded.includes(key)) return;
    setSelected((current) =>
      current.some((item) => forwardTargetKey(item) === key)
        ? current.filter((item) => forwardTargetKey(item) !== key)
        : [...current, target],
    );
  }

  async function forward() {
    if (!selected.length || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        selected.map((target) => {
          const targetKey = forwardTargetKey(target);
          let requestKey = requestKeys.current.get(targetKey);
          if (!requestKey) {
            requestKey = createTeamHubIdempotencyKey();
            requestKeys.current.set(targetKey, requestKey);
          }
          return teamHubData(
            client.api.POST("/v0/rooms/{roomId}/messages/{messageId}/forward", {
              params: {
                path: { roomId: message.room_id, messageId: message.id },
                header: idempotencyHeader(requestKey),
              },
              body: { target: { id: target.id, kind: target.kind } },
            }),
          );
        }),
      );
      const confirmed = selected.filter(
        (_, index) => results[index]?.status === "fulfilled",
      );
      const remaining = selected.filter(
        (_, index) => results[index]?.status === "rejected",
      );
      setForwarded((current) => [
        ...current,
        ...confirmed.map(forwardTargetKey),
      ]);
      setSelected(remaining);
      if (!remaining.length) {
        onClose();
        return;
      }
      const targetChanged = results.some(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof TeamHubError &&
          result.reason.status === 409,
      );
      setError(
        confirmed.length
          ? `Forwarded to ${confirmed.length} of ${selected.length} targets. Retry the ${remaining.length} remaining ${remaining.length === 1 ? "target" : "targets"}.`
          : targetChanged
            ? translate(chatMessages.forwardTargetChanged)
            : "Could not confirm forwarding. Retry the selected targets.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <ModalDialog
      closeOnBackdrop
      onClose={close}
      size="lg"
      title={t(chatMessages.forwardTo)}
      footer={
        <div className="w-full">
          {error ? (
            <p className="mb-3 text-sm text-app-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button disabled={sending} onClick={close} tone="ghost">
              {t(commonMessages.cancel)}
            </Button>
            <Button
              disabled={!selected.length}
              loading={sending}
              onClick={() => void forward()}
              tone="primary"
            >
              <Icon icon={SentIcon} size={16} /> {t(chatMessages.forward)}
            </Button>
          </div>
        </div>
      }
    >
      <div className="px-5 py-4">
        <div className="relative flex items-center">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 flex items-center text-app-muted"
          >
            <Icon icon={Search01Icon} size={16} />
          </span>
          <input
            aria-label={t(chatMessages.searchForwardTargets)}
            className="h-11 min-w-0 flex-1 rounded-md border border-app-border pl-9 pr-9 text-sm outline-none placeholder:text-app-placeholder focus:border-app-focus"
            disabled={sending}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(commonMessages.search)}
            value={query}
          />
          {query ? (
            <div className="absolute right-1.5 flex items-center">
              <Button
                aria-label="Clear search"
                disabled={sending}
                onClick={() => setQuery("")}
                size="compactIcon"
                tone="ghost"
              >
                <Icon icon={Cancel01Icon} size={14} />
              </Button>
            </div>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["agent", "room"] as const).map((targetKind) => (
            <Button
              key={targetKind}
              disabled={sending}
              onClick={() => {
                if (sendingRef.current) return;
                setKind(targetKind);
                setError(null);
              }}
              size="compact"
              tone={kind === targetKind ? "primary" : "secondary"}
            >
              {targetKind === "agent"
                ? t(chatMessages.forwardAgents)
                : t(chatMessages.forwardRooms)}
            </Button>
          ))}
        </div>
        {selected.length ? (
          <div
            aria-label={t(chatMessages.selectedForwardTargets)}
            className="mt-3 flex flex-wrap gap-2"
          >
            {selected.map((target) => {
              const key = forwardTargetKey(target);
              return (
                <button
                  data-voice-risk="never"
                  aria-pressed="true"
                  className="inline-flex items-center gap-1 rounded-full bg-app-selected px-2.5 py-1 text-xs text-app-ink"
                  disabled={sending}
                  key={key}
                  onClick={() => toggleTarget(target)}
                  title={t(chatMessages.removeSelectedTarget)}
                  type="button"
                >
                  <Icon icon={Tick02Icon} size={14} /> {target.label}
                  <Icon icon={Cancel01Icon} size={14} />
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="mt-3">
          {activeQuery.isPending ? (
            <div
              className="flex items-center justify-center gap-2 px-3 py-5 text-sm text-app-muted"
              role="status"
            >
              <Spinner size={16} />
              Loading {kind === "room" ? "rooms" : "agents"}...
            </div>
          ) : activeQuery.isError ? (
            <div
              className="flex items-center justify-between gap-3 px-3 py-4 text-sm text-app-danger"
              role="alert"
            >
              <span>
                {kind === "room" ? "Rooms" : "Agents"} could not be loaded.
              </span>
              <Button
                loading={activeQuery.isFetching}
                onClick={() => void activeQuery.refetch()}
                size="compact"
                tone="secondary"
              >
                {t(commonMessages.retry)}
              </Button>
            </div>
          ) : targets.length === 0 ? (
            <p className="px-3 py-5 text-center text-sm text-app-muted">
              {query.trim()
                ? `No matching ${kind === "room" ? "rooms" : "agents"}.`
                : kind === "room"
                  ? "No other rooms available."
                  : "No agents available."}
            </p>
          ) : (
            targets.map((target) => {
              const key = forwardTargetKey(target);
              const checked = selectedKeys.has(key);
              const confirmed = forwarded.includes(key);
              return (
                <button
                  className="flex min-h-14 w-full items-center justify-between px-3 text-left hover:bg-app-hover disabled:cursor-default disabled:opacity-50"
                  disabled={sending || confirmed}
                  key={key}
                  onClick={() => toggleTarget(target)}
                  type="button"
                >
                  <span className="text-sm text-app-ink">{target.label}</span>
                  <span className="text-xs text-app-muted">
                    {confirmed
                      ? "Forwarded"
                      : checked
                        ? t(chatMessages.targetSelected)
                        : t(chatMessages.selectTarget)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </ModalDialog>
  );
}
