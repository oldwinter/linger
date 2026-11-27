export type HerdrCoreTerminalStatusWord =
  | "idle"
  | "working"
  | "done"
  | "blocked"
  | "error";

export interface HerdrCoreTerminalStatus {
  readonly state?: string | null;
  readonly status?: string | null;
  readonly msg?: string | null;
  readonly kind?: string | null;
  readonly app?: string | null;
  readonly title?: string | null;
  readonly progress?: number | null;
  readonly detail?: string | null;
}

export interface HerdrCoreTerminalForeground {
  readonly pid?: number | null;
  readonly name?: string | null;
  readonly argv?: readonly string[] | null;
  readonly cwd?: string | null;
  readonly command?: string | null;
}

export interface HerdrCoreTerminal {
  readonly address: string;
  readonly machine?: string | null;
  readonly name?: string | null;
  readonly state: string;
  readonly cwd: string;
  readonly foreground_cwd?: string | null;
  readonly argv?: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly parent?: string | null;
  readonly template?: string | null;
  readonly title?: string;
  readonly cols: number;
  readonly rows: number;
  readonly created_ms: number;
  readonly exit_code?: number | null;
  readonly signal?: number | null;
  readonly reason?: string | null;
  readonly pid?: number | null;
  readonly keep?: boolean;
  readonly reported?: boolean;
  readonly turn?: number;
  readonly status?: HerdrCoreTerminalStatus | null;
  readonly status_ms?: number | null;
  readonly foreground?: HerdrCoreTerminalForeground | null;
}

export interface HerdrCoreMachine {
  readonly name: string;
  readonly host?: string | null;
  readonly id?: string | null;
  readonly target?: string | null;
  readonly via?: boolean;
  readonly state?: string | null;
  readonly status?: string | null;
  readonly online?: boolean;
  readonly connected?: boolean;
  readonly needs_login?: boolean;
  readonly keeps_running_after_logout?: boolean | null;
  readonly logout_linger_user?: string | null;
  readonly error?: string | null;
}

export interface HerdrCoreStatusResponse {
  readonly available: boolean;
  readonly version: string | null;
  readonly core_id: string | null;
  readonly core_name: string | null;
  readonly pid: number | null;
  readonly uptime_ms: number | null;
  readonly live_count: number;
  readonly finished_count: number;
  readonly blocked_count: number;
  readonly working_count: number;
  readonly machines: readonly HerdrCoreMachine[];
  readonly shared_core?: boolean;
  readonly socket_path?: string | null;
  readonly binary_path?: string | null;
}

export interface HerdrCoreTerminalsQuery {
  readonly all?: boolean;
  readonly machine?: string;
  readonly room_id?: string;
  readonly work_item_id?: string;
  readonly status?: string;
}

export interface HerdrCoreTerminalsResponse {
  readonly terminals: readonly HerdrCoreTerminal[];
  readonly machines: readonly HerdrCoreMachine[];
  readonly hidden_finished?: number;
}

export interface HerdrCoreTerminalResponse {
  readonly terminal: HerdrCoreTerminal;
}

export interface HerdrCoreReadResponse {
  readonly text: string;
  readonly complete: boolean;
  readonly how?: string | null;
  readonly why?: string | null;
}

export interface HerdrCoreLaunchRequest {
  readonly argv?: readonly string[];
  readonly line?: string;
  readonly template?: string;
  readonly task?: string;
  readonly name?: string;
  readonly cwd?: string;
  readonly on?: string;
  readonly keep?: boolean;
  readonly labels?: Readonly<Record<string, string>>;
  readonly parent?: string;
  readonly rm?: boolean;
  readonly no_notify?: boolean;
  readonly size?: { readonly cols: number; readonly rows: number };
}

export interface HerdrCoreSendRequest {
  readonly address: string;
  readonly text: string;
  readonly if?: "idle" | "working" | "done" | "blocked" | "error";
  readonly turn?: number;
  readonly force?: boolean;
  readonly wait?: boolean;
  readonly timeout?: number;
}

