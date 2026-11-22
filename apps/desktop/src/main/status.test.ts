import { describe, expect, it } from "vitest";

import zhCN from "../i18n/locales/zh-CN.json" with { type: "json" };
import { translator } from "../i18n/language.js";
import { summarizeStatus, type StatusInput } from "./status.js";

const summarize = (input: StatusInput) =>
  summarizeStatus(input, translator("en"));

const base = {
  connection: "online",
  runtime: "ready" as const,
  enrolled: true,
  running: 0,
};

describe("summarizeStatus", () => {
  it("describes each state in one line", () => {
    expect(summarize(base)).toEqual({
      tone: "online",
      label: "Online · Idle",
    });
    expect(summarize({ ...base, running: 2 })).toEqual({
      tone: "busy",
      label: "Running 2 Tasks",
    });
    expect(summarize({ ...base, connection: "connecting" })).toEqual({
      tone: "offline",
      label: "Offline · Reconnecting",
    });
    expect(summarize({ ...base, connection: "auth_failed" }).tone).toBe(
      "error",
    );
    expect(summarize({ ...base, runtime: "crashed" }).tone).toBe("error");
    expect(summarize({ ...base, runtime: "starting" }).label).toBe("Starting…");
    expect(summarize({ ...base, enrolled: false }).tone).toBe("setup");
  });

  it("asks to reconnect when the daemon has no valid credential", () => {
    expect(
      summarize({
        ...base,
        connection: "auth_failed",
        runtime: "stopped",
      }),
    ).toEqual({
      tone: "error",
      label: "Sign-in Expired · Reconnect This Computer",
    });
  });

  it("asks to reconnect on a Daemon Identity conflict", () => {
    expect(
      summarize({
        ...base,
        connection: "identity_conflict",
      }),
    ).toEqual({
      tone: "error",
      label: "Computer Identity Conflict · Reconnect This Computer",
    });
  });

  it("speaks the shell's language, counting tasks its way", () => {
    expect(
      summarizeStatus({ ...base, running: 2 }, translator("zh-CN")).label,
    ).toBe(zhCN.status.running.other.replace("{count}", "2"));
    expect(summarizeStatus(base, translator("zh-CN")).label).toBe(
      zhCN.status.idle,
    );
  });
});
