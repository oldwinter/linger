const stateLabel: Record<string, string> = {
  in_progress: "in progress",
  open: "open",
  resolved: "resolved",
};

/** The fields the side-by-side reading compares. Display only. */
export interface WorkItemPairFacts {
  priority: string;
  /** Whether a room is doing this work. */
  room: boolean;
  state: string;
  title: string;
}

export function workItemPairPath(
  tenantId: string,
  leftId: string,
  rightId: string,
) {
  const params = new URLSearchParams({ left: leftId, right: rightId });
  return `/t/${encodeURIComponent(tenantId)}/dashboard/side-by-side?${params}`;
}

/**
 * How two Work Items differ on state, priority, and whether a room is doing
 * the work. Same facts produce one sentence instead of a list of matches.
 */
export function workItemPairContrast(
  left: WorkItemPairFacts,
  right: WorkItemPairFacts,
): string {
  const lines: string[] = [];
  if (left.state !== right.state) {
    lines.push(
      `${left.title} is ${labelState(left.state)}; ${right.title} is ${labelState(right.state)}.`,
    );
  }
  if (left.priority !== right.priority) {
    lines.push(
      `${left.title} is ${left.priority} priority; ${right.title} is ${right.priority} priority.`,
    );
  }
  if (left.room !== right.room) {
    lines.push(
      left.room
        ? `${left.title} has a room doing the work; ${right.title} does not.`
        : `${right.title} has a room doing the work; ${left.title} does not.`,
    );
  }
  if (lines.length === 0) {
    return "Same state, same priority, and the same kind of room.";
  }
  return lines.join(" ");
}

function labelState(state: string) {
  return stateLabel[state] ?? state;
}
