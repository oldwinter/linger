import { closeSync, openSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { linuxNodeFdHygieneArgs } from "./native-process-fds.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("linuxNodeFdHygieneArgs", () => {
  it("returns --import data URL on Linux and no arguments on other platforms", () => {
    const linuxArgs = linuxNodeFdHygieneArgs("linux");
    expect(linuxArgs).toHaveLength(2);
    expect(linuxArgs[0]).toBe("--import");
    expect(linuxArgs[1]).toMatch(/^data:text\/javascript,/);
    expect(linuxNodeFdHygieneArgs("darwin")).toEqual([]);
    expect(linuxNodeFdHygieneArgs("win32")).toEqual([]);
  });

  it.skipIf(process.platform !== "linux")(
    "closes inherited listening TCP sockets and high non-O_CLOEXEC FDs while preserving stdio",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "native-tcp-fds-"));
      roots.push(root);
      const leakedFileFd = openSync(path.join(root, "leaked.txt"), "w");
      const server = net.createServer();
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const handle = (server as unknown as { _handle?: { fd?: number } })
          ._handle;
        const listenFd = handle?.fd;
        expect(typeof listenFd).toBe("number");
        const stdio: Array<"ignore" | "pipe" | number> = [
          "ignore",
          "pipe",
          "pipe",
        ];
        // Map the listening socket onto both a low FD (5) and a high FD (67),
        // and a regular file onto a high non-O_CLOEXEC FD (68).
        while (stdio.length < 69) stdio.push("ignore");
        stdio[5] = listenFd!;
        stdio[67] = listenFd!;
        stdio[68] = leakedFileFd;
        const result = spawnSync(
          process.execPath,
          [
            ...linuxNodeFdHygieneArgs("linux"),
            "-e",
            `
              const fs = require("node:fs");
              const check = (fd) => {
                try { return fs.readlinkSync("/proc/self/fd/" + fd); }
                catch { return null; }
              };
              console.log(JSON.stringify({
                fd5: check(5),
                fd67: check(67),
                fd68: check(68),
              }));
            `,
          ],
          { stdio, encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        const reported = JSON.parse(result.stdout.trim()) as {
          fd5: string | null;
          fd67: string | null;
          fd68: string | null;
        };
        expect(reported).toEqual({ fd5: null, fd67: null, fd68: null });
      } finally {
        closeSync(leakedFileFd);
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it.skipIf(process.platform !== "linux")(
    "closes inherited listening Unix sockets while preserving a non-3 IPC channel FD",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "native-unix-fds-"));
      roots.push(root);
      const sockPath = path.join(root, "listen.sock");
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(sockPath, resolve));
      try {
        const handle = (server as unknown as { _handle?: { fd?: number } })
          ._handle;
        const listenFd = handle?.fd;
        expect(typeof listenFd).toBe("number");
        const message = await new Promise<{
          unixFd: string | null;
          channelFd: number | null;
        }>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              ...linuxNodeFdHygieneArgs("linux"),
              "-e",
              `
                const fs = require("node:fs");
                let unixFd = null;
                try { unixFd = fs.readlinkSync("/proc/self/fd/5"); } catch {}
                process.send({ unixFd, channelFd: process.channel?.fd ?? null });
                process.disconnect();
              `,
            ],
            {
              // Place IPC on FD 4 (not 3) and the listening Unix socket on FD 5.
              stdio: ["ignore", "pipe", "pipe", "ignore", "ipc", listenFd!],
            },
          );
          let stderr = "";
          child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
          });
          let received:
            | { unixFd: string | null; channelFd: number | null }
            | undefined;
          child.once("message", (payload) => {
            received = payload as {
              unixFd: string | null;
              channelFd: number | null;
            };
          });
          child.once("error", reject);
          child.once("close", (code) => {
            if (code !== 0 || !received)
              reject(new Error(`child exited ${code}: ${stderr}`));
            else resolve(received);
          });
        });
        expect(message).toEqual({ unixFd: null, channelFd: 4 });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
