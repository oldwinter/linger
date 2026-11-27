import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Legacy feature/component CSS files that predate the Tailwind-only rule in
 * apps/web/AGENTS.md. No new `.css` or `.module.css` file may be added outside
 * `src/app/`; remove entries as legacy stylesheets are retired.
 */
const LEGACY_FEATURE_CSS_FILES = new Set([
  "components/knowledge-document.css",
  "components/read-only-blocknote-document.css",
  "features/memory/meeting-page.css",
  "features/memory/wiki-knowledge-graph.css",
  "features/rooms/agent-creation-progress.module.css",
  "features/rooms/chat/direct-agent-model-switch.css",
  "features/rooms/chat/message-markdown.css",
  "features/rooms/chat/voice-mode/voice-mode.module.css",
  "features/rooms/documents/room-document-blocknote.css",
  "features/rooms/documents/room-document-mermaid-code-block.css",
  "features/rooms/mermaid-svg-preview.css",
  "features/rooms/voice-control/voice-focus.module.css",
  "features/wiki/wiki-home-page.css",
  "features/wiki/wiki-profile-page.css",
  "features/wiki/wiki-working-card.css",
]);

/**
 * Documented Runtime activity files that retain `lucide-react` icons per
 * apps/web/AGENTS.md. All other UI icons must use `@hugeicons/core-free-icons`.
 */
const ALLOWED_LUCIDE_FILES = new Set([
  "features/rooms/runtime-status/runtime-tool-presentation.ts",
  "features/rooms/task-sidebar/adapters/runtime-history-view.tsx",
]);

/**
 * Known legacy circular import clusters (identified by their sorted member
 * list). New circular imports anywhere in `apps/web/src/` fail the test; remove
 * entries as remaining clusters are decoupled.
 */
const LEGACY_CYCLE_CLUSTERS: readonly (readonly string[])[] = [
  [
    "features/rooms/chat/direct-room-message",
    "features/rooms/chat/message-composer",
    "features/rooms/chat/use-composer-attachments",
    "features/rooms/chat/use-composer-document-paste",
    "features/rooms/chat/use-composer-draft",
    "features/rooms/chat/use-composer-history",
    "features/rooms/chat/use-composer-keydown",
    "features/rooms/chat/use-composer-picker",
    "features/rooms/chat/use-composer-quote-reply",
    "features/rooms/chat/use-composer-reference-insertion",
    "features/rooms/chat/use-composer-send",
    "features/rooms/chat/use-composer-textarea",
    "features/rooms/chat/use-composer-voice",
    "features/rooms/chat/voice-mode/live/voice-live-arbiter",
    "features/rooms/chat/voice-mode/voice-material-composition",
    "features/rooms/chat/voice-mode/voice-mode-controls",
    "features/rooms/chat/voice-mode/voice-mode-room-sender",
    "features/rooms/chat/voice-mode/voice-mode-session",
    "features/rooms/chat/voice-mode/voice-mode-session-engine",
  ],
  [
    "features/rooms/documents/room-document-blocknote-editor",
    "features/rooms/documents/room-document-clipboard-link",
    "features/rooms/documents/room-document-slash-menu",
  ],
  [
    "features/rooms/documents/room-document-comment-schema",
    "features/rooms/documents/room-document-image-preview",
  ],
];

const STATIC_IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gu;

