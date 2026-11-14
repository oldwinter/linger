import {
  Cancel01Icon,
  PinIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type UIEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { HighlightedText } from "@/features/search/search-highlight";
import type { TeamHubMessagePinList } from "@/features/teamhub/teamhub-types";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { roomPinsQueryOptions } from "../../room-queries";
import { searchPinnedMessages } from "./pinned-message-search";
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
  // The filter is view state for this opening in this Room; closing the panel
  // or opening another Room starts it over.
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(0);
  const restoreScroll = useRef(false);
  useEffect(() => {
    setQuery("");
    scrollRef.current = 0;
    restoreScroll.current = false;
  }, [open, roomId]);
  useLayoutEffect(() => {
    if (!restoreScroll.current) return;
    restoreScroll.current = false;
    if (listRef.current) listRef.current.scrollTop = scrollRef.current;
  }, [query]);
  const filtering = query.trim().length > 0;
  const search = searchPinnedMessages(pins, query);
  function changeQuery(next: string) {
    // Clearing returns the list the person had scrolled through before.
    if (!next.trim() && filtering) restoreScroll.current = true;
    setQuery(next);
  }
  function rememberScroll(event: UIEvent<HTMLDivElement>) {
    if (!filtering) scrollRef.current = event.currentTarget.scrollTop;
  }
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
            <div className="flex items-baseline gap-1.5">
              <h2 className="text-sm font-medium text-foreground">Pinned</h2>
              {filtering ? (
                <span aria-live="polite" className="text-2xs text-app-subtle">
                  {search.count} of {pins.length}
                </span>
              ) : null}
            </div>
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
          {!isPending && !isError && pins.length > 0 ? (
            <label className="mb-1 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-muted-foreground transition-colors hover:border-border-hover focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring/40">
              <Icon icon={Search01Icon} size={14} />
              <input
                aria-label="Search pinned messages"
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                onChange={(event) => changeQuery(event.target.value)}
                placeholder="Search pinned messages"
                role="searchbox"
                type="text"
                value={query}
              />
              {query ? (
                <button
                  aria-label="Clear pinned message search"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
                  onClick={() => changeQuery("")}
                  type="button"
                >
                  <Icon icon={Cancel01Icon} size={12} />
                </button>
              ) : null}
            </label>
          ) : null}
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
            // The scroller stays mounted so clearing the filter can put the
            // list back where the person left it.
            <div
              className="workspace-scrollbar flex min-h-0 flex-col gap-1 overflow-y-auto"
              onScroll={rememberScroll}
              ref={listRef}
            >
              {filtering && search.count === 0 ? (
                <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
                  <p className="text-xs text-app-muted">
                    No pinned messages match “{query.trim()}”.
                  </p>
                  <Button
                    onClick={() => changeQuery("")}
                    size="compact"
                    tone="secondary"
                  >
                    Clear search
                  </Button>
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {search.items.map((pin) => {
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
                          <HighlightedText
                            query={query}
                            text={pin.message.author.display_name}
                          />
                        </p>
                        <p className="line-clamp-2 text-xs text-app-ink">
                          <HighlightedText
                            query={query}
                            text={pin.message.raw_message}
                          />
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
                          <p
                            className="mt-1 text-xs text-app-danger"
                            role="alert"
                          >
                            Could not unpin the message.
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
