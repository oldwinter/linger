// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SetupCommand,
  SetupLocalAccount,
  SetupLocalModelsCheck,
  SetupState,
} from "../shared/setup.js";

const page = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "setup.html"),
  "utf8",
);
const PASSWORD = "a-private-password";

const state = (
  phase: SetupState["localServer"]["phase"],
  account?: SetupLocalAccount,
): SetupState => ({
  platform: "linux",
  version: "1.0.0",
  serverUrl: "http://localhost:3000",
  signedIn: phase === "ready",
  enrolled: phase === "ready",
  displayName: "Desk",
  preventSleep: false,
  openAtLogin: false,
  folders: [],
  localServer: {
    available: true,
    phase,
    message: "",
    steps: ["prepare", "services", "connect", "agents"],
    step: phase === "ready" ? "agents" : "services",
    progress: phase === "ready" ? 1 : 0.5,
    attempt: 1,
    localModels: { state: "unavailable" },
    location: { path: "~/.simplexai", custom: false },
    keys: { composio: false },
    ...(account ? { account } : {}),
  },
});

// Loads the setup page with a fake main process, mid-install by default.
const openPage = async (
  initial: SetupState = state("installing"),
  step = "installing",
) => {
  const [, body] = /<body[^>]*>([\s\S]*)<\/body>/.exec(page)!;
  const [, script] = /<script>([\s\S]*)<\/script>/.exec(body!)!;
  document.body.innerHTML = body!.replace(/<script>[\s\S]*<\/script>/, "");
  let listener: ((next: SetupState) => void) | undefined;
  let current = initial;
  const run = vi.fn(async (command: SetupCommand) => {
    if (command.op === "local.account.show")
      current = state("ready", {
        email: "owner@linger.local",
        ...(command.on ? { password: PASSWORD } : {}),
      });
    return current;
  });
  Object.assign(window, {
    matchMedia: () => ({ matches: true }),
    lingerSetup: {
      getState: async () => current,
      onState: (callback: (next: SetupState) => void) => {
        listener = callback;
        return () => {};
      },
      run,
    },
  });
  new Function(script!)();
  await vi.waitFor(() =>
    expect(
      document.querySelector(`section[data-step="${step}"].active`),
    ).not.toBeNull(),
  );
  const push = (next: SetupState) => {
    current = next;
    listener!(next);
  };
  return { run, push };
};

const $ = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("setup page finish screen", () => {
  it("shows the account email with the password masked", async () => {
    const { push } = await openPage();
    push(state("ready", { email: "owner@linger.local" }));
    expect(
      document.querySelector('section[data-step="ready"].active'),
    ).not.toBeNull();
    expect($("account").hidden).toBe(false);
    expect($("account-email").textContent).toBe("owner@linger.local");
    expect($("account-password").textContent).toBe("•".repeat(12));
    expect($("account").textContent).not.toContain(PASSWORD);
    expect($("account-show").textContent).toBe("Show");
    expect($("account-copy").textContent).toBe("Copy");
    expect($("account-reveal").textContent?.trim()).toBe(
      "Open account file location",
    );
  });

  it("shows the password only after Show and hides it again", async () => {
    const { push, run } = await openPage();
    push(state("ready", { email: "owner@linger.local" }));
    $("account-show").click();
    await vi.waitFor(() =>
      expect($("account-password").textContent).toBe(PASSWORD),
    );
    expect(run).toHaveBeenCalledWith({ op: "local.account.show", on: true });
    expect($("account-show").textContent).toBe("Hide");
    $("account-show").click();
    await vi.waitFor(() =>
      expect($("account-password").textContent).toBe("•".repeat(12)),
    );
    expect(run).toHaveBeenLastCalledWith({
      op: "local.account.show",
      on: false,
    });
  });

  it("asks the main process to copy the password and reveal the file", async () => {
    const { push, run } = await openPage();
    push(state("ready", { email: "owner@linger.local" }));
    $("account-copy").click();
    await vi.waitFor(() =>
      expect($("account-copy").textContent).toBe("Copied"),
    );
    expect(run).toHaveBeenCalledWith({ op: "local.account.copy" });
    $("account-reveal").click();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith({ op: "local.account.reveal" }),
    );
  });

  it("says why the account cannot be shown", async () => {
    const { push } = await openPage();
    push(
      state("ready", {
        error:
          "The local account file must be private and owned by the current user (chmod 600).",
      }),
    );
    expect($("account").hidden).toBe(false);
    expect($("account-fields").hidden).toBe(true);
    expect($("account-note").hidden).toBe(true);
    expect($("account-error").textContent).toContain("chmod 600");
  });
});

