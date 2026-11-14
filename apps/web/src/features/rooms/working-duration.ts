import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_HOURS = 24;

/** Keeps the moment each still-running Room started, and drops the ones that stopped. */
export function retainWorkingSince(
  runningIds: readonly string[],
  previous: Readonly<Record<string, number>>,
  now: number,
): Readonly<Record<string, number>> {
  const next: Record<string, number> = {};
  for (const id of runningIds) next[id] = previous[id] ?? now;
  return next;
}

export interface WorkingDuration {
  /** Compact clock, such as `4m` or `2h 5m`. */
  short: string;
  /** Spoken form for the status icon. */
  speech: string;
}

function unit(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** How long a Room has been working, once it has reached a minute. */
export function workingDuration(
  since: number | undefined,
  now: number,
): WorkingDuration | undefined {
  if (since === undefined || now < since) return;
  const minutes = Math.floor((now - since) / MINUTE_MS);
  if (minutes < 1) return;
  const hours = Math.floor(minutes / HOUR_MINUTES);
  const days = Math.floor(hours / DAY_HOURS);
  if (days >= 1) {
    return {
      short: `${days}d`,
      speech: `Agent working for ${unit(days, "day", "days")}`,
    };
  }
  if (hours >= 1) {
    const rest = minutes % HOUR_MINUTES;
    const hourText = unit(hours, "hour", "hours");
    return {
      short: rest === 0 ? `${hours}h` : `${hours}h ${rest}m`,
      speech:
        rest === 0
          ? `Agent working for ${hourText}`
          : `Agent working for ${hourText} ${unit(rest, "minute", "minutes")}`,
    };
  }
  return {
    short: `${minutes}m`,
    speech: `Agent working for ${unit(minutes, "minute", "minutes")}`,
  };
}

const TICK_MS = 15_000;

/** One clock for every running Room, so a minute label does not reset on each poll. */
export function useWorkingClock(runningIds: readonly string[]) {
  const key = runningIds.join("\0");
  const [since, setSince] = useState<Readonly<Record<string, number>>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const ids = key.length === 0 ? [] : key.split("\0");
    setSince((current) => retainWorkingSince(ids, current, Date.now()));
    setNow(Date.now());
  }, [key]);
  useEffect(() => {
    if (key.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [key]);
  return { now, since };
}
