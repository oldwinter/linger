import type { TeamHubApi } from "@/features/teamhub/teamhub-api";
import { resolveTeamHubBaseUrl } from "@/features/teamhub/teamhub-base-url";
import {
  TeamHubError,
  TeamHubTransportError,
} from "@/features/teamhub/teamhub-error";

import type {
  DesktopHerdrCoreApi,
  DesktopHerdrCoreBridgeInfo,
  HerdrCoreDocResponse,
  HerdrCoreInterruptRequest,
  HerdrCoreInterruptResponse,
  HerdrCoreKeysRequest,
  HerdrCoreLaunchRequest,
  HerdrCoreMachinesResponse,
  HerdrCorePutRequest,
  HerdrCorePutResponse,
  HerdrCoreReadResponse,
  HerdrCoreSendRequest,
  HerdrCoreSendResponse,
  HerdrCoreStatusResponse,
  HerdrCoreTemplatesResponse,
  HerdrCoreTerminalResponse,
  HerdrCoreTerminalsQuery,
  HerdrCoreTerminalsResponse,
  HerdrCoreTransportMode,
} from "./types";

export type HerdrCoreApiErrorKind =
  | "not_implemented"
  | "unavailable"
  | "offline"
  | "blocked"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "error";

export class HerdrCoreApiError extends Error {
  readonly status: number;
  readonly kind: HerdrCoreApiErrorKind;
  readonly code?: string;

  constructor(options: {
    readonly status: number;
    readonly kind: HerdrCoreApiErrorKind;
    readonly message: string;
    readonly code?: string;
  }) {
    super(options.message);
    this.name = "HerdrCoreApiError";
    this.status = options.status;
    this.kind = options.kind;
    this.code = options.code;
  }
}

export interface HerdrCoreClientOptions {
  readonly computerId: string;
  readonly baseOrigin?: string;
  readonly directBridge?: DesktopHerdrCoreBridgeInfo | null;
  readonly teamHubApi?: TeamHubApi;
  readonly fetchImpl?: typeof fetch;
}

export interface HerdrCoreClient {
  readonly computerId: string;
  readonly transportMode: HerdrCoreTransportMode;
  readonly directBridge: DesktopHerdrCoreBridgeInfo | null;
  getStatus(signal?: AbortSignal): Promise<HerdrCoreStatusResponse>;
  listTerminals(
    query?: HerdrCoreTerminalsQuery,
    signal?: AbortSignal,
  ): Promise<HerdrCoreTerminalsResponse>;
  getTerminal(
    address: string,
    signal?: AbortSignal,
  ): Promise<HerdrCoreTerminalResponse>;
  readTerminal(
    address: string,
    lines?: number,
    signal?: AbortSignal,
  ): Promise<HerdrCoreReadResponse>;
  launchTerminal(
    input: HerdrCoreLaunchRequest,
  ): Promise<HerdrCoreTerminalResponse>;
  sendPrompt(input: HerdrCoreSendRequest): Promise<HerdrCoreSendResponse>;
  sendKeys(input: HerdrCoreKeysRequest): Promise<Record<string, unknown>>;
  interruptTerminal(
    input: HerdrCoreInterruptRequest,
  ): Promise<HerdrCoreInterruptResponse>;
  killTerminal(address: string): Promise<Record<string, unknown>>;
  removeTerminal(address: string): Promise<void>;
  labelTerminal(
    address: string,
    labels: Readonly<Record<string, string | null>>,
  ): Promise<Record<string, unknown>>;
  putFile(input: HerdrCorePutRequest): Promise<HerdrCorePutResponse>;
  listTemplates(signal?: AbortSignal): Promise<HerdrCoreTemplatesResponse>;
  listMachines(signal?: AbortSignal): Promise<HerdrCoreMachinesResponse>;
  getDoc(
    name: string,
    on?: string,
    signal?: AbortSignal,
  ): Promise<HerdrCoreDocResponse>;
  putDoc(
    name: string,
    value: unknown,
    options?: { readonly on?: string; readonly version?: number },
  ): Promise<{ readonly version: number }>;
  buildAttachWsUrl(params: {
    readonly address: string;
    readonly cols: number;
    readonly rows: number;
    readonly observe: boolean;
    readonly history?: number;
    readonly resumed?: boolean;
  }): string;
}

export function getDesktopHerdrCoreApi(): DesktopHerdrCoreApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { lingerDesktop?: { herdrCore?: DesktopHerdrCoreApi } })
    .lingerDesktop?.herdrCore;
}

