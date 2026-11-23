import type { ErrorObject } from "ajv";
import type { z } from "zod";
import { CliError } from "./errors.js";

/**
 * The closed set of input problems. Each code has one sentence shape, so a
 * caller can fix every listed field in one retry without reading the schema.
 */
export type InputIssueCode =
  | "missing"
  | "unknown_field"
  | "invalid_type"
  | "invalid_value"
  | "out_of_range"
  | "invalid_format"
  | "conflict"
  | "invalid_json"
  | "unreadable"
  | "unwritable";

/** Where (a flag, a JSON field path or a file), what, and what is expected. */
export interface InputIssue {
  readonly path: string;
  readonly code: InputIssueCode;
  readonly message: string;
}

/** More than this many issues are counted, not listed. */
export const listedIssueLimit = 10;
const echoLimit = 40;

type Segment = string | number;
type Json = Record<string, unknown>;

function record(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One `invalid_input` failure listing its issues under details.issues. */
export function invalidInput(
  message: string,
  issues: readonly InputIssue[],
  details: Record<string, unknown> = {},
): CliError {
  const unique = issues.filter(
    (issue, index) =>
      issues.findIndex(
        (other) =>
          other.path === issue.path &&
          other.code === issue.code &&
          other.message === issue.message,
      ) === index,
  );
  return new CliError("invalid_input", message, {
    ...details,
    issues: unique.slice(0, listedIssueLimit),
    ...(unique.length > listedIssueLimit
      ? { issues_omitted: unique.length - listedIssueLimit }
      : {}),
  });
}

/** One input issue; the message follows its code's sentence shape. */
export function inputIssue(
  path: string,
  code: InputIssueCode,
  message: string,
): InputIssue {
  return { path, code, message };
}

export function joinPath(root: string, path: readonly Segment[]): string {
  let text = "";
  for (const segment of path) {
    if (typeof segment === "number") text += `[${segment}]`;
    else text += text ? `.${segment}` : segment;
  }
  return text || root;
}

// Field names are identifiers, not prose: a credential-shaped name never
// echoes its value back.
const secretField = /token|secret|password|api_?key|authorization|credential/iu;
function secret(path: readonly Segment[]): boolean {
  return path.some(
    (segment) => typeof segment === "string" && secretField.test(segment),
  );
}

/** A value as the caller wrote it: one line, at most 40 characters. */
export function echo(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  const characters = [...text.replace(/\p{Cc}+/gu, " ")];
  const shown =
    characters.length > echoLimit
      ? characters.slice(0, echoLimit).join("") + "…"
      : characters.join("");
  return typeof value === "string" ? JSON.stringify(shown) : shown;
}

function got(path: readonly Segment[], value: unknown): string {
  return secret(path) ? "." : `; got ${echo(value)}.`;
}

/**
 * Names the flag that set each issue's top-level field (`limit` becomes
 * `--limit`), when the command has one; other paths stay field paths.
 */
export function flagPaths(
  issues: readonly InputIssue[],
  options: Readonly<Record<string, unknown>>,
): InputIssue[] {
  return issues.map((issue) => {
    const [field, ...rest] = issue.path.split(/(?=[.[])/u);
    const flag = [`--${field}`, `--${field?.replaceAll("_", "-")}`].find(
      (name) => Object.hasOwn(options, name),
    );
    return flag ? { ...issue, path: flag + rest.join("") } : issue;
  });
}

/** The JSON type of a value the caller wrote. */
export function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function list(values: readonly unknown[]): string {
  return values
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join(", ");
}

export function missingMessage(nullable: boolean): string {
  return nullable ? "required; use null if there is none." : "required.";
}

export function unknownFieldMessage(allowed: readonly string[]): string {
  return allowed.length
    ? `not allowed. Allowed: ${allowed.join(", ")}.`
    : "not allowed.";
}

export function invalidValueMessage(
  allowed: readonly unknown[],
  path: readonly Segment[],
  value: unknown,
): string {
  return allowed.length === 1
    ? `must be ${list(allowed)}${got(path, value)}`
    : `must be one of ${list(allowed)}${got(path, value)}`;
}

interface Bounds {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: boolean;
  readonly exclusiveMaximum?: boolean;
}

function lengthOf(value: unknown): number | undefined {
  if (typeof value === "string") return [...value].length;
  if (Array.isArray(value)) return value.length;
  return undefined;
}

/**
 * A bound in words, shared by error messages and --help: "1 to 200
 * characters", "at most 8 items", "an integer from 1 to 200", "at least 1".
 */
export function rangeText(kind: string, bounds: Bounds): string {
  const { minimum, maximum } = bounds;
  if (minimum === undefined && maximum === undefined) return "";
  const countable = kind === "string" || kind === "array";
  const lower =
    minimum === undefined
      ? undefined
      : `${bounds.exclusiveMinimum ? "more than" : "at least"} ${minimum}`;
  const upper =
    maximum === undefined
      ? undefined
      : `${bounds.exclusiveMaximum ? (countable ? "fewer than" : "less than") : "at most"} ${maximum}`;
  const both =
    minimum !== undefined &&
    maximum !== undefined &&
    !bounds.exclusiveMinimum &&
    !bounds.exclusiveMaximum;
  if (countable) {
    const [one, many] =
      kind === "string" ? ["character", "characters"] : ["item", "items"];
    const single = lower === undefined || upper === undefined;
    const unit = single && (minimum ?? maximum) === 1 ? one : many;
    return both
      ? `${minimum} to ${maximum} ${unit}`
      : `${[lower, upper].filter(Boolean).join(" and ")} ${unit}`;
  }
  if (both)
    return `${kind === "integer" ? "an integer" : "a number"} from ${minimum} to ${maximum}`;
  return [lower, upper].filter(Boolean).join(" and ");
}

function rangeRule(kind: string, bounds: Bounds): string {
  return `${kind === "array" ? "must have" : "must be"} ${rangeText(kind, bounds)}`;
}

export function outOfRangeMessage(
  kind: string,
  bounds: Bounds,
  path: readonly Segment[],
  value: unknown,
): string {
  const length = lengthOf(value);
  const shown =
    (kind === "string" || kind === "array") && length !== undefined
      ? `; got ${length}.`
      : got(path, value);
  return `${rangeRule(kind, bounds)}${shown}`;
}

const formatDescriptions: Readonly<Record<string, readonly [string, string]>> =
  {
    offset_datetime: ["a time with offset", "2026-11-22T18:10:00+08:00"],
    // JSON Schema's name for zod's offset date-time.
    "date-time": ["a time with offset", "2026-11-22T18:10:00+08:00"],
    utc_datetime: ["a UTC time", "2026-11-22T10:10:00Z"],
    date: ["a date", "2026-11-22"],
    time: ["a time of day", "18:10:00"],
    duration: ["an ISO 8601 duration", "PT30M"],
    email: ["an email address", "name@example.com"],
    url: ["a URL", "https://example.com/page"],
    uri: ["a URL", "https://example.com/page"],
    uuid: ["a UUID", "123e4567-e89b-12d3-a456-426614174000"],
    guid: ["a UUID", "123e4567-e89b-12d3-a456-426614174000"],
    hostname: ["a host name", "example.com"],
    ipv4: ["an IPv4 address", "192.0.2.1"],
    ipv6: ["an IPv6 address", "2001:db8::1"],
  };

/** A known format in words with an example, shared with --help. */
export function formatText(format: string): string | undefined {
  const known = formatDescriptions[format];
  return known && `${known[0]}, for example ${known[1]}`;
}

export function invalidFormatMessage(
  format: string,
  path: readonly Segment[],
  value: unknown,
  pattern?: string,
): string {
  const known = formatText(format);
  if (known) return `expected ${known}${got(path, value)}`;
  if (pattern !== undefined)
    return pattern.length <= 80
      ? `expected text matching ${pattern}${got(path, value)}`
      : `expected text in the pattern --schema shows${got(path, value)}`;
  return `expected ${format.replaceAll("_", " ")} format${got(path, value)}`;
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function valueAt(
  input: unknown,
  path: readonly Segment[],
): { present: boolean; value: unknown } {
  let current: unknown = input;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      if (segment >= current.length)
        return { present: false, value: undefined };
      current = current[segment];
    } else if (record(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else return { present: false, value: undefined };
  }
  return { present: current !== undefined, value: current };
}

// zod schema introspection. Only the shape walk lives here: every message is
// written from the structured issue and the schema's own bounds.
interface ZodNode {
  readonly _zod: { readonly def: Json; readonly bag: Json };
}
function zodNode(value: unknown): value is ZodNode {
  return record(value) && record((value as { _zod?: unknown })._zod);
}
const wrappers = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "readonly",
  "catch",
  "nonoptional",
  "success",
]);
function unwrap(schema: unknown): ZodNode | undefined {
  let current = schema;
  for (let depth = 0; depth < 32 && zodNode(current); depth++) {
    const def = current._zod.def;
    if (wrappers.has(def.type as string)) current = def.innerType;
    else if (def.type === "pipe") current = def.in;
    else if (def.type === "lazy" && typeof def.getter === "function")
      current = (def.getter as () => unknown)();
    else return current;
  }
  return undefined;
}
function zodOptions(node: ZodNode): readonly unknown[] {
  const def = node._zod.def;
  if (def.type === "union" && Array.isArray(def.options)) return def.options;
  if (def.type === "intersection") return [def.left, def.right];
  return [];
}
function zodChild(schema: unknown, segment: Segment): unknown {
  const node = unwrap(schema);
  if (!node) return undefined;
  const def = node._zod.def;
  if (def.type === "object" && record(def.shape))
    return typeof segment === "string" && Object.hasOwn(def.shape, segment)
      ? def.shape[segment]
      : undefined;
  if (def.type === "array") return def.element;
  if (def.type === "tuple" && Array.isArray(def.items))
    return typeof segment === "number" ? def.items[segment] : undefined;
  if (def.type === "record") return def.valueType;
  for (const option of zodOptions(node)) {
    const child = zodChild(option, segment);
    if (child) return child;
  }
  return undefined;
}
function zodAt(schema: unknown, path: readonly Segment[]): unknown {
  let current = schema;
  for (const segment of path) {
    current = zodChild(current, segment);
    if (!current) return undefined;
  }
  return current;
}
function zodNullable(schema: unknown): boolean {
  let current = schema;
  for (let depth = 0; depth < 32 && zodNode(current); depth++) {
    const def = current._zod.def;
    if (def.type === "nullable" || def.type === "null") return true;
    if (def.type === "union")
      return (def.options as unknown[]).some((option) => zodNullable(option));
    if (wrappers.has(def.type as string)) current = def.innerType;
    else if (def.type === "pipe") current = def.in;
    else return false;
  }
  return false;
}
function zodKeys(schema: unknown, value: unknown): string[] {
  const node = unwrap(schema);
  if (!node) return [];
  const def = node._zod.def;
  if (def.type === "object" && record(def.shape)) return Object.keys(def.shape);
  const options = zodOptions(node).map((option) => zodKeys(option, value));
  // A union branch that accepts the value's discriminator, when one exists,
  // names the fields that can go with it.
  return options.find((keys) => keys.length) ?? [];
}
function zodBounds(schema: unknown): Bounds {
  const node = unwrap(schema);
  const bag = node?._zod.bag ?? {};
  return {
    ...(typeof bag.minimum === "number" && Number.isFinite(bag.minimum)
      ? { minimum: bag.minimum }
      : {}),
    ...(typeof bag.maximum === "number" && Number.isFinite(bag.maximum)
      ? { maximum: bag.maximum }
      : {}),
  };
}
function zodDatetimeOffset(schema: unknown): boolean | undefined {
  const def = unwrap(schema)?._zod.def;
  if (!def) return undefined;
  if (def.format === "datetime") return def.offset === true;
  const check = (Array.isArray(def.checks) ? def.checks : [])
    .map((item: unknown) => (zodNode(item) ? item._zod.def : undefined))
    .find((item) => item?.format === "datetime");
  return check ? check.offset === true : undefined;
}

type ZodIssue = z.core.$ZodIssue;

function zodIssue(
  issue: ZodIssue,
  prefix: readonly Segment[],
  options: { root: string; input: unknown; schema?: z.ZodType },
): InputIssue[] {
  const path: Segment[] = [
    ...prefix,
    ...issue.path.filter(
      (segment): segment is Segment => typeof segment !== "symbol",
    ),
  ];
  const at = (code: InputIssueCode, message: string, where = path) =>
    inputIssue(joinPath(options.root, where), code, message);
  const { present, value } = valueAt(options.input, path);
  const schema = options.schema ? zodAt(options.schema, path) : undefined;
  switch (issue.code) {
    case "invalid_type":
      if (!present) return [at("missing", missingMessage(zodNullable(schema)))];
      return [
        at(
          "invalid_type",
          `expected ${issue.expected === "int" ? "integer" : issue.expected}; got ${typeName(value)}.`,
        ),
      ];
    case "invalid_union": {
      if (!present) {
        const nullable =
          zodNullable(schema) ||
          issue.errors.some((branch) =>
            branch.some(
              (item) =>
                item.code === "invalid_type" &&
                item.expected === "null" &&
                !item.path.length,
            ),
          );
        return [at("missing", missingMessage(nullable))];
      }
      if ("discriminator" in issue && typeof issue.discriminator === "string") {
        const where = path.at(-1) === issue.discriminator ? path : [...path];
        const allowed = Array.isArray((issue as { options?: unknown }).options)
          ? (issue as { options: unknown[] }).options
          : [];
        return [
          at(
            "invalid_value",
            invalidValueMessage(
              allowed,
              where,
              valueAt(options.input, where).value,
            ),
            where,
          ),
        ];
      }
      const branches = issue.errors.filter((branch) => branch.length);
      const typeOnly = branches.every(
        (branch) =>
          branch.length === 1 &&
          branch[0]!.code === "invalid_type" &&
          !branch[0].path.length,
      );
      if (typeOnly && branches.length)
        return [
          at(
            "invalid_type",
            `expected ${[
              ...new Set(
                branches.map((branch) => {
                  const expected = (branch[0] as { expected: string }).expected;
                  return expected === "int" ? "integer" : expected;
                }),
              ),
            ].join(" or ")}; got ${typeName(value)}.`,
          ),
        ];
      // The branch whose problems are deepest in the value is the one the
      // caller most likely meant; type mismatches at its root rank last.
      const ranked = branches
        .map((branch) => ({
          branch,
          score: branch.some(
            (item) => item.code === "invalid_type" && !item.path.length,
          )
            ? Number.MAX_SAFE_INTEGER
            : branch.length,
        }))
        .sort((left, right) => left.score - right.score);
      const best = ranked[0]?.branch ?? [];
      return best.flatMap((item) => zodIssue(item, path, options));
    }
    case "invalid_value":
      return [
        at("invalid_value", invalidValueMessage(issue.values, path, value)),
      ];
    case "unrecognized_keys": {
      const allowed = schema
        ? zodKeys(schema, value)
        : options.schema && !path.length
          ? zodKeys(options.schema, value)
          : [];
      return issue.keys.map((key) =>
        inputIssue(
          joinPath(options.root, [...path, key]),
          "unknown_field",
          unknownFieldMessage(allowed),
        ),
      );
    }
    case "too_small":
    case "too_big": {
      const kind =
        issue.origin === "string"
          ? "string"
          : issue.origin === "array" || issue.origin === "set"
            ? "array"
            : unwrap(schema)?._zod.bag.format === "safeint"
              ? "integer"
              : "number";
      const own: Bounds =
        issue.code === "too_small"
          ? {
              minimum: Number(issue.minimum),
              exclusiveMinimum: issue.inclusive === false,
            }
          : {
              maximum: Number(issue.maximum),
              exclusiveMaximum: issue.inclusive === false,
            };
      return [
        at(
          "out_of_range",
          outOfRangeMessage(
            kind,
            { ...zodBounds(schema), ...own },
            path,
            value,
          ),
        ),
      ];
    }
    case "not_multiple_of":
      return [
        at(
          "out_of_range",
          `must be a multiple of ${String(issue.divisor)}${got(path, value)}`,
        ),
      ];
    case "invalid_format": {
      const format =
        issue.format === "datetime"
          ? (zodDatetimeOffset(schema) ??
            (typeof issue.pattern === "string"
              ? issue.pattern.includes("[+-]")
              : true))
            ? "offset_datetime"
            : "utc_datetime"
          : issue.format;
      const pattern =
        issue.format === "regex" && typeof issue.pattern === "string"
          ? issue.pattern.replace(/^\/(.*)\/[a-z]*$/su, "/$1/")
          : undefined;
      return [
        at(
          "invalid_format",
          invalidFormatMessage(format, path, value, pattern),
        ),
      ];
    }
    case "invalid_key":
    case "invalid_element":
      return issue.issues.flatMap((item) =>
        zodIssue(
          item,
          issue.code === "invalid_element"
            ? [...path, issue.key as Segment]
            : path,
          options,
        ),
      );
    default:
      return [at("invalid_value", sentence(issue.message))];
  }
}

/**
 * Converts zod issues into input issues. Paths are relative to the input the
 * caller wrote; the root itself (for example a flag) is named by `root`.
 */
export function zodInputIssues(
  issues: readonly ZodIssue[],
  input: unknown,
  options: { root?: string; schema?: z.ZodType } = {},
): InputIssue[] {
  return issues.flatMap((issue) =>
    zodIssue(issue, [], { root: options.root ?? "input", input, ...options }),
  );
}

function pointer(path: string): Segment[] {
  if (!path) return [];
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((segment) =>
      /^(?:0|[1-9]\d*)$/u.test(segment) ? Number(segment) : segment,
    );
}

function jsonSchemaNullable(schema: unknown): boolean {
  if (!record(schema)) return false;
  if (schema.nullable === true || schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  if ("const" in schema && schema.const === null) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  return [schema.anyOf, schema.oneOf]
    .filter(Array.isArray)
    .some((branches) => (branches as unknown[]).some(jsonSchemaNullable));
}

function jsonSchemaBounds(schema: unknown, kind: string): Bounds {
  if (!record(schema)) return {};
  const number = (name: string) =>
    typeof schema[name] === "number" ? schema[name] : undefined;
  const [min, max] =
    kind === "string"
      ? [number("minLength"), number("maxLength")]
      : kind === "array"
        ? [number("minItems"), number("maxItems")]
        : [
            number("minimum") ?? number("exclusiveMinimum"),
            number("maximum") ?? number("exclusiveMaximum"),
          ];
  return {
    ...(min === undefined ? {} : { minimum: min }),
    ...(max === undefined ? {} : { maximum: max }),
    ...(kind !== "string" &&
    kind !== "array" &&
    number("minimum") === undefined &&
    number("exclusiveMinimum") !== undefined
      ? { exclusiveMinimum: true }
      : {}),
    ...(kind !== "string" &&
    kind !== "array" &&
    number("maximum") === undefined &&
    number("exclusiveMaximum") !== undefined
      ? { exclusiveMaximum: true }
      : {}),
  };
}

const lengthKeywords: Readonly<Record<string, string>> = {
  minLength: "string",
  maxLength: "string",
  minItems: "array",
  maxItems: "array",
  minimum: "number",
  maximum: "number",
  exclusiveMinimum: "number",
  exclusiveMaximum: "number",
};

function ajvIssue(
  error: ErrorObject,
  options: { root: string; input: unknown },
): InputIssue[] {
  const path = pointer(error.instancePath);
  const at = (code: InputIssueCode, message: string, where = path) =>
    inputIssue(joinPath(options.root, where), code, message);
  const value = valueAt(options.input, path).value;
  const params = error.params as Json;
  const parent = record(error.parentSchema) ? error.parentSchema : {};
  switch (error.keyword) {
    case "required":
    case "dependentRequired": {
      const property = String(params.missingProperty);
      const properties = record(parent.properties) ? parent.properties : {};
      return [
        at(
          "missing",
          missingMessage(jsonSchemaNullable(properties[property])),
          [...path, property],
        ),
      ];
    }
    case "additionalProperties":
    case "unevaluatedProperties":
      return [
        at(
          "unknown_field",
          unknownFieldMessage(
            record(parent.properties) ? Object.keys(parent.properties) : [],
          ),
          [
            ...path,
            String(params.additionalProperty ?? params.unevaluatedProperty),
          ],
        ),
      ];
    case "type": {
      const expected = Array.isArray(params.type)
        ? (params.type as string[])
        : String(params.type).split(",");
      if (value === undefined)
        return [at("missing", missingMessage(expected.includes("null")))];
      return [
        at(
          "invalid_type",
          `expected ${expected.join(" or ")}; got ${typeName(value)}.`,
        ),
      ];
    }
    case "enum":
      return [
        at(
          "invalid_value",
          invalidValueMessage(
            Array.isArray(params.allowedValues) ? params.allowedValues : [],
            path,
            value,
          ),
        ),
      ];
    case "const":
      return [
        at(
          "invalid_value",
          invalidValueMessage([params.allowedValue], path, value),
        ),
      ];
    case "format":
      return [
        at(
          "invalid_format",
          invalidFormatMessage(
            params.format === "date-time"
              ? "offset_datetime"
              : String(params.format),
            path,
            value,
          ),
        ),
      ];
    case "pattern":
      return [
        at(
          "invalid_format",
          invalidFormatMessage(
            "pattern",
            path,
            value,
            `/${String(params.pattern)}/`,
          ),
        ),
      ];
    case "multipleOf":
      return [
        at(
          "out_of_range",
          `must be a multiple of ${String(params.multipleOf)}${got(path, value)}`,
        ),
      ];
    case "minProperties":
    case "maxProperties":
      return [
        at(
          "out_of_range",
          `must have ${error.keyword === "minProperties" ? "at least" : "at most"} ${String(params.limit)} fields.`,
        ),
      ];
    case "uniqueItems":
      return [
        at(
          "invalid_value",
          `items must be unique; items ${String(params.j)} and ${String(params.i)} are equal.`,
        ),
      ];
    default: {
      const kind = lengthKeywords[error.keyword];
      if (kind) {
        const resolved =
          kind === "number" && parent.type === "integer" ? "integer" : kind;
        return [
          at(
            "out_of_range",
            outOfRangeMessage(
              resolved,
              jsonSchemaBounds(parent, kind),
              path,
              value,
            ),
          ),
        ];
      }
      return [at("invalid_value", sentence(error.message ?? "is not valid"))];
    }
  }
}

/**
 * Converts ajv errors (validated with allErrors and verbose) into input
 * issues. A failed anyOf or oneOf is reported by its closest branch, the way
 * a caller who picked that shape would fix it.
 */
export function ajvInputIssues(
  errors: readonly ErrorObject[],
  input: unknown,
  options: { root?: string } = {},
): InputIssue[] {
  const root = options.root ?? "input";
  const unions = errors.filter(
    (error) => error.keyword === "anyOf" || error.keyword === "oneOf",
  );
  const consumed = new Set<ErrorObject>();
  const converted: InputIssue[] = [];
  // Innermost unions first, so an outer union sees inner ones as resolved.
  for (const union of [...unions].sort(
    (left, right) => right.schemaPath.length - left.schemaPath.length,
  )) {
    if (consumed.has(union)) continue;
    consumed.add(union);
    const prefix = `${union.schemaPath}/`;
    const branches = new Map<string, ErrorObject[]>();
    for (const error of errors) {
      if (!error.schemaPath.startsWith(prefix) || consumed.has(error)) continue;
      consumed.add(error);
      const branch = error.schemaPath.slice(prefix.length).split("/")[0]!;
      branches.set(branch, [...(branches.get(branch) ?? []), error]);
    }
    if (union.keyword === "oneOf" && (union.params as Json).passingSchemas) {
      converted.push(
        inputIssue(
          joinPath(root, pointer(union.instancePath)),
          "invalid_value",
          "matches more than one allowed shape.",
        ),
      );
      continue;
    }
    const all = [...branches.values()].filter(
      (branch) =>
        !branch.every(
          (error) => error.keyword === "anyOf" || error.keyword === "oneOf",
        ),
    );
    const path = pointer(union.instancePath);
    const value = valueAt(input, path).value;
    const typeOnly =
      all.length > 0 &&
      all.every(
        (branch) =>
          branch.length === 1 &&
          branch[0]!.keyword === "type" &&
          branch[0]!.instancePath === union.instancePath,
      );
    if (typeOnly) {
      converted.push(
        inputIssue(
          joinPath(root, path),
          "invalid_type",
          `expected ${[
            ...new Set(
              all.map((branch) => String((branch[0]!.params as Json).type)),
            ),
          ].join(" or ")}; got ${typeName(value)}.`,
        ),
      );
      continue;
    }
    const best = all
      .map((branch) => ({
        branch,
        score: branch.some(
          (error) =>
            error.keyword === "type" &&
            error.instancePath === union.instancePath,
        )
          ? Number.MAX_SAFE_INTEGER
          : branch.length,
      }))
      .sort((left, right) => left.score - right.score)[0]?.branch;
    converted.push(
      ...(best ?? []).flatMap((error) => ajvIssue(error, { root, input })),
    );
  }
  const direct = errors
    .filter(
      (error) =>
        !consumed.has(error) &&
        error.keyword !== "if" &&
        error.keyword !== "not",
    )
    .flatMap((error) => ajvIssue(error, { root, input }));
  return [...direct, ...converted];
}

const writingCalls = new Set([
  "write",
  "writev",
  "mkdir",
  "mkdtemp",
  "rename",
  "unlink",
  "rmdir",
  "rm",
  "copyfile",
  "symlink",
  "link",
  "chmod",
  "chown",
  "utime",
  "futime",
  "ftruncate",
]);
const fileReasons: Readonly<Record<string, string>> = {
  ENOENT: "not found",
  EACCES: "permission denied",
  EPERM: "permission denied",
  EISDIR: "is a directory",
  ENOTDIR: "a parent is not a directory",
  EEXIST: "already exists",
  ENOTEMPTY: "not empty",
  ENOSPC: "no space left",
  EROFS: "read-only file system",
  ELOOP: "too many symbolic links",
  ENAMETOOLONG: "name too long",
  EMFILE: "too many open files",
  EBUSY: "busy",
  EXDEV: "on another device",
};

/** A Node file system error, which names its system call and path. */
export function fileSystemError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    /^E[A-Z0-9]+$/u.test((error as NodeJS.ErrnoException).code!) &&
    typeof (error as NodeJS.ErrnoException).syscall === "string"
  );
}

