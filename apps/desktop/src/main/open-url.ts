import { spawn } from "node:child_process";

// Electron's shell.openExternal on Linux starts xdg-open without waiting for
// it, so it reports success even with no xdg-open or no browser to open.
// This runs xdg-open the same way and waits for its verdict: it fails when
// xdg-open is missing or exits with an error, and counts as opened when it
// exits cleanly or is still running (the browser it started) after waitMs.
// Linux only: other platforms keep shell.openExternal.
export const openWithXdg = (
  url: string,
  options: { readonly command?: string; readonly waitMs?: number } = {},
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(options.command ?? "xdg-open", [url], {
      detached: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.unref();
      resolve();
    }, options.waitMs ?? 5000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`xdg-open exited with ${code ?? signal}`));
    });
  });
