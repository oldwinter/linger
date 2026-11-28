import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

const ZERO_CYCLE_ROOTS = [
  "packages/document-model/src",
  "packages/document-files/src",
  "packages/service-kit/src",
  "packages/local-installation/src",
  "apps/teamhub-cli/src",
  "apps/desktop/src/main",
  "apps/linger-installer/src",
  "apps/voice-runtime/src",
] as const;

// Ratcheted legacy circular-import clusters in apps/node-services/src.
// All other roles (document, document-normalizer, llm-wiki, voice) and all
// new modules must remain acyclic; shrinking or deleting these sets is welcome,
// growing them fails CI.
const LEGACY_NODE_SERVICES_CYCLES: readonly (readonly string[])[] = [
  ["memory/daily-cli.ts", "memory/day-read.ts"],
  [
    "agent/agent-features/agent-memory/client.ts",
    "agent/agent-features/agent-memory/coordinator.ts",
    "agent/agent-features/agent-memory/feature.ts",
    "agent/agent-features/agent-memory/projection.ts",
    "agent/agent-features/builtin.ts",
    "agent/agent-features/catalog.generated.ts",
    "agent/agent-features/compose.ts",
    "agent/agent-features/context-instructions/feature.ts",
    "agent/agent-features/context-restart/feature.ts",
    "agent/agent-features/contracts.ts",
    "agent/agent-features/emoji-reaction/feature.ts",
    "agent/agent-features/flashback/feature.ts",
    "agent/agent-features/flashback/index.ts",
    "agent/agent-features/flashback/session.ts",
    "agent/agent-features/host-ports.ts",
    "agent/agent-features/inbox-source/feature.ts",
    "agent/agent-features/notification-context/feature.ts",
    "agent/agent-features/proactive/feature.ts",
    "agent/agent-features/reply-rhythm/feature.ts",
    "agent/agent-features/room-reply-guard/feature.ts",
    "agent/agent-features/run-status/feature.ts",
    "agent/agent-features/task-input/feature.ts",
    "agent/agent-features/task-progress/feature.ts",
    "agent/agent-features/tool-approval/feature.ts",
    "agent/agent-features/user-memory-update/feature.ts",
    "agent/agent-features/user-memory-update/index.ts",
    "agent/agent-features/user-memory/feature.ts",
    "agent/agent-features/user-memory/index.ts",
    "agent/executor/activation.ts",
    "agent/executor/local-backend.ts",
    "agent/prompt/index.ts",
    "agent/prompt/input-contribution-merger.ts",
    "agent/prompt/static-prefixes.ts",
    "agent/runner-gateway/agent-runner-lifecycle.ts",
    "agent/runner-gateway/context-view-content.ts",
    "agent/runner-gateway/local-computer-management.ts",
    "agent/runner-gateway/local-computer-registry.ts",
    "agent/runner-gateway/local-mcp-relay.ts",
    "agent/runner-gateway/model-queue.ts",
    "agent/runner-gateway/remote-codex-provider.ts",
    "agent/runner-gateway/runner-cli-credentials.ts",
    "agent/runner-gateway/runner-computer-tools.ts",
    "agent/runner-gateway/runner-connections.ts",
    "agent/runner-gateway/runner-debug-inspection.ts",
    "agent/runner-gateway/runner-gateway-context.ts",
    "agent/runner-gateway/runner-gateway.ts",
    "agent/runner-gateway/runner-herdr-core.ts",
    "agent/runner-gateway/runner-local-capabilities.ts",
    "agent/runner-gateway/runner-local-models.ts",
    "agent/runner-gateway/runner-local-speech.ts",
    "agent/runner-gateway/runner-model-invocation.ts",
    "agent/runner-gateway/runner-operation-preparation.ts",
    "agent/runner-gateway/runner-operations.ts",
    "agent/runner-gateway/runner-session-compaction.ts",
    "agent/runtime-settings.ts",
  ],
];

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.")
    ) {
      out.push(full);
    }
  }
  return out;
}

function findCircularImportClusters(relativeRoot: string): string[][] {
  const absRoot = path.join(repoRoot, relativeRoot);
  const files = walkSourceFiles(absRoot);
  const fileSet = new Set(files);
  const adjacency = new Map<string, string[]>();

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      false,
    );
    const edges = new Set<string>();
    for (const statement of sourceFile.statements) {
      if (
        (ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const specifier = statement.moduleSpecifier.text;
        if (!specifier.startsWith(".")) continue;
        const base = path.resolve(
          path.dirname(file),
          specifier.replace(/\.(js|jsx|mjs|cjs)$/, ""),
        );
        const resolved = [
          `${base}.ts`,
          `${base}.tsx`,
          path.join(base, "index.ts"),
          path.join(base, "index.tsx"),
        ].find((candidate) => fileSet.has(candidate));
        if (resolved && resolved !== file) edges.add(resolved);
      }
    }
    adjacency.set(file, [...edges]);
  }

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const clusters: string[][] = [];

  function strongConnect(node: string): void {
    indices.set(node, nextIndex);
    lowLink.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor);
        lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lowLink.set(node, Math.min(lowLink.get(node)!, indices.get(neighbor)!));
      }
    }

    if (lowLink.get(node) === indices.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(path.relative(absRoot, member).replace(/\\/g, "/"));
      } while (member !== node);
      if (component.length > 1) clusters.push(component.sort());
    }
  }

  for (const file of files) {
    if (!indices.has(file)) strongConnect(file);
  }
  return clusters.sort((left, right) => left[0]!.localeCompare(right[0]!));
}

describe("TypeScript circular import boundaries", () => {
  it.each(ZERO_CYCLE_ROOTS)("keeps %s free of circular imports", (root) => {
    expect(findCircularImportClusters(root)).toEqual([]);
  });

  it("prevents new circular imports in apps/node-services/src", () => {
    const allowedMembers = LEGACY_NODE_SERVICES_CYCLES.map(
      (cluster) => new Set(cluster),
    );
    const unexpected = findCircularImportClusters(
      "apps/node-services/src",
    ).filter(
      (cluster) =>
        !allowedMembers.some((allowed) =>
          cluster.every((file) => allowed.has(file)),
        ),
    );
    expect(unexpected).toEqual([]);
  });
});