const GB = 1024 ** 3;
const capable: SetupLocalModelsCheck = {
  state: "checked",
  eligible: true,
  memoryBytes: 64 * GB,
  diskFreeBytes: 400 * GB,
  gpu: "RTX 4090",
  model: {
    name: "qwen3-8b",
    downloadBytes: 6 * GB,
    diskBytes: 8 * GB,
    memoryBytes: 12 * GB,
  },
  recommendation: "local-models",
};
const small: SetupLocalModelsCheck = {
  state: "checked",
  eligible: false,
  memoryBytes: 8 * GB,
  diskFreeBytes: 100 * GB,
  // A code the page never parses: it shows only the message.
  reasons: [
    { code: "upstream_policy", message: "No model fits this computer." },
  ],
  recommendation: "codex",
};
// The model fits the hardware, but other programs hold its memory now.
const held: SetupLocalModelsCheck = {
  state: "checked",
  eligible: false,
  blockedNow: true,
  memoryBytes: 16 * GB,
  diskFreeBytes: 400 * GB,
  model: {
    name: "qwen3-8b",
    downloadBytes: 6 * GB,
    diskBytes: 8 * GB,
    memoryBytes: 12 * GB,
  },
  reasons: [
    {
      code: "free-memory-required",
      message:
        "Other programs are using memory it needs (now 2.7 GB of RAM is available).",
    },
  ],
  recommendation: "codex",
};
const welcome = (localModels: SetupLocalModelsCheck): SetupState => {
  const base = state("idle");
  return { ...base, localServer: { ...base.localServer, localModels } };
};
const installed = (run: ReturnType<typeof vi.fn>) =>
  run.mock.calls
    .map(([command]) => command as SetupCommand)
    .filter((command) => command.op === "local.start");

