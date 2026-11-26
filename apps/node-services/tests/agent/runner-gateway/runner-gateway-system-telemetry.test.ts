import type {
  AgentToDaemonEnvelope,
  CapabilitySystemTelemetry,
  SystemTelemetrySnapshot,
} from "@linger/wire-contracts/runner-gateway/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalComputerCapabilityError,
  LocalComputerOfflineError,
} from "../../../src/agent/runner-gateway/local-computer-management.js";
import { type RunnerGatewayConnection } from "../../../src/agent/runner-gateway/runner-gateway.js";
import {
  CURRENT_RUNNER_CAPABILITIES,
  currentRunnerIdentity,
} from "../test-support/runner-capabilities.js";
import { createTestRunnerGateway } from "../test-support/runner-gateway.js";
import { runtimeDiagnostics } from "./runtime-diagnostics-fixture.js";

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

const isSystemTelemetryCommand = (
  frame: AgentToDaemonEnvelope,
): frame is CapabilitySystemTelemetry =>
  frame.type === "execute" && frame.kind === "system_telemetry";

const target = {
  computerId: "computer-local",
  tenantId: "tenant-1",
  ownerActorId: "actor-1",
} as const;

const sampleSnapshot: SystemTelemetrySnapshot = {
  observed_at: "2026-11-27T01:30:00Z",
  sample_interval_ms: 1000,
  hardware: {
    architecture: "uma",
    platform: "darwin",
    arch: "arm64",
    hostname: "mac-mini.local",
    chip_name: "Apple M6",
    os_label: "macOS 15.6",
    gpu_name: "Apple M6",
    gpu_core_count: 12,
    ane_cores: 16,
    memory: {
      total_bytes: 25_769_803_776,
      used_bytes: 16_106_127_360,
      recommended_working_set_bytes: 19_069_665_280,
      model_weights_bytes: 6_442_450_944,
      kv_cache_bytes: 1_073_741_824,
      compute_buffer_bytes: 536_870_912,
      os_wired_bytes: 3_221_225_472,
      active_apps_bytes: 3_758_096_384,
      compressed_bytes: 1_073_741_824,
      free_headroom_bytes: 9_663_676_416,
      system_ram_total_bytes: 25_769_803_776,
      system_ram_used_bytes: 16_106_127_360,
      system_ram_available_bytes: 9_663_676_416,
      memory_pressure: "normal",
      swap_used_bytes: 0,
      swap_total_bytes: 0,
      swap_io_mb_s: 0,
    },
    bandwidth: {
      effective_decode_gb_s: 112.5,
      theoretical_gb_s: 150,
      utilization_pct: 75,
      source: "estimated",
    },
    disk: {
      total_bytes: 500_000_000_000,
      free_bytes: 120_000_000_000,
      model_cache_bytes: 8_000_000_000,
    },
    cpu: {
      total_cores: 12,
      load_pct: 22.5,
      load_avg: [1.4, 1.2, 1.1],
      clusters: [
        { id: "super", name: "Super", kind: "super", cores: 2 },
        { id: "perf", name: "Performance", kind: "performance", cores: 4 },
        { id: "eff", name: "Efficiency", kind: "efficiency", cores: 6 },
      ],
    },
    gpu: {
      util_pct: 64,
      renderer_pct: 62,
      tiler_pct: 14,
      in_use_system_bytes: 8_053_063_680,
      alloc_system_bytes: 8_589_934_592,
    },
    power: {},
    thermal: {
      state: "nominal",
      throttling: false,
      cpu_speed_limit_pct: 100,
    },
  },
  inference: {
    ttft_live_ms: 94,
    ttft_p50_ms: 88,
    ttft_p95_ms: 142,
    prefill_tok_s: 310.0,
    decode_tok_s: 45.2,
    theoretical_decode_ceiling_tok_s: 60.0,
    bandwidth_efficiency_pct: 75.3,
    active_requests_count: 1,
    queued_requests_count: 0,
    active_slots: 1,
    total_slots: 4,
    kv_cache_used_pct: 24.5,
    kv_cache_tokens_used: 8192,
    kv_cache_tokens_capacity: 32768,
    prefix_cache_hit_rate_pct: 82.0,
    total_tokens_session: 18_420,
    loaded_models: [],
    slots: [],
    requests: [],
    bottleneck: {
      kind: "healthy",
      severity: "healthy",
      reason_code: "balanced_headroom",
    },
  },
};

describe("Runner Gateway system telemetry", () => {
  it.each(["dev", "0.67.0"])(
    "sends the command to Computer %s and resolves the snapshot",
    async (version) => {
      const { gateway, connection, sent } = await connect(version);
      const reading = gateway.systemTelemetry(target);
      await vi.waitFor(() =>
        expect(sent.some(isSystemTelemetryCommand)).toBe(true),
      );
      const request = sent.find(isSystemTelemetryCommand);
      if (!request) throw new Error("Missing system telemetry command");
      await connection.receive({
        type: "executed",
        kind: "system_telemetry",
        action: "snapshot",
        outcome: "succeeded",
        protocol_version: request.protocol_version,
        command_id: request.command_id,
        runner_id: request.runner_id,
        tenant_id: request.tenant_id,
        owner_actor_id: request.owner_actor_id,
        connection_epoch: request.connection_epoch,
        expires_at: request.expires_at,
        telemetry: sampleSnapshot,
      });
      await expect(reading).resolves.toEqual(sampleSnapshot);
    },
  );

  // An older Computer closes the connection on a command kind it cannot decode.
  it("refuses an older Computer before sending", async () => {
    const { gateway, sent } = await connect("0.66.0");
    await expect(gateway.systemTelemetry(target)).rejects.toBeInstanceOf(
      LocalComputerCapabilityError,
    );
    expect(sent.some(isSystemTelemetryCommand)).toBe(false);
  });

  it("rejects in-flight telemetry requests when the Computer disconnects", async () => {
    const { gateway, connection, sent } = await connect("0.67.0");
    const reading = gateway.systemTelemetry(target);
    await vi.waitFor(() =>
      expect(sent.some(isSystemTelemetryCommand)).toBe(true),
    );
    connection.disconnect();
    await expect(reading).rejects.toBeInstanceOf(LocalComputerOfflineError);
  });
});
