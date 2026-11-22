import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { loadAgentCommandSchema } from "./command-schema-loader.js";
import { routesByToolName } from "./business-routes.js";
import { runCli } from "./cli.js";
import { writeCliConfig } from "./test-support/cli-config.js";

it("exposes live membership and collaboration protocol reads", async () => {
  for (const [toolName, input, endpoint] of [
    [
      "get_room_members",
      { inbox_id: "thread:room_thread" },
      "room-members/query",
    ],
    ["get_team_md", { inbox_id: "room_one" }, "team-md/query"],
  ] as const) {
    expect(routesByToolName[toolName]).toBe(`/api/agent/v1/${endpoint}`);
    expect(
      (await loadAgentCommandSchema(toolName))?.input.parse(input),
    ).toEqual(input);
  }
});

it("accepts registered Agent identity alongside Human members", async () => {
  const members = [
    { actor_id: "actor_human", kind: "human", display_name: "Owner" },
    {
      actor_id: "actor_sam",
      kind: "agent",
      display_name: "Sam",
      agent_type: "general",
      description: "Researches Slack AI cases",
    },
    {
      actor_id: "actor_delegate",
      kind: "agent",
      display_name: "Delegate",
      agent_type: "anotherme",
      description: "",
    },
  ];
  for (const [toolName, scope] of [
    ["get_room_members", { inbox_id: "room:room_one", room_id: "room_one" }],
  ] as const) {
    const schema = (await loadAgentCommandSchema(toolName))!;
    const output = { ...scope, membership_revision: 1, members };
    expect(schema.output.parse(output)).toEqual(output);
  }
});

it.each([true, false])(
  "reports a Room without team.md as a result, not an error (json=%s)",
  async (json) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "teamhub-cli-team-md-"),
    );
    try {
      const result = { room_id: "room_one", published: false, revision: 0 };
      const stdout: string[] = [];
      const stderr: string[] = [];
      const code = await runCli(
        ["room", "protocol", ...(json ? ["--json"] : [])],
        {
          cwd: directory,
          env: writeCliConfig(path.join(directory, "config"), {
            scope: { kind: "room", id: "room_one" },
          }),
          fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json(result)),
          stdout: (value) => {
            stdout.push(value);
          },
          stderr: (value) => {
            stderr.push(value);
          },
        },
      );
      expect([code, stderr.join("")]).toEqual([0, ""]);
      if (json) expect(JSON.parse(stdout.join(""))).toEqual(result);
      else
        expect(stdout.join("")).toBe(
          "No team.md collaboration protocol has been published in this Room yet.\n",
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