describe("setup page Quick Install recommendation", () => {
  it("installs the local model with Pi when the localmodels tool recommends it", async () => {
    const { run } = await openPage(welcome(capable), "welcome");
    expect($("plan-summary").textContent).toBe(
      "Recommended for this computer: Local model + Pi",
    );
    expect($("plan-why").hidden).toBe(false);
    expect($("plan-why").textContent).toBe(
      "qwen3-8b · fits RTX 4090 · 64 GB memory · 6 GB download",
    );
    expect($("local-install-label").textContent).toBe("Quick Install");
    $("local-install").click();
    await vi.waitFor(() =>
      expect(installed(run)).toEqual([{ op: "local.start", runtime: "local" }]),
    );
  });

  it("installs the tool's runtime and says why there is no local model", async () => {
    const { run } = await openPage(welcome(small), "welcome");
    expect($("plan-summary").textContent).toBe(
      "Recommended for this computer: Codex",
    );
    expect($("plan-why").textContent).toBe(
      "No local model: No model fits this computer.",
    );
    expect($("local-row").hidden).toBe(true);
    $("local-install").click();
    await vi.waitFor(() =>
      expect(installed(run)).toEqual([{ op: "local.start", runtime: "codex" }]),
    );
  });

  it("holds a local model that needs free memory and checks again on request", async () => {
    const { run } = await openPage(welcome(held), "welcome");
    expect($("plan-summary").textContent).toBe(
      "Recommended for this computer: Codex",
    );
    expect($("plan-why").textContent).toBe(
      "Local model on hold: Other programs are using memory it needs (now 2.7 GB of RAM is available). Quick Install sets up Codex now, or choose Check again once memory is free.",
    );
    expect($("local-recheck").hidden).toBe(false);
    $("local-customize").click();
    expect($("local-row").hidden).toBe(false);
    expect($("local-model-name").textContent).toBe("qwen3-8b");
    expect($("local-sub").textContent).toBe(
      "On hold: close other programs, then Check again.",
    );
    expect(($("local-model") as HTMLButtonElement).disabled).toBe(true);
    expect($("local-model").getAttribute("aria-checked")).toBe("false");
    $("local-recheck").click();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith({ op: "local.recheck" }),
    );
    $("local-customize").click();
    $("local-install").click();
    await vi.waitFor(() =>
      expect(installed(run)).toEqual([{ op: "local.start", runtime: "codex" }]),
    );
  });

  it("says how much memory a held local model needs and how much is free", async () => {
    const counted = (
      code: string,
      message: string,
      vram = false,
    ): SetupLocalModelsCheck => ({
      ...held,
      freeMemory: {
        ramAvailableBytes: 2899102924,
        ramRequiredBytes: 13689304433,
        ...(vram ? { vramFreeBytes: 3 * GB, vramRequiredBytes: 9 * GB } : {}),
      },
      reasons: [{ code, message }],
    });
    await openPage(
      welcome(
        counted(
          "free-memory-required",
          "Other programs are using memory it needs.",
        ),
      ),
      "welcome",
    );
    expect($("plan-summary").textContent).toBe(
      "Recommended for this computer: Codex",
    );
    expect($("plan-why").textContent).toBe(
      "Local model on hold: quit other programs first; it needs 12.7 GB of memory, 2.7 GB is free. Quick Install sets up Codex now, or choose Check again once memory is free.",
    );
    expect($("local-recheck").hidden).toBe(false);
    $("local-customize").click();
    expect($("local-sub").textContent).toBe(
      "On hold: 12.7 GB memory needed, 2.7 GB free",
    );
    // Another code names what holds the memory, so its words stay.
    await openPage(
      welcome(
        counted(
          "plan-unavailable",
          "Another inference app holds this Mac's memory; quit it and check again.",
          true,
        ),
      ),
      "welcome",
    );
    expect($("plan-why").textContent).toBe(
      "Local model on hold: quit other programs first; it needs 12.7 GB of memory, 2.7 GB is free; graphics memory needs 9.0 GB, 3.0 GB is free. Another inference app holds this Mac's memory; quit it and check again. Quick Install sets up Codex now, or choose Check again once memory is free.",
    );
  });

  it("lets the installer pick when this computer could not be checked", async () => {
    const { run } = await openPage(
      welcome({ state: "unavailable" }),
      "welcome",
    );
    expect($("plan-summary").textContent).toBe("Best AI runtime");
    expect($("plan-why").textContent).toBe(
      "Couldn't check this computer for a local model.",
    );
    $("local-install").click();
    await vi.waitFor(() =>
      expect(installed(run)).toEqual([
        { op: "local.start", runtime: "recommended" },
      ]),
    );
  });

  it("says what Quick Install waits for until the check ends", async () => {
    const { push } = await openPage(welcome({ state: "checking" }), "welcome");
    const button = $("local-install") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect($("local-install-label").textContent).toBe(
      "Checking this computer…",
    );
    expect($("local-install-label").querySelector(".spinner")).not.toBeNull();
    expect($("plan-summary").textContent).toBe(
      "Finding the best setup for this computer",
    );
    // The first run downloads the localmodels tool before checking.
    push(
      welcome({
        state: "checking",
        download: { completed: 12 * 1024 ** 2, total: 69 * 1024 ** 2 },
      }),
    );
    expect($("local-install-label").textContent).toBe(
      "Downloading setup tools…",
    );
    expect($("plan-why").textContent).toBe("12 MB of 69 MB · 57 MB left");
    expect($("plan-why").hidden).toBe(false);
    push(welcome(capable));
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect($("local-install-label").textContent).toBe("Quick Install");
    expect($("plan-summary").textContent).toBe(
      "Recommended for this computer: Local model + Pi",
    );
  });

  it("follows the tool's pick when Auto was chosen during the check", async () => {
    const { run, push } = await openPage(
      welcome({ state: "checking" }),
      "welcome",
    );
    $("local-customize").click();
    const option = (value: string) =>
      document.querySelector<HTMLButtonElement>(
        `[data-plan="runtime"] [data-value="${value}"]`,
      )!;
    option("recommended").click();
    push(welcome(capable));
    expect(option("recommended").hidden).toBe(true);
    expect(option("pi").getAttribute("aria-checked")).toBe("true");
    expect($("local-model").getAttribute("aria-checked")).toBe("true");
    $("local-install").click();
    await vi.waitFor(() =>
      expect(installed(run)).toEqual([{ op: "local.start", runtime: "local" }]),
    );
  });

  it("marks the recommendation under Customize and installs the person's choice", async () => {
    const { run } = await openPage(welcome(capable), "welcome");
    $("local-customize").click();
    const option = (value: string) =>
      document.querySelector<HTMLButtonElement>(
        `[data-plan="runtime"] [data-value="${value}"]`,
      )!;
    expect(option("pi").dataset.recommended).toBe("true");
    expect(option("pi").getAttribute("aria-checked")).toBe("true");
    expect(option("codex").dataset.recommended).toBe("false");
    expect(option("recommended").hidden).toBe(true);
    expect($("runtime-sub").textContent).toBe("Recommended: Pi.");
    expect($("local-sub").textContent).toContain(
      "Recommended for this computer",
    );
    expect($("local-model").getAttribute("aria-checked")).toBe("true");
    option("claude").click();
    expect($("local-model").getAttribute("aria-checked")).toBe("false");
    expect($("local-install-label").textContent).toBe("Install");
    $("local-install").click();
    await vi.waitFor(() =>
      expect(installed(run)).toEqual([
        { op: "local.start", runtime: "claude" },
      ]),
    );
    $("local-customize").click();
    expect($("local-install-label").textContent).toBe("Quick Install");
    expect($("plan-summary").textContent).toBe(
      "Recommended for this computer: Local model + Pi",
    );
  });
  it("offers the local model only with the Pi runtime", async () => {
    const { run } = await openPage(welcome(capable), "welcome");
    // Quick Install follows the tool's pick: Pi with the local model.
    expect($("plan-summary").textContent).toBe(
      "Recommended for this computer: Local model + Pi",
    );
    $("local-customize").click();
    const option = (value: string) =>
      document.querySelector<HTMLButtonElement>(
        `[data-plan="runtime"] [data-value="${value}"]`,
      )!;
    const local = $("local-model") as HTMLButtonElement;
    expect(local.getAttribute("aria-disabled")).toBe("false");
    expect(local.hasAttribute("aria-describedby")).toBe(false);
    expect($("local-pi-only").hidden).toBe(true);
    for (const runtime of ["codex", "claude"]) {
      option(runtime).click();
      // Greyed, still focusable, and it says why.
      expect(local.getAttribute("aria-checked")).toBe("false");
      expect(local.getAttribute("aria-disabled")).toBe("true");
      expect(local.disabled).toBe(false);
      expect(local.getAttribute("aria-describedby")).toBe("local-pi-only");
      expect($("local-pi-only").hidden).toBe(false);
      expect($("local-pi-only").textContent).toBe(
        "Local models are only available with the Pi runtime.",
      );
      // Clicking or pressing it does not pick it, nor switch the runtime.
      local.click();
      expect(local.getAttribute("aria-checked")).toBe("false");
      expect(option(runtime).getAttribute("aria-checked")).toBe("true");
    }
    // Pi alone: the local model is off until chosen again.
    option("pi").click();
    expect(local.getAttribute("aria-disabled")).toBe("false");
    expect($("local-pi-only").hidden).toBe(true);
    expect(local.getAttribute("aria-checked")).toBe("false");
    local.click();
    expect(local.getAttribute("aria-checked")).toBe("true");
    $("local-install").click();
    await vi.waitFor(() =>
      expect(installed(run)).toEqual([{ op: "local.start", runtime: "local" }]),
    );
  });

  it("keeps a held local model on hold with Pi and says Pi is needed otherwise", async () => {
    await openPage(welcome(held), "welcome");
    $("local-customize").click();
    const local = $("local-model") as HTMLButtonElement;
    // Codex is the tool's pick here.
    expect(local.disabled).toBe(true);
    expect($("local-pi-only").hidden).toBe(false);
    document
      .querySelector<HTMLButtonElement>(
        '[data-plan="runtime"] [data-value="pi"]',
      )!
      .click();
    expect($("local-pi-only").hidden).toBe(true);
    expect(local.getAttribute("aria-disabled")).toBe("false");
    // Pi does not lift the hold: the model still waits for free memory.
    expect(local.disabled).toBe(true);
    expect($("local-sub").textContent).toBe(
      "On hold: close other programs, then Check again.",
    );
  });
});

