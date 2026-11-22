import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSync } from "esbuild";
import { expect, it } from "vitest";

const wslExecutable = path.join(
  process.env.SystemRoot ?? "C:/Windows",
  "System32",
  "wsl.exe",
);
const wslAvailable =
  process.platform === "win32" &&
  spawnSync(wslExecutable, ["--exec", "/bin/true"], {
    timeout: 30_000,
    windowsHide: true,
  }).status === 0;

it.skipIf(!wslAvailable)(
  "sends a native WSL attachment and saves a native WSL output with Windows Node",
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "linger teamhub wsl "));
    const wsl = (args: string[]) =>
      execFileSync(wslExecutable, ["--cd", "/tmp", "--exec", ...args], {
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
      }).trim();
    let linuxRoot: string | undefined;
    const cli = path.join(root, "resources", "app", "dist", "teamhub-cli");
    let primaryError: unknown;
    try {
      mkdirSync(cli, { recursive: true });
      const put = (name: string, text: string) => {
        writeFileSync(path.join(cli, name), text);
      };
      put("package.json", '{"type":"module"}');
      put("token", "th_agent_fixture\n");
      put(
        "config.json",
        JSON.stringify({
          version: 1,
          default_profile: "work",
          profiles: {
            work: {
              url: "https://teamhub.example",
              token_file: "token",
              scope: { kind: "room", id: "room_example" },
            },
          },
        }),
      );
      put(
        "teamhub",
        readFileSync(path.resolve("scripts/teamhub.sh"), "utf8").replace(
          /\r\n/g,
          "\n",
        ),
      );
      buildSync({
        stdin: {
          resolveDir: process.cwd(),
          contents: FIXTURE,
        },
        bundle: true,
        format: "esm",
        platform: "node",
        outfile: path.join(cli, "teamhub.js"),
      });
      const sandbox = wsl([
        "/bin/sh",
        "-c",
        'base=$HOME; if [ -w /home ]; then base=/home; fi; mktemp -d -- "$base/linger-teamhub.XXXXXXXX"',
      ]);
      expect(sandbox).toMatch(/^\/.*linger-teamhub\.[A-Za-z0-9]{8}$/u);
      linuxRoot = sandbox;
      const attachment = sandbox + "/attachment with spaces.txt";
      const alias = sandbox + "/alias.txt";
      const output = sandbox + "/output with spaces.png";
      const body = sandbox + "/body with spaces.md";
      const content = "/home/u/x.png is message text, including --attach";
      wsl([
        "/bin/sh",
        "-c",
        'printf "attachment bytes" > "$1" && ln -s -- "$1" "$2" && printf "%s" "$4" > "$3"',
        "sh",
        attachment,
        alias,
        body,
        content,
      ]);
      const launcher = wsl(["wslpath", "-u", path.join(cli, "teamhub")]);
      const node = wsl(["wslpath", "-u", process.execPath]);
      const run = (...args: string[]) =>
        JSON.parse(
          wsl(["env", `LINGER_NODE=${node}`, "/bin/sh", launcher, ...args]),
        );
      const send = (...args: string[]) =>
        run("message", "send", "--content", content, ...args);
      const receipt = {
        node: "1",
        exit: 0,
        calls: [
          {
            segments: [{ type: "text", content }, { type: "document" }],
            attachment: "attachment bytes",
          },
        ],
      };
      for (const sent of [
        send("--attach", attachment),
        run(
          "message",
          "send",
          "--message",
          JSON.stringify({
            segments: [
              { type: "text", content },
              { type: "document", "content-path": attachment },
            ],
          }),
        ),
        run(
          "message",
          "send",
          "--file",
          body,
          "--attach=" + wsl(["wslpath", "-w", attachment]),
        ),
      ]) {
        expect(sent.exit, JSON.stringify(sent)).toBe(0);
        expect(sent).toMatchObject(receipt);
      }
      const rejected = send("--attach=" + alias);
      expect(rejected.exit, JSON.stringify(rejected)).not.toBe(0);
      expect(rejected.calls).toEqual([]);
      const saved = run(
        "docs",
        "image",
        "get",
        "document_example",
        "block_card",
        "--output",
        output,
      );
      expect(saved.exit, JSON.stringify(saved)).toBe(0);
      expect(wsl(["cat", output])).toBe("image fixture");
    } catch (error) {
      primaryError = error;
    }
    try {
      if (linuxRoot)
        wsl([
          "/bin/sh",
          "-c",
          'rm -f -- "$1/attachment with spaces.txt" "$1/alias.txt" "$1/output with spaces.png" "$1/body with spaces.md" && rmdir -- "$1"',
          "sh",
          linuxRoot,
        ]);
      rmSync(root, { recursive: true, force: true, maxRetries: 8 });
    } catch (cleanupError) {
      throw primaryError === undefined
        ? cleanupError
        : new AggregateError(
            [primaryError, cleanupError],
            String(primaryError),
          );
    }
    if (primaryError !== undefined) throw primaryError;
  },
  180_000,
);

const FIXTURE = `
import { runCli } from "../teamhub-cli/src/cli.ts";
import path from "node:path";
const calls = [];
const configured = {
  WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME,
  SystemRoot: process.env.SystemRoot,
  TEAMHUB_CONFIG: path.join(path.dirname(process.argv[1]), "config.json"),
};
let stdout = "", stderr = "";
const exit = await runCli(process.argv.slice(2), {
  cwd: process.cwd(), env: configured,
  stdout(value) { stdout += value; }, stderr(value) { stderr += value; },
  async fetch(input, init) {
    const request = new Request(input, init);
    const fields = new URL(request.url).pathname;
    if (fields.endsWith("/files/document_example/content"))
      return Response.json({ blocks: [{ id: "block_card", type: "image", props: { url: "document-asset:asset_example" } }] });
    if (fields.endsWith("/assets/asset_example/content")) return new Response("image fixture");
    const form = await request.formData();
    const metadata = JSON.parse(form.get("metadata"));
    const uploaded = form.get("file");
    calls.push({ segments: metadata.segments, attachment: await uploaded.text() });
    return Response.json({ accepted: true, target: { type: "room", id: "room_example" }, inbox_id: "room_example", message_id: "message_example", resources: [{kind: "document", segment_index: 1, status: "published", document_id: "document_example", version_id: "version_example", name: "attachment with spaces.txt"}], duplicate_request: false });
  },
});
process.stdout.write(JSON.stringify({ exit, node: process.env.ELECTRON_RUN_AS_NODE, calls, stdout, stderr }));
`;
