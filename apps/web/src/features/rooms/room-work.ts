import type { TeamHubRunStatus } from "@/features/teamhub/teamhub-types";
import { isRunWorking } from "@/features/teamhub/run-status";

export function roomWorkPath(tenantId: string, roomId: string) {
  return `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/working`;
}

/**
 * The run this screen should show. A run that is still working wins over a
 * finished one, and the latest update wins among those.
 */
export function chooseRoomWorkRun(
  runs: readonly TeamHubRunStatus[],
): TeamHubRunStatus | undefined {
  const working = runs.filter(isRunWorking);
  const pool = working.length > 0 ? working : runs;
  return [...pool].sort(
    (left, right) =>
      right.updated_at.localeCompare(left.updated_at) ||
      right.id.localeCompare(left.id),
  )[0];
}