function defaultBaseOrigin(): string {
  try {
    return resolveTeamHubBaseUrl().origin;
  } catch {
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }
    return "http://127.0.0.1:3000";
  }
}

function classifyHttpError(
  status: number,
  code: string | undefined,
): HerdrCoreApiErrorKind {
  const upper = code?.toUpperCase();
  if (status === 501 || (status === 404 && !upper)) {
    return "not_implemented";
  }
  if (status === 404) {
    if (upper === "NOT_FOUND" || upper === "LOCAL_COMPUTER_NOT_FOUND") {
      return "not_found";
    }
    return "not_implemented";
  }
  if (status === 409 && upper === "BLOCKED") return "blocked";
  if (status === 409) return "conflict";
  if (status === 413 || upper === "PAYLOAD_TOO_LARGE")
    return "payload_too_large";
  if (status === 502 || status === 503 || status === 504) {
    if (
      upper === "LOCAL_COMPUTER_OFFLINE" ||
      upper === "COMPUTER_OFFLINE" ||
      upper === "HERDR_CORE_OFFLINE"
    ) {
      return "offline";
    }
    return "unavailable";
  }
  return "error";
}

function mapTeamHubError(error: unknown): never {
  if (error instanceof Error && error.name === "AbortError") {
    throw error;
  }
  if (error instanceof HerdrCoreApiError) {
    throw error;
  }
  if (error instanceof TeamHubError) {
    throw new HerdrCoreApiError({
      status: error.status,
      kind: classifyHttpError(error.status, error.code),
      code: error.code,
      message: error.serverMessage ?? error.message,
    });
  }
  if (error instanceof TeamHubTransportError) {
    throw new HerdrCoreApiError({
      status: 0,
      kind: "offline",
      message: error.message,
    });
  }
  throw new HerdrCoreApiError({
    status: 0,
    kind: "offline",
    message:
      error instanceof Error
        ? error.message
        : "Network request to herdr-core failed.",
  });
}

function toWebSocketOrigin(origin: string): string {
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.origin;
}

