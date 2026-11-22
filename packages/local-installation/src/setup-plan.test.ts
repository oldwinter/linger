import path from "node:path";
import { expect, it, vi } from "vitest";
import { inspectSetup } from "./setup-plan.js";

const upstream = (available = true) => ({
  schema: "localmodels.setup-report/v1",
  facts: {
    platform: "linux",
    arch: "unusual",
    ram: { total_bytes: 7 },
    disk: { free_bytes: 9 },
    gpus: [{ index: 4, name: "upstream GPU", total_bytes: 6, free_bytes: 5 }],
  },
  stack: {
    available,
    reasons: available
      ? []
      : [{ code: "upstream_policy", message: "Upstream rejected this host" }],
    plan: available
      ? {
          llm: {
            model: { id: "upstream-model" },
            placement: { gpus: [{ index: 4 }] },
          },
          budget: {
            download_bytes: 11,
            disk_needed_bytes: 13,
            ram_needed_bytes: 17,
          },
        }
      : null,
  },
  harness: {
    schema: "localmodels.harness-status/v1",
    runtimes: ["codex", "claude", "pi"].map((runtime) => ({
      runtime,
      installed: runtime === "pi",
      authenticated: runtime === "pi",
    })),
  },
  recommendation: available ? "local-models" : "pi",
});
const runner = (value: object = upstream()) =>
  vi.fn(async () => ({ code: 0, stdout: JSON.stringify(value), stderr: "" }));
