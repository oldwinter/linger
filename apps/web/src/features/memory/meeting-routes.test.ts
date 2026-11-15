import { describe, expect, it } from "vitest";

import { meetingPath } from "./meeting-routes";

describe("meetingPath", () => {
  it("names one meeting inside its Tenant's Library", () => {
    expect(
      meetingPath("tenant-northstar", "meeting_012345678901234567890123"),
    ).toBe(
      "/t/tenant-northstar/library/meetings?entry=meeting_012345678901234567890123",
    );
  });

  it("encodes the Tenant and meeting ids", () => {
    expect(meetingPath("tenant north/one", "meeting:one")).toBe(
      "/t/tenant%20north%2Fone/library/meetings?entry=meeting%3Aone",
    );
  });
});
