import { Link, useMatch } from "react-router";

import { whoManagesPath } from "./who-manages";

/** Opens the choice of who may manage this room from now on. */
export function WhoManagesLink({
  roomId,
  tenantId,
}: {
  roomId: string;
  tenantId: string;
}) {
  const here = useMatch("/t/:tenantId/rooms/:roomId/who-manages");
  if (here) return null;
  return (
    <Link
      className="shrink-0 rounded-md px-2 py-1 text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to={whoManagesPath(tenantId, roomId)}
    >
      Who can manage
    </Link>
  );
}
