import { beforeEach, expect, test, vi } from "vitest";
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
import { instanceRuntime } from "./instance-runtime.js";

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