describe("setup page download progress", () => {
  const installing = (transfer?: SetupState["localServer"]["transfer"]) => {
    const base = state("installing");
    return {
      ...base,
      localServer: { ...base.localServer, ...(transfer ? { transfer } : {}) },
    };
  };

  it("shows how much of the local model is left, the rate and the time", async () => {
    const { push } = await openPage(installing());
    expect($("installing-transfer").hidden).toBe(true);
    push(
      installing({
        label: "Downloading the local model…",
        completed: 12 * GB,
        total: 31 * GB,
        bytesPerSecond: 50 * 1024 ** 2,
      }),
    );
    expect($("installing-transfer").hidden).toBe(false);
    expect($("installing-transfer-label").textContent).toBe(
      "Downloading the local model…",
    );
    expect($("installing-transfer-bytes").textContent).toBe(
      "12.0 GB of 31.0 GB · 19.0 GB left · 50 MB/s · about 6 min left",
    );
    push(installing());
    expect($("installing-transfer").hidden).toBe(true);
  });

  it("says only the file's bytes when the tool counts one file", async () => {
    await openPage(
      installing({
        label: "Downloading the local model…",
        completed: 3 * GB,
        total: 4 * GB,
        bytesPerSecond: 50 * 1024 ** 2,
        partial: true,
      }),
    );
    expect($("installing-transfer-bytes").textContent).toBe(
      "This file: 3.0 GB of 4.0 GB · 50 MB/s",
    );
  });
});

