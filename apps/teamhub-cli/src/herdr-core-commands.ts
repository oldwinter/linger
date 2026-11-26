import type { components } from "@linger/wire-contracts/teamhub-agent-api/types";
import type {
  CommandArguments,
  CommandDefinition,
  CommandInputReader,
  CommandOption,
} from "./command-definition.js";
import {
  assertPositionals,
  bodySource,
  option,
  parseJsonValue,
  values,
} from "./command-input.js";
import { displayText } from "./display-text.js";
import { CliError } from "./errors.js";
import { operationHeaders, teamHubData } from "./http-client.js";

type Schemas = components["schemas"];
type HerdrCoreToolName = Schemas["HerdrCoreToolName"];
type HerdrCoreAskOption = Schemas["HerdrCoreAskOption"];

const maxQuestionLength = 2000;
const maxOptionLength = 200;
const maxOptions = 20;
const maxKeysPerOption = 16;
const maxKeyLength = 64;
const maxAddressLength = 256;
const validTerminalStatuses = new Set([
  "idle",
  "working",
  "done",
  "blocked",
  "error",
]);

function invalid(message: string): never {
  throw new CliError("usage", message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseNonNegativeInt(
  raw: string | undefined,
  flag: string,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d{1,15}$/u.test(raw))
    invalid(`${flag} must be a non-negative integer.`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max)
    invalid(`${flag} must be between 0 and ${max}.`);
  return parsed;
}

function parsePositiveInt(
  raw: string | undefined,
  flag: string,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d{0,14}$/u.test(raw))
    invalid(`${flag} must be a positive integer.`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max)
    invalid(`${flag} must be between 1 and ${max}.`);
  return parsed;
}

function parsePositiveNumber(
  raw: string | undefined,
  flag: string,
  max = 3600,
): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max)
    invalid(`${flag} must be a number greater than 0 and at most ${max}.`);
  return parsed;
}

function requiredAddress(args: CommandArguments): string {
  assertPositionals(args, 1);
  const address = args.positionals[0]?.trim() ?? "";
  if (!address || [...address].length > maxAddressLength)
    invalid(
      `Provide a terminal address of 1 to ${maxAddressLength} characters.`,
    );
  return address;
}

function requiredPath(args: CommandArguments): string {
  assertPositionals(args, 1);
  const targetPath = args.positionals[0]?.trim() ?? "";
  if (!targetPath || [...targetPath].length > 4096)
    invalid("Provide a non-empty file path.");
  return targetPath;
}

function parseLabels(rawLabels: readonly string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const entry of rawLabels) {
    const separator = entry.indexOf("=");
    if (separator <= 0) invalid("--label must use key=value syntax.");
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (!key || !value)
      invalid("--label requires a non-empty key and value (key=value).");
    labels[key] = value;
  }
  return labels;
}

function parseArgvJson(raw: string): string[] {
  const parsed = parseJsonValue(raw, "--argv");
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((item) => typeof item !== "string" || item.length === 0)
  )
    invalid("--argv must be a non-empty JSON array of strings.");
  return parsed as string[];
}

function deadlineFromTimeoutSeconds(timeout: unknown): number | undefined {
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0)
    return undefined;
  const computed = Math.round(timeout * 1000) + 5000;
  return Math.max(1000, Math.min(120_000, computed));
}

const callOutputSchema = {
  type: "object",
  properties: {
    computer_id: { type: "string" },
    tool_name: { type: "string" },
    result: { type: "object", additionalProperties: true },
  },
  required: ["computer_id", "tool_name", "result"],
};

function renderCallResult(result: Record<string, unknown>): string {
  const tool = displayText(result.tool_name ?? "herdr_core");
  const payload = result.result;
  if (payload === undefined) return `${tool}: ok`;
  if (typeof payload === "object" && payload !== null && "text" in payload) {
    const record = asRecord(payload);
    if (typeof record.text === "string") return record.text;
  }
  if (typeof payload === "object" && payload !== null && "content" in payload) {
    const record = asRecord(payload);
    if (typeof record.content === "string") return record.content;
  }
  return `${tool} (${displayText(result.computer_id ?? "")}): ${JSON.stringify(payload)}`;
}

