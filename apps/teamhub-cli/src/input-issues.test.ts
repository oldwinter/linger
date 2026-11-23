import { describe, expect, it } from "vitest";
import { z } from "zod";
import { schemaErrors } from "./connector-runtime.js";
import { addTrackingItemSchema } from "./domains/knowledge/tools/tracking-items.js";
import {
  ajvInputIssues,
  echo,
  fileFailure,
  invalidInput,
  listedIssueLimit,
  zodInputIssues,
} from "./input-issues.js";

function zodIssues(schema: z.ZodType, value: unknown, root?: string) {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("expected a failure");
  return zodInputIssues(parsed.error.issues, value, {
    schema,
    ...(root ? { root } : {}),
  });
}

describe("zod input issues", () => {
  it("lists every missing Tracking Item field and says which take null", () => {
    expect(
      zodIssues(addTrackingItemSchema.input, { kind: "meeting", content: "x" }),
    ).toEqual([
      {
        path: "due_at",
        code: "missing",
        message: "required; use null if there is none.",
      },
      {
        path: "due_text",
        code: "missing",
        message: "required; use null if there is none.",
      },
      { path: "source_ref", code: "missing", message: "required." },
      { path: "source_date", code: "missing", message: "required." },
      { path: "source_timezone", code: "missing", message: "required." },
      { path: "idempotency_key", code: "missing", message: "required." },
    ]);
  });

  it("writes each problem in its code's sentence", () => {
    expect(
      zodIssues(addTrackingItemSchema.input, {
        kind: "event",
        content: 5,
        due_at: "tonight",
        due_text: null,
        source_ref: "",
        source_date: "2026-13-01",
        source_timezone: "Asia/Shanghai",
        idempotency_key: "k",
        bogus: 1,
      }),
    ).toEqual([
      {
        path: "kind",
        code: "invalid_value",
        message: 'must be one of todo, question, meeting; got "event".',
      },
      {
        path: "content",
        code: "invalid_type",
        message: "expected string; got number.",
      },
      {
        path: "due_at",
        code: "invalid_format",
        message:
          'expected a time with offset, for example 2026-11-22T18:10:00+08:00; got "tonight".',
      },
      {
        path: "source_ref",
        code: "out_of_range",
        message: "must be 1 to 2048 characters; got 0.",
      },
      {
        path: "source_date",
        code: "invalid_format",
        message: 'expected a date, for example 2026-11-22; got "2026-13-01".',
      },
      {
        path: "bogus",
        code: "unknown_field",
        message:
          "not allowed. Allowed: kind, content, due_at, due_text, source_ref, source_date, source_timezone, idempotency_key.",
      },
    ]);
  });

  it("names nested fields by path and numeric ranges by both bounds", () => {
    const schema = z
      .object({
        routines: z.array(
          z
            .object({
              purpose: z.string(),
              limit: z.number().int().min(1).max(200),
            })
            .strict(),
        ),
        id: z.string().regex(/^ti_[a-f0-9]{32}$/u),
      })
      .strict();
    expect(
      zodIssues(schema, { routines: [{ limit: 0 }], id: "x" }, "--item"),
    ).toEqual([
      { path: "routines[0].purpose", code: "missing", message: "required." },
      {
        path: "routines[0].limit",
        code: "out_of_range",
        message: "must be an integer from 1 to 200; got 0.",
      },
      {
        path: "id",
        code: "invalid_format",
        message: 'expected text matching /^ti_[a-f0-9]{32}$/; got "x".',
      },
    ]);
    expect(zodIssues(schema, [], "--item")).toEqual([
      {
        path: "--item",
        code: "invalid_type",
        message: "expected object; got array.",
      },
    ]);
  });

  it("reports a union by its closest branch or by the types it accepts", () => {
    const segment = z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), content: z.string() }).strict(),
      z.object({ type: z.literal("image"), url: z.string() }).strict(),
    ]);
    expect(
      zodIssues(z.object({ segment }), { segment: { type: "video" } }),
    ).toEqual([
      {
        path: "segment.type",
        code: "invalid_value",
        message: 'must be one of text, image; got "video".',
      },
    ]);
    expect(
      zodIssues(z.object({ segment }), { segment: { type: "text" } }),
    ).toEqual([
      { path: "segment.content", code: "missing", message: "required." },
    ]);
    expect(
      zodIssues(z.object({ value: z.union([z.string(), z.number()]) }), {
        value: true,
      }),
    ).toEqual([
      {
        path: "value",
        code: "invalid_type",
        message: "expected string or number; got boolean.",
      },
    ]);
  });

  it("echoes at most 40 characters on one line and never a secret", () => {
    expect(echo("a".repeat(45))).toBe(JSON.stringify(`${"a".repeat(40)}…`));
    expect(echo("one\ntwo")).toBe('"one two"');
    expect(
      zodIssues(z.object({ api_key: z.enum(["a", "b"]) }), {
        api_key: "sk-live",
      }),
    ).toEqual([
      {
        path: "api_key",
        code: "invalid_value",
        message: "must be one of a, b.",
      },
    ]);
  });
});