/** A byte limit as people read it: 5 MiB, 512 MiB, 1.5 MiB. */
export function mebibytes(bytes: number): string {
  return `${Number((bytes / 1024 / 1024).toFixed(1))} MiB`;
}

/**
 * A local file the command could not read or write, as one issue on the flag
 * that named it ("file" when none is known). `source` is the path as the
 * caller wrote it. A caller that knows the direction passes `writing`;
 * otherwise the failed call decides, and a failed open counts as a read.
 */
export function fileFailure(
  error: NodeJS.ErrnoException,
  flag = "file",
  source = error.path ?? "file",
  writing = writingCalls.has(error.syscall ?? ""),
): CliError {
  const reason = fileReasons[error.code!] ?? `failed with ${error.code}`;
  return invalidInput(
    `${flag === "file" ? "A local file" : `The ${flag} path`} could not be ${writing ? "written" : "read"}.`,
    [
      inputIssue(
        flag,
        writing ? "unwritable" : "unreadable",
        `${source}: ${reason}.`,
      ),
    ],
  );
}

/** A malformed command line: `usage`, with what to change as issues. */
export function usageError(
  message: string,
  issues: readonly InputIssue[] = [],
): CliError {
  return new CliError("usage", message, issues.length ? { issues } : {});
}

/** Flags that cannot be given together. */
export function conflictingFlags(flags: readonly string[]): CliError {
  return usageError(`${flags.join(", ")} cannot be used together.`, [
    inputIssue(flags[0]!, "conflict", `give only one of ${flags.join(", ")}.`),
  ]);
}