interface CallCommandSpec {
  readonly subcommand: string;
  readonly toolName: string;
  readonly hcTool: Exclude<HerdrCoreToolName, "answer">;
  readonly description: string;
  readonly readOnly: boolean;
  readonly usage: readonly string[];
  readonly arguments?: readonly string[];
  readonly options: Readonly<Record<string, CommandOption>>;
  readonly notes?: readonly string[];
  readonly inputSchema: object;
  readonly normalize: (
    args: CommandArguments,
    reader: CommandInputReader,
  ) => Promise<Record<string, unknown>>;
  readonly deadlineMs?: (input: Record<string, unknown>) => number | undefined;
  readonly render?: (result: Record<string, unknown>) => string;
}

function callCommand(spec: CallCommandSpec): CommandDefinition {
  return {
    command: ["computer", "hc", spec.subcommand],
    toolName: spec.toolName,
    operationId: !spec.readOnly,
    description: spec.description,
    readOnly: spec.readOnly,
    usage: spec.usage,
    ...(spec.arguments ? { arguments: spec.arguments } : {}),
    options: spec.options,
    ...(spec.notes ? { notes: spec.notes } : {}),
    inputSchema: spec.inputSchema,
    outputSchema: callOutputSchema,
    normalize: async (args, reader) => ({
      input: await spec.normalize(args, reader),
    }),
    execute: async (input, context) => {
      const deadlineMs = spec.deadlineMs?.(input);
      return teamHubData(
        context.client.api.POST("/api/agent/v1/computer/herdr-core/call", {
          body: {
            ...(context.operationId
              ? { operation_id: context.operationId }
              : {}),
            tool_name: spec.hcTool,
            arguments: input,
            ...(deadlineMs !== undefined ? { deadline_ms: deadlineMs } : {}),
          },
          headers: operationHeaders(context.operationId),
        }),
      );
    },
    render: spec.render ?? renderCallResult,
  };
}

const hcStatus = callCommand({
  subcommand: "status",
  toolName: "herdr_core_status",
  hcTool: "status",
  description:
    "Read herdr-core daemon status, version, terminal counts, and machines on your Computer.",
  readOnly: true,
  usage: ["teamhub computer hc status"],
  options: {},
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  normalize: async (args) => {
    assertPositionals(args, 0);
    return {};
  },
});

const hcList = callCommand({
  subcommand: "ls",
  toolName: "herdr_core_list",
  hcTool: "list",
  description:
    "List live (or all) herdr-core terminals across local and remote machines on your Computer.",
  readOnly: true,
  usage: [
    "teamhub computer hc ls [--all] [--machine <name>] [--room-id <id>] [--work-item-id <id>] [--status <state>]",
  ],
  options: {
    "--all": { description: "Include finished terminals.", boolean: true },
    "--machine": {
      description:
        "Filter by machine name (use local for the local machine only).",
    },
    "--room-id": {
      description: "Filter terminals carrying label linger.room=<id>.",
    },
    "--work-item-id": {
      description: "Filter terminals carrying label linger.work_item=<id>.",
    },
    "--status": {
      description:
        "Filter by OSC 7501 status state: idle, working, done, blocked, or error.",
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      all: { type: "boolean" },
      machine: { type: "string", maxLength: 128 },
      room_id: { type: "string", maxLength: 128 },
      work_item_id: { type: "string", maxLength: 128 },
      status: { enum: ["idle", "working", "done", "blocked", "error"] },
    },
    additionalProperties: false,
  },
  normalize: async (args) => {
    assertPositionals(args, 0);
    const out: Record<string, unknown> = {};
    if (option(args, "--all") !== undefined) out.all = true;
    const machine = option(args, "--machine")?.trim();
    if (machine) out.machine = machine;
    const roomId = option(args, "--room-id")?.trim();
    if (roomId) out.room_id = roomId;
    const workItemId = option(args, "--work-item-id")?.trim();
    if (workItemId) out.work_item_id = workItemId;
    const status = option(args, "--status")?.trim();
    if (status !== undefined) {
      if (!validTerminalStatuses.has(status))
        invalid("--status must be one of idle, working, done, blocked, error.");
      out.status = status;
    }
    return out;
  },
});

