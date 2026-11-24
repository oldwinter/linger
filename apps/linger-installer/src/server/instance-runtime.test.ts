import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Instance } from "@linger/local-installation/instance";
import type { RuntimeDescriptor } from "@linger/local-installation/managed-runtimes";

vi.mock("@linger/local-installation/instance", () => ({
  loadInstance: vi.fn(),
}));
vi.mock("@linger/local-installation/setup-selection", () => ({
  readSetupChoice: vi.fn(),
}));
vi.mock("@linger/local-installation/byok-source", () => ({
  readByokEnvironment: vi.fn(),
}));
vi.mock("@linger/local-installation/local-models", () => ({
  localModelsEnvironment: vi.fn(),
}));
vi.mock("@linger/local-installation/managed-codex", () => ({
  managedRuntimeEnvironment: vi.fn(),
}));
vi.mock("@linger/local-installation/localmodels-computer", () => ({
  LOCALMODELS_TOOL_ENVIRONMENT: ["LINGER_LOCALMODELS_PYTHON"],
  localmodelsComputerTool: vi.fn(),
  localmodelsToolEnvironment: vi.fn(() => ({})),
}));
vi.mock("@linger/local-installation/localmodels-tool", () => ({
  pinnedToolSource: vi.fn(() => undefined),
}));

import { loadInstance } from "@linger/local-installation/instance";
import { readSetupChoice } from "@linger/local-installation/setup-selection";
import { readByokEnvironment } from "@linger/local-installation/byok-source";
import { localModelsEnvironment } from "@linger/local-installation/local-models";
import { managedRuntimeEnvironment } from "@linger/local-installation/managed-codex";
import { localmodelsComputerTool } from "@linger/local-installation/localmodels-computer";
import {
  formatRuntimeLookupTimings,
  RUNTIME_LOOKUP_TIMINGS_EVENT,
  instanceRuntime,
  type RuntimeLookupTimings,
} from "./instance-runtime.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadInstance).mockResolvedValue({
    name: "local",
    root: "/home/instances/local",
  } as Instance);
  vi.mocked(readSetupChoice).mockResolvedValue("pi");
  vi.mocked(readByokEnvironment).mockResolvedValue(undefined);
  vi.mocked(localModelsEnvironment).mockResolvedValue({});
  vi.mocked(managedRuntimeEnvironment).mockResolvedValue({
    LINGER_PI_PATH: "/probed/pi",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("reuses inspected runtime descriptors without re-probing managedRuntimeEnvironment", async () => {
  const descriptor: RuntimeDescriptor = {
    runtime: "pi",
    executable: "/reused/pi",
    argvPrefix: [],
    installed: true,
    authenticated: true,
    authMode: "api_key",
    loginCommand: null,
    environment: { PI_CODING_AGENT_DIR: "/home/runtime/pi" },
  };
  const result = await instanceRuntime("/home", "local", {
    runtimeDescriptors: [descriptor],
  });
  expect(result).toEqual({
    setupChoice: "pi",
    environment: {
      LINGER_PI_PATH: "/reused/pi",
      PI_CODING_AGENT_DIR: "/home/runtime/pi",
    },
  });
  expect(managedRuntimeEnvironment).not.toHaveBeenCalled();
});

test("falls back to managedRuntimeEnvironment when no descriptors are supplied", async () => {
  const result = await instanceRuntime("/home", "local");
  expect(result).toEqual({
    setupChoice: "pi",
    environment: { LINGER_PI_PATH: "/probed/pi" },
  });
  expect(managedRuntimeEnvironment).toHaveBeenCalledWith(
    "/home",
    "/home/instances/local",
  );
});

test("reports separate stage timings for a runtime lookup", async () => {
  const timings: RuntimeLookupTimings[] = [];
  // instanceRuntime reads the clock once at the start, twice per timed
  // stage, and once for the total. Script it so the assertions are exact
  // and independent of the test host's scheduler.
  const now = vi.spyOn(performance, "now");
  for (const value of [0, 0, 4, 4, 6, 6, 6, 6, 11, 11, 13, 13, 22, 25])
    now.mockReturnValueOnce(value);
  vi.mocked(localmodelsComputerTool).mockResolvedValue(undefined as never);

  await instanceRuntime("/home", "local", {
    onTimings: (value) => timings.push(value),
  });

  expect(timings).toEqual([
    { config: 6, runtime: 5, localModels: 2, tool: 9, total: 25 },
  ]);
});

test("formats runtime lookup timings as one JSON line", () => {
  const timings = { config: 1, runtime: 2, localModels: 3, tool: 4, total: 10 };
  const line = formatRuntimeLookupTimings("desk\ntop", timings);
  expect(line.endsWith("\n")).toBe(true);
  expect(line.slice(0, -1)).not.toContain("\n");
  expect(JSON.parse(line)).toEqual({
    event: RUNTIME_LOOKUP_TIMINGS_EVENT,
    instance: "desk\ntop",
    timings,
  });
});
