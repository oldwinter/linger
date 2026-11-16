import { describe, expect, it } from "vitest";

import { workItemPairContrast, workItemPairPath } from "./work-item-pair";

const login = {
  priority: "high",
  room: true,
  state: "in_progress",
  title: "Fix login",
};

describe("work item pair", () => {
  it("builds a dashboard path for the two cards", () => {
    expect(workItemPairPath("tenant one", "left", "right")).toBe(
      "/t/tenant%20one/dashboard/side-by-side?left=left&right=right",
    );
  });

  it("names the structured differences and stays quiet when they match", () => {
    expect(
      workItemPairContrast(login, {
        priority: "low",
        room: false,
        state: "open",
        title: "Write the note",
      }),
    ).toBe(
      "Fix login is in progress; Write the note is open. Fix login is high priority; Write the note is low priority. Fix login has a room doing the work; Write the note does not.",
    );
    expect(
      workItemPairContrast(login, { ...login, title: "Fix login again" }),
    ).toBe("Same state, same priority, and the same kind of room.");
  });
});