const hcGet = callCommand({
  subcommand: "get",
  toolName: "herdr_core_get",
  hcTool: "get",
  description:
    "Inspect one herdr-core terminal's metadata, status, turn, cwd, and labels.",
  readOnly: true,
  usage: ["teamhub computer hc get <address>"],
  arguments: ["<address>"],
  options: {},
  inputSchema: {
    type: "object",
    properties: {
      address: { type: "string", minLength: 1, maxLength: maxAddressLength },
    },
    required: ["address"],
    additionalProperties: false,
  },
  normalize: async (args) => ({ address: requiredAddress(args) }),
});

const hcRead = callCommand({
  subcommand: "read",
  toolName: "herdr_core_read",
  hcTool: "read",
  description: "Read recent rendered text from one herdr-core terminal.",
  readOnly: true,
  usage: ["teamhub computer hc read <address> [--lines <n>]"],
  arguments: ["<address>"],
  options: {
    "--lines": {
      description: "Number of recent lines to return (1-5000).",
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      address: { type: "string", minLength: 1, maxLength: maxAddressLength },
      lines: { type: "integer", minimum: 1, maximum: 5000 },
    },
    required: ["address"],
    additionalProperties: false,
  },
  normalize: async (args) => {
    const address = requiredAddress(args);
    const lines = parsePositiveInt(option(args, "--lines"), "--lines", 5000);
    return {
      address,
      ...(lines !== undefined ? { lines } : {}),
    };
  },
});

const hcRun = callCommand({
  subcommand: "run",
  toolName: "herdr_core_run",
  hcTool: "run",
  description:
    "Launch a new herdr-core terminal from a command line, argv array, or template.",
  readOnly: false,
  usage: [
    "teamhub computer hc run (--line <cmd> | --argv <json-array> | --template <name>) [--prompt <text>] [--name <name>] [--cwd <dir>] [--on <machine>] [--keep] [--label key=value ...] [--parent <addr>] [--rm] [--no-notify] [--size <COLSxROWS>]",
  ],
  options: {
    "--line": { description: "Shell command line to run in the terminal." },
    "--argv": {
      description:
        "JSON array of command arguments (mutually exclusive with --line).",
    },
    "--template": { description: "Named herdr-core template to launch." },
    "--prompt": {
      description:
        "Initial prompt or task text passed to the template or coding agent.",
    },
    "--name": { description: "Optional terminal name." },
    "--cwd": { description: "Working directory for the new terminal." },
    "--on": { description: "Remote machine name to launch on." },
    "--keep": {
      description: "Keep the terminal record after exit.",
      boolean: true,
    },
    "--label": {
      description: "Attach a label in key=value form; repeatable.",
      repeatable: true,
    },
    "--parent": { description: "Parent terminal address." },
    "--rm": {
      description: "Remove the terminal record automatically on exit.",
      boolean: true,
    },
    "--no-notify": {
      description: "Suppress completion notifications for this terminal.",
      boolean: true,
    },
    "--size": {
      description: "Initial terminal size as COLSxROWS (e.g. 120x36).",
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      line: { type: "string", minLength: 1, maxLength: 16384 },
      argv: {
        type: "array",
        minItems: 1,
        maxItems: 128,
        items: { type: "string" },
      },
      template: { type: "string", minLength: 1, maxLength: 120 },
      task: { type: "string", minLength: 1, maxLength: 16384 },
      name: { type: "string", minLength: 1, maxLength: 120 },
      cwd: { type: "string", minLength: 1, maxLength: 4096 },
      on: { type: "string", minLength: 1, maxLength: 128 },
      keep: { type: "boolean" },
      labels: { type: "object", additionalProperties: { type: "string" } },
      parent: { type: "string", minLength: 1, maxLength: maxAddressLength },
      rm: { type: "boolean" },
      no_notify: { type: "boolean" },
      size: { type: "string", pattern: "^[1-9]\\d{0,3}x[1-9]\\d{0,3}$" },
    },
    additionalProperties: false,
  },
  normalize: async (args) => {
    assertPositionals(args, 0);
    const line = option(args, "--line");
    const argvRaw = option(args, "--argv");
    const template = option(args, "--template")?.trim();
    const prompt = option(args, "--prompt");
    if (line !== undefined && argvRaw !== undefined)
      invalid("Provide only one of --line or --argv.");
    if (
      line === undefined &&
      argvRaw === undefined &&
      !template &&
      prompt === undefined
    )
      invalid(
        "Provide at least one of --line, --argv, --template, or --prompt.",
      );
    const out: Record<string, unknown> = {};
    if (line !== undefined) {
      if (!line.trim()) invalid("--line must not be empty.");
      out.line = line;
    }
    if (argvRaw !== undefined) out.argv = parseArgvJson(argvRaw);
    if (template) out.template = template;
    if (prompt !== undefined) out.task = prompt;
    const name = option(args, "--name")?.trim();
    if (name) out.name = name;
    const cwd = option(args, "--cwd")?.trim();
    if (cwd) out.cwd = cwd;
    const on = option(args, "--on")?.trim();
    if (on) out.on = on;
    if (option(args, "--keep") !== undefined) out.keep = true;
    const rawLabels = values(args, "--label");
    if (rawLabels.length > 0) out.labels = parseLabels(rawLabels);
    const parent = option(args, "--parent")?.trim();
    if (parent) out.parent = parent;
    if (option(args, "--rm") !== undefined) out.rm = true;
    if (option(args, "--no-notify") !== undefined) out.no_notify = true;
    const size = option(args, "--size")?.trim();
    if (size !== undefined) {
      if (!/^[1-9]\d{0,3}x[1-9]\d{0,3}$/u.test(size))
        invalid("--size must use COLSxROWS format, for example 120x36.");
      out.size = size;
    }
    return out;
  },
});

