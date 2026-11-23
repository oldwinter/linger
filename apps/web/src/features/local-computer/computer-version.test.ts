import { expect, it } from "vitest";
import {
  compareComputerVersion,
  isUpgradeRecommended,
} from "./computer-version";

it.each([
  [undefined, true],
  ["0.1.0", true],
  ["0.2.0-rc.1", true],
  ["0.2.0", false],
  ["0.2.0+release.12", false],
  ["0.10.0", false],
  ["dev", false],
] as const)(
  "compares reported release %s without rejecting usable clients",
  (version, expected) => {
    expect(
      isUpgradeRecommended({
        daemon_version: version,
        recommended_version: "0.2.0",
      }),
    ).toBe(expected);
    expect(isUpgradeRecommended({ daemon_version: version })).toBe(false);
  },
);

it.each([
  ["0.59.0", "0.59.0", 0],
  ["0.59.0+build.1", "0.59.0", 0],
  ["0.59.0-rc.1", "0.59.0", -1],
  ["0.59.0", "0.59.0-rc.1", 1],
  ["0.58.9", "0.59.0", -1],
  ["0.60.1", "0.59.0", 1],
  ["1.0.0", "0.99.99", 1],
  ["dev", "0.59.0", undefined],
] as const)("compares %s with %s", (a, b, expected) => {
  expect(compareComputerVersion(a, b)).toBe(expected);
});
