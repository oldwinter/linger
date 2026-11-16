// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  clearInterruptedPage,
  interruptedPage,
  rememberInterruptedPage,
  takeInterruptedPage,
} from "./interrupted-page";

afterEach(() => {
  clearInterruptedPage();
});

describe("interrupted page", () => {
  it("keeps the page the session interrupted and reads it once", () => {
    const page = "/t/tenant-northstar/settings/security?section=keys";
    rememberInterruptedPage(page);
    expect(takeInterruptedPage()).toBe(page);
    expect(takeInterruptedPage()).toBeNull();
  });

  it.each([
    "https://evil.example/t/tenant/settings/security",
    "//evil.example/t/tenant/settings/security",
    "/login",
    "/login?reason=session-expired",
    "/t/tenant/../settings/security",
    "/t/tenant/settings/security#token",
  ])("does not keep %s", (value) => {
    expect(interruptedPage(value)).toBeNull();
    rememberInterruptedPage(value);
    expect(takeInterruptedPage()).toBeNull();
  });
});