const hcSend = callCommand({
  subcommand: "send",
  toolName: "herdr_core_send",
  hcTool: "send",
  description:
    "Send a text prompt or input line to a herdr-core terminal, optionally guarding on state or waiting for a turn.",
  readOnly: false,
  usage: [
    "teamhub computer hc send <address> (--text <text> | --file <path>) [--if <state>] [--force] [--wait] [--timeout <seconds>]",
  ],
  arguments: ["<address>"],
  options: {
    "--text": { description: "Text to send to the terminal." },
    "--file": {
      description: "Read UTF-8 text to send from a file or - for stdin.",
    },
    "--if": {
      description:
        "Require this OSC 7501 state before sending (for example idle or blocked).",
    },
    "--force": {
      description: "Send even if the terminal appears busy.",
      boolean: true,
    },
    "--wait": {
      description: "Wait for the triggered turn to progress or complete.",
      boolean: true,
    },
    "--timeout": {
      description: "Optional wait timeout in seconds.",
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      address: { type: "string", minLength: 1, maxLength: maxAddressLength },
      text: { type: "string", minLength: 1, maxLength: 65536 },
      if: { type: "string", maxLength: 64 },
      force: { type: "boolean" },
      wait: { type: "boolean" },
      timeout: { type: "number", minimum: 0.1 },
    },
    required: ["address", "text"],
    additionalProperties: false,
  },
  normalize: async (args, reader) => {
    const address = requiredAddress(args);
    const text = await bodySource(args, reader, true, ["--text", "--file"]);
    if (!text) invalid("Provide non-empty --text or --file.");
    const out: Record<string, unknown> = { address, text };
    const ifState = option(args, "--if")?.trim();
    if (ifState) out.if = ifState;
    if (option(args, "--force") !== undefined) out.force = true;
    if (option(args, "--wait") !== undefined) out.wait = true;
    const timeout = parsePositiveNumber(option(args, "--timeout"), "--timeout");
    if (timeout !== undefined) out.timeout = timeout;
    return out;
  },
  deadlineMs: (input) => deadlineFromTimeoutSeconds(input.timeout),
});

const hcKeys = callCommand({
  subcommand: "keys",
  toolName: "herdr_core_keys",
  hcTool: "keys",
  description:
    "Send a sequence of named keystrokes (for example Down, Enter, C-c) to a herdr-core terminal.",
  readOnly: false,
  usage: ["teamhub computer hc keys <address> --key <key> [--key <key> ...]"],
  arguments: ["<address>"],
  options: {
    "--key": {
      description:
        "Key token to send (repeatable, 1-64 keys, e.g. y, Down, Enter, C-c).",
      repeatable: true,
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      address: { type: "string", minLength: 1, maxLength: maxAddressLength },
      keys: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: { type: "string", minLength: 1, maxLength: maxKeyLength },
      },
    },
    required: ["address", "keys"],
    additionalProperties: false,
  },
  normalize: async (args) => {
    const address = requiredAddress(args);
    const keys = values(args, "--key").map((k) => k.trim());
    if (keys.length === 0 || keys.length > 64)
      invalid("Provide 1 to 64 --key values.");
    if (
      keys.some(
        (key) => !key || [...key].length > maxKeyLength || /\p{Cc}/u.test(key),
      )
    )
      invalid(
        `Each --key must be non-empty, single-line, and at most ${maxKeyLength} characters.`,
      );
    return { address, keys };
  },
});