it("delegates all hardware policy, runtime detection, estimates and recommendation upstream", async () => {
  const localmodels = runner();
  const home = path.resolve("/owned");
  const report = await inspectSetup({
    home,
    localmodels,
  });
  expect(localmodels).toHaveBeenCalledWith(
    home,
    [
      "setup",
      "inspect",
      "--root",
      path.join(home, "runtime", "harness"),
      "--model-base-dir",
      path.join(home, "runtime", "localmodels", "models"),
      "--decision",
      "none",
      "--offline",
      "--defer-services",
      "--share-gpu",
      "--lang",
      "en",
      "--json",
    ],
    expect.objectContaining({ timeoutMs: 120000 }),
  );
  expect(report.hardware.totalMemoryBytes).toBe(7);
  expect(report.localModels).toMatchObject({
    eligible: true,
    state: "ready",
    selectedGpuIndex: 4,
    estimate: {
      model: "upstream-model",
      downloadBytes: 11,
      diskBytes: 13,
      memoryBytes: 17,
      durationSeconds: null,
    },
  });
  expect(report.localModels).not.toHaveProperty("minimum");
  expect(report.runtimes[2]).toMatchObject({
    installed: true,
    auth: "authenticated",
    estimate: {
      downloadBytes: null,
      diskBytes: null,
      memoryBytes: null,
      durationSeconds: null,
    },
  });
  expect(report.recommendation).toBe("local-models");
});
it("preserves upstream rejection and never substitutes downstream eligibility", async () => {
  const localmodels = runner(upstream(false));
  const report = await inspectSetup({ localmodels });
  expect(report.localModels.state).toBe("unavailable");
  expect(report.localModels.reasons).toEqual([
    { code: "upstream_policy", message: "Upstream rejected this host" },
  ]);
  expect(report.recommendation).toBe("pi");
  expect(report.localModels.estimate.downloadBytes).toBeNull();
});
it("recommends the next runtime while the local plan waits for free memory (tool without stack.state)", async () => {
  const freeMemory = (installed: boolean) => {
    const value = upstream();
    return {
      ...value,
      stack: {
        ...value.stack,
        basis: "capacity",
        reasons: [
          {
            code: "free-memory-required",
            message: "Close other programs before installing.",
          },
        ],
      },
      harness: {
        ...value.harness,
        runtimes: value.harness.runtimes.map((row) => ({
          ...row,
          installed: installed && row.installed,
        })),
      },
    };
  };
  const report = await inspectSetup({ localmodels: runner(freeMemory(true)) });
  expect(report.localModels).toMatchObject({
    eligible: false,
    state: "blocked-now",
    basis: "capacity",
    reasons: [
      {
        code: "free-memory-required",
        message: "Close other programs before installing.",
      },
    ],
    estimate: { model: "upstream-model" },
  });
  expect(report.localModels).not.toHaveProperty("memory");
  expect(report.recommendation).toBe("pi");
  const bare = await inspectSetup({ localmodels: runner(freeMemory(false)) });
  expect(bare.recommendation).toBe("codex");
  // The reason code alone holds the plan too.
  const { basis: _, ...stack } = freeMemory(true).stack;
  const coded = await inspectSetup({
    localmodels: runner({ ...freeMemory(true), stack }),
  });
  expect(coded.localModels).toMatchObject({
    state: "blocked-now",
    basis: "capacity",
  });
  expect(coded.recommendation).toBe("pi");
  const ready = await inspectSetup({ localmodels: runner() });
  expect(ready.localModels).not.toHaveProperty("basis");
});
it("reads the tool's blocked-now state, memory and recommendation", async () => {
  const value = upstream();
  const blocked = {
    ...value,
    stack: {
      ...value.stack,
      available: false,
      state: "blocked-now",
      hardwareCapable: true,
      basis: "capacity",
      reasons: [
        {
          code: "free-memory-required",
          message: "Close other programs before installing.",
        },
      ],
      memory: {
        ramAvailableBytes: 2899102924,
        ramRequiredBytes: 13689304433,
        vramFreeBytes: 3,
        vramRequiredBytes: 8,
      },
    },
    recommendation: "codex",
  };
  const report = await inspectSetup({ localmodels: runner(blocked) });
  expect(report.localModels).toMatchObject({
    eligible: false,
    state: "blocked-now",
    hardwareCapable: true,
    basis: "capacity",
    memory: {
      ramAvailableBytes: 2899102924,
      ramRequiredBytes: 13689304433,
      vramFreeBytes: 3,
      vramRequiredBytes: 8,
    },
    estimate: { model: "upstream-model" },
  });
  // The tool's non-local pick stands, even with Pi installed.
  expect(report.recommendation).toBe("codex");
  // The tool's state wins over the older marks; null fields stay out.
  const ready = await inspectSetup({
    localmodels: runner({
      ...value,
      stack: {
        ...value.stack,
        state: "ready",
        hardwareCapable: true,
        basis: null,
        memory: null,
      },
    }),
  });
  expect(ready.localModels).toMatchObject({
    eligible: true,
    state: "ready",
    hardwareCapable: true,
  });
  expect(ready.localModels).not.toHaveProperty("basis");
  expect(ready.localModels).not.toHaveProperty("memory");
  const small = await inspectSetup({
    localmodels: runner({
      ...upstream(false),
      stack: {
        ...upstream(false).stack,
        state: "unavailable",
        hardwareCapable: false,
      },
    }),
  });
  expect(small.localModels).toMatchObject({
    eligible: false,
    state: "unavailable",
    hardwareCapable: false,
  });
});
it("passes on the memory counts each reason carries", async () => {
  const value = upstream();
  const report = await inspectSetup({
    localmodels: runner({
      ...value,
      stack: {
        ...value.stack,
        available: false,
        state: "blocked-now",
        basis: "capacity",
        reasons: [
          {
            code: "gpu-memory-required",
            message: "Other programs are using GPU 1's memory.",
            gpuIndex: 1,
            freeBytes: 3,
            requiredBytes: 8,
          },
          {
            code: "free-memory-required",
            message: "Other programs are using memory they need.",
            freeBytes: 5,
            requiredBytes: 13,
          },
          // A count outside the contract is left out, not shown.
          { code: "free-memory-required", message: "", freeBytes: -1 },
        ],
      },
      recommendation: "codex",
    }),
  });
  expect(report.localModels.reasons).toEqual([
    {
      code: "gpu-memory-required",
      message: "Other programs are using GPU 1's memory.",
      gpuIndex: 1,
      freeBytes: 3,
      requiredBytes: 8,
    },
    {
      code: "free-memory-required",
      message: "Other programs are using memory they need.",
      freeBytes: 5,
      requiredBytes: 13,
    },
    { code: "free-memory-required", message: "" },
  ]);
});
it("passes on validated CUDA driver versions and drops malformed values", async () => {
  const value = upstream(false);
  const report = await inspectSetup({
    localmodels: runner({
      ...value,
      stack: {
        ...value.stack,
        available: false,
        state: "blocked-now",
        hardwareCapable: true,
        reasons: [
          {
            code: "cuda-driver-update-required",
            message: "Driver supports CUDA 12.1; requires CUDA >= 12.4.",
            detectedCudaVersion: "12.1",
            requiredCudaVersion: "12.4",
            driverVersion: "535.98",
          },
          {
            code: "cuda-driver-version-unknown",
            message: "Could not detect driver CUDA version.",
            detectedCudaVersion: "CUDA 12.1",
            requiredCudaVersion: "12.4",
            driverVersion: "[N/A]",
          },
        ],
      },
      recommendation: "codex",
    }),
  });
  expect(report.localModels).toMatchObject({
    eligible: false,
    state: "blocked-now",
    hardwareCapable: true,
    reasons: [
      {
        code: "cuda-driver-update-required",
        message: "Driver supports CUDA 12.1; requires CUDA >= 12.4.",
        detectedCudaVersion: "12.1",
        requiredCudaVersion: "12.4",
        driverVersion: "535.98",
      },
      {
        code: "cuda-driver-version-unknown",
        message: "Could not detect driver CUDA version.",
        requiredCudaVersion: "12.4",
      },
    ],
  });
});
it("fails explicitly and redacts tool output when upstream is unavailable or malformed", async () => {
  for (const response of [
    { code: 1, stdout: "private token", stderr: "secret" },
    { code: 0, stdout: "{}", stderr: "" },
  ]) {
    await expect(
      inspectSetup({ localmodels: vi.fn(async () => response) }),
    ).rejects.toMatchObject({ code: "LOCALMODELS_SETUP_UNAVAILABLE" });
  }
});
it("names the upstream cause and logs its redacted output when the check fails", async () => {
  const onEvent = vi.fn();
  await expect(
    inspectSetup({
      onEvent,
      localmodels: vi.fn(async () => ({
        code: 1,
        stdout: "",
        // A long traceback ends with its cause.
        stderr: [
          "Traceback (most recent call last):",
          ...Array.from({ length: 40 }, (_, i) => `  File "frame${i}.py"`),
          "sk-abcdefghijklmnopqrstuvwxyz",
          "error: Unsupported or changed Codex provider configuration",
        ].join("\n"),
      })),
    }),
  ).rejects.toMatchObject({
    code: "LOCALMODELS_SETUP_UNAVAILABLE",
    message: expect.stringContaining(
      "Unsupported or changed Codex provider configuration",
    ),
  });
  const messages = onEvent.mock.calls.map(([event]) => event.message);
  // The cause leads, ahead of the long output the desktop may cut off.
  expect(messages[0]).toMatch(
    /^localmodels setup inspect failed: .*Unsupported or changed Codex provider configuration$/,
  );
  const logged = messages.join("\n");
  expect(logged).toContain("localmodels setup inspect exited with code 1");
  expect(logged).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
});
it("honors cancellation before invoking upstream", async () => {
  const localmodels = runner();
  await expect(
    inspectSetup({ signal: AbortSignal.abort(), localmodels }),
  ).rejects.toThrow();
  expect(localmodels).not.toHaveBeenCalled();
});

