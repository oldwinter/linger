import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);

it("keeps Pi's public MCP extension bound to private Operation proxies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "linger-pi-extension-"));
  try {
    const result = await run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import assert from "node:assert/strict";
      import { chmodSync, writeFileSync } from "node:fs";
      import { loadManagedMcpConfig } from ${JSON.stringify(new URL("../tools/pi-mcp.mjs", import.meta.url).href)};
      const file = ${JSON.stringify(path.join(root, "mcp.json"))};
      const write = (server) => writeFileSync(file, JSON.stringify({mcpServers:{computer:server}}),{mode:0o600});
      write({type:"http",url:"http://127.0.0.1:1234/mcp/fixture"});
      const config=loadManagedMcpConfig(file);
      assert.equal(config.autoEnableCodemode,false);
      assert.equal(config.servers[0].config.exposure,"direct");
      for(const server of [
        {type:"http",url:"https://example.com"},
        {type:"http",url:"http://localhost:1234"},
        {type:"http",url:"http://secret@127.0.0.1:1234"},
        {type:"http",url:"http://127.0.0.1:1234",headers:{Authorization:"credential"}},
        {type:"stdio",url:"http://127.0.0.1:1234",command:"untrusted"}
      ]){write(server);assert.throws(()=>loadManagedMcpConfig(file));}
      write({type:"http",url:"http://127.0.0.1:1234"});
      if(process.platform!=="win32"){chmodSync(file,0o644);assert.throws(()=>loadManagedMcpConfig(file),/private/);}
      assert.equal(process.env.NODE_PATH,"inherited");
      assert.equal(process.env.LINGER_PI_INHERITED_NODE_PATH,undefined);
      console.log("private immutable MCP configuration passed");
    `,
      ],
      {
        timeout: 20_000,
        env: {
          ...process.env,
          NODE_PATH: path.join(root, "tools", "node_modules"),
          LINGER_PI_INHERITED_NODE_PATH: "inherited",
        },
      },
    );
    expect(result.stdout).toContain(
      "private immutable MCP configuration passed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it.skipIf(process.platform === "win32")(
  "refuses a bash call the Daemon's shell-text-hook refuses",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linger-pi-shell-text-"));
    try {
      const hook = path.join(root, "daemon");
      await writeFile(
        hook,
        `#!${process.execPath}
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const { tool_input } = JSON.parse(input);
  if (process.argv[2] !== "shell-text-hook" || !tool_input.command.includes("$1")) process.exit(0);
  process.stderr.write("Not run: use a quoted heredoc\\n");
  process.exit(2);
});
`,
        { mode: 0o700 },
      );
      const result = await run(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
      import assert from "node:assert/strict";
      import { refuseRewrittenShellText } from ${JSON.stringify(new URL("../tools/pi-mcp.mjs", import.meta.url).href)};
      const hook = ${JSON.stringify(hook)};
      const bash = (command) => ({ toolName: "bash", input: { command } });
      assert.deepEqual(
        await refuseRewrittenShellText(bash('teamhub message send --content "Quote: $180"'), hook),
        { block: true, reason: "Not run: use a quoted heredoc" },
      );
      assert.equal(await refuseRewrittenShellText(bash('teamhub message send --content "Total $TOTAL"'), hook), undefined);
      assert.equal(await refuseRewrittenShellText(bash('teamhub message send --content "Done."'), hook), undefined);
      assert.equal(await refuseRewrittenShellText({ toolName: "read", input: { path: "$1" } }, hook), undefined);
      assert.equal(await refuseRewrittenShellText(bash('teamhub message send --content "$180"'), ${JSON.stringify(path.join(root, "missing"))}), undefined);
      assert.equal(await refuseRewrittenShellText(bash('teamhub message send --content "$180"'), undefined), undefined);
      console.log("shell text check passed");
    `,
        ],
        { timeout: 20_000 },
      );
      expect(result.stdout).toContain("shell text check passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);

it("asks the Daemon about Pi commands and MCP calls and blocks unless allowed", async () => {
  const entry = new URL("../tools/pi-mcp.mjs", import.meta.url).href;
  const { PERMISSION_REVIEW, reviewToolCall } = (await import(entry)) as {
    PERMISSION_REVIEW: string;
    reviewToolCall: (
      event: { toolName: string; input: Record<string, unknown> },
      ui: { input: (title: string, placeholder: string) => Promise<unknown> },
    ) => Promise<unknown>;
  };
  const asked: Array<{ title: string; call: unknown }> = [];
  const ui = (answer: string | undefined) => ({
    input: async (title: string, placeholder: string) => {
      asked.push({ title, call: JSON.parse(placeholder) });
      return answer;
    },
  });
  const bash = { toolName: "bash", input: { command: "git push" } };

  expect(
    await reviewToolCall({ toolName: "read", input: {} }, ui("")),
  ).toBeUndefined();
  expect(asked).toEqual([]);
  expect(
    await reviewToolCall(bash, ui(JSON.stringify({ allow: true }))),
  ).toBeUndefined();
  expect(asked).toEqual([{ title: PERMISSION_REVIEW, call: bash }]);
  expect(
    await reviewToolCall(
      { toolName: "mcp__computer__click", input: {} },
      ui(JSON.stringify({ allow: false, message: "not now" })),
    ),
  ).toEqual({ block: true, reason: "not now" });
  expect(await reviewToolCall(bash, ui(undefined))).toEqual({
    block: true,
    reason: "bash was not approved",
  });
});