describe("web architecture boundaries", () => {
  it("prevents features/teamhub from importing UI feature modules", async () => {
    const files = await walkSourceFiles(srcRoot);
    const violations: string[] = [];

    for (const file of files) {
      if (!file.startsWith("features/teamhub/") || isTestFile(file)) continue;
      const content = await readFile(path.join(srcRoot, file), "utf8");
      for (const spec of extractImportSpecifiers(content)) {
        const resolved = resolveInternalModule(file, spec);
        if (
          resolved?.startsWith("features/") &&
          !resolved.startsWith("features/teamhub/")
        ) {
          violations.push(`${file} -> ${spec}`);
        }
      }
    }

    expect(
      violations,
      "features/teamhub is the core TeamHub adapter layer and must not depend on UI feature modules.",
    ).toEqual([]);
  });

  it("blocks new feature-level CSS files outside src/app/", async () => {
    const cssFiles = await walkFilesByExtension(srcRoot, ".css");
    const nonAppCss = cssFiles.filter((file) => !file.startsWith("app/"));
    const unexpected = nonAppCss.filter(
      (file) => !LEGACY_FEATURE_CSS_FILES.has(file),
    );
    const staleAllowlist = [...LEGACY_FEATURE_CSS_FILES].filter(
      (file) => !nonAppCss.includes(file),
    );

    expect(
      unexpected,
      "Do not add CSS Modules or feature-level .css files outside src/app/.",
    ).toEqual([]);
    expect(
      staleAllowlist,
      "Remove retired stylesheets from LEGACY_FEATURE_CSS_FILES.",
    ).toEqual([]);
  });

  it("restricts lucide-react imports to the documented Runtime activity views", async () => {
    const files = await walkSourceFiles(srcRoot);
    const lucideImporters: string[] = [];

    for (const file of files) {
      if (isTestFile(file)) continue;
      const content = await readFile(path.join(srcRoot, file), "utf8");
      if (extractImportSpecifiers(content).includes("lucide-react")) {
        lucideImporters.push(file);
      }
    }

    expect(lucideImporters.sort()).toEqual([...ALLOWED_LUCIDE_FILES].sort());
  });

  it("prevents new circular import clusters across apps/web/src", async () => {
    const files = (await walkSourceFiles(srcRoot)).filter(
      (file) => !isTestFile(file),
    );
    const moduleIds = new Set(files.map(stripExtension));
    const edges = new Map<string, Set<string>>();

    for (const file of files) {
      const fromId = stripExtension(file);
      const targets = new Set<string>();
      const content = await readFile(path.join(srcRoot, file), "utf8");
      for (const spec of extractImportSpecifiers(content)) {
        const target = resolveInternalModule(file, spec);
        if (!target) continue;
        const normalized = stripExtension(target);
        if (moduleIds.has(normalized) && normalized !== fromId) {
          targets.add(normalized);
        } else if (moduleIds.has(`${normalized}/index`)) {
          targets.add(`${normalized}/index`);
        }
      }
      edges.set(fromId, targets);
    }

    const found = findStronglyConnectedComponents(edges)
      .filter((scc) => scc.length > 1)
      .map((scc) => scc.sort())
      .sort((a, b) => a[0]!.localeCompare(b[0]!));

    const allowedKeys = new Set(
      LEGACY_CYCLE_CLUSTERS.map((cluster) => [...cluster].sort().join("|")),
    );
    const unexpected = found.filter((scc) => !allowedKeys.has(scc.join("|")));

    expect(
      unexpected,
      "New circular import cluster introduced in apps/web/src.",
    ).toEqual([]);

    const foundKeys = new Set(found.map((scc) => scc.join("|")));
    const stale = LEGACY_CYCLE_CLUSTERS.filter(
      (cluster) => !foundKeys.has([...cluster].sort().join("|")),
    );
    expect(
      stale,
      "Remove resolved circular import clusters from LEGACY_CYCLE_CLUSTERS.",
    ).toEqual([]);
  });
});

function isTestFile(relativePath: string): boolean {
  return (
    relativePath.startsWith("test/") ||
    /\.test\.(ts|tsx)$/u.test(relativePath) ||
    /\.spec\.(ts|tsx)$/u.test(relativePath)
  );
}

function stripExtension(relativePath: string): string {
  return relativePath.replace(/\.(ts|tsx|mjs|js)$/u, "");
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(STATIC_IMPORT_RE)) {
    const spec = match[1];
    if (spec) specifiers.push(spec);
  }
  return specifiers;
}

function resolveInternalModule(
  fromRelativePath: string,
  specifier: string,
): string | null {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }
  if (specifier.startsWith(".")) {
    const joined = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromRelativePath), specifier),
    );
    if (joined.startsWith("..")) return null;
    return joined;
  }
  return null;
}

async function walkSourceFiles(
  directory: string,
  prefix = "",
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(
        ...(await walkSourceFiles(path.join(directory, entry.name), relative)),
      );
    } else if (
      /\.(ts|tsx)$/u.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      results.push(relative);
    }
  }
  return results;
}

async function walkFilesByExtension(
  directory: string,
  extension: string,
  prefix = "",
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(
        ...(await walkFilesByExtension(
          path.join(directory, entry.name),
          extension,
          relative,
        )),
      );
    } else if (entry.name.endsWith(extension)) {
      results.push(relative);
    }
  }
  return results;
}

function findStronglyConnectedComponents(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(node: string) {
    indices.set(node, nextIndex);
    lowLink.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!indices.has(neighbor)) {
        visit(neighbor);
        lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lowLink.set(node, Math.min(lowLink.get(node)!, indices.get(neighbor)!));
      }
    }

    if (lowLink.get(node) === indices.get(node)) {
      const component: string[] = [];
      for (;;) {
        const member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      components.push(component);
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return components;
}
