import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { runProcess } from "../process.js";

export function withComputerFixture(run: typeof runProcess): typeof runProcess {
  if (process.platform !== "win32") return run;
  return async (executable, args, options) => {
    // These tests use a JavaScript CLI with a Node shebang on POSIX. On
    // Windows, start that same fixture explicitly with the Node executable.
    if (
      path.isAbsolute(executable) &&
      path.basename(executable) === "computer"
    ) {
      const relative = path.relative(tmpdir(), executable);
      if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
        const contents = await readFile(executable, "utf8").catch(() => "");
        if (contents.startsWith(`#!${process.execPath}\n`))
          return run(process.execPath, [executable, ...args], options);
      }
    }
    return run(executable, args, options);
  };
}
