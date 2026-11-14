import { Link, useMatch } from "react-router";

import { useRoomActivity } from "./use-room-activity";
import { steerRunPath } from "./steer-run";

/** Shown while this room has a run you can stop before its next step. */
export function SteerRunLink({
  roomId,
  tenantId,
}: {
  roomId: string;
  tenantId: string;
}) {
  const here = useMatch("/t/:tenantId/rooms/:roomId/steer");
  const { runningRoomIds } = useRoomActivity(tenantId, true);
  if (here || !runningRoomIds.includes(roomId)) return null;
  return (
    <Link
      className="shrink-0 rounded-md px-2 py-1 text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to={steerRunPath(tenantId, roomId)}
    >
      Steer this run
    </Link>
  );
}
