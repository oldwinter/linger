import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

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

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(active + 1, Math.max(places.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
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
          <h1 className="text-xl text-foreground">Jump</h1>
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
            aria-expanded={!loading && !failed && places.length > 0}
            className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading places.
          </p>
        ) : failed ? (
          <p className="text-sm text-destructive" role="alert">
            Places could not be loaded.
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