const hcInterrupt = callCommand({
  subcommand: "interrupt",
  toolName: "herdr_core_interrupt",
  hcTool: "interrupt",
  description: "Interrupt the foreground process in a herdr-core terminal.",
  readOnly: false,
  usage: ["teamhub computer hc interrupt <address> [--timeout <seconds>]"],
  arguments: ["<address>"],
  options: {
    "--timeout": {
      description: "Optional seconds to wait for the interruption to settle.",
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      address: { type: "string", minLength: 1, maxLength: maxAddressLength },
      timeout: { type: "number", minimum: 0.1 },
    },
    required: ["address"],
    additionalProperties: false,
  },
  normalize: async (args) => {
    const address = requiredAddress(args);
    const timeout = parsePositiveNumber(option(args, "--timeout"), "--timeout");
    return {
      address,
      ...(timeout !== undefined ? { timeout } : {}),
    };
  },
  deadlineMs: (input) => deadlineFromTimeoutSeconds(input.timeout),
});

const hcKill = callCommand({
  subcommand: "kill",
  toolName: "herdr_core_kill",
  hcTool: "kill",
  description: "Terminate a live herdr-core terminal.",
  readOnly: false,
  usage: ["teamhub computer hc kill <address>"],
  arguments: ["<address>"],
  options: {},
  inputSchema: {
    type: "object",
    properties: {
      address: { type: "string", minLength: 1, maxLength: maxAddressLength },
    },
    required: ["address"],
    additionalProperties: false,
  },
  normalize: async (args) => ({ address: requiredAddress(args) }),
});

const hcRm = callCommand({
  subcommand: "rm",
  toolName: "herdr_core_rm",
  hcTool: "rm",
  description: "Remove a finished herdr-core terminal record.",
  readOnly: false,
  usage: ["teamhub computer hc rm <address>"],
  arguments: ["<address>"],
  options: {},
  inputSchema: {
    type: "object",
    properties: {
      address: { type: "string", minLength: 1, maxLength: maxAddressLength },
    },
    required: ["address"],
    additionalProperties: false,
  },
  normalize: async (args) => ({ address: requiredAddress(args) }),
});

const hcExec = callCommand({
  subcommand: "exec",
  toolName: "herdr_core_exec",
  hcTool: "exec",
  description:
    "Run a one-shot non-interactive command through herdr-core on the local or remote machine.",
  readOnly: false,
  usage: [
    "teamhub computer hc exec (--line <cmd> | --argv <json-array>) [--cwd <dir>] [--on <machine>] [--timeout <seconds>]",
  ],
  options: {
    "--line": { description: "Shell command line to execute." },
    "--argv": {
      description:
        "JSON array of command arguments (mutually exclusive with --line).",
    },
    "--cwd": { description: "Working directory for the command." },
    "--on": { description: "Remote machine name to execute on." },
    "--timeout": { description: "Command timeout in seconds." },
  },
  inputSchema: {
    type: "object",
    properties: {
      line: { type: "string", minLength: 1, maxLength: 16384 },
      argv: {
        type: "array",
        minItems: 1,
        maxItems: 128,
        items: { type: "string" },
      },
      cwd: { type: "string", minLength: 1, maxLength: 4096 },
      on: { type: "string", minLength: 1, maxLength: 128 },
      timeout: { type: "number", minimum: 0.1 },
    },
    additionalProperties: false,
  },
  normalize: async (args) => {
    assertPositionals(args, 0);
    const line = option(args, "--line");
    const argvRaw = option(args, "--argv");
    if (line !== undefined && argvRaw !== undefined)
      invalid("Provide only one of --line or --argv.");
    if (line === undefined && argvRaw === undefined)
      invalid("Provide --line or --argv.");
    const out: Record<string, unknown> = {};
    if (line !== undefined) {
      if (!line.trim()) invalid("--line must not be empty.");
      out.line = line;
    }
    if (argvRaw !== undefined) out.argv = parseArgvJson(argvRaw);
    const cwd = option(args, "--cwd")?.trim();
    if (cwd) out.cwd = cwd;
    const on = option(args, "--on")?.trim();
    if (on) out.on = on;
    const timeout = parsePositiveNumber(option(args, "--timeout"), "--timeout");
    if (timeout !== undefined) out.timeout = timeout;
    return out;
  },
  deadlineMs: (input) => deadlineFromTimeoutSeconds(input.timeout),
});

