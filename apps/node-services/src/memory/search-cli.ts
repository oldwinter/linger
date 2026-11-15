import type {
  PersonalKnowledgeQueryRequest,
  PersonalKnowledgeQueryResponse,
} from "@linger/wire-contracts/node-services-internal/client";

import { isMainModule } from "../paths.js";
import {
  createMemoryChunkIndexFromEnvironment,
  type ChunkSearchProvider,
} from "./chunk-index.js";
import { loadAnotherMeSubjects } from "./collector.js";
import { closeMemoryDatabase } from "./database.js";
import { queryPersonalKnowledge } from "./knowledge-query.js";
import { parseOptions, type CliOptions } from "./options.js";
import type { AnotherMeSubject } from "./types.js";

const HIT_TEXT_LIMIT = 140;

if (isMainModule(import.meta.url)) {
  runMemorySearchCliFromEnvironment(process.argv.slice(2))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(closeMemoryDatabase);
}

export interface MemorySearchArguments {
  query: string;
  options: CliOptions;
  scope?: NonNullable<PersonalKnowledgeQueryRequest["scope"]>;
}

/**
 * The words form the query, so an unquoted multi-word search still works.
 * Everything else goes through the Memory CLIs' shared options, which also
 * resolve the Memory root.
 */
export function parseMemorySearchArguments(
  argv: string[],
): MemorySearchArguments {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const words: string[] = [];
  const optionArgs: string[] = [];
  let scope: MemorySearchArguments["scope"];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--scope") {
      const value = args[index + 1];
      if (value !== "originals" && value !== "summaries")
        throw new Error(
          `--scope must be originals or summaries: ${value ?? ""}`,
        );
      scope = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      optionArgs.push(arg);
      const value = args[index + 1];
      if (value !== undefined) {
        optionArgs.push(value);
        index += 1;
      }
      continue;
    }
    words.push(arg);
  }
  const query = words.join(" ").trim();
  if (!query)
    throw new Error(
      'Usage: memory:search "<query>" [--memory-subject-key <key>] [--scope originals|summaries]',
    );
  return {
    options: parseOptions(optionArgs),
    query,
    ...(scope ? { scope } : {}),
  };
}

export interface MemorySearchRuntime {
  chunkSearch?: ChunkSearchProvider;
  /** Injected by tests; the command reads the subjects from TeamHub. */
  query?: typeof queryPersonalKnowledge;
  subjects?: readonly AnotherMeSubject[];
}

/** Runs one query and prints a line per hit for a developer at the terminal. */
export async function runMemorySearchCli(
  args: MemorySearchArguments,
  runtime: MemorySearchRuntime = {},
): Promise<PersonalKnowledgeQueryResponse> {
  const subject = selectSubject(
    runtime.subjects ?? (await loadAnotherMeSubjects()),
    args.options.memorySubjectKey,
  );
  const result = await (runtime.query ?? queryPersonalKnowledge)(
    args.options.memoryRoot,
    {
      // The index is per Another Me, and calls about a Human's artifacts are
      // attributed to that Human and its Tenant.
      agent_actor_id: subject.agentActorId,
      agent_id: subject.agentManagementId,
      query: args.query,
      tenant_id: subject.tenantId,
      user_artifact_owner_actor_id: subject.representedHumanActorId,
      ...(args.scope ? { scope: args.scope } : {}),
    },
    { chunkSearch: runtime.chunkSearch },
  );
  for (const line of formatMemorySearch(result, args.query)) console.log(line);
  return result;
}

/** One line per hit: rank, scope, title or ID, and one line of its text. */
export function formatMemorySearch(
  result: PersonalKnowledgeQueryResponse,
  query: string,
): string[] {
  const facts = result.facts ?? [];
  const total = result.items.length + result.summaries.length + facts.length;
  if (total === 0) return [`No hits for "${query}".`];
  return [
    `${total} hit${total === 1 ? "" : "s"} for "${query}" (${result.status})`,
    ...result.items.map((entry) =>
      hitLine(
        entry.citeAs,
        `original:${entry.kind}`,
        entry.title,
        entry.snippet ?? entry.content,
      ),
    ),
    ...result.summaries.map((entry) =>
      hitLine(
        entry.citeAs,
        `summary:${entry.kind}`,
        entry.title,
        entry.snippet ?? entry.content,
      ),
    ),
    ...facts.map((fact, index) =>
      hitLine(`F${index + 1}`, "fact", fact.evidenceId, fact.text),
    ),
  ];
}

function hitLine(
  rank: string,
  scope: string,
  title: string,
  text: string | undefined,
): string {
  const line = oneLine(text ?? "");
  return line
    ? `${rank}  ${scope}  ${title}  —  ${line}`
    : `${rank}  ${scope}  ${title}`;
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > HIT_TEXT_LIMIT
    ? `${line.slice(0, HIT_TEXT_LIMIT)}…`
    : line;
}

function selectSubject(
  subjects: readonly AnotherMeSubject[],
  memorySubjectKey: string | undefined,
): AnotherMeSubject {
  const matches = memorySubjectKey
    ? subjects.filter(
        (subject) => subject.memorySubjectKey === memorySubjectKey,
      )
    : subjects;
  const [subject] = matches;
  if (subject && matches.length === 1) return subject;
  if (!subject)
    throw new Error(
      memorySubjectKey
        ? `No AnotherMe subject ${memorySubjectKey}`
        : "No AnotherMe subjects; pass --memory-subject-key",
    );
  throw new Error(
    `Several AnotherMe subjects match; pass --memory-subject-key: ${matches
      .map((match) => match.memorySubjectKey)
      .join(", ")}`,
  );
}

async function runMemorySearchCliFromEnvironment(
  argv: string[],
): Promise<void> {
  const args = parseMemorySearchArguments(argv);
  // Both the subjects and the index come from TeamHub's database.
  const chunkIndex = createMemoryChunkIndexFromEnvironment(
    args.options.memoryRoot,
  );
  try {
    await runMemorySearchCli(args, { chunkSearch: chunkIndex });
  } finally {
    await chunkIndex.close();
  }
}
