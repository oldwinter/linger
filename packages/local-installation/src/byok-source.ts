import path from "node:path";
import { readPrivate } from "./instance.js";
import {
  localmodelsBaseDirectory,
  localmodelsStateDirectory,
  runLocalmodels,
} from "./localmodels-tool.js";
import { prepareRuntime, type NativeRuntime } from "./managed-runtimes.js";
import type { InstallOutcome, InstallerEvent } from "./events.js";

export type ByokProtocol = "openai-chat" | "openai-responses" | "anthropic";

export interface ByokConfiguration {
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  contextWindow?: number;
  runtime?: NativeRuntime;
}

export interface ByokCheckOutcome {
  ok: true;
  protocol: ByokProtocol;
  baseUrl: string;
  modelId: string;
  contextWindow: number;
}

interface StoredModelSource {
  schema: "localmodels.model-source/v1";
  mode: "local" | "subscription" | "byok";
  runtime: NativeRuntime;
  runtime_model: string;
  model_label: string | null;
  gateway_url: string | null;
  environment: Record<string, string>;
}

const PRIVATE_HOST_IPV4 =
  /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})$/;

export function isAllowedByokUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    const host = url.hostname.toLowerCase().replace(/^\[\s*|\s*\]$/g, "");
    if (
      host === "0.0.0.0" ||
      host === "::" ||
      host === "metadata.google.internal" ||
      host.startsWith("169.254.") ||
      host.startsWith("fe80:")
    )
      return false;
    if (url.protocol === "https:") return true;
    return (
      host === "localhost" ||
      host === "::1" ||
      host.endsWith(".local") ||
      !host.includes(".") ||
      PRIVATE_HOST_IPV4.test(host)
    );
  } catch {
    return false;
  }
}

export function validateByokConfiguration(value: unknown): ByokConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid BYOK configuration.");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (
      !["baseUrl", "apiKey", "modelId", "contextWindow", "runtime"].includes(
        key,
      )
    )
      throw new Error("Invalid BYOK configuration.");
  if (
    typeof record.baseUrl !== "string" ||
    record.baseUrl.length > 2048 ||
    !isAllowedByokUrl(record.baseUrl)
  )
    throw new Error(
      "Endpoint URL must use HTTPS, or HTTP on localhost / a private network.",
    );
  if (
    typeof record.modelId !== "string" ||
    !/^[-a-zA-Z0-9_./:@]{1,256}$/.test(record.modelId.trim())
  )
    throw new Error("Model ID is invalid.");
  const apiKey = record.apiKey;
  if (
    apiKey !== undefined &&
    (typeof apiKey !== "string" ||
      apiKey.length > 4096 ||
      [...apiKey].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127))
  )
    throw new Error("API key format is invalid.");
  const contextWindow = record.contextWindow;
  if (
    contextWindow !== undefined &&
    (!Number.isSafeInteger(contextWindow) ||
      Number(contextWindow) < 1 ||
      Number(contextWindow) > 2_147_483_647)
  )
    throw new Error("Context window must be a positive integer.");
  const runtime = record.runtime;
  if (
    runtime !== undefined &&
    runtime !== "claude" &&
    runtime !== "codex" &&
    runtime !== "pi"
  )
    throw new Error("Invalid BYOK runtime selection.");
  return {
    baseUrl: record.baseUrl.trim().replace(/\/+$/, ""),
    ...(apiKey !== undefined ? { apiKey } : {}),
    modelId: record.modelId.trim(),
    ...(contextWindow !== undefined
      ? { contextWindow: Number(contextWindow) }
      : {}),
    ...(runtime !== undefined ? { runtime } : {}),
  };
}

// The API key travels on stdin, never in argv.
function byokStdin(config: ByokConfiguration): string {
  return JSON.stringify({
    baseUrl: config.baseUrl,
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    modelId: config.modelId,
    ...(config.contextWindow !== undefined
      ? { contextWindow: config.contextWindow }
      : {}),
  });
}

function isByokProtocol(value: unknown): value is ByokProtocol {
  return (
    value === "openai-chat" ||
    value === "openai-responses" ||
    value === "anthropic"
  );
}

/**
 * Verifies the endpoint from this computer and finds the wire format it
 * answers, trying the runtime's own format first.
 */
export async function checkByokEndpoint(
  home: string,
  config: ByokConfiguration,
  signal: AbortSignal,
  dependencies: { localmodels?: typeof runLocalmodels } = {},
): Promise<ByokCheckOutcome> {
  const validated = validateByokConfiguration(config);
  signal.throwIfAborted();
  const result = await (dependencies.localmodels ?? runLocalmodels)(
    home,
    [
      "source",
      "check",
      "--config-stdin",
      "--runtime",
      validated.runtime ?? "claude",
      "--json",
    ],
    { signal, timeoutMs: 45_000, input: byokStdin(validated) },
  );
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    parsed = undefined;
  }
  if (
    result.code !== 0 ||
    parsed?.ok !== true ||
    !isByokProtocol(parsed.protocol)
  ) {
    const message =
      typeof parsed?.message === "string" && parsed.message
        ? parsed.message
        : "Could not verify the BYOK endpoint. Check the URL, API key, model ID and network.";
    const code =
      typeof parsed?.code === "string" ? parsed.code : "BYOK_CHECK_FAILED";
    throw Object.assign(new Error(message), { code });
  }
  return {
    ok: true,
    protocol: parsed.protocol,
    baseUrl:
      typeof parsed.base_url === "string" ? parsed.base_url : validated.baseUrl,
    modelId:
      typeof parsed.model_id === "string" ? parsed.model_id : validated.modelId,
    contextWindow:
      typeof parsed.context_window === "number" && parsed.context_window > 0
        ? parsed.context_window
        : (validated.contextWindow ?? 131_072),
  };
}

