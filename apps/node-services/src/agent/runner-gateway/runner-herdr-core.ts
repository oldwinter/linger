import type { HerdrCoreEvent } from "@linger/wire-contracts/runner-gateway/types";
import { isRecord } from "@linger/service-kit";

import { TeamHubRuntimeStateError } from "../executor/teamhub-runtime-state-client.js";
import { logAgentEvent } from "../observability/agent-log.js";
import {
  FIRST_SERVICE_FEATURES_COMPUTER_VERSION,
  isComputerVersionAtLeast,
  LocalComputerNotFoundError,
  LocalComputerOfflineError,
} from "./local-computer-management.js";
import { isServingConnection } from "./runner-connections.js";
import type {
  ConnectedRunner,
  RunnerGatewayContext,
  RunnerGatewayControllers,
} from "./runner-gateway-context.js";

/**
 * Allowlisted herdr_core tools callable via REST and Agent Business API.
 * Note: herdr-core v0.1.21 terminal.send accepts only "idle" | "working" in its
 * own "if" parameter, so the Local Computer Daemon handles both send(if="blocked")
 * and answer (answer_text / answer_keys) via terminal.get CAS followed by
 * terminal.send(force: true, no "if") or terminal.keys.
 */
export const HERDR_CORE_TOOL_NAMES = [
  "status",
  "list",
  "get",
  "read",
  "run",
  "send",
  "keys",
  "interrupt",
  "wait",
  "kill",
  "rm",
  "keep",
  "label",
  "put",
  "templates",
  "machines",
  "exec",
  "file_read",
  "file_write",
  "file_edit",
  "doc_get",
  "doc_set",
  "answer",
] as const;

export type HerdrCoreToolName = (typeof HERDR_CORE_TOOL_NAMES)[number];

/** Internal computer_tool name that initiates a daemon binary PTY stream session. */
export const HERDR_CORE_ATTACH_TOOL_NAME = "attach" as const;

const HERDR_CORE_TOOL_SET: ReadonlySet<string> = new Set(HERDR_CORE_TOOL_NAMES);

/** Agent ID sentinel carried on wire frames for direct owner-level herdr_core calls. */
export const OWNER_HERDR_CORE_AGENT_ID = "herdr-core";

export function isHerdrCoreToolName(
  value: unknown,
): value is HerdrCoreToolName {
  return typeof value === "string" && HERDR_CORE_TOOL_SET.has(value);
}

export class HerdrCoreUnsupportedError extends Error {
  readonly code = "herdr_core_unsupported";

  constructor(
    message = "Local Computer release does not support herdr_core_v1",
  ) {
    super(message);
    this.name = "HerdrCoreUnsupportedError";
  }
}

export class HerdrCoreInvalidRequestError extends Error {
  readonly code = "invalid_herdr_core_request";

  constructor(message: string) {
    super(message);
    this.name = "HerdrCoreInvalidRequestError";
  }
}

export interface OwnerHerdrCoreCallRequest {
  readonly tenantId: string;
  readonly ownerActorId: string;
  readonly computerId: string;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly deadlineMs?: number;
  readonly toolSessionId?: string;
  /** Permits internal stream rendezvous (`attach`) from runner-herdr-core-stream. */
  readonly allowAttach?: boolean;
  readonly signal: AbortSignal;
}

/** Coordinates herdr_core control-plane calls and runner.herdr_core_event reports. */
export class RunnerHerdrCore {
  readonly #context: RunnerGatewayContext;
  readonly #owners: Pick<
    RunnerGatewayControllers,
    "connections" | "computerTools"
  >;
  readonly #disconnectListeners = new Set<(computerId: string) => void>();

  constructor(
    context: RunnerGatewayContext,
    owners: Pick<RunnerGatewayControllers, "connections" | "computerTools">,
  ) {
    this.#context = context;
    this.#owners = owners;
  }

  /** Whether the connected Computer received herdr_core_v1 and herdr_core_stream features. */
  supportsHerdrCore(computerId: string): boolean {
    const connection = this.#owners.connections().getConnection(computerId);
    return (
      isServingConnection(connection) &&
      isComputerVersionAtLeast(
        connection.hello.daemon_version,
        FIRST_SERVICE_FEATURES_COMPUTER_VERSION,
      )
    );
  }

