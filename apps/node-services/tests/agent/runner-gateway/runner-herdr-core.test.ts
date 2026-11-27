import type {
  AgentToDaemonEnvelope,
  ComputerToolCall,
} from "@linger/wire-contracts/runner-gateway/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalComputerNotFoundError,
  LocalComputerOfflineError,
} from "../../../src/agent/runner-gateway/local-computer-management.js";
import { TeamHubRuntimeStateError } from "../../../src/agent/executor/teamhub-runtime-state-client.js";
import {
  HerdrCoreInvalidRequestError,
  HerdrCoreUnsupportedError,
  OWNER_HERDR_CORE_AGENT_ID,
} from "../../../src/agent/runner-gateway/runner-herdr-core.js";
import { type RunnerGatewayConnection } from "../../../src/agent/runner-gateway/runner-gateway.js";
import {
  createTestRunnerGateway,
  testRegistryOf,
} from "../test-support/runner-gateway.js";
import {
  testRegistrationId,
  testRunnerPlacement,
} from "../test-support/local-computer-registry.js";
import { runtimeDiagnostics } from "./runtime-diagnostics-fixture.js";
import {
  CURRENT_RUNNER_CAPABILITIES,
  currentRunnerIdentity,
} from "../test-support/runner-capabilities.js";

const connections: RunnerGatewayConnection[] = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.disconnect();
  vi.useRealTimers();
});

async function connect(daemonVersion = "dev", placeAgent = false) {
  const gateway = createTestRunnerGateway({ heartbeatIntervalMs: 60_000 });
  if (placeAgent) {
    testRegistryOf(gateway).place(
      "computer-hc",
      testRunnerPlacement({
        agentId: "agent-1",
        tenantId: "tenant-1",
        ownerActorId: "actor-1",
        workspaceGrantId: "workspace-1",
      }),
    );
  }
  const sent: AgentToDaemonEnvelope[] = [];
  const connection = await gateway.acceptConnection(
    {
      runnerId: "computer-hc",
      credentialGeneration: 0,
      tenantOwners: [{ tenantId: "tenant-1", ownerActorId: "actor-1" }],
    },
    {
      type: "runner.hello",
      platform: "darwin",
      protocol_version: "2",
      daemon_version: daemonVersion,
      ...currentRunnerIdentity(),
      capabilities: [...CURRENT_RUNNER_CAPABILITIES],
      runner_id: "computer-hc",
      display_name: "Workstation",
      connection_nonce: "nonce-hc-1",
      sent_at: new Date().toISOString(),
      runtimes: ["codex"],
      runtime_diagnostics: runtimeDiagnostics(),
      workspace_grants: [],
      agent_runners: placeAgent
        ? [
            {
              runner_id: "computer-hc",
              tenant_id: "tenant-1",
              agent_id: "agent-1",
              runner_revision: 1,
              state: "ready",
              runtime: { type: "codex" },
              registration_id: testRegistrationId("codex", {
                tenantId: "tenant-1",
                ownerActorId: "actor-1",
              }),
              assignment_revision: 1,
              workspace_grant_id: "workspace-1",
              runner_pid: 4242,
            },
          ]
        : [],
      active_operations: [],
    },
    {
      send: vi.fn(async (envelope: AgentToDaemonEnvelope) => {
        sent.push(envelope);
      }),
      close: vi.fn(),
    },
  );
  connections.push(connection);

  const nextToolCall = async (): Promise<ComputerToolCall> => {
    await vi.waitFor(() =>
      expect(
        sent.some(
          (frame) => frame.type === "execute" && frame.kind === "computer_tool",
        ),
      ).toBe(true),
    );
    const frame = [...sent]
      .reverse()
      .find((item) => item.type === "execute" && item.kind === "computer_tool");
    if (frame?.type !== "execute" || frame.kind !== "computer_tool") {
      throw new Error("Expected execute computer_tool frame");
    }
    return frame;
  };

  return { gateway, connection, sent, nextToolCall };
}

