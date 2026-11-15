import { describe, expect, it } from "vitest";

import {
  computerPermissionActionLabel,
  nextComputerPermissionStep,
} from "./computer-can-do";

describe("what a Mac can do", () => {
  it("asks macOS, then opens Settings, then relaunches", () => {
    expect(
      nextComputerPermissionStep("linger", {
        id: "screen_recording",
        prompt: "available",
        relaunch_required: false,
        state: "not_determined",
      }),
    ).toEqual({
      action: "prompt",
      permission: "screen_recording",
      subject: "linger",
    });
    expect(
      computerPermissionActionLabel({
        action: "prompt",
        permission: "screen_recording",
        subject: "linger",
      }),
    ).toBe("Ask macOS for Screen Recording");
    expect(
      nextComputerPermissionStep("computer_use", {
        id: "accessibility",
        prompt: "settings_only",
        relaunch_required: false,
        state: "denied",
      })?.action,
    ).toBe("open_settings");
    expect(
      nextComputerPermissionStep("linger", {
        id: "accessibility",
        prompt: "available",
        relaunch_required: true,
        state: "granted",
      })?.action,
    ).toBe("relaunch");
    expect(
      nextComputerPermissionStep("linger", {
        id: "accessibility",
        prompt: "available",
        relaunch_required: false,
        state: "granted",
      }),
    ).toBeUndefined();
  });
});
