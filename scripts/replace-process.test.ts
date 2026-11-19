import { describe, expect, it } from "vitest";
import { windowsCommandLine, windowsLaunch } from "./replace-process.mjs";

describe("windowsCommandLine", () => {
  it("quotes paths with spaces and leaves plain arguments alone", () => {
    expect(
      windowsCommandLine("C:\\Program Files\\nodejs\\node.exe", [
        "C:\\Users\\Ada Lovelace\\linger\\scripts\\source-native.mjs",
        "--include",
        "apps/node-services/src/**/*",
        "-p=2",
      ]),
    ).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Ada Lovelace\\linger\\scripts\\source-native.mjs" --include "apps/node-services/src/**/*" -p=2',
    );
  });
  it("refuses characters cmd.exe would reinterpret", () => {
    for (const value of ['a"b', "%PATH%", "a\nb"])
      expect(() => windowsCommandLine("pnpm", [value])).toThrow(/Unsupported/);
  });
});

describe("windowsLaunch", () => {
  it("runs a program file as a direct child, so it ends with its supervisor", () => {
    expect(
      windowsLaunch("C:\\Users\\Ada Lovelace\\linger\\teamhub.exe", ["-x"]),
    ).toEqual({
      file: "C:\\Users\\Ada Lovelace\\linger\\teamhub.exe",
      args: ["-x"],
      shell: false,
    });
  });
  it("resolves launchers such as pnpm through cmd.exe", () => {
    expect(windowsLaunch("pnpm", ["dev"])).toEqual({
      file: "pnpm dev",
      args: [],
      shell: true,
    });
  });
});
