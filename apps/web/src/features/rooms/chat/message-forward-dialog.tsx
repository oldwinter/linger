import {
  Cancel01Icon,
  Search01Icon,
  SentIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { idempotencyHeader, teamHubData } from "@/features/teamhub/teamhub-api";
import {
  createTeamHubIdempotencyKey,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import type { TeamHubMessage } from "@/features/teamhub/teamhub-types";
import { tenantActorsQueryOptions } from "../room-queries";

type TargetKind = "agent" | "room";

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
  const [selected, setSelected] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const [forwarded, setForwarded] = useState<string[]>([]);
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
  const targets = useMemo(() => {
    const values: Array<{ id: string; label: string }> = [];
    if (kind === "room") {
      for (const room of rooms.data?.items ?? []) {
        values.push({ id: room.id, label: room.name });
      }
    } else {
      for (const actor of actors.data?.items ?? []) {
        if (actor.kind === kind) {
          values.push({ id: actor.id, label: actor.display_name });
        }
      }
    }
    const needle = query.trim().toLowerCase();
    return needle
      ? values.filter((target) => target.label.toLowerCase().includes(needle))
      : values;
  }, [actors.data, kind, query, rooms.data]);
  const selectedSet = new Set(selected);
  const targetById = new Map(targets.map((target) => [target.id, target]));

  function close() {
    if (!sendingRef.current) onClose();
  }

  function toggleTarget(targetId: string) {
    if (sendingRef.current || forwarded.includes(`${kind}:${targetId}`)) return;
    setSelected((current) =>
      current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : [...current, targetId],
    );
  }

  async function forward() {
    if (!selected.length || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        selected.map((targetId) => {
          const targetKey = `${kind}:${targetId}`;
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
              body: { target: { id: targetId, kind } },
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
        ...confirmed.map((targetId) => `${kind}:${targetId}`),
      ]);
      setSelected(remaining);
      if (!remaining.length) {
        onClose();
        return;
      }
      setError(
        confirmed.length
          ? `Forwarded to ${confirmed.length} of ${selected.length} targets. Retry the ${remaining.length} remaining ${remaining.length === 1 ? "target" : "targets"}.`
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
      title="Forward to"
      footer={
        <div className="w-full">
          {error ? (
            <p className="mb-3 text-sm text-app-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button disabled={sending} onClick={close} tone="ghost">
              Cancel
            </Button>
            <Button
              disabled={!selected.length}
              loading={sending}
              onClick={() => void forward()}
            >
              <Icon icon={SentIcon} size={16} /> Forward
            </Button>
          </div>
        </div>
      }
    >
      <div className="px-5 py-4">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(searchInput);
          }}
        >
          <input
            aria-label="Search forward targets"
            className="h-11 min-w-0 flex-1 rounded-md border border-app-border px-3 text-sm outline-none focus:border-app-focus"
            disabled={sending}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setQuery(searchInput);
            }}
            placeholder="Search"
            value={searchInput}
          />
          <Button
            aria-label="Search"
            disabled={sending}
            size="icon"
            tone="secondary"
            type="submit"
          >
            <Icon icon={Search01Icon} size={16} />
          </Button>
        </form>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["agent", "room"] as const).map((targetKind) => (
            <Button
              key={targetKind}
              disabled={sending}
              onClick={() => {
                if (sendingRef.current) return;
                setKind(targetKind);
                setSelected([]);
                setError(null);
              }}
              size="compact"
              tone={kind === targetKind ? "primary" : "secondary"}
            >
              {targetKind === "agent" ? "Agents" : "Rooms"}
            </Button>
          ))}
        </div>
        {selected.length ? (
          <div
            aria-label="Selected forward targets"
            className="mt-3 flex flex-wrap gap-2"
          >
            {selected.map((targetId) => {
              const target = targetById.get(targetId);
              return (
                <button
                  aria-pressed="true"
                  className="inline-flex items-center gap-1 rounded-full bg-app-selected px-2.5 py-1 text-xs text-app-ink"
                  disabled={sending}
                  key={targetId}
                  onClick={() => toggleTarget(targetId)}
                  title="Remove selected target"
                  type="button"
                >
                  <Icon icon={Tick02Icon} size={14} />{" "}
                  {target?.label ?? targetId}
                  <Icon icon={Cancel01Icon} size={14} />
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="mt-3 divide-y divide-app-border border-y border-app-border">
          {targets.map((target) => {
            const checked = selectedSet.has(target.id);
            const confirmed = forwarded.includes(`${kind}:${target.id}`);
            return (
              <button
                className="flex min-h-14 w-full items-center justify-between px-3 text-left hover:bg-app-hover disabled:cursor-default disabled:opacity-50"
                disabled={sending || confirmed}
                key={target.id}
                onClick={() => toggleTarget(target.id)}
                type="button"
              >
                <span className="text-sm text-app-ink">{target.label}</span>
                <span className="text-xs text-app-muted">
                  {confirmed ? "Forwarded" : checked ? "Selected" : "Select"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </ModalDialog>
  );
}
