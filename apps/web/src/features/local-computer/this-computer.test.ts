import { describe, expect, it } from "vitest";

import { computerTheDesktopOpens } from "./this-computer";

const computers = ["computer-jenny-mac", "computer-lab"];

describe("computer the desktop opens", () => {
  it("opens this computer when several are connected", () => {
    expect(
      computerTheDesktopOpens(computers, {
        requestedId: null,
        showingDirectory: false,
        thisComputerId: "computer-jenny-mac",
      }),
    ).toBe("computer-jenny-mac");
  });

  it("leaves a chosen computer, the list, a browser, and a single computer alone", () => {
    expect(
      computerTheDesktopOpens(computers, {
        requestedId: "computer-lab",
        showingDirectory: false,
        thisComputerId: "computer-jenny-mac",
      }),
    ).toBeUndefined();
    expect(
      computerTheDesktopOpens(computers, {
        requestedId: null,
        showingDirectory: true,
        thisComputerId: "computer-jenny-mac",
      }),
    ).toBeUndefined();
    expect(
      computerTheDesktopOpens(computers, {
        requestedId: null,
        showingDirectory: false,
        thisComputerId: undefined,
      }),
    ).toBeUndefined();
    expect(
      computerTheDesktopOpens(["computer-jenny-mac"], {
        requestedId: null,
        showingDirectory: false,
        thisComputerId: "computer-jenny-mac",
      }),
    ).toBeUndefined();
    expect(
      computerTheDesktopOpens(computers, {
        requestedId: null,
        showingDirectory: false,
        thisComputerId: "computer-somewhere-else",
      }),
    ).toBeUndefined();
  });
});
