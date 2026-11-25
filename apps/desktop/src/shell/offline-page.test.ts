// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Language } from "../i18n/language.js";
import zhCN from "../i18n/locales/zh-CN.json" with { type: "json" };
import { localizePage } from "../i18n/page.js";
import { offlineMessages } from "./offline.messages.js";

const shellFile = (name: string) =>
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), name),
    "utf8",
  );
const rawPage = shellFile("offline.html");
const messagesRuntime = shellFile("messages.html");

function openOfflinePage(search: string, language: Language = "en"): void {
  window.history.replaceState(null, "", `/${search}`);
  const page = localizePage(
    rawPage,
    messagesRuntime,
    offlineMessages,
    language,
  );
  const [, body] = /<body[^>]*>([\s\S]*)<\/body>/.exec(page)!;
  const [, script] = /<script>([\s\S]*)<\/script>/.exec(body!)!;
  const [, data] =
    /<script type="application\/json" id="linger-messages">([\s\S]*?)<\/script>/.exec(
      body!,
    )!;
  document.body.innerHTML = body!.replace(/<script[\s\S]*<\/script>/g, "");
  const json = document.createElement("script");
  json.type = "application/json";
  json.id = "linger-messages";
  json.textContent = data!;
  document.body.appendChild(json);
  new Function(script!)();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  delete document.body.dataset.mode;
  document.body.className = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("offline.html starting & updating feedback", () => {
  it("shows live progress copy and reveals Show Logs after 15s during starting", () => {
    openOfflinePage("?starting=1", "en");

    expect(document.body.dataset.mode).toBe("starting");
    expect(document.getElementById("title")?.textContent).toBe(
      "Starting LingerX",
    );
    expect(document.getElementById("phase")?.textContent).toBe(
      "Starting local services…",
    );
    expect(document.getElementById("slow-escape")?.hidden).toBe(true);

    vi.advanceTimersByTime(14_999);
    expect(document.getElementById("slow-escape")?.hidden).toBe(true);

    vi.advanceTimersByTime(1);
    expect(document.getElementById("slow-escape")?.hidden).toBe(false);
    expect(document.getElementById("slow-hint")?.textContent).toBe(
      "Taking longer than expected?",
    );
    expect(document.getElementById("starting-logs")?.textContent).toBe(
      "Show Logs",
    );
  });

  it("shows localized updating progress copy in zh-CN and reveals Show Logs after 15s", () => {
    openOfflinePage("?updating=1", "zh-CN");

    expect(document.body.dataset.mode).toBe("updating");
    expect(document.getElementById("title")?.textContent).toBe(
      zhCN.offline.updatingTitle,
    );
    expect(document.getElementById("phase")?.textContent).toBe(
      zhCN.offline.updatingPhase,
    );
    expect(document.getElementById("slow-escape")?.hidden).toBe(true);

    vi.advanceTimersByTime(15_000);
    expect(document.getElementById("slow-escape")?.hidden).toBe(false);
    expect(document.getElementById("slow-hint")?.textContent).toBe(
      zhCN.offline.takingLonger,
    );
    expect(document.getElementById("starting-logs")?.textContent).toBe(
      zhCN.offline.showLogs,
    );
  });

  it("includes OS dark mode and reduced-motion rules", () => {
    expect(rawPage).toContain("@media (prefers-color-scheme: dark)");
    expect(rawPage).toContain("@media (prefers-reduced-motion: reduce)");
    expect(rawPage).toContain("<title>LingerX</title>");
  });
});
