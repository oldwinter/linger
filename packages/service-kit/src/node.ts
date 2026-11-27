import { createHash, hkdfSync, timingSafeEqual } from "node:crypto";

export {
  createJsonLogger,
  type JsonLogLevel,
  type JsonLogger,
  type JsonLoggerOptions,
} from "./json-logger.js";

/** Lowercase hex SHA-256; strings hash as UTF-8. */
export const sha256Hex = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

const tokenDigest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

/** Constant-time equality over UTF-8 tokens without leaking length; empty tokens never match. */
export function tokensEqual(candidate: string, expected: string): boolean {
  if (candidate.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(tokenDigest(candidate), tokenDigest(expected));
}

/** Verifies an Authorization Bearer header against an expected token in constant time. */
export function hasBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  const match = /^Bearer ([^\s]+)$/i.exec(authorizationHeader ?? "");
  if (!match?.[1]) return false;
  return tokensEqual(match[1], expectedToken);
}

/**
 * One service link's credential, derived from LINGER_SECRET_SEED exactly as
 * TeamHub derives it. Without a seed the link stays off. Callers
 * pass the environment so this package never reads process state itself.
 */
export function serviceCredential(
  label: string,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const seed = environment.LINGER_SECRET_SEED?.trim();
  if (!seed) return undefined;
  if (Buffer.byteLength(seed) < 32) {
    throw new TypeError("LINGER_SECRET_SEED must be at least 32 characters");
  }
  return Buffer.from(
    hkdfSync("sha256", seed, "simplexai/service-credential/v1", label, 32),
  ).toString("base64url");
}