export function createHerdrCoreClient(
  options: HerdrCoreClientOptions,
): HerdrCoreClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const direct =
    options.directBridge?.running &&
    options.directBridge.baseUrl &&
    options.directBridge.wsBaseUrl &&
    options.directBridge.token
      ? options.directBridge
      : null;

  const transportMode: HerdrCoreTransportMode = direct
    ? "desktop_direct"
    : "teamhub_relay";

  const apiBase = direct
    ? direct.baseUrl!.replace(/\/$/u, "")
    : `${(options.baseOrigin ?? defaultBaseOrigin()).replace(/\/$/u, "")}/api/v1/computers/${encodeURIComponent(options.computerId)}/herdr-core`;

  const wsBase = direct
    ? direct.wsBaseUrl!.replace(/\/$/u, "")
    : `${toWebSocketOrigin(options.baseOrigin ?? defaultBaseOrigin())}/api/v1/computers/${encodeURIComponent(options.computerId)}/herdr-core`;

  async function requestJson<T>(
    path: string,
    init: {
      readonly method?: string;
      readonly query?: Readonly<
        Record<string, string | number | boolean | undefined>
      >;
      readonly body?: unknown;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const url = new URL(`${apiBase}${path}`);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers: Record<string, string> = {};
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (direct?.token) {
      headers.authorization = `Bearer ${direct.token}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: init.method ?? "GET",
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        credentials: direct ? "omit" : "include",
        signal: init.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      throw new HerdrCoreApiError({
        status: 0,
        kind: "offline",
        message:
          error instanceof Error
            ? error.message
            : "Network request to herdr-core failed.",
      });
    }

    if (!response.ok) {
      let code: string | undefined;
      let message = `Request failed (${response.status})`;
      try {
        const parsed = (await response.json()) as {
          readonly error?: {
            readonly code?: string;
            readonly message?: string;
          };
        };
        if (parsed.error?.code) code = parsed.error.code;
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        // Non-JSON error body (e.g. gateway 404/502 page).
      }
      throw new HerdrCoreApiError({
        status: response.status,
        kind: classifyHttpError(response.status, code),
        code,
        message,
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text.trim()) {
      return {} as T;
    }
    return JSON.parse(text) as T;
  }

  const teamHubApi = direct ? undefined : options.teamHubApi;
  const computerId = options.computerId;

  async function runTeamHub<T>(
    call: () => Promise<{ readonly data?: unknown }>,
  ): Promise<T> {
    try {
      const { data } = await call();
      return data as T;
    } catch (error) {
      mapTeamHubError(error);
    }
  }

  return {
    computerId,
    transportMode,
    directBridge: direct,
    getStatus: (signal) =>
      teamHubApi
        ? runTeamHub<HerdrCoreStatusResponse>(() =>
            teamHubApi.GET("/api/v1/computers/{computerId}/herdr-core/status", {
              params: { path: { computerId } },
              signal,
            }),
          )
        : requestJson<HerdrCoreStatusResponse>("/status", { signal }),
    listTerminals: (query, signal) =>
      teamHubApi
        ? runTeamHub<HerdrCoreTerminalsResponse>(() =>
            teamHubApi.GET(
              "/api/v1/computers/{computerId}/herdr-core/terminals",
              {
                params: {
                  path: { computerId },
                  query: {
                    all: query?.all ?? false,
                    machine: query?.machine || undefined,
                    room_id: query?.room_id || undefined,
                    work_item_id: query?.work_item_id || undefined,
                    status: query?.status as
                      | "idle"
                      | "working"
                      | "done"
                      | "blocked"
                      | "error"
                      | undefined,
                  },
                },
                signal,
              },
            ),
          )
        : requestJson<HerdrCoreTerminalsResponse>("/terminals", {
            query: {
              all: query?.all ?? false,
              machine: query?.machine,
              room_id: query?.room_id,
              work_item_id: query?.work_item_id,
              status: query?.status,
            },
            signal,
          }),
    getTerminal: (address, signal) =>
      teamHubApi
        ? runTeamHub<HerdrCoreTerminalResponse>(() =>
            teamHubApi.GET(
              "/api/v1/computers/{computerId}/herdr-core/terminal",
              {
                params: { path: { computerId }, query: { address } },
                signal,
              },
            ),
          )
        : requestJson<HerdrCoreTerminalResponse>("/terminal", {
            query: { address },
            signal,
          }),
    readTerminal: (address, lines = 120, signal) =>
      teamHubApi
        ? runTeamHub<HerdrCoreReadResponse>(() =>
            teamHubApi.GET(
              "/api/v1/computers/{computerId}/herdr-core/terminal/read",
              {
                params: { path: { computerId }, query: { address, lines } },
                signal,
              },
            ),
          )
        : requestJson<HerdrCoreReadResponse>("/terminal/read", {
            query: { address, lines },
            signal,
          }),
    launchTerminal: (input) =>
      teamHubApi
        ? runTeamHub<HerdrCoreTerminalResponse>(() =>
            teamHubApi.POST(
              "/api/v1/computers/{computerId}/herdr-core/terminals",
              {
                params: { path: { computerId } },
                body: {
                  ...input,
                  argv: input.argv ? [...input.argv] : undefined,
                  labels: input.labels ? { ...input.labels } : undefined,
                },
              },
            ),
          )
        : requestJson<HerdrCoreTerminalResponse>("/terminals", {
            method: "POST",
            body: input,
          }),
    sendPrompt: (input) =>
      teamHubApi
        ? runTeamHub<HerdrCoreSendResponse>(() =>
            teamHubApi.POST(
              "/api/v1/computers/{computerId}/herdr-core/terminal/send",
              {
                params: { path: { computerId } },
                body: {
                  address: input.address,
                  text: input.text,
                  if:
                    input.if === "idle" ||
                    input.if === "working" ||
                    input.if === "blocked"
                      ? input.if
                      : undefined,
                  turn: input.turn,
                  force: input.force,
                  wait: input.wait,
                  timeout: input.timeout,
                },
              },
            ),
          )
        : requestJson<HerdrCoreSendResponse>("/terminal/send", {
            method: "POST",
            body: input,
          }),
    sendKeys: (input) =>
      teamHubApi
        ? runTeamHub<Record<string, unknown>>(() =>
            teamHubApi.POST(
              "/api/v1/computers/{computerId}/herdr-core/terminal/keys",
              {
                params: { path: { computerId } },
                body: { address: input.address, keys: [...input.keys] },
              },
            ),
          )
        : requestJson<Record<string, unknown>>("/terminal/keys", {
            method: "POST",
            body: input,
          }),
    interruptTerminal: (input) =>
      teamHubApi
        ? runTeamHub<HerdrCoreInterruptResponse>(() =>
            teamHubApi.POST(
              "/api/v1/computers/{computerId}/herdr-core/terminal/interrupt",
              {
                params: { path: { computerId } },
                body: { address: input.address, timeout: input.timeout },
              },
            ),
          )
        : requestJson<HerdrCoreInterruptResponse>("/terminal/interrupt", {
            method: "POST",
            body: input,
          }),
    killTerminal: (address) =>
      teamHubApi
        ? runTeamHub<Record<string, unknown>>(() =>
            teamHubApi.POST(
              "/api/v1/computers/{computerId}/herdr-core/terminal/kill",
              {
                params: { path: { computerId } },
                body: { address },
              },
            ),
          )
        : requestJson<Record<string, unknown>>("/terminal/kill", {
            method: "POST",
            body: { address },
          }),
    removeTerminal: async (address) => {
      if (teamHubApi) {
        await runTeamHub(() =>
          teamHubApi.DELETE(
            "/api/v1/computers/{computerId}/herdr-core/terminal",
            {
              params: { path: { computerId }, query: { address } },
            },
          ),
        );
        return;
      }
      await requestJson("/terminal", {
        method: "DELETE",
        query: { address },
      });
    },
    labelTerminal: (address, labels) =>
      requestJson<Record<string, unknown>>("/terminal/label", {
        method: "POST",
        body: { address, labels },
      }),
    putFile: (input) =>
      teamHubApi
        ? runTeamHub<HerdrCorePutResponse>(() =>
            teamHubApi.POST(
              "/api/v1/computers/{computerId}/herdr-core/terminal/put",
              {
                params: { path: { computerId } },
                body: input,
              },
            ),
          )
        : requestJson<HerdrCorePutResponse>("/terminal/put", {
            method: "POST",
            body: input,
          }),
    listTemplates: (signal) =>
      teamHubApi
        ? runTeamHub<HerdrCoreTemplatesResponse>(() =>
            teamHubApi.GET(
              "/api/v1/computers/{computerId}/herdr-core/templates",
              {
                params: { path: { computerId } },
                signal,
              },
            ),
          )
        : requestJson<HerdrCoreTemplatesResponse>("/templates", { signal }),
    listMachines: (signal) =>
      teamHubApi
        ? runTeamHub<HerdrCoreMachinesResponse>(() =>
            teamHubApi.GET(
              "/api/v1/computers/{computerId}/herdr-core/machines",
              {
                params: { path: { computerId } },
                signal,
              },
            ),
          )
        : requestJson<HerdrCoreMachinesResponse>("/machines", { signal }),
    getDoc: (name, on, signal) =>
      teamHubApi
        ? runTeamHub<HerdrCoreDocResponse>(() =>
            teamHubApi.GET(
              "/api/v1/computers/{computerId}/herdr-core/docs/{name}",
              {
                params: {
                  path: { computerId, name },
                  query: on ? { on } : undefined,
                },
                signal,
              },
            ),
          )
        : requestJson<HerdrCoreDocResponse>(
            `/docs/${encodeURIComponent(name)}`,
            {
              query: { on },
              signal,
            },
          ),
    putDoc: (name, value, docOptions) =>
      teamHubApi
        ? runTeamHub<{ readonly version: number }>(() =>
            teamHubApi.PUT(
              "/api/v1/computers/{computerId}/herdr-core/docs/{name}",
              {
                params: {
                  path: { computerId, name },
                  query: docOptions?.on ? { on: docOptions.on } : undefined,
                },
                body: {
                  value,
                  version: docOptions?.version ?? 0,
                },
              },
            ),
          )
        : requestJson<{ readonly version: number }>(
            `/docs/${encodeURIComponent(name)}`,
            {
              method: "PUT",
              query: { on: docOptions?.on },
              body: {
                value,
                ...(docOptions?.version !== undefined
                  ? { version: docOptions.version }
                  : {}),
              },
            },
          ),
    buildAttachWsUrl: (params) => {
      const url = new URL(`${wsBase}/attach`);
      url.searchParams.set("address", params.address);
      url.searchParams.set("cols", String(params.cols));
      url.searchParams.set("rows", String(params.rows));
      url.searchParams.set("observe", params.observe ? "true" : "false");
      url.searchParams.set("history", String(params.history ?? 200));
      if (params.resumed) {
        url.searchParams.set("resumed", "true");
      }
      if (direct?.token) {
        url.searchParams.set("token", direct.token);
      }
      return url.toString();
    },
  };
}

export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
