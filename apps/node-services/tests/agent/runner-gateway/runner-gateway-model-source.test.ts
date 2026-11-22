import type {
  AgentToDaemonEnvelope,
  CapabilityModelSource,
} from "@linger/wire-contracts/runner-gateway/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalComputerCapabilityError } from "../../../src/agent/runner-gateway/local-computer-management.js";
import { type RunnerGatewayConnection } from "../../../src/agent/runner-gateway/runner-gateway.js";
import { createTestRunnerGateway } from "../test-support/runner-gateway.js";
import { runtimeDiagnostics } from "./runtime-diagnostics-fixture.js";
import {
  CURRENT_RUNNER_CAPABILITIES,
  currentRunnerIdentity,
} from "../test-support/runner-capabilities.js";

const connections: RunnerGatewayConnection[] = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.disconnect();
});

const connect = async (daemonVersion: string) => {
  const gateway = createTestRunnerGateway({ heartbeatIntervalMs: 60_000 });
  const sent: AgentToDaemonEnvelope[] = [];
  const connection = await gateway.acceptConnection(
    {
      runnerId: "computer-local",
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
      runner_id: "computer-local",
      display_name: "Alice's Mac",
      connection_nonce: "nonce-1",
      sent_at: new Date().toISOString(),
      runtimes: ["codex"],
      runtime_diagnostics: runtimeDiagnostics(),
      workspace_grants: [],
      agent_runners: [],
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
  return { gateway, connection, sent };
};

const isModelSourceCommand = (
  frame: AgentToDaemonEnvelope,
): frame is CapabilityModelSource =>
  frame.type === "execute" && frame.kind === "model_source";

const target = {
  computerId: "computer-local",
  tenantId: "tenant-1",
  ownerActorId: "actor-1",
} as const;

describe("Runner Gateway model source", () => {
  it.each(["dev", "0.54.0"])(
    "sends the command to Computer %s",
    async (version) => {
      const { gateway, connection, sent } = await connect(version);
      const reading = gateway.modelSource({ ...target, action: "status" });
      await vi.waitFor(() =>
        expect(sent.some(isModelSourceCommand)).toBe(true),
      );
      const request = sent.find(isModelSourceCommand);
      if (!request) throw new Error("Missing model source command");
      await connection.receive({
        type: "executed",
        kind: "model_source",
        outcome: "succeeded",
        protocol_version: request.protocol_version,
        command_id: request.command_id,
        runner_id: request.runner_id,
        tenant_id: request.tenant_id,
        owner_actor_id: request.owner_actor_id,
        connection_epoch: request.connection_epoch,
        expires_at: request.expires_at,
        action: "status",
      });
      await expect(reading).resolves.toEqual({});
    },
  );

  // An older Computer closes the connection on a command it cannot decode.
  it("refuses an older Computer before sending", async () => {
    const { gateway, sent } = await connect("0.53.0");
    await expect(
      gateway.modelSource({ ...target, action: "status" }),
    ).rejects.toBeInstanceOf(LocalComputerCapabilityError);
    expect(sent.some(isModelSourceCommand)).toBe(false);
  });

  // A Computer before 0.56.0 closes the connection on a BYOK path, endpoint
  // or protocol, so it gets only commands without a BYOK input.
  it("refuses a BYOK input to a Computer that predates BYOK paths", async () => {
    const { gateway, sent } = await connect("0.55.0");
    await expect(
      gateway.modelSource({
        ...target,
        action: "models",
        byok: {
          base_url: "https://open.bigmodel.cn",
          path: "/api/paas/v4",
          endpoint: "/chat/completions",
          protocol: "openai-chat",
        },
      }),
    ).rejects.toBeInstanceOf(LocalComputerCapabilityError);
    expect(sent.some(isModelSourceCommand)).toBe(false);
  });
});