it("inspects with GPU sharing unless sharing was explicitly declined", async () => {
  const localmodels = vi.fn<
    (
      home: string,
      args: string[],
    ) => Promise<{ code: number; stdout: string; stderr: string }>
  >(async () => ({
    code: 0,
    stdout: JSON.stringify(upstream()),
    stderr: "",
  }));
  await inspectSetup({ localmodels, shareGpu: false });
  expect(localmodels.mock.calls[0]?.[1]).not.toContain("--share-gpu");
  await inspectSetup({ localmodels, shareGpu: true });
  expect(localmodels.mock.calls[1]?.[1]).toContain("--share-gpu");
  await inspectSetup({ localmodels });
  expect(localmodels.mock.calls[2]?.[1]).toContain("--share-gpu");
});

it("checks the installation target while keeping tool state in the existing home", async () => {
  const home = path.resolve("cached-home");
  const targetHome = path.resolve("candidate");
  const localmodels = runner();
  await inspectSetup({ home, targetHome, localmodels });
  expect(localmodels).toHaveBeenCalledWith(
    home,
    expect.arrayContaining([
      "--root",
      path.join(targetHome, "runtime", "harness"),
      "--model-base-dir",
      path.join(targetHome, "runtime", "localmodels", "models"),
    ]),
    expect.anything(),
  );
});
