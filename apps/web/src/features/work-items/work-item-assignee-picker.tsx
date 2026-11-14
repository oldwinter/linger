import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { buttonClassName } from "@/components/ui/button";
import { ActorAvatar } from "@/features/rooms/members/actor-avatar";
import { tenantActorsQueryOptions } from "@/features/rooms/room-queries";
import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { updateFailureMessage } from "./work-item-failure";
import { useAssignWorkItem } from "./work-item-queries";

/** A candidate list longer than this gets a search field above it. */
const searchThreshold = 8;

/** The Actor a person chose and the one idempotency key for that choice. */
interface AssigneeChoice {
  actorId: string;
  idempotencyKey: string;
}

/**
 * Assigns another same-Tenant Human or Agent from the peek. An Actor already on
 * the Item is not offered. Choosing one keeps the picker open until the
 * Assignment lands, and a refusal keeps it open with the chosen Actor marked so
 * a retry sends the same choice and reuses its idempotency key.
 */
export function WorkItemAssigneePicker({
  assignedActorIds,
  disabled,
  tenantId,
  workItemId,
}: {
  assignedActorIds: readonly string[];
  /** Blocks the trigger while another assignment is in flight. */
  disabled: boolean;
  tenantId: string;
  workItemId: string;
}) {
  const { client } = useTeamHubRuntime();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [choice, setChoice] = useState<AssigneeChoice>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const actors = useQuery({
    ...tenantActorsQueryOptions(client, tenantId),
    enabled: open,
    retry: false,
  });
  const assign = useAssignWorkItem(tenantId, workItemId);
  const assigned = new Set(assignedActorIds);
  const candidates = (actors.data?.items ?? []).filter(
    (actor) => !assigned.has(actor.id),
  );
  const showSearch = candidates.length > searchThreshold;
  const needle = search.trim().toLocaleLowerCase();
  const matches = needle
    ? candidates.filter((actor) =>
        actor.display_name.toLocaleLowerCase().includes(needle),
      )
    : candidates;
  const groups = (["human", "agent"] as const).map((kind) => ({
    actors: matches.filter((actor) => actor.kind === kind),
    kind,
  }));

  useLayoutEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    if (!popup) return;
    popup.showPopover?.();
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || !popup) return;
      const height = Math.min(280, window.innerHeight - 16);
      popup.style.width = `${Math.min(280, window.innerWidth - 32)}px`;
      popup.style.maxHeight = `${height}px`;
      popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
      popup.style.top = `${Math.max(8, rect.bottom + popup.offsetHeight + 8 < window.innerHeight ? rect.bottom + 6 : rect.top - popup.offsetHeight - 6)}px`;
    }
    place();
    if (showSearch) searchRef.current?.focus();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(place);
    observer?.observe(popup);
    let positionTimer: number | undefined;
    function schedulePlace() {
      if (positionTimer !== undefined) return;
      positionTimer = window.setTimeout(() => {
        positionTimer = undefined;
        place();
      }, 16);
    }
    window.addEventListener("resize", schedulePlace);
    window.addEventListener("scroll", schedulePlace, true);
    return () => {
      observer?.disconnect();
      window.clearTimeout(positionTimer);
      window.removeEventListener("resize", schedulePlace);
      window.removeEventListener("scroll", schedulePlace, true);
    };
  }, [open, showSearch]);

  // Without a search field the list takes focus, so arrows act on its options.
  useEffect(() => {
    if (!open || showSearch) return;
    const popup = popupRef.current;
    if (!popup || popup.contains(document.activeElement)) return;
    popup
      .querySelector<HTMLButtonElement>("[data-assignee-option]:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [open, showSearch, actors.data]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      // A choice in flight must land in the open picker, where a refusal shows.
      if (assign.isPending) return;
      if (
        !popupRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, assign.isPending]);

  function closePicker() {
    setOpen(false);
    setSearch("");
  }

  function choose(actorId: string) {
    if (assign.isPending) return;
    const next =
      choice?.actorId === actorId
        ? choice
        : { actorId, idempotencyKey: createTeamHubIdempotencyKey() };
    setChoice(next);
    assign.mutate(
      { actorId, idempotencyKey: next.idempotencyKey },
      {
        onSuccess: () => {
          setChoice(undefined);
          closePicker();
        },
      },
    );
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={buttonClassName({ size: "compact" })}
        disabled={disabled}
        onClick={() => {
          if (open) {
            closePicker();
            return;
          }
          assign.reset();
          setSearch("");
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        Assign someone
      </button>
      {open ? (
        <dialog
          aria-label="Assign someone"
          className="app-floating-enter fixed inset-auto z-[100] m-0 flex flex-col overflow-hidden rounded-md bg-popover p-1 text-foreground shadow-md"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (assign.isPending) return;
              closePicker();
              triggerRef.current?.focus();
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const options = Array.from(
                popupRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button[data-assignee-option]:not(:disabled)",
                ) ?? [],
              );
              const current = options.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              options[
                (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  options.length) %
                  options.length
              ]?.focus();
            }
          }}
          open
          popover="manual"
          ref={popupRef}
        >
          {showSearch ? (
            <input
              aria-label="Search Actors"
              className="min-h-9 w-full shrink-0 rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              placeholder="Search Actors..."
              ref={searchRef}
              role="searchbox"
              value={search}
            />
          ) : null}
          <div className="workspace-scrollbar min-h-0 overflow-y-auto">
            {actors.isPending ? (
              <p className="p-2 text-xs text-muted-foreground" role="status">
                Loading Actors…
              </p>
            ) : null}
            {actors.isError ? (
              <p className="p-2 text-xs text-app-danger" role="alert">
                Actors could not be loaded.
              </p>
            ) : null}
            {actors.isSuccess && !matches.length ? (
              <p className="p-2 text-xs text-muted-foreground">
                {needle ? "No Actors match." : "No Actors available."}
              </p>
            ) : null}
            {groups.map(({ actors: groupActors, kind }) => {
              if (!groupActors.length) return null;
              return (
                <section
                  aria-label={kind === "human" ? "Humans" : "Agents"}
                  key={kind}
                >
                  <h4 className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
                    {kind === "human" ? "Humans" : "Agents"}
                  </h4>
                  {groupActors.map((actor) => (
                    <button
                      aria-current={
                        choice?.actorId === actor.id ? "true" : undefined
                      }
                      aria-label={actor.display_name}
                      className="flex min-h-[33px] w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
                      data-assignee-option
                      disabled={assign.isPending}
                      key={actor.id}
                      onClick={() => choose(actor.id)}
                      type="button"
                    >
                      <ActorAvatar
                        actorId={actor.id}
                        kind={actor.kind}
                        name={actor.display_name}
                        size="micro"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {actor.display_name}
                      </span>
                    </button>
                  ))}
                </section>
              );
            })}
            {assign.isPending ? (
              <p className="p-2 text-xs text-muted-foreground" role="status">
                Assigning…
              </p>
            ) : null}
            {assign.error ? (
              <p className="p-2 text-xs text-app-danger" role="alert">
                {updateFailureMessage(assign.error)}
              </p>
            ) : null}
          </div>
        </dialog>
      ) : null}
    </>
  );
}
