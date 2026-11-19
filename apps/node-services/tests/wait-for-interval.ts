import { vi } from "vitest";

// Vitest polls waitFor every 50 ms by default, so a condition that becomes
// true just after the first check costs a whole interval. Tests here wait on
// in-process events that settle within microtasks, so poll more often. The
// timeout stays the caller's; under fake timers each poll still advances the
// clock by the interval, keeping the total advanced time per real timeout.
const WAIT_FOR_INTERVAL_MS = 5;

type WaitForOptions = Parameters<typeof vi.waitFor>[1];

const waitFor = vi.waitFor.bind(vi);
vi.waitFor = ((
  callback: Parameters<typeof vi.waitFor>[0],
  options?: WaitForOptions,
) => waitFor(callback, withInterval(options))) as typeof vi.waitFor;
const waitUntil = vi.waitUntil.bind(vi);
vi.waitUntil = ((
  callback: Parameters<typeof vi.waitUntil>[0],
  options?: Parameters<typeof vi.waitUntil>[1],
) => waitUntil(callback, withInterval(options))) as typeof vi.waitUntil;

function withInterval(options: WaitForOptions): WaitForOptions {
  if (typeof options === "number") {
    return { timeout: options, interval: WAIT_FOR_INTERVAL_MS };
  }
  return { interval: WAIT_FOR_INTERVAL_MS, ...options };
}