describe("ajv input issues", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["to", "due"],
    properties: {
      to: { type: "string", format: "email" },
      due: {
        anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
      },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      folder: { enum: ["inbox", "sent"] },
      title: { type: "string", minLength: 1, maxLength: 5 },
      value: { anyOf: [{ type: "string" }, { type: "number" }] },
    },
  };
  const issues = async (value: unknown) =>
    ajvInputIssues(await schemaErrors(schema, value), value);

  it("names missing, unknown, mistyped and out-of-range fields", async () => {
    expect(
      await issues({
        to: "nobody",
        limit: 0,
        folder: "trash",
        title: "too long",
        value: true,
        extra: 1,
      }),
    ).toEqual([
      {
        path: "due",
        code: "missing",
        message: "required; use null if there is none.",
      },
      {
        path: "extra",
        code: "unknown_field",
        message: "not allowed. Allowed: to, due, limit, folder, title, value.",
      },
      {
        path: "to",
        code: "invalid_format",
        message:
          'expected an email address, for example name@example.com; got "nobody".',
      },
      {
        path: "limit",
        code: "out_of_range",
        message: "must be an integer from 1 to 100; got 0.",
      },
      {
        path: "folder",
        code: "invalid_value",
        message: 'must be one of inbox, sent; got "trash".',
      },
      {
        path: "title",
        code: "out_of_range",
        message: "must be 1 to 5 characters; got 8.",
      },
      {
        path: "value",
        code: "invalid_type",
        message: "expected string or number; got boolean.",
      },
    ]);
  });

  it("reports a union value by the branch it was closest to", async () => {
    expect(await issues({ to: "a@example.com", due: "tomorrow" })).toEqual([
      {
        path: "due",
        code: "invalid_format",
        message:
          'expected a time with offset, for example 2026-11-22T18:10:00+08:00; got "tomorrow".',
      },
    ]);
  });
});

it("lists at most the issue limit and counts the rest", () => {
  const failure = invalidInput(
    "The input does not match this command.",
    Array.from({ length: listedIssueLimit + 3 }, (_, index) => ({
      path: `field_${index}`,
      code: "missing" as const,
      message: "required.",
    })),
  );
  expect(failure.code).toBe("invalid_input");
  expect(failure.details.issues).toHaveLength(listedIssueLimit);
  expect(failure.details.issues_omitted).toBe(3);
});

describe("local file failures", () => {
  const missing = Object.assign(new Error("ENOENT"), {
    code: "ENOENT",
    syscall: "open",
    path: "/work/out/report.md",
  });
  it("names the flag and the path as the caller wrote it", () => {
    expect(
      fileFailure(missing, "--output", "out/report.md", true),
    ).toMatchObject({
      code: "invalid_input",
      message: "The --output path could not be written.",
      details: {
        issues: [
          {
            path: "--output",
            code: "unwritable",
            message: "out/report.md: not found.",
          },
        ],
      },
    });
  });
  it("treats a failed open as a read when the caller cannot tell", () => {
    expect(fileFailure(missing).details.issues).toEqual([
      {
        path: "file",
        code: "unreadable",
        message: "/work/out/report.md: not found.",
      },
    ]);
  });
});
