// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const webSrcRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function collectStaticImportSpecifiers(filePath: string): string[] {
  const sourceText = readFileSync(filePath, "utf8");
  const scriptKind = filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    scriptKind,
  );
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (!clause) {
        // Side-effect import (e.g. CSS or font packages).
        specifiers.push(statement.moduleSpecifier.text);
        continue;
      }
      if (clause.isTypeOnly) continue;
      const hasValueDefault = clause.name !== undefined;
      const bindings = clause.namedBindings;
      const hasValueBinding =
        bindings !== undefined &&
        (ts.isNamespaceImport(bindings) ||
          bindings.elements.some((element) => !element.isTypeOnly));
      if (hasValueDefault || hasValueBinding) {
        specifiers.push(statement.moduleSpecifier.text);
      }
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.exportClause;
      const hasValueExport =
        !clause ||
        ts.isNamespaceExport(clause) ||
        clause.elements.some((element) => !element.isTypeOnly);
      if (hasValueExport) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
  }

  return specifiers;
}

function resolveLocalModule(
  fromFile: string,
  specifier: string,
): string | undefined {
  let basePath: string | undefined;
  if (specifier.startsWith("@/")) {
    basePath = resolve(webSrcRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    basePath = resolve(dirname(fromFile), specifier);
  } else {
    return undefined;
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    resolve(basePath, "index.ts"),
    resolve(basePath, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function walkStaticInitialClosure(entryFile: string): {
  externalPackages: Set<string>;
  localFiles: Set<string>;
} {
  const localFiles = new Set<string>();
  const externalPackages = new Set<string>();
  const queue = [entryFile];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const rel = relative(webSrcRoot, current).replaceAll("\\", "/");
    if (localFiles.has(rel)) continue;
    localFiles.add(rel);

    for (const specifier of collectStaticImportSpecifiers(current)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
        externalPackages.add(specifier);
        continue;
      }
      const resolved = resolveLocalModule(current, specifier);
      if (resolved && /\.(?:ts|tsx|js|mjs)$/u.test(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return { externalPackages, localFiles };
}

describe("Web initial entry static import closure", () => {
  it("keeps deferred routes, transfer verifiers, and logout/voice-DOM helpers off the initial graph", () => {
    const { externalPackages, localFiles } = walkStaticInitialClosure(
      resolve(webSrcRoot, "main.tsx"),
    );

    const forbiddenLocalFiles = [
      "features/apps/oauth-complete-page.tsx",
      "features/apps/connectors.messages.ts",
      "features/auth/local-authenticated-state.ts",
      "features/memory/meetings-calendar.ts",
      "features/memory/meetings.messages.ts",
      "features/memory/up-next.ts",
      "features/rooms/chat/room-message-outbox.ts",
      "features/rooms/chat/voice-mode/voice-ui-bridge.ts",
      "features/rooms/room-drafts.ts",
      "features/teamhub/teamhub-artifact-download.ts",
      "features/teamhub/teamhub-personal-wiki-client.ts",
      "features/work-items/work-item-dashboard-filters.ts",
      "features/work-items/work-item-queries.ts",
      "features/work-items/work-items.messages.ts",
    ];

    const leakedLocalFiles = forbiddenLocalFiles.filter((file) =>
      localFiles.has(file),
    );
    expect(leakedLocalFiles).toEqual([]);

    const leakedCryptoPackages = [...externalPackages].filter((pkg) =>
      pkg.startsWith("@noble/hashes"),
    );
    expect(leakedCryptoPackages).toEqual([]);
  });
});