describe("RunnerHerdrCore control plane", () => {
  it("dispatches owner-scoped herdr_core calls without requiring an Agent placement", async () => {
    const { gateway, connection, nextToolCall } = await connect("dev", false);
    const pending = gateway.callHerdrCore({
      tenantId: "tenant-1",
      ownerActorId: "actor-1",
      computerId: "computer-hc",
      toolName: "list",
      arguments: { all: false },
      signal: new AbortController().signal,
    });
    const command = await nextToolCall();
    expect(command.server).toBe("herdr_core");
    expect(command.tool_name).toBe("list");
    expect(command.agent_id).toBe(OWNER_HERDR_CORE_AGENT_ID);
    expect(command.arguments).toEqual({ all: false });

    await connection.receive({
      type: "executed",
      kind: "computer_tool",
      protocol_version: "2",
      command_id: command.command_id,
      runner_id: command.runner_id,
      connection_epoch: command.connection_epoch,
      tenant_id: command.tenant_id,
      owner_actor_id: command.owner_actor_id,
      agent_id: command.agent_id,
      result: { terminals: [{ address: "t7" }], machines: [] },
    });

    await expect(pending).resolves.toEqual({
      terminals: [{ address: "t7" }],
      machines: [],
    });
  });

  it("gates herdr_core calls against older Computer Daemons without service_features", async () => {
    const { gateway } = await connect("0.51.0", false);
    expect(gateway.supportsHerdrCore("computer-hc")).toBe(false);
    await expect(
      gateway.callHerdrCore({
        tenantId: "tenant-1",
        ownerActorId: "actor-1",
        computerId: "computer-hc",
        toolName: "status",
        arguments: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(HerdrCoreUnsupportedError);
  });

  it("rejects unknown tools, wrong owners, and offline Computers", async () => {
    const { gateway, connection } = await connect("dev", false);
    await expect(
      gateway.callHerdrCore({
        tenantId: "tenant-1",
        ownerActorId: "actor-1",
        computerId: "computer-hc",
        toolName: "attach",
        arguments: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(HerdrCoreInvalidRequestError);
    await expect(
      gateway.callHerdrCore({
        tenantId: "tenant-1",
        ownerActorId: "other-owner",
        computerId: "computer-hc",
        toolName: "status",
        arguments: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(LocalComputerNotFoundError);

    connection.disconnect();
    await expect(
      gateway.callHerdrCore({
        tenantId: "tenant-1",
        ownerActorId: "actor-1",
        computerId: "computer-hc",
        toolName: "status",
        arguments: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(LocalComputerOfflineError);
  });

  it("requires Agent placement for Agent-scoped callComputerTool on server herdr_core", async () => {
    const { gateway } = await connect("dev", false);
    await expect(
      gateway.callComputerTool({
        tenantId: "tenant-1",
        ownerActorId: "actor-1",
        computerId: "computer-hc",
        agentId: "agent-unplaced",
        toolSessionId: "session-1",
        server: "herdr_core",
        toolName: "status",
        arguments: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(LocalComputerNotFoundError);
  });

  it("forwards runner.herdr_core_event to TeamHub and survives transient report failures", async () => {
    const { gateway, connection } = await connect("dev", false);
    const registry = testRegistryOf(gateway);
    await connection.receive({
      type: "runner.herdr_core_event",
      protocol_version: "2",
      runner_id: "computer-hc",
      sent_at: "2026-11-27T01:00:00Z",
      event: {
        kind: "agent_blocked",
        address: "vps/t7",
        machine: "vps",
        turn: 4,
        status_ms: 1732670400000,
        status: {
          state: "blocked",
          kind: "permission",
          app: "codex",
          msg: "Confirm deployment?",
        },
        cwd: "/srv/app",
        labels: { "linger.room": "room-1" },
        tail: "Proceed? [y/N]",
      },
    });
    expect(registry.herdrCoreEvents).toHaveLength(1);
    expect(registry.herdrCoreEvents[0]).toMatchObject({
      computerId: "computer-hc",
      event: {
        kind: "agent_blocked",
        address: "vps/t7",
        machine: "vps",
        turn: 4,
        status: {
          state: "blocked",
          kind: "permission",
          app: "codex",
          msg: "Confirm deployment?",
        },
      },
    });

    registry.reportHerdrCoreEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary outage"));
    await expect(
      connection.receive({
        type: "runner.herdr_core_event",
        protocol_version: "2",
        runner_id: "computer-hc",
        sent_at: "2026-11-27T01:01:00Z",
        event: {
          kind: "terminal_changed",
          address: "t7",
          turn: 5,
          status_ms: 1732670460000,
        },
      }),
    ).resolves.toBeUndefined();
    expect(gateway.supportsHerdrCore("computer-hc")).toBe(true);
  });

  it("drops status.kind and retries once when an older TeamHub rejects it with 400", async () => {
    const { connection, gateway } = await connect("dev", false);
    const registry = testRegistryOf(gateway);
    const reportMock = vi
      .fn()
      .mockRejectedValueOnce(
        new TeamHubRuntimeStateError(
          400,
          "herdr-core event is invalid",
          "INVALID_REQUEST",
        ),
      )
      .mockResolvedValueOnce(undefined);
    registry.reportHerdrCoreEvent = reportMock;

    await connection.receive({
      type: "runner.herdr_core_event",
      protocol_version: "2",
      runner_id: "computer-hc",
      sent_at: "2026-11-27T01:02:00Z",
      event: {
        kind: "agent_blocked",
        address: "vps/t7",
        machine: "vps",
        turn: 6,
        status_ms: 1732670520000,
        status: {
          state: "blocked",
          kind: "question",
          app: "codex",
          msg: "Use blue-green deploy?",
        },
        tail: "Use blue-green deploy? [y/N]",
      },
    });

    expect(reportMock).toHaveBeenCalledTimes(2);
    expect(reportMock.mock.calls[0]?.[1]).toMatchObject({
      status: {
        state: "blocked",
        kind: "question",
        msg: "Use blue-green deploy?",
      },
    });
    expect(reportMock.mock.calls[1]?.[1]).toMatchObject({
      status: {
        state: "blocked",
        app: "codex",
        msg: "Use blue-green deploy?",
      },
      tail: "Use blue-green deploy? [y/N]",
    });
    expect(reportMock.mock.calls[1]?.[1]?.status).not.toHaveProperty("kind");
  });
});
