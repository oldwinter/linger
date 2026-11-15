import { Link, useMatch } from "react-router";

import { workMovesPath } from "./work-moves";

/** Opens the room's collaboration as a sequence, not the sidebar graph. */
export function WorkMovesLink({
  roomId,
  tenantId,
}: {
  roomId: string;
  tenantId: string;
}) {
  const here = useMatch("/t/:tenantId/rooms/:roomId/how-work-moves");
  if (here) return null;
  return (
    <Link
      className="shrink-0 rounded-md px-2 py-1 text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to={workMovesPath(tenantId, roomId)}
    >
      How work moves
    </Link>
  );
}