const hcFileRead = callCommand({
  subcommand: "file-read",
  toolName: "herdr_core_file_read",
  hcTool: "file_read",
  description: "Read a file on the local or remote machine through herdr-core.",
  readOnly: true,
  usage: [
    "teamhub computer hc file-read <path> [--on <machine>] [--offset <n>] [--limit <n>]",
  ],
  arguments: ["<path>"],
  options: {
    "--on": { description: "Remote machine name to read from." },
    "--offset": {
      description: "Optional starting line or byte offset (>= 0).",
    },
    "--limit": { description: "Optional maximum lines or bytes to return." },
  },
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, maxLength: 4096 },
      on: { type: "string", minLength: 1, maxLength: 128 },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  normalize: async (args) => {
    const filePath = requiredPath(args);
    const out: Record<string, unknown> = { path: filePath };
    const on = option(args, "--on")?.trim();
    if (on) out.on = on;
    const offset = parseNonNegativeInt(option(args, "--offset"), "--offset");
    if (offset !== undefined) out.offset = offset;
    const limit = parsePositiveInt(option(args, "--limit"), "--limit");
    if (limit !== undefined) out.limit = limit;
    return out;
  },
});

const hcFileEdit = callCommand({
  subcommand: "file-edit",
  toolName: "herdr_core_file_edit",
  hcTool: "file_edit",
  description:
    "Apply an exact search-and-replace edit to a file through herdr-core.",
  readOnly: false,
  usage: [
    "teamhub computer hc file-edit <path> (--old <text> | --old-file <path>) (--new <text> | --new-file <path>) [--on <machine>] [--replace-all]",
  ],
  arguments: ["<path>"],
  options: {
    "--old": { description: "Exact existing text to replace." },
    "--old-file": {
      description: "Read exact existing text from a file or - for stdin.",
    },
    "--new": { description: "Replacement text." },
    "--new-file": {
      description: "Read replacement text from a file or - for stdin.",
    },
    "--on": { description: "Remote machine name to edit on." },
    "--replace-all": {
      description:
        "Replace every occurrence instead of requiring a single match.",
      boolean: true,
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, maxLength: 4096 },
      old: { type: "string", minLength: 1 },
      new: { type: "string" },
      on: { type: "string", minLength: 1, maxLength: 128 },
      replace_all: { type: "boolean" },
    },
    required: ["path", "old", "new"],
    additionalProperties: false,
  },
  normalize: async (args, reader) => {
    const filePath = requiredPath(args);
    const oldText = await bodySource(args, reader, true, [
      "--old",
      "--old-file",
    ]);
    if (!oldText) invalid("Provide non-empty --old or --old-file.");
    const newText = await bodySource(args, reader, true, [
      "--new",
      "--new-file",
    ]);
    const out: Record<string, unknown> = {
      path: filePath,
      old: oldText,
      new: newText ?? "",
    };
    const on = option(args, "--on")?.trim();
    if (on) out.on = on;
    if (option(args, "--replace-all") !== undefined) out.replace_all = true;
    return out;
  },
});

const hcFileWrite = callCommand({
  subcommand: "file-write",
  toolName: "herdr_core_file_write",
  hcTool: "file_write",
  description:
    "Write UTF-8 content to a file on the local or remote machine through herdr-core.",
  readOnly: false,
  usage: [
    "teamhub computer hc file-write <path> (--content <text> | --file <path>) [--on <machine>]",
  ],
  arguments: ["<path>"],
  options: {
    "--content": { description: "Inline UTF-8 file content." },
    "--file": {
      description: "Read UTF-8 file content from a local file or - for stdin.",
    },
    "--on": { description: "Remote machine name to write on." },
  },
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", minLength: 1, maxLength: 4096 },
      content: { type: "string" },
      on: { type: "string", minLength: 1, maxLength: 128 },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  normalize: async (args, reader) => {
    const filePath = requiredPath(args);
    const content = await bodySource(args, reader, true, [
      "--content",
      "--file",
    ]);
    const out: Record<string, unknown> = {
      path: filePath,
      content: content ?? "",
    };
    const on = option(args, "--on")?.trim();
    if (on) out.on = on;
    return out;
  },
});

