import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { useMeetings } from "@/features/memory/memory-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import {
  anotherMeQueryOptions,
  tenantRoomsQueryOptions,
} from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { buildJumpPlaces, filterJumpPlaces } from "./jump-places";

/** One field that opens a room, a meeting, or a part of the library. */
export function JumpPage() {
  const { client } = useTeamHubRuntime();
  const navigate = useNavigate();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const anotherMe = useQuery(anotherMeQueryOptions(client, tenantId));
  const meetings = useMeetings(tenantId);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const scrollActiveRef = useRef(false);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const places = filterJumpPlaces(
    buildJumpPlaces({
      anotherMeRoomId: anotherMe.data?.room_id,
      meetings: meetings.data ?? [],
      rooms: rooms.data?.items ?? [],
      tenantId,
    }),
    query,
  );
  const active = Math.min(activeIndex, Math.max(places.length - 1, 0));
  const loading =
    rooms.isPending ||
    meetings.isPending ||
    (anotherMe.isPending && !anotherMe.isError);
  const failed = rooms.isError || meetings.isError;

  useEffect(() => {
    if (!scrollActiveRef.current) return;
    scrollActiveRef.current = false;
    optionRefs.current[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      void navigate(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      scrollActiveRef.current = true;
      setActiveIndex(Math.min(active + 1, Math.max(places.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      scrollActiveRef.current = true;
      setActiveIndex(Math.max(active - 1, 0));
    } else if (event.key === "Enter") {
      const place = places[active];
      if (!place) return;
      event.preventDefault();
      void navigate(place.path);
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-xl text-foreground">Jump</h1>
            <Button
              onClick={() => void navigate(-1)}
              size="compact"
              tone="ghost"
            >
              Back
            </Button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Open a room, a meeting, or a part of the library. This does not
            search what was said.
          </p>
        </header>
        <div className="flex flex-col gap-2">
          <label className="text-sm text-foreground" htmlFor="jump-query">
            Where do you want to go?
          </label>
          <input
            aria-activedescendant={
              places[active] ? `jump-place-${places[active].id}` : undefined
            }
            aria-autocomplete="list"
            aria-controls="jump-places"
            aria-expanded={!loading && places.length > 0}
            className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="jump-query"
            ref={inputRef}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="A room, a meeting, Wiki, Library"
            role="combobox"
            value={query}
          />
        </div>
        {failed ? (
          <div
            className="flex items-center justify-between gap-3 rounded-xl border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] px-3.5 py-2.5 text-sm text-[var(--app-status-danger-text)]"
            role="alert"
          >
            <span>
              {rooms.isError && meetings.isError
                ? "Places could not be loaded."
                : rooms.isError
                  ? "Rooms could not be loaded."
                  : "Meetings could not be loaded."}
            </span>
            <Button
              onClick={() => {
                if (rooms.isError) void rooms.refetch();
                if (meetings.isError) void meetings.refetch();
                if (anotherMe.isError) void anotherMe.refetch();
              }}
              size="compact"
              tone="ghost"
            >
              Retry
            </Button>
          </div>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading places.
          </p>
        ) : places.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            Nothing matches that.
          </p>
        ) : (
          <ul
            aria-label="Places"
            className="flex flex-col gap-1"
            id="jump-places"
            role="listbox"
          >
            {places.map((place, index) => (
              <li
                aria-selected={index === active}
                className={
                  index === active ? "rounded-2xl bg-accent" : "rounded-2xl"
                }
                id={`jump-place-${place.id}`}
                key={place.id}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="option"
              >
                <Link
                  className="flex items-baseline justify-between gap-3 rounded-2xl px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onMouseMove={() => setActiveIndex(index)}
                  to={place.path}
                >
                  <span>{place.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {place.detail}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
