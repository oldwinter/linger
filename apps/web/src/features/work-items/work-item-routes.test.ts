import { describe, expect, it } from "vitest";

import { dashboardWorkItemPath } from "./work-item-routes";

describe("dashboardWorkItemPath", () => {
  it("builds the Work Item's dashboard link", () => {
    expect(dashboardWorkItemPath("tenant-northstar", "workitem-login")).toBe(
      "/t/tenant-northstar/dashboard/workitem-login",
    );
  });

  it("encodes ids that need it", () => {
    expect(dashboardWorkItemPath("tenant north", "work/item")).toBe(
      "/t/tenant%20north/dashboard/work%2Fitem",
    );
  });
});
