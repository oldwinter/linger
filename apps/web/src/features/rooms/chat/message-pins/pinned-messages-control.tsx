import { Cancel01Icon, PinIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TeamHubMessagePinList } from "@/features/teamhub/teamhub-types";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { roomPinsQueryOptions } from "../../room-queries";
import { useMessagePinToggle } from "./use-message-pin-toggle";

type MessagePin = TeamHubMessagePinList["items"][number];

/** The Room header's Pinned button and the newest-first list it opens. */
export function PinnedMessagesControl({
  onJump,
  roomId,
  tenantId,
}: {
  onJump: (messageId: string) => void;
  roomId: string;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data, isError, isPending, refetch } = useQuery({
    ...roomPinsQueryOptions(client, tenantId, roomId),
    enabled: open,
  });
  const togglePin = useMessagePinToggle({
    client,
    queryClient,
    roomId,
    tenantId,
  });
  // The toggle rereads the Pinned list in its finally, so a success removes the
  // entry and the header's list follows without a reload, while a failure
  // leaves the authoritative pin in place.
  const unpin = useMutation({
    mutationFn: (pin: MessagePin) => togglePin(pin.message, true),
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      )
        setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pins = data?.items ?? [];
  return (
    <div className="relative" ref={rootRef}>
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Pinned messages"
        className="!rounded-lg border-0 text-app-muted"
        onClick={() => setOpen((current) => !current)}
        size="compactIcon"
        title="Pinned messages"
        tone="ghost"
      >
        <Icon icon={PinIcon} size={16} />
      </Button>
      {open ? (
        <div
          aria-label="Pinned messages"
          className="app-popover-card absolute top-full right-0 z-50 mt-2 flex max-h-96 w-80 flex-col p-2"
          role="dialog"
        >
          <div className="flex items-center justify-between px-1 pb-1">
            <h2 className="text-sm font-medium text-foreground">Pinned</h2>
            <Button
              aria-label="Close pinned messages"
              className="!rounded-lg border-0 text-app-muted"
              onClick={() => setOpen(false)}
              size="compactIcon"
              title="Close pinned messages"
              tone="ghost"
            >
              <Icon icon={Cancel01Icon} size={14} />
            </Button>
          </div>
          {isPending ? (
            <p className="px-1 py-2 text-xs text-app-subtle">
              Loading pinned messages
            </p>
          ) : isError ? (
            <Button
              className="mx-1 my-2 justify-start"
              onClick={() => void refetch()}
              size="compact"
              tone="secondary"
            >
              Retry pinned messages
            </Button>
          ) : pins.length === 0 ? (
            <p className="px-1 py-2 text-xs text-app-subtle">
              No pinned messages yet.
            </p>
          ) : (
            <ul className="workspace-scrollbar flex min-h-0 flex-col gap-1 overflow-y-auto">
              {pins.map((pin) => {
                const unpinning =
                  unpin.isPending &&
                  unpin.variables?.message.id === pin.message.id;
                const unpinFailed =
                  unpin.isError &&
                  unpin.variables?.message.id === pin.message.id;
                return (
                  <li
                    className="rounded-md p-2 hover:bg-accent"
                    key={pin.message.id}
                  >
                    <p className="truncate text-2xs font-medium text-app-subtle">
                      {pin.message.author.display_name}
                    </p>
                    <p className="line-clamp-2 text-xs text-app-ink">
                      {pin.message.raw_message}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      <Button
                        className="justify-start"
                        onClick={() => {
                          onJump(pin.message.id);
                          setOpen(false);
                        }}
                        size="compact"
                        tone="ghost"
                      >
                        Go to message
                      </Button>
                      <Button
                        disabled={unpinning}
                        onClick={() => unpin.mutate(pin)}
                        size="compact"
                        tone="ghost"
                      >
                        Unpin
                      </Button>
                    </div>
                    {unpinFailed ? (
                      <p className="mt-1 text-xs text-app-danger" role="alert">
                        Could not unpin the message.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