  /** Returns the serving Computer's connection epoch if owned by tenantId/ownerActorId. */
  servingOwnerConnectionEpoch(
    computerId: string,
    tenantId: string,
    ownerActorId: string,
  ): number | undefined {
    const connection = this.#owners.connections().getConnection(computerId);
    if (!isServingConnection(connection)) return undefined;
    if (connection.tenantOwners.get(tenantId) !== ownerActorId)
      return undefined;
    return connection.connectionEpoch;
  }

  /** Invokes one structured herdr_core tool on an owned Local Computer without requiring an Agent placement. */
  async callOwnerTool(
    request: OwnerHerdrCoreCallRequest,
  ): Promise<Record<string, unknown>> {
    const allowed =
      isHerdrCoreToolName(request.toolName) ||
      (request.allowAttach === true &&
        request.toolName === HERDR_CORE_ATTACH_TOOL_NAME);
    if (!allowed) {
      throw new HerdrCoreInvalidRequestError(
        `Unsupported herdr_core tool: ${request.toolName}`,
      );
    }
    if (!isRecord(request.arguments)) {
      throw new HerdrCoreInvalidRequestError(
        "herdr_core tool arguments must be a JSON object",
      );
    }
    const connection = this.#owners
      .connections()
      .getConnection(request.computerId);
    if (!isServingConnection(connection)) throw new LocalComputerOfflineError();
    if (
      connection.tenantOwners.get(request.tenantId) !== request.ownerActorId
    ) {
      throw new LocalComputerNotFoundError();
    }
    if (
      !isComputerVersionAtLeast(
        connection.hello.daemon_version,
        FIRST_SERVICE_FEATURES_COMPUTER_VERSION,
      )
    ) {
      throw new HerdrCoreUnsupportedError();
    }
    const toolSessionId =
      request.toolSessionId?.trim() || `hc-${this.#context.createId()}`;
    return this.#owners.computerTools().call({
      tenantId: request.tenantId,
      ownerActorId: request.ownerActorId,
      computerId: request.computerId,
      agentId: OWNER_HERDR_CORE_AGENT_ID,
      toolSessionId,
      server: "herdr_core",
      toolName: request.toolName,
      arguments: request.arguments,
      ownerScoped: true,
      ...(request.deadlineMs === undefined
        ? {}
        : { deadlineMs: request.deadlineMs }),
      signal: request.signal,
    });
  }

  /** Forwards a runner.herdr_core_event to TeamHub without ever failing the Runner connection. */
  async receiveEvent(
    connection: ConnectedRunner,
    event: HerdrCoreEvent,
  ): Promise<void> {
    try {
      await this.#context.computerRegistry?.reportHerdrCoreEvent?.(
        connection.runnerId,
        event,
      );
    } catch (error) {
      if (
        error instanceof TeamHubRuntimeStateError &&
        error.status === 400 &&
        event.status?.kind !== undefined
      ) {
        // Older TeamHub releases reject unknown status.kind with HTTP 400;
        // drop only kind and retry once so status.msg and the event still land.
        const { kind: _droppedKind, ...legacyStatus } = event.status;
        try {
          await this.#context.computerRegistry?.reportHerdrCoreEvent?.(
            connection.runnerId,
            { ...event, status: legacyStatus },
          );
          return;
        } catch (retryError) {
          logAgentEvent("warn", "runner.herdr_core_event.report_failed", {
            runnerId: connection.runnerId,
            kind: event.kind,
            address: event.address,
            status:
              retryError instanceof TeamHubRuntimeStateError
                ? retryError.status
                : null,
          });
          return;
        }
      }
      logAgentEvent("warn", "runner.herdr_core_event.report_failed", {
        runnerId: connection.runnerId,
        kind: event.kind,
        address: event.address,
        status: error instanceof TeamHubRuntimeStateError ? error.status : null,
      });
    }
  }

  disconnected(connection: ConnectedRunner): void {
    for (const listener of this.#disconnectListeners) {
      try {
        listener(connection.runnerId);
      } catch {
        // Disconnect fanout must not break teardown of other listeners.
      }
    }
  }

  onComputerDisconnected(listener: (computerId: string) => void): () => void {
    this.#disconnectListeners.add(listener);
    return () => {
      this.#disconnectListeners.delete(listener);
    };
  }
}