export interface HerdrCoreSendResponse {
  readonly started?: boolean | null;
  readonly status?: string | null;
  readonly turn?: number;
}

export interface HerdrCoreKeysRequest {
  readonly address: string;
  readonly keys: readonly string[];
}

export interface HerdrCoreInterruptRequest {
  readonly address: string;
  readonly timeout?: number;
}

export interface HerdrCoreInterruptResponse {
  readonly outcome?: string;
  readonly key?: string;
}

export interface HerdrCorePutRequest {
  readonly address: string;
  readonly name: string;
  readonly data_base64: string;
}

export interface HerdrCorePutResponse {
  readonly path: string;
  readonly name?: string;
  readonly bytes?: number;
}

export interface HerdrCoreTemplate {
  readonly name: string;
  readonly description?: string | null;
  readonly command?: string | readonly string[] | null;
  readonly error?: string | null;
}

export interface HerdrCoreTemplatesResponse {
  readonly templates: readonly HerdrCoreTemplate[];
}

export interface HerdrCoreMachinesResponse {
  readonly machines: readonly HerdrCoreMachine[];
}

export interface HerdrCoreDocResponse {
  readonly value: unknown;
  readonly version: number;
}

export interface HerdrAppTabEntry {
  readonly id: string;
  readonly title: string;
  readonly terminal?: string;
}

export interface HerdrAppSpaceEntry {
  readonly id: string;
  readonly name: string;
  readonly tabs: readonly HerdrAppTabEntry[];
}

export interface HerdrAppParsedDoc {
  readonly spaces: readonly HerdrAppSpaceEntry[];
  readonly raw: Record<string, unknown>;
}

export type HerdrCoreAttachClientMessage =
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | {
      readonly type: "mode";
      readonly observe: boolean;
      readonly cols?: number;
      readonly rows?: number;
    }
  | {
      readonly type: "put";
      readonly name: string;
      readonly data_base64: string;
    }
  | { readonly type: "ping" };

export type HerdrCoreAttachServerMessage =
  | {
      readonly type: "attached";
      readonly terminal?: HerdrCoreTerminal;
      readonly cols?: number;
      readonly rows?: number;
      readonly observe?: boolean;
      readonly resize_notifications?: boolean;
      readonly automatic_input?: boolean;
    }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | {
      readonly type: "status";
      readonly status?: HerdrCoreTerminalStatus | string | null;
      readonly msg?: string | null;
      readonly progress?: number | null;
    }
  | {
      readonly type: "put_result";
      readonly path: string;
      readonly name?: string;
      readonly bytes?: number;
    }
  | { readonly type: "closed"; readonly reason?: string }
  | { readonly type: "error"; readonly code?: string; readonly message: string }
  | { readonly type: "pong" };

export interface DesktopHerdrCoreDetection {
  readonly installed: boolean;
  readonly running: boolean;
  readonly binaryPath: string | null;
  readonly socketPath: string | null;
  readonly session: string;
  readonly platform: string;
  readonly sharedCore: boolean;
  readonly version: string | null;
  readonly installHint: string;
}

export interface DesktopHerdrCoreBridgeInfo {
  readonly running: boolean;
  readonly baseUrl: string | null;
  readonly wsBaseUrl: string | null;
  readonly token: string | null;
  readonly detection: DesktopHerdrCoreDetection;
}

export interface DesktopHerdrCoreStartResult {
  readonly ok: boolean;
  readonly detection: DesktopHerdrCoreDetection;
  readonly error?: string;
}

export interface DesktopHerdrCoreApi {
  getBridge(): Promise<DesktopHerdrCoreBridgeInfo>;
  detect(): Promise<DesktopHerdrCoreDetection>;
  startServer(): Promise<DesktopHerdrCoreStartResult>;
}

export type HerdrCoreTransportMode = "desktop_direct" | "teamhub_relay";
