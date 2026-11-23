import type { CommandArguments } from "./command-definition.js";
import { option, values } from "./command-input.js";
import { CliError } from "./errors.js";
import {
  echo,
  flagNotOneOf,
  flagOutOfRange,
  invalidFlag,
} from "./input-issues.js";
import type { Json } from "./connector-runtime.js";

export const usage = (message: string): never => {
  throw new CliError("usage", message);
};
export function text(value: unknown, label: string, max = 512): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value].length > max ||
    /[\r\n\p{Cc}]/u.test(value)
  )
    throw invalidFlag(
      label,
      typeof value === "string" && [...value].length > max
        ? "out_of_range"
        : "invalid_value",
      typeof value === "string" && [...value].length > max
        ? `must be 1 to ${max} characters; got ${[...value].length}.`
        : `must be nonempty text without line breaks; got ${typeof value === "string" ? echo(value) : "nothing"}.`,
    );
  return value;
}
export function number(
  value: string | undefined,
  label: string,
  min: number,
  max: number,
  fallback?: number,
): number | undefined {
  if (value === undefined) return fallback;
  if (
    !/^\d+$/u.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw flagOutOfRange(label, min, max, value);
  return Number(value);
}
export function choice(
  value: string | undefined,
  allowed: readonly string[],
  label: string,
  fallback?: string,
): string | undefined {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw flagNotOneOf(label, allowed, value);
  return value;
}
export function email(value: string): string {
  if (
    !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/u.test(value) ||
    value.length > 254
  )
    usage(
      "Use one plain email address per option, without a display name or comma.",
    );
  const at = value.lastIndexOf("@");
  return value.slice(0, at) + "@" + value.slice(at + 1).toLowerCase();
}
export function emails(
  args: CommandArguments,
  name: string,
): string[] | undefined {
  const list = values(args, name);
  if (!list.length) return undefined;
  const result = [...new Set(list.map(email))];
  if (result.length > 100)
    usage("At most 100 recipient addresses are allowed.");
  return result;
}
export function pageInput(args: CommandArguments): Json {
  return {
    limit: number(option(args, "--limit"), "--limit", 1, 100, 20),
    ...(option(args, "--cursor") === undefined
      ? {}
      : { cursor: text(option(args, "--cursor"), "--cursor", 131072) }),
  };
}
export function schema(properties: Json, required: string[] = []): Json {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...properties,
      account: { type: "string", minLength: 1, maxLength: 240 },
    },
    ...(required.length ? { required } : {}),
  };
}
export const stringSchema = { type: "string", minLength: 1 };
export const booleanSchema = { type: "boolean" };
export const pageSchema = {
  limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  cursor: stringSchema,
};
