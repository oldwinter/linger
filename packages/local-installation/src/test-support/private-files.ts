import { chmod, stat } from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import { runProcess } from "../process.js";
import { windowsPrivatePath } from "../windows-private.js";

export async function expectPrivateFixtureFile(file: string): Promise<void> {
  if (process.platform === "win32") {
    await expect(windowsPrivatePath(file, "file")).resolves.toBeUndefined();
  } else {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }
}

export async function shareFixtureFile(file: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(file, 0o644);
    return;
  }
  // Windows chmod only controls the read-only attribute. Grant another
  // identity access to the synthetic fixture to test the actual DACL check.
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$file = [Console]::In.ReadToEnd()
$acl = Get-Acl -LiteralPath $file
$everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($everyone, 'Read', 'Allow'))
[IO.FileInfo]::new($file).SetAccessControl($acl)
`;
  const result = await runProcess(
    path.win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { input: file, timeoutMs: 30_000 },
  );
  expect(result.code, result.stderr).toBe(0);
}
