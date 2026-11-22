import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { windowsPrivatePath } from "../src/windows-private.js";

const windowsPowerShellModules = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "Modules",
);

declare module "vitest" {
  interface ProvidedContext {
    windowsFixtures: { temporary: string; modules: string };
  }
}

export default async function setup(project: TestProject) {
  // The system TEMP can inherit shared access from AppData. Every fixture
  // starts below one fresh private directory, with user/SYSTEM inheritance.
  const home = await realpath(homedir());
  const temporary = await mkdtemp(path.join(home, "linger-test-"));
  const cleanup = async () => {
    if (
      path.dirname(temporary) !== home ||
      (await realpath(temporary)) !== temporary
    )
      throw new Error(
        "Refusing to clean a test directory outside its original location",
      );
    await rm(temporary, { recursive: true, force: true, maxRetries: 10 });
  };
  const previousModules = process.env.PSModulePath;
  try {
    // Windows PowerShell 5 must not try to load the caller's PowerShell 7
    // modules when it runs Get-Acl or reads the Windows process table.
    process.env.PSModulePath = windowsPowerShellModules;
    await windowsPrivatePath(temporary, "directory", true);
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    if (previousModules === undefined) delete process.env.PSModulePath;
    else process.env.PSModulePath = previousModules;
  }
  project.provide("windowsFixtures", {
    temporary,
    modules: windowsPowerShellModules,
  });
  return cleanup;
}
