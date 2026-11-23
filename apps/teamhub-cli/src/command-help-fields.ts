import { formatText, rangeText } from "./input-issues.js";

type Json = Record<string, unknown>;

function record(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// zod writes an unbounded safe integer as its largest safe value.
const bound = (value: unknown): number | undefined =>
  typeof value === "number" && value < Number.MAX_SAFE_INTEGER
    ? value
    : undefined;

/** One schema node as a short type: values, format, type and limits. */
export function schemaType(schema: unknown): string {
  if (!record(schema)) return "any";
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(" | ");
  if ("const" in schema) return JSON.stringify(schema.const);
  const branches = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(branches))
    return [
      ...new Set(
        branches
          .filter((branch) => !record(branch) || branch.type !== "null")
          .map(schemaType),
      ),
    ].join(" or ");
  const type = Array.isArray(schema.type)
    ? schema.type.join(" or ")
    : schema.type;
  if (type === "string") {
    const format =
      typeof schema.format === "string" ? formatText(schema.format) : undefined;
    if (format) return format;
    if (typeof schema.pattern === "string" && schema.pattern.length <= 40)
      return `string matching ${schema.pattern}`;
    const length = rangeText("string", {
      minimum: bound(schema.minLength),
      maximum: bound(schema.maxLength),
    });
    return length ? `string, ${length}` : "string";
  }
  if (type === "integer" || type === "number") {
    const exclusive = typeof schema.exclusiveMinimum === "number";
    const bounds = {
      // An integer above n is at least n + 1.
      minimum:
        exclusive && type === "integer"
          ? (schema.exclusiveMinimum as number) + 1
          : bound(exclusive ? schema.exclusiveMinimum : schema.minimum),
      maximum: bound(schema.maximum),
      exclusiveMinimum: exclusive && type === "number",
    };
    const limits = rangeText(type, bounds);
    if (!limits) return type;
    return bounds.minimum !== undefined &&
      bounds.maximum !== undefined &&
      !bounds.exclusiveMinimum
      ? limits
      : `${type} ${limits}`;
  }
  if (type === "array") {
    const count = rangeText("array", {
      minimum: bound(schema.minItems),
      maximum: bound(schema.maxItems),
    });
    return `array of ${schemaType(schema.items)}${count ? `, ${count}` : ""}`;
  }
  if (type === "object")
    return record(schema.properties)
      ? `object (${Object.keys(schema.properties).join(", ")})`
      : "object";
  return typeof type === "string" ? type : "any";
}

function nullable(schema: unknown): boolean {
  if (!record(schema)) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  const branches = schema.anyOf ?? schema.oneOf;
  return Array.isArray(branches) && branches.some(nullable);
}

function objectAt(schema: unknown, path: string): Json | undefined {
  let current = schema;
  for (const segment of path ? path.split(".") : []) {
    if (!record(current) || !record(current.properties)) return undefined;
    current = current.properties[segment];
  }
  // A JSON array of objects lists the fields of one item.
  if (record(current) && current.type === "array") current = current.items;
  return record(current) && record(current.properties) ? current : undefined;
}

/**
 * The help lines for a JSON flag's fields: name, whether it is required or
 * may be null, its type or values with limits, and its description.
 */
export function jsonFieldLines(inputSchema: unknown, path: string): string[] {
  const schema = objectAt(inputSchema, path);
  if (!schema) return [];
  const required = new Set(
    Array.isArray(schema.required) ? schema.required : [],
  );
  const fields = Object.entries(schema.properties as Json);
  const width = Math.max(...fields.map(([name]) => name.length));
  return fields.map(([name, field]) => {
    const presence = required.has(name)
      ? nullable(field)
        ? "required, may be null"
        : "required"
      : "optional";
    const description =
      record(field) && typeof field.description === "string"
        ? `  ${field.description}`
        : "";
    return `  ${name.padEnd(width)}  ${presence}; ${schemaType(field)}.${description}`;
  });
}
