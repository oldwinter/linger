import { spawn } from "node:child_process";

// Quote for cmd.exe, which also resolves pnpm.cmd and other PATHEXT launchers.
export function windowsCommandLine(command, args) {
  return [command, ...args]
    .map((value) => {
      if (/["%\r\n]/.test(value))
        throw new Error("Unsupported character in a Windows command argument.");
      return /^[\w./\\:=@+-]+$/.test(value) ? value : `"${value}"`;
    })
    .join(" ");
}

/**
 * How Windows starts the command: a program file directly, anything else
 * (pnpm.cmd and other PATHEXT launchers) through cmd.exe.
 */
export function windowsLaunch(command, args) {
  return /^(?:[a-z]:\\|\\\\).*\.exe$/i.test(command)
    ? { file: command, args, shell: false }
    : { file: windowsCommandLine(command, args), args: [], shell: true };
}

/**
 * POSIX replaces this process so the caller keeps the command's PID, exit
 * status and signals. Windows has no execve: run the command as a child and
 * exit with its status; the supervisor still owns it through the parent link.
 * Node ends the children it starts when it exits, but not their children, so
 * a program file runs as this process's own child: through cmd.exe it
 * outlived its supervisor and kept its port.
 */
export function replaceProcess(command, args, env, cwd = process.cwd()) {
  if (process.platform !== "win32") {
    process.chdir(cwd);
    process.execve("/usr/bin/env", ["env", command, ...args], env);
  }
  const launch = windowsLaunch(command, args);
  const child = spawn(launch.file, launch.args, {
    cwd,
    env,
    shell: launch.shell,
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.once("exit", (code) => process.exit(code ?? 1));
}
