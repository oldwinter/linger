import { useEffect, useState } from "react";

import { dayKey } from "@/lib/date-format";

/** Milliseconds until the next local midnight. Exactly midnight waits a full day. */
export function msUntilLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const delay = next.getTime() - now.getTime();
  return delay > 0 ? delay : 24 * 60 * 60 * 1000;
}

/**
 * The viewer's calendar day, refreshed when that day ends. A view that means
 * "today" can follow the date while it stays open.
 */
export function useLocalCalendarDay(): string {
  const [day, setDay] = useState(() => dayKey(new Date()));
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      const now = new Date();
      const nextDay = dayKey(now);
      setDay((current) => (current === nextDay ? current : nextDay));
      timer = window.setTimeout(arm, msUntilLocalMidnight(now));
    };
    arm();
    return () => window.clearTimeout(timer);
  }, []);
  return day;
}
