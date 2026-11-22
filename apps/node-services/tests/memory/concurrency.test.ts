import { describe, expect, it } from "vitest";

import { concurrencyLimit } from "../../src/memory/concurrency.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("concurrencyLimit", () => {
  it("never runs more than the limit, even for work submitted during a handoff", async () => {
    const limit = concurrencyLimit(2);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, deferred);
    const run = (index: number) =>
      limit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gates[index]!.promise;
        active -= 1;
        return index;
      });
    const first = [0, 1, 2].map(run);
    gates[0]!.resolve();
    // Submitted while slot 0 passes to the waiting work 2.
    const late = [3, 4].map(run);
    for (const gate of gates) gate.resolve();
    await expect(Promise.all([...first, ...late])).resolves.toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(peak).toBe(2);
  });

  it("starts waiting work in submission order", async () => {
    const limit = concurrencyLimit(1);
    const started: number[] = [];
    await Promise.all(
      [0, 1, 2].map((index) =>
        limit(async () => {
          started.push(index);
        }),
      ),
    );
    expect(started).toEqual([0, 1, 2]);
  });

  it("frees the slot of work that fails", async () => {
    const limit = concurrencyLimit(1);
    await expect(
      limit(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(limit(async () => "next")).resolves.toBe("next");
  });
});
