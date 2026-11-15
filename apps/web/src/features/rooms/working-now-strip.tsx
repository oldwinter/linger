import { Link } from "react-router";

import { workingPhaseLabel, type WorkingNowRoom } from "./working-now";

/** Rooms whose agents are working right now. It leaves when none are. */
export function WorkingNowStrip({
  onNavigate,
  rooms,
  tenantId,
}: {
  onNavigate: () => void;
  rooms: readonly WorkingNowRoom[];
  tenantId: string;
}) {
  if (rooms.length === 0) return null;
  return (
    <section aria-label="Working now" className="mx-2 flex flex-col gap-1">
      <h2 className="px-1 text-xs font-medium text-app-muted">Working now</h2>
      <ul className="flex flex-col gap-1">
        {rooms.map((room) => (
          <li key={room.id}>
            <Link
              aria-label={`${room.name}, ${workingPhaseLabel(room.phase)}`}
              className="block rounded-lg bg-app-hover px-2.5 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-focus"
              onClick={onNavigate}
              to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(room.id)}/chat`}
            >
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="truncate text-sm text-foreground">
                  {room.name}
                </span>
                <span className="shrink-0 text-xs text-app-muted">
                  {workingPhaseLabel(room.phase)}
                </span>
              </span>
              {room.preview ? (
                <span className="mt-0.5 block truncate text-xs text-app-muted">
                  {room.preview}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
