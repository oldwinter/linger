export interface HerdrCoreDetection {
  readonly installed: boolean;
  readonly running: boolean;
  readonly binaryPath: string | null;
  readonly socketPath: string | null;
  readonly session: string;
  readonly platform: NodeJS.Platform;
  readonly sharedCore: boolean;
  readonly version: string | null;
  readonly installHint: string;
}

export interface HerdrCoreBridgeConnectionInfo {
  readonly running: boolean;
  readonly baseUrl: string | null;
  readonly wsBaseUrl: string | null;
  readonly token: string | null;
  readonly detection: HerdrCoreDetection;
}

export interface HerdrCoreStartServerResult {
  readonly ok: boolean;
  readonly detection: HerdrCoreDetection;
  readonly error?: string;
}

export interface HerdrCoreStatusRecord {
  readonly state?: string | null;
  readonly status?: string | null;
  readonly msg?: string | null;
  readonly kind?: string | null;
  readonly app?: string | null;
  readonly title?: string | null;
  readonly progress?: number | null;
  readonly detail?: string | null;
}

export function terminalStatusWord(
  terminal: Pick<HerdrCoreTerminal, "status">,
): string | null {
  const word = terminal.status?.state ?? terminal.status?.status;
  return typeof word === "string" && word.trim().length > 0
    ? word.trim()
    : null;
}

export interface HerdrCoreTerminal {
  readonly address: string;
  readonly name?: string | null;
  readonly state: string;
  readonly cwd: string;
  readonly argv: readonly string[];
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
  readonly status?: HerdrCoreStatusRecord | null;
  readonly status_ms?: number | null;
  readonly foreground?: {
    readonly pid?: number | null;
    readonly name?: string | null;
    readonly argv?: readonly string[] | null;
    readonly cwd?: string | null;
    readonly command?: string | null;
  } | null;
}

export interface HerdrCoreMachine {
  readonly name: string;
  readonly host?: string | null;
  readonly id?: string | null;
  readonly target?: string | null;
  readonly via?: boolean;
  readonly state?: string | null;
  readonly connected?: boolean;
  readonly needs_login?: boolean;
  readonly keeps_running_after_logout?: boolean | null;
  readonly logout_linger_user?: string | null;
  readonly error?: string | null;
}

export interface HerdrCoreTemplate {
  readonly name: string;
  readonly description?: string | null;
  readonly command?: string | readonly string[] | null;
  readonly error?: string | null;
}

export interface HerdrCoreStatusPayload {
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
  readonly shared_core: boolean;
  readonly socket_path: string | null;
  readonly binary_path: string | null;
}

/** Maximum raw byte payload allowed for `terminal.put` (16 MiB). */
export const MAX_HERDR_CORE_PUT_BYTES = 16 * 1024 * 1024;

/** Maximum serialized byte length allowed for `doc.set` (1 MiB, matching herdr-core). */
export const MAX_HERDR_CORE_DOC_BYTES = 1024 * 1024;