/** A required flag, or one of several alternatives, is absent. */
export function missingFlag(flags: readonly string[]): CliError {
  return usageError(
    flags.length === 1
      ? `${flags[0]} is required.`
      : `One of ${flags.join(", ")} is required.`,
    [
      inputIssue(
        flags[0]!,
        "missing",
        flags.length === 1
          ? "required."
          : `required; give one of ${flags.join(", ")}.`,
      ),
    ],
  );
}

/** One flag's value is wrong: `invalid_input` with that one issue. */
export function invalidFlag(
  flag: string,
  code: InputIssueCode,
  message: string,
): CliError {
  return invalidInput(`${flag} has an invalid value.`, [
    inputIssue(flag, code, message),
  ]);
}

/** A flag value as the caller typed it: numbers bare, other text quoted. */
export function echoFlag(value: string): string {
  return /^-?\d+(?:\.\d+)?$/u.test(value) ? value : echo(value);
}

/** `--name must be an integer from 1 to 100; got 500.` as one issue. */
export function flagOutOfRange(
  flag: string,
  min: number,
  max: number,
  value: string,
): CliError {
  return invalidFlag(
    flag,
    "out_of_range",
    `must be an integer from ${min} to ${max}; got ${echoFlag(value)}.`,
  );
}

/** A flag whose value must be one of a fixed set. */
export function flagNotOneOf(
  flag: string,
  allowed: readonly string[],
  value: string,
): CliError {
  return invalidFlag(
    flag,
    "invalid_value",
    `must be one of ${allowed.join(", ")}; got ${echo(value)}.`,
  );
}

