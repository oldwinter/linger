import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.each(["stdout", "stderr"])(
  "rejects an output sink failure on %s without crashing or leaving the command running",
  async (stream) => {
    const root = await mkdtemp(path.join(tmpdir(), "linger-output-sink-"));
    const pidFile = path.join(root, "child.pid");
    try {
      const childSource = `
        require('node:fs').writeFileSync(process.argv[1], String(process.pid));
        process[process.argv[2]].write('diagnostic');
        setTimeout(() => process.exit(0), 2000);
      `;
      const harness = `
        import { runProcess } from ${JSON.stringify(new URL("./process.ts", import.meta.url).href)};
        import { writeFileSync } from 'node:fs';
        const result = await runProcess(process.execPath, ['-e', ${JSON.stringify(childSource)}, ${JSON.stringify(pidFile)}, ${JSON.stringify(stream)}], {
          onOutput() { writeFileSync(${JSON.stringify(root)}, 'diagnostic'); }
        }).then(() => ({resolved:true}), error => ({code:error.code, message:error.message}));
        process.stdout.write(JSON.stringify(result));
      `;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", harness],
        {
          encoding: "utf8",
          timeout: 5000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ code: "EISDIR" });
      expect(result.stderr).toBe("");
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      if (pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* Already gone. */
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
