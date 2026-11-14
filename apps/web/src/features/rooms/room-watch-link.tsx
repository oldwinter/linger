import { Link, useMatch } from "react-router";

import { useRoomActivity } from "./use-room-activity";
import { roomWorkPath } from "./room-work";

/** Shown in the Room header only while an agent is working in this Room. */
export function RoomWatchLink({
  roomId,
  tenantId,
}: {
  roomId: string;
  tenantId: string;
}) {
  const watching = useMatch("/t/:tenantId/rooms/:roomId/working");
  const { runningRoomIds } = useRoomActivity(tenantId, true);
  if (watching || !runningRoomIds.includes(roomId)) return null;
  return (
    <Link
      className="shrink-0 rounded-md px-2 py-1 text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to={roomWorkPath(tenantId, roomId)}
    >
      Watch the work
    </Link>
  );
}