class JsonSyntaxStop extends Error {
  constructor(
    readonly at: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}

/** Where JSON text first breaks, as a 1-based line and column, and why. */
export function jsonSyntaxError(
  text: string,
): { line: number; column: number; reason: string } | undefined {
  let index = 0;
  const stop = (reason: string): never => {
    throw new JsonSyntaxStop(index, reason);
  };
  const space = () => {
    while (" \t\n\r".includes(text[index] ?? "x")) index++;
  };
  const expect = (what: string): never =>
    stop(
      index >= text.length
        ? `expected ${what}; the input ended`
        : `expected ${what}`,
    );
  const string = () => {
    index++;
    for (;;) {
      const char = text[index];
      if (char === undefined) stop("unterminated string");
      if (char === '"') {
        index++;
        return;
      }
      if (char === "\\") {
        const escape = text[index + 1];
        if (
          escape === "u"
            ? !/^[0-9a-fA-F]{4}$/u.test(text.slice(index + 2, index + 6))
            : !'"\\/bfnrt'.includes(escape ?? "x")
        )
          stop("invalid escape sequence");
        index += escape === "u" ? 6 : 2;
        continue;
      }
      if (char! < " ")
        stop("a line break or control character in a string must be escaped");
      index++;
    }
  };
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;
  const value = (depth: number): void => {
    if (depth > 100) stop("nested deeper than 100 levels");
    space();
    const char = text[index];
    if (char === "{") {
      index++;
      space();
      if (text[index] === "}") return void index++;
      for (;;) {
        space();
        if (text[index] !== '"') expect("a property name in double quotes");
        string();
        space();
        if (text[index] !== ":") expect(": after the property name");
        index++;
        value(depth + 1);
        space();
        if (text[index] === ",") index++;
        else if (text[index] === "}") return void index++;
        else expect(", or } after the property value");
      }
    }
    if (char === "[") {
      index++;
      space();
      if (text[index] === "]") return void index++;
      for (;;) {
        value(depth + 1);
        space();
        if (text[index] === ",") index++;
        else if (text[index] === "]") return void index++;
        else expect(", or ] after the item");
      }
    }
    if (char === '"') return string();
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) {
      number.lastIndex = index;
      if (!number.exec(text)) stop("invalid number");
      index = number.lastIndex;
      return;
    }
    for (const literal of ["true", "false", "null"])
      if (text.startsWith(literal, index))
        return void (index += literal.length);
    if (char === "'") stop("strings need double quotes");
    expect("a value");
  };
  try {
    value(0);
    space();
    if (index < text.length) stop("unexpected text after the JSON value");
    return undefined;
  } catch (error) {
    if (!(error instanceof JsonSyntaxStop)) throw error;
    return { ...textPosition(text, error.at), reason: error.reason };
  }
}

/** The 1-based line and column of a UTF-16 offset. */
export function textPosition(
  text: string,
  at: number,
): { line: number; column: number } {
  const before = text.slice(0, at);
  return {
    line: before.split("\n").length,
    column: at - before.lastIndexOf("\n"),
  };
}