const hcTemplates = callCommand({
  subcommand: "templates",
  toolName: "herdr_core_templates",
  hcTool: "templates",
  description: "List terminal launch templates configured in herdr-core.",
  readOnly: true,
  usage: ["teamhub computer hc templates [--on <machine>]"],
  options: {
    "--on": { description: "Optional remote machine name." },
  },
  inputSchema: {
    type: "object",
    properties: {
      on: { type: "string", minLength: 1, maxLength: 128 },
    },
    additionalProperties: false,
  },
  normalize: async (args) => {
    assertPositionals(args, 0);
    const on = option(args, "--on")?.trim();
    return on ? { on } : {};
  },
});

const hcMachines = callCommand({
  subcommand: "machines",
  toolName: "herdr_core_machines",
  hcTool: "machines",
  description: "List local and remote machines configured in herdr-core.",
  readOnly: true,
  usage: ["teamhub computer hc machines"],
  options: {},
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  normalize: async (args) => {
    assertPositionals(args, 0);
    return {};
  },
});

function parseOptionWithKeys(raw: string): HerdrCoreAskOption {
  const separator = raw.indexOf("=");
  if (separator <= 0)
    invalid("--option-keys must use label=key1,key2,... syntax.");
  const rawLabel = raw.slice(0, separator);
  if (/\p{Cc}/u.test(rawLabel))
    invalid("Each --option-keys label must be a single line.");
  const label = rawLabel.trim();
  if (!label || [...label].length > maxOptionLength)
    invalid(
      `Each --option-keys label must be 1 to ${maxOptionLength} characters.`,
    );
  const rawKeys = raw.slice(separator + 1).split(",");
  if (rawKeys.length === 0 || rawKeys.length > maxKeysPerOption)
    invalid(
      `Each --option-keys value must list 1 to ${maxKeysPerOption} keys.`,
    );
  const keys = rawKeys.map((part) => {
    if (/\p{Cc}/u.test(part))
      invalid("Each key in --option-keys must be single-line.");
    const trimmed = part.trim();
    if (!trimmed || [...trimmed].length > maxKeyLength)
      invalid(
        `Each key in --option-keys must be 1 to ${maxKeyLength} characters.`,
      );
    return trimmed;
  });
  return { label, keys };
}