// The installer switches the source through localmodels, as the Computer
// does from Settings, so model-source.json has one writer.
function applySource(
  home: string,
  mode: "local" | "subscription" | "byok",
  runtime: NativeRuntime,
  options: { signal: AbortSignal; timeoutMs: number; input?: string },
  localmodels: typeof runLocalmodels,
) {
  return localmodels(
    home,
    [
      "source",
      "apply",
      "--mode",
      mode,
      "--runtime",
      runtime,
      "--base-dir",
      localmodelsBaseDirectory(home),
      "--harness-root",
      path.join(path.resolve(home), "runtime", "harness"),
      "--node",
      process.execPath,
      ...(options.input === undefined ? [] : ["--config-stdin"]),
      "--json",
    ],
    {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      ...(options.input === undefined ? {} : { input: options.input }),
    },
  );
}

function sourceApplyFailure(
  stdout: string,
  message: string,
  code: string,
): InstallOutcome {
  let detail = message;
  let detailCode = code;
  try {
    const errDoc = JSON.parse(stdout) as { message?: unknown; code?: unknown };
    if (typeof errDoc.message === "string" && errDoc.message)
      detail = errDoc.message;
    if (typeof errDoc.code === "string" && errDoc.code)
      detailCode = errDoc.code;
  } catch {
    /* Non-JSON tool output stays private. */
  }
  return {
    code: 1,
    state: "failed",
    message: detail,
    details: { code: detailCode },
  };
}

export async function prepareByokRuntime(
  config: ByokConfiguration,
  options: {
    home: string;
    signal: AbortSignal;
    onEvent: (event: InstallerEvent) => void;
    env?: NodeJS.ProcessEnv;
  },
  dependencies: {
    localmodels?: typeof runLocalmodels;
    prepareNative?: typeof prepareRuntime;
  } = {},
): Promise<InstallOutcome> {
  const validated = validateByokConfiguration(config);
  const runtime = validated.runtime ?? "claude";
  const nativeOutcome = await (dependencies.prepareNative ?? prepareRuntime)(
    runtime,
    {
      home: options.home,
      signal: options.signal,
      onEvent: options.onEvent,
      env: options.env,
    },
    dependencies.localmodels ? { localmodels: dependencies.localmodels } : {},
  );
  if (
    nativeOutcome.code !== 0 &&
    (nativeOutcome.details as { code?: string } | undefined)?.code !==
      "RUNTIME_AUTH_REQUIRED"
  )
    return nativeOutcome;

  options.onEvent({
    kind: "stage",
    stage: "runtime",
    state: "running",
    message: "Mounting BYOK endpoint on local Bifrost gateway…",
  });
  const result = await applySource(
    options.home,
    "byok",
    runtime,
    {
      signal: options.signal,
      timeoutMs: 180_000,
      input: byokStdin(validated),
    },
    dependencies.localmodels ?? runLocalmodels,
  );
  if (result.code !== 0)
    return sourceApplyFailure(
      result.stdout,
      "BYOK gateway configuration failed. Check the endpoint settings and retry.",
      "BYOK_GATEWAY_FAILED",
    );
  options.onEvent({
    kind: "stage",
    stage: "runtime",
    state: "succeeded",
    message: "BYOK gateway and runtime profiles are ready.",
  });
  return {
    code: 0,
    state: "ready",
    message: "BYOK gateway and runtime profiles are ready.",
  };
}

/**
 * Makes a local-model or subscription setup the Computer's model source, which
 * also ends a BYOK source left from an earlier setup. Returns a failed outcome
 * when localmodels refuses.
 */
export async function applyNativeSource(
  home: string,
  mode: "local" | "subscription",
  runtime: NativeRuntime,
  signal: AbortSignal,
  dependencies: { localmodels?: typeof runLocalmodels } = {},
): Promise<InstallOutcome | undefined> {
  const result = await applySource(
    home,
    mode,
    runtime,
    { signal, timeoutMs: 180_000 },
    dependencies.localmodels ?? runLocalmodels,
  );
  return result.code === 0
    ? undefined
    : sourceApplyFailure(
        result.stdout,
        "Could not set the model source. Retry setup.",
        "MODEL_SOURCE_FAILED",
      );
}

export async function readByokEnvironment(home: string): Promise<
  | {
      mode: "local" | "subscription" | "byok";
      runtime: NativeRuntime;
      runtimeModel: string;
      environment: Record<string, string>;
    }
  | undefined
> {
  try {
    const raw = await readPrivate(
      path.join(localmodelsStateDirectory(home), "model-source.json"),
    );
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredModelSource>;
    if (
      parsed.schema !== "localmodels.model-source/v1" ||
      !parsed.mode ||
      !["local", "subscription", "byok"].includes(parsed.mode) ||
      !parsed.runtime ||
      !["claude", "codex", "pi"].includes(parsed.runtime)
    )
      return undefined;
    const environment: Record<string, string> = {};
    if (parsed.environment && typeof parsed.environment === "object") {
      for (const key of [
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "PI_CODING_AGENT_DIR",
      ]) {
        const val = parsed.environment[key];
        if (typeof val === "string" && path.isAbsolute(val))
          environment[key] = val;
      }
    }
    return {
      mode: parsed.mode,
      runtime: parsed.runtime,
      runtimeModel:
        typeof parsed.runtime_model === "string" ? parsed.runtime_model : "",
      environment,
    };
  } catch {
    return undefined;
  }
}
