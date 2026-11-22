import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { Instance } from "./instance.js";
import { runProcess } from "./process.js";
import { prepareSourceComputer } from "./source-computer.js";
vi.mock("./process.js", () => ({ runProcess: vi.fn() }));
// Fake the Computer CLI and its installer, not Windows' private-path probe.
vi.mock("./windows-private.js", async (original) => {
  const actual = await original<typeof import("./windows-private.js")>();
  const { runProcess } =
    await vi.importActual<typeof import("./process.js")>("./process.js");
  const windowsPrivatePath: typeof actual.windowsPrivatePath = (
    file,
    kind,
    repair,
  ) => actual.windowsPrivatePath(file, kind, repair, runProcess);
  return { ...actual, windowsPrivatePath };
});
const roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(): Promise<Instance> {
  const root = await mkdtemp(path.join(tmpdir(), "source-computer-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const management = path.join(
    repo,
    "apps/node-services/src/agent/runner-gateway",
  );
  await mkdir(management, { recursive: true });
  await writeFile(
    path.join(management, "local-computer-management.ts"),
    'export const MINIMUM_CURRENT_COMPUTER_VERSION = "0.39.0"; export const MINIMUM_COMPUTER_VERSION = "0.22.0";',
  );
  return {
    schemaVersion: 1,
    mode: "source-native",
    name: "source-test",
    root,
    project: "source-test",
    origin: "http://localhost:31234",
    port: 31234,
    releaseDir: repo,
    computerConfig: path.join(root, "computer/config.json"),
    computerExecutable: "linger-computer",
    source: { repo },
  } as Instance;
}
test("reuses a suitable installed release without changing global Computer", async () => {
  const instance = await fixture();
  vi.mocked(runProcess).mockResolvedValue({
    code: 0,
    stdout: "linger-computer 0.39.0\n",
    stderr: "",
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await prepareSourceComputer(instance, new AbortController().signal);
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    vi.mocked(runProcess).mock.calls.map((call) => call.slice(0, 2)),
  ).toEqual([["linger-computer", ["version"]]]);
});
test("downloads the checkout-served release when installed Computer is below the work admission minimum", async () => {
  const instance = await fixture();
  const windows = process.platform === "win32";
  const shell = windows ? "powershell.exe" : "bash";
  const url = `http://localhost:31234/install/linger-computer.${windows ? "ps1" : "sh"}`;
  const executable = path.join(
    instance.root,
    "computer",
    "bin",
    windows ? "linger-computer.exe" : "linger-computer",
  );
  vi.mocked(runProcess).mockImplementation(async (command) => ({
    code: 0,
    stdout:
      command === "linger-computer"
        ? "linger-computer 0.38.0"
        : command === shell
          ? "installed"
          : "linger-computer 0.39.0",
    stderr: "",
  }));
  const fetcher = vi.fn(
    async (_url: string) =>
      new Response(windows ? "exit 0\n" : "#!/bin/bash\nexit 0\n"),
  );
  vi.stubGlobal("fetch", fetcher);
  await prepareSourceComputer(instance, new AbortController().signal);
  expect(fetcher.mock.calls[0]?.[0]).toBe(url);
  const installer = vi
    .mocked(runProcess)
    .mock.calls.find((call) => call[0] === shell);
  expect(installer?.[2]?.env).toMatchObject({
    LINGER_COMPUTER_DATA_DIR: path.join(instance.root, "computer/release"),
    LINGER_COMPUTER_BIN_DIR: path.join(instance.root, "computer/bin"),
    LINGER_COMPUTER_CONFIG: instance.computerConfig,
  });
  expect(instance.computerExecutable).toBe(executable);
  expect(
    JSON.parse(
      await readFile(path.join(instance.root, "instance.json"), "utf8"),
    ).computerExecutable,
  ).toBe(instance.computerExecutable);
  expect(
    vi.mocked(runProcess).mock.calls.some((call) => call[1].includes("stop")),
  ).toBe(false);
});
test("unavailable official release fails explicitly without fabricating a source build", async () => {
  const instance = await fixture();
  vi.mocked(runProcess).mockResolvedValue({
    code: 1,
    stdout: "",
    stderr: "unavailable",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("installer")),
  );
  await expect(
    prepareSourceComputer(instance, new AbortController().signal),
  ).rejects.toThrow(/0.39.0.*checkout/i);
  expect(instance.computerExecutable).toBe("linger-computer");
});
test("cancellation prevents any probing or download", async () => {
  const instance = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    prepareSourceComputer(instance, controller.signal),
  ).rejects.toThrow();
  expect(runProcess).not.toHaveBeenCalled();
});
test("rejects oversized installer responses before launching downloaded code", async () => {
  const instance = await fixture();
  vi.mocked(runProcess).mockResolvedValue({
    code: 1,
    stdout: "",
    stderr: "missing",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("x".repeat(2 * 1024 * 1024 + 1))),
  );
  await expect(
    prepareSourceComputer(instance, new AbortController().signal),
  ).rejects.toThrow(/size limit/);
  expect(
    vi.mocked(runProcess).mock.calls.every((call) => call[1][0] === "version"),
  ).toBe(true);
  expect(instance.computerExecutable).toBe("linger-computer");
});
test.each(["0.39.0", "dev"])(
  "reuses a current installed Computer %s and leaves capability admission to Gateway",
  async (version) => {
    const instance = await fixture();
    vi.mocked(runProcess).mockResolvedValue({
      code: 0,
      stdout: `linger-computer ${version}`,
      stderr: "",
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await prepareSourceComputer(instance, new AbortController().signal);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(runProcess)
        .mock.calls.every((call) => call[1][0] === "version"),
    ).toBe(true);
  },
);
