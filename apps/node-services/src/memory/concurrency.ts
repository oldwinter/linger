/** Runs work with at most a fixed number of pieces in flight. */
export type ConcurrencyLimit = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * Starts work in submission order once fewer than `concurrency` pieces run.
 * A finishing piece hands its slot straight to the next waiter, so work
 * submitted in between cannot take the slot and exceed the limit.
 */
export function concurrencyLimit(concurrency: number): ConcurrencyLimit {
  const waiters: Array<() => void> = [];
  let active = 0;
  return async (work) => {
    if (active < concurrency) active += 1;
    else await new Promise<void>((resolve) => waiters.push(resolve));
    try {
      return await work();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
