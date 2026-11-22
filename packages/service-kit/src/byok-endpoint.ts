/** Wire formats supported for bring-your-own-key endpoints. */
export type ByokProtocol = "openai-chat" | "openai-responses" | "anthropic";

/** Runtimes that can drive a bring-your-own-key endpoint. */
export type ByokRuntime = "claude" | "codex" | "pi";

/** Wire format resolved from a request address and its Runtime fallback. */
export interface ByokProtocolResolution {
  readonly fromUrl: boolean;
  readonly protocol: ByokProtocol;
}

/** The path most providers serve their API under. */
export const DEFAULT_BYOK_PATH = "/v1";

/** Maximum length of a BYOK path or endpoint segment string. */
export const MAX_BYOK_URL_PATH = 256;

// Empty, or whole segments each led by one slash, so a path or endpoint can
// only extend the base URL's path.
export const BYOK_URL_PATH_PATTERN = /^(?:\/[^/?#\s\\]+)*$/u;

/** The endpoint suffix that names each BYOK wire format. */
export const BYOK_PROTOCOL_ENDPOINTS: Readonly<Record<ByokProtocol, string>> = {
  "openai-chat": "/chat/completions",
  "openai-responses": "/responses",
  anthropic: "/messages",
};

/** Each Runtime's own wire format, which Bifrost forwards untranslated. */
export const BYOK_RUNTIME_PROTOCOLS: Readonly<
  Record<ByokRuntime, ByokProtocol>
> = {
  claude: "anthropic",
  codex: "openai-responses",
  pi: "openai-chat",
};

const BYOK_PROTOCOLS: readonly ByokProtocol[] = [
  "openai-chat",
  "openai-responses",
  "anthropic",
];

/** Whether `value` is one of the supported BYOK wire formats. */
export function isByokProtocol(value: unknown): value is ByokProtocol {
  return (
    typeof value === "string" && BYOK_PROTOCOLS.includes(value as ByokProtocol)
  );
}

/** The endpoint a Runtime's requests go to unless the owner picks another. */
export function defaultByokEndpoint(runtime: ByokRuntime): string {
  return BYOK_PROTOCOL_ENDPOINTS[BYOK_RUNTIME_PROTOCOLS[runtime]];
}

/** A typed path as it is sent: trimmed, led by one slash, no trailing slash. */
export function normalizeByokPath(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, "");
  return trimmed && !trimmed.startsWith("/") ? `/${trimmed}` : trimmed;
}

/** A base URL as it is sent: trimmed, without a trailing slash. */
export function normalizeByokBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

/** Whether a path only appends whole segments to the base URL. */
export function validByokPath(path: string): boolean {
  return path.length <= MAX_BYOK_URL_PATH && BYOK_URL_PATH_PATTERN.test(path);
}

/**
 * The wire format of a request address: its ending names one, else the
 * Runtime's own format applies. Nothing is probed.
 */
export function byokProtocolFor(
  url: string,
  runtime: ByokRuntime,
): ByokProtocolResolution {
  const named = BYOK_PROTOCOLS.find((protocol) =>
    url.endsWith(BYOK_PROTOCOL_ENDPOINTS[protocol]),
  );
  return named
    ? { fromUrl: true, protocol: named }
    : { fromUrl: false, protocol: BYOK_RUNTIME_PROTOCOLS[runtime] };
}
