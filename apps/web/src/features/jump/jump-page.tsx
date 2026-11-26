import { Search01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useMeetings } from "@/features/memory/memory-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import {
  anotherMeQueryOptions,
  tenantRoomsQueryOptions,
} from "@/features/rooms/room-queries";
import { searchShortcutLabel } from "@/features/search/search-shortcut";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { buildJumpPlaces, filterJumpPlaces } from "./jump-places";
import { jumpMessages as m } from "./jump.messages";

/** One field that opens a room, a meeting, or a part of the library. */
export function JumpPage() {
  const { client } = useTeamHubRuntime();
  const navigate = useNavigate();
  const t = useT();
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
  const searchShortcut = searchShortcutLabel();

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
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {t(m.title)}
            </h1>
            <Button
              onClick={() => void navigate(-1)}
              size="compact"
              tone="ghost"
            >
              {t(commonMessages.back)}
            </Button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t(m.subtitle)}</p>
          <p className="mt-2.5 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <Icon className="shrink-0" icon={Search01Icon} size={14} />
            <span>{t(m.searchHint, { shortcut: searchShortcut })}</span>
          </p>
        </header>
        <div className="flex flex-col gap-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor="jump-query"
          >
            {t(m.fieldLabel)}
          </label>
          <input
            aria-activedescendant={
              places[active] ? `jump-place-${places[active].id}` : undefined
            }
            aria-autocomplete="list"
            aria-controls="jump-places"
            aria-expanded={!loading && places.length > 0}
            className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-xs placeholder:text-app-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="jump-query"
            ref={inputRef}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t(m.placeholder)}
            role="combobox"
            value={query}
          />
        </div>
        {failed ? (
          <div
            className="flex items-center justify-between gap-3 rounded-xl border border-(--app-status-danger-border) bg-(--app-status-danger-surface) px-3.5 py-2.5 text-sm text-(--app-status-danger-text)"
            role="alert"
          >
            <span>
              {rooms.isError && meetings.isError
                ? t(m.loadFailedAll)
                : rooms.isError
                  ? t(m.loadFailedRooms)
                  : t(m.loadFailedMeetings)}
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
              {t(commonMessages.retry)}
            </Button>
          </div>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.loading)}
          </p>
        ) : places.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t(m.noMatch)}
          </p>
        ) : (
          <ul
            aria-label={t(m.placesLabel)}
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