describe("setup page Send Diagnostics", () => {
  // A failure scrolls its actions into view, which jsdom lacks.
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  const failed = (
    diagnosticsSend?: SetupState["diagnosticsSend"],
  ): SetupState => {
    const base = state("failed");
    return {
      ...base,
      localServer: { ...base.localServer, message: "Services did not start" },
      ...(diagnosticsSend ? { diagnosticsSend } : {}),
    };
  };

  it("hides Send Diagnostics while no receiver is set up", async () => {
    await openPage(failed());
    expect($("installing-diagnostics").hidden).toBe(false);
    expect($("send-diagnostics").hidden).toBe(true);
    expect($("send-modal").hidden).toBe(true);
  });

  it("asks before sending and lists every file", async () => {
    const { run, push } = await openPage(failed({ phase: "idle" }));
    expect($("send-diagnostics").hidden).toBe(false);
    $("send-diagnostics").click();
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith({
        op: "diagnostics.send",
        action: "start",
      }),
    );
    push(failed({ phase: "preparing" }));
    expect($("send-modal").hidden).toBe(false);
    expect($("send-title").textContent).toBe("Preparing diagnostics");
    expect($("send-primary").hidden).toBe(true);
    push(
      failed({
        phase: "confirm",
        host: "diagnostics.example.com",
        files: ["summary.json", "desktop/logs/main.log"],
        bytes: 2048,
      }),
    );
    expect($("send-title").textContent).toBe(
      "Send diagnostics to diagnostics.example.com?",
    );
    expect($("send-lead").textContent).toContain("2 files, 2 KB");
    expect($("send-lead").textContent).toContain("home folder path");
    expect(
      [...$("send-files").querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["summary.json", "desktop/logs/main.log"]);
    expect($("send-primary").textContent).toBe("Send");
    expect($("send-close").textContent).toBe("Cancel");
    $("send-primary").click();
    await vi.waitFor(() =>
      expect(run).toHaveBeenLastCalledWith({
        op: "diagnostics.send",
        action: "confirm",
      }),
    );
  });

  it("shows progress, then the report id to copy", async () => {
    const { run, push } = await openPage(failed({ phase: "idle" }));
    push(
      failed({
        phase: "sending",
        host: "diagnostics.example.com",
        sent: 512,
        total: 2048,
      }),
    );
    expect($("send-title").textContent).toBe("Sending diagnostics");
    expect($("send-lead").textContent).toBe(
      "Uploading to diagnostics.example.com… 25%",
    );
    expect($("send-track").hidden).toBe(false);
    expect($("send-fill").style.width).toBe("25%");
    expect($("send-close").hidden).toBe(true);
    push(
      failed({
        phase: "sent",
        host: "diagnostics.example.com",
        reportId: "LD-7K3Q9XPM",
      }),
    );
    expect($("send-report").hidden).toBe(false);
    expect($("send-report-id").textContent).toBe("LD-7K3Q9XPM");
    $("send-primary").click();
    await vi.waitFor(() =>
      expect($("send-primary").textContent).toBe("Copied"),
    );
    expect(run).toHaveBeenCalledWith({
      op: "diagnostics.send",
      action: "copy",
    });
    $("send-close").click();
    await vi.waitFor(() =>
      expect(run).toHaveBeenLastCalledWith({
        op: "diagnostics.send",
        action: "cancel",
      }),
    );
  });

  it("offers Try Again only when it can help", async () => {
    const { run, push } = await openPage(failed({ phase: "idle" }));
    push(failed({ phase: "failed", error: "Couldn't reach it", retry: true }));
    expect($("send-error").textContent).toBe("Couldn't reach it");
    expect($("send-primary").textContent).toBe("Try Again");
    $("send-primary").click();
    await vi.waitFor(() =>
      expect(run).toHaveBeenLastCalledWith({
        op: "diagnostics.send",
        action: "retry",
      }),
    );
    push(failed({ phase: "failed", error: "Too large", retry: false }));
    expect($("send-primary").hidden).toBe(true);
    expect($("send-lead").textContent).toContain("Save Diagnostics");
    expect($("send-close").textContent).toBe("Close");
  });
});