const hcAsk: CommandDefinition = {
  command: ["computer", "hc", "ask"],
  toolName: "ask_herdr_core_terminal",
  operationId: true,
  description:
    "Ask your owner, with a question card, how to answer a blocked coding agent in a herdr-core terminal; TeamHub delivers their answer (keys or text) once while the terminal stays on that turn.",
  readOnly: false,
  usage: [
    "teamhub computer hc ask --address <addr> --turn <n> --status-ms <ms> --question <text> (--option <choice> | --option-keys <label=k1,k2>) [...]",
  ],
  options: {
    "--address": {
      description:
        "Terminal address from the herdr-core event (for example t7 or vps/t7).",
    },
    "--turn": {
      description: "Terminal turn counter from the herdr-core event.",
    },
    "--status-ms": {
      description:
        "Status timestamp in milliseconds from the herdr-core event.",
    },
    "--question": {
      description: `What the coding agent asks, at most ${maxQuestionLength} characters.`,
    },
    "--option": {
      description: `One text choice offered to your owner (1-${maxOptions} total across --option and --option-keys).`,
      repeatable: true,
    },
    "--option-keys": {
      description:
        "One key-sequence choice in label=key1,key2 form (for example Approve=y,Enter); repeatable.",
      repeatable: true,
    },
  },
  notes: [
    "Only for a herdr-core blocked event in your owner's chat. Asking again for the same address, turn, and status_ms returns the same card.",
    "When your owner picks an --option-keys choice, TeamHub sends that key sequence; otherwise TeamHub sends their chosen or written text once while the terminal is still blocked on that state.",
    "An event gated by quiet hours or daily reminders is refused with herdr_ask_gated: keep the address, turn, and status_ms in a Tracking Item and ask when its follow-up comes.",
  ],
  inputSchema: {
    type: "object",
    properties: {
      address: { type: "string", minLength: 1, maxLength: maxAddressLength },
      turn: { type: "integer", minimum: 0 },
      status_ms: { type: "integer", minimum: 0 },
      question: { type: "string", minLength: 1, maxLength: maxQuestionLength },
      options: {
        type: "array",
        minItems: 1,
        maxItems: maxOptions,
        items: {
          type: "object",
          properties: {
            label: { type: "string", minLength: 1, maxLength: maxOptionLength },
            keys: {
              type: "array",
              minItems: 1,
              maxItems: maxKeysPerOption,
              items: { type: "string", minLength: 1, maxLength: maxKeyLength },
            },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
    },
    required: ["address", "turn", "status_ms", "question", "options"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { enum: ["asked"] },
      computer_id: { type: "string" },
      room_id: { type: "string" },
      message_id: { type: "string" },
      interaction_id: { type: "string" },
    },
    required: [
      "status",
      "computer_id",
      "room_id",
      "message_id",
      "interaction_id",
    ],
  },
  normalize: async (args) => {
    assertPositionals(args, 0);
    const address = option(args, "--address")?.trim();
    if (!address || [...address].length > maxAddressLength)
      invalid("Provide --address from the herdr-core event.");
    const turn = parseNonNegativeInt(option(args, "--turn"), "--turn");
    if (turn === undefined)
      invalid("--turn must be the turn number from the herdr-core event.");
    const statusMs = parseNonNegativeInt(
      option(args, "--status-ms"),
      "--status-ms",
    );
    if (statusMs === undefined)
      invalid(
        "--status-ms must be the status_ms timestamp from the herdr-core event.",
      );
    const question = option(args, "--question")?.trim();
    if (!question) invalid("Provide --question.");
    if ([...question].length > maxQuestionLength)
      invalid(`--question must be at most ${maxQuestionLength} characters.`);

    const options: HerdrCoreAskOption[] = [];
    const seenLabels = new Set<string>();
    for (const item of args.ordered) {
      if (item.name === "--option") {
        if (/\p{Cc}/u.test(item.value))
          invalid(
            `Each --option must be distinct, one line, and at most ${maxOptionLength} characters.`,
          );
        const label = item.value.trim();
        if (!label || [...label].length > maxOptionLength)
          invalid(
            `Each --option must be distinct, one line, and at most ${maxOptionLength} characters.`,
          );
        if (seenLabels.has(label))
          invalid(
            "Option labels must be distinct across --option and --option-keys.",
          );
        seenLabels.add(label);
        options.push({ label });
      } else if (item.name === "--option-keys") {
        const parsed = parseOptionWithKeys(item.value);
        if (seenLabels.has(parsed.label))
          invalid(
            "Option labels must be distinct across --option and --option-keys.",
          );
        seenLabels.add(parsed.label);
        options.push(parsed);
      }
    }
    if (options.length === 0 || options.length > maxOptions)
      invalid(
        `Provide 1 to ${maxOptions} choices using --option or --option-keys.`,
      );
    return {
      input: {
        address,
        turn,
        status_ms: statusMs,
        question,
        options,
      },
    };
  },
  execute: async (input, context) =>
    teamHubData(
      context.client.api.POST("/api/agent/v1/computer/herdr-core/ask", {
        body: {
          address: input.address as string,
          turn: input.turn as number,
          status_ms: input.status_ms as number,
          question: input.question as string,
          options: input.options as HerdrCoreAskOption[],
        },
        headers: operationHeaders(context.operationId),
      }),
    ),
  render: (result) =>
    `Question card posted (${displayText(result.message_id)}). End your turn now; TeamHub delivers your owner's answer to the herdr-core terminal once and then tells you whether it arrived.`,
};

export const herdrCoreCommandDefinitions: readonly CommandDefinition[] = [
  hcStatus,
  hcList,
  hcGet,
  hcRead,
  hcRun,
  hcSend,
  hcKeys,
  hcInterrupt,
  hcKill,
  hcRm,
  hcExec,
  hcFileRead,
  hcFileEdit,
  hcFileWrite,
  hcTemplates,
  hcMachines,
  hcAsk,
];
