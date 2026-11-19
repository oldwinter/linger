import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  windowsPrivatePath,
  WINDOWS_PRIVATE_SCRIPT,
} from "./windows-private.js";
it("sends paths through stdin and runs a fixed encoded ACL program", async () => {
  const run = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  await windowsPrivatePath(
    "C:\\Users\\person\\private's",
    "directory",
    true,
    run,
  );
  expect(run.mock.calls[0]![1].join(" ")).not.toContain("person");
  expect(run.mock.calls[0]![2].input).toContain("person");
  expect(WINDOWS_PRIVATE_SCRIPT).toContain("[Console]::InputEncoding");
  expect(WINDOWS_PRIVATE_SCRIPT).toContain("ReparsePoint");
  expect(WINDOWS_PRIVATE_SCRIPT).toContain("GetCurrent().User");
  expect(WINDOWS_PRIVATE_SCRIPT).toContain("AccessControlSections]::Access");
});
it("fails closed without disclosing command diagnostics", async () => {
  const run = vi
    .fn()
    .mockResolvedValue({ code: 1, stdout: "", stderr: "sensitive path" });
  const error = await windowsPrivatePath("private", "file", false, run).catch(
    (failure: unknown) => failure as Error,
  );
  expect(error?.message).toMatch(/^Windows private path validation failed/);
  expect(error?.message).not.toContain("sensitive");
  expect(error).toMatchObject({
    code: "WINDOWS_PRIVATE_PATH_UNSAFE",
    reason: "UNCHECKED",
  });
});
it("names the path and why it is not private", async () => {
  const file =
    "C:\\Users\\person\\.simplexai\\instances\\desktop\\native.env.1.tmp";
  const owned = vi
    .fn()
    .mockResolvedValue({ code: 1, stdout: "UNSAFE_OWNER", stderr: "" });
  const error = await windowsPrivatePath(file, "file", false, owned).catch(
    (failure: unknown) => failure as Error,
  );
  expect(error).toMatchObject({
    code: "WINDOWS_PRIVATE_PATH_UNSAFE",
    reason: "UNSAFE_OWNER",
    path: path.resolve(file),
  });
  expect(error?.message).toContain(path.resolve(file));
  expect(error?.message).toContain("owned by another account");
  // Only the script's fixed codes pass; anything else is unchecked.
  const other = vi.fn().mockResolvedValue({
    code: 1,
    stdout: "Access denied to C:\\x",
    stderr: "",
  });
  await expect(
    windowsPrivatePath(file, "file", false, other),
  ).rejects.toMatchObject({ reason: "UNCHECKED" });
});
it("gives every failure in the ACL program a fixed reason code", () => {
  const thrown = [...WINDOWS_PRIVATE_SCRIPT.matchAll(/throw '([^']*)'/g)].map(
    (match) => match[1],
  );
  expect(thrown.length).toBeGreaterThan(5);
  for (const code of thrown) expect(code).toMatch(/^[A-Z][A-Z_]+$/);
});
it("ignores inherit-only ACEs only for effective ancestor permissions", () => {
  const ancestors = WINDOWS_PRIVATE_SCRIPT.slice(
    WINDOWS_PRIVATE_SCRIPT.indexOf("while ($parent)"),
    WINDOWS_PRIVATE_SCRIPT.indexOf("if ($request.repair)"),
  );
  const target = WINDOWS_PRIVATE_SCRIPT.slice(
    WINDOWS_PRIVATE_SCRIPT.indexOf("$currentAllowed = $false"),
  );
  expect(ancestors).toContain(
    "$rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly",
  );
  expect(target).not.toContain("PropagationFlags");
  expect(target).toContain("SHARED_ACCESS");
});
