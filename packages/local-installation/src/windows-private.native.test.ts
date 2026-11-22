import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeWindowsPrivateWorker,
  WINDOWS_PRIVATE_SCRIPT,
  windowsPrivatePath,
} from "./windows-private.js";
import { runProcess } from "./process.js";
import {
  WITHOUT_ADMINISTRATORS_SCRIPT,
  windowsCommandLine,
} from "./windows-restricted-token.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "linger-private-acl-"));
  roots.push(root);
  await windowsPrivatePath(root, "directory", true);
  return root;
}
it.skipIf(process.platform !== "win32")(
  "creates a protected user/SYSTEM DACL and accepts inherited private files",
  async () => {
    const root = await fixture();
    const file = path.join(root, "settings.json");
    await writeFile(file, "{}");
    await expect(windowsPrivatePath(file, "file")).resolves.toBeUndefined();
    await expect(
      windowsPrivatePath(root, "directory"),
    ).resolves.toBeUndefined();
  },
);
it.skipIf(process.platform !== "win32")(
  "uses the native Get-Acl despite the caller's module path",
  { timeout: 30_000 },
  async () => {
    const root = await fixture();
    const modules = path.join(root, "modules");
    const name = "Microsoft.PowerShell.Security";
    await mkdir(path.join(modules, name), { recursive: true });
    await writeFile(
      path.join(modules, name, name + ".psm1"),
      "function Get-Acl { throw 'UNEXPECTED_ACL_MODULE' }; Export-ModuleMember -Function Get-Acl",
    );
    const foreignModules = [modules, process.env.PSModulePath]
      .filter(Boolean)
      .join(path.delimiter);
    vi.stubEnv("PSModulePath", foreignModules);
    // Start a fresh worker so it inherits the stubbed PSModulePath.
    closeWindowsPrivateWorker();
    try {
      const privateFile = path.join(root, "settings.json");
      await writeFile(privateFile, "{}");
      await expect(
        windowsPrivatePath(privateFile, "file"),
      ).resolves.toBeUndefined();
      expect(process.env.PSModulePath).toBe(foreignModules);
    } finally {
      vi.unstubAllEnvs();
      closeWindowsPrivateWorker();
    }
  },
);
it.skipIf(process.platform !== "win32")(
  "accepts private paths that Administrators own, as an elevated Linger creates them",
  async (context) => {
    const root = await fixture();
    const file = path.join(root, "manager.sqlite");
    await writeFile(file, "");
    const script =
      "$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); $p=[Console]::In.ReadToEnd(); foreach ($path in @($p, [IO.Path]::GetDirectoryName($p))) { $a=Get-Acl -LiteralPath $path; $a.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')); Set-Acl -LiteralPath $path -AclObject $a }";
    const changed = await runProcess(
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
      { input: file, timeoutMs: 30000 },
    );
    // Only an elevated process may hand a file to Administrators.
    if (changed.code !== 0) return context.skip();
    await expect(windowsPrivatePath(file, "file")).resolves.toBeUndefined();
    await expect(
      windowsPrivatePath(root, "directory", true),
    ).resolves.toBeUndefined();
    // A token with Administrators disabled and no elevated token linked to
    // it, like a standard user's, does not accept that owner.
    const powershell = path.win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const encoded = (text: string) =>
      Buffer.from(text, "utf16le").toString("base64");
    const program = path.join(root, "check.ps1");
    const request = path.join(root, "request.json");
    const output = path.join(root, "output.txt");
    await writeFile(program, WINDOWS_PRIVATE_SCRIPT);
    await writeFile(
      request,
      JSON.stringify({ path: file, kind: "file", repair: false }),
    );
    // The program reads its request from a real stdin, as windowsPrivatePath
    // sends it; a PowerShell pipe into powershell.exe would send CLIXML.
    const check = [
      `$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-Content -Raw -LiteralPath '${program}')))`,
      `$p = Start-Process -FilePath '${powershell}' -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand',$encoded -RedirectStandardInput '${request}' -RedirectStandardOutput '${output}' -NoNewWindow -Wait -PassThru`,
      `[Console]::Out.Write((Get-Content -Raw -LiteralPath '${output}'))`,
      "exit $p.ExitCode",
    ].join("; ");
    const restricted = await runProcess(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encoded(WITHOUT_ADMINISTRATORS_SCRIPT),
      ],
      {
        input: JSON.stringify(
          windowsCommandLine(powershell, [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            encoded(check),
          ]),
        ),
        timeoutMs: 60000,
      },
    );
    expect(restricted.code).toBe(1);
    expect(restricted.stdout.trim()).toBe("UNSAFE_OWNER");
  },
);
it.skipIf(process.platform !== "win32")(
  "rejects a junction as either the target or an ancestor",
  async () => {
    const root = await fixture();
    const junction = path.join(root, "link");
    await symlink(root, junction, "junction");
    await writeFile(path.join(root, "settings.json"), "{}");
    await expect(
      windowsPrivatePath(junction, "directory"),
    ).rejects.toMatchObject({ reason: "UNSAFE_TYPE", path: junction });
    await expect(
      windowsPrivatePath(path.join(junction, "settings.json"), "file"),
    ).rejects.toMatchObject({ reason: "UNSAFE_PARENT_LINK" });
  },
);
it.skipIf(process.platform !== "win32")(
  "rejects an ACL allowing another identity to read private state",
  async () => {
    const root = await fixture();
    const file = path.join(root, "settings.json");
    await writeFile(file, "{}");
    const script =
      "$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd(); $item=[IO.FileInfo]::new($p); $a=Get-Acl -LiteralPath $p; $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow')); $item.SetAccessControl($a)";
    const changed = await runProcess(
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
      { input: file, timeoutMs: 30000 },
    );
    expect(changed.code).toBe(0);
    await expect(windowsPrivatePath(file, "file")).rejects.toMatchObject({
      reason: "SHARED_ACCESS",
      path: file,
    });
  },
);
it.skipIf(process.platform !== "win32")(
  "accepts inherit-only ancestor Modify ACEs but rejects effective ancestor access and broad private target inheritance",
  async () => {
    const root = await fixture();
    const child = path.join(root, "private");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(child);
    await windowsPrivatePath(child, "directory", true);
    const mutate = async (propagation: "InheritOnly" | "None") => {
      const script = `$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); $p=[Console]::In.ReadToEnd(); $item=[IO.DirectoryInfo]::new($p); $a=Get-Acl -LiteralPath $p; $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'Modify','ContainerInherit,ObjectInherit','${propagation}','Allow')); $item.SetAccessControl($a)`;
      const changed = await runProcess(
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
        { input: root, timeoutMs: 30000 },
      );
      expect(changed.code).toBe(0);
    };
    await mutate("InheritOnly");
    await expect(
      windowsPrivatePath(child, "directory"),
    ).resolves.toBeUndefined();
    // A private target also owns future descendants, so broad inheritance on
    // the target remains forbidden even when it is inherit-only.
    await expect(windowsPrivatePath(root, "directory")).rejects.toMatchObject({
      reason: "SHARED_ACCESS",
    });
    await mutate("None");
    await expect(windowsPrivatePath(child, "directory")).rejects.toMatchObject({
      reason: "UNSAFE_PARENT_ACCESS",
    });
  },
);
