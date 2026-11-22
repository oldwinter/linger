import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const featuresRoot = join(srcRoot, "features");

const FORBIDDEN_PLACEHOLDER_TOKEN =
  /\bplaceholder:text-(?:muted-foreground|app-muted)\b/u;
const BLOCKING_BROWSER_DIALOG =
  /\b(?:window|globalThis)\.(?:confirm|alert|prompt)\s*\(/u;
const ARBITRARY_HEX_CLASS = /\b(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\b/u;
const POSITION_UTILITY = /(?:^|\s)(?:[a-z0-9-]+:)*(?:absolute|fixed)(?=\s|$)/u;

describe("design-system guardrails", () => {
  it("uses placeholder:text-app-placeholder instead of muted text tokens", async () => {
    const violations = await scanFiles(srcRoot, /\.tsx$/u, (file, text) =>
      matchingLines(file, text, FORBIDDEN_PLACEHOLDER_TOKEN),
    );
    expect(
      violations,
      "Use `placeholder:text-app-placeholder` instead of `placeholder:text-muted-foreground` or `placeholder:text-app-muted`.",
    ).toEqual([]);
  });

  it("never passes competing absolute or fixed positioning directly on <Button>", async () => {
    const violations = await scanFiles(srcRoot, /\.tsx$/u, (file, text) =>
      findButtonPositionViolations(text).map((line) => `${file}:${line}`),
    );
    expect(
      violations,
      "Do not pass `absolute` or `fixed` in `<Button className=...>` because Button hardcodes `relative`; place positioning on a wrapper element instead.",
    ).toEqual([]);
  });

  it("forbids blocking window.confirm, window.alert, and window.prompt calls in feature code", async () => {
    const violations = await scanFiles(
      featuresRoot,
      /\.(ts|tsx)$/u,
      (file, text) =>
        matchingLines(`features/${file}`, text, BLOCKING_BROWSER_DIALOG),
    );
    expect(
      violations,
      "Use ModalDialog instead of blocking `window.confirm`, `window.alert`, or `window.prompt` calls in feature code.",
    ).toEqual([]);
  });

  it("forbids hardcoded Tailwind arbitrary hex colors in feature TSX files", async () => {
    const violations = await scanFiles(featuresRoot, /\.tsx$/u, (file, text) =>
      matchingLines(`features/${file}`, text, ARBITRARY_HEX_CLASS),
    );
    expect(
      violations,
      "Use semantic tokens from visual-theme.css and globals.css instead of arbitrary hex utilities (`bg-[#...]`, `text-[#...]`, `border-[#...]`).",
    ).toEqual([]);
  });
});

describe("design-system guardrail detectors", () => {
  it("detects competing position utilities on <Button> even across multiline props", () => {
    const sample = [
      "export function Bad() {",
      "  return (",
      "    <Button",
      "      onClick={() => console.log('x > y')}",
      '      className="top-2 right-2 absolute"',
      "    >",
      "      Close",
      "    </Button>",
      "  );",
      "}",
    ].join("\n");
    expect(findButtonPositionViolations(sample)).toEqual([5]);
  });

  it("allows positioning on a wrapper around <Button> and safe Button classes", () => {
    const sample = [
      "export function Good() {",
      "  return (",
      '    <div className="absolute right-2 top-2">',
      '      <Button className="w-full" onClick={() => undefined}>',
      '        <span className="fixed inset-0" />',
      "      </Button>",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    expect(findButtonPositionViolations(sample)).toEqual([]);
  });
});

async function scanFiles(
  root: string,
  extensionPattern: RegExp,
  check: (relativePath: string, text: string) => string[],
): Promise<string[]> {
  const files = await productionSourceFiles(root, extensionPattern);
  const results = await Promise.all(
    files.map(async (file) =>
      check(file, await readFile(join(root, file), "utf8")),
    ),
  );
  return results.flat().sort();
}

async function productionSourceFiles(
  dir: string,
  extensionPattern: RegExp,
  prefix = "",
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (path === "test") continue;
      files.push(
        ...(await productionSourceFiles(
          join(dir, entry.name),
          extensionPattern,
          path,
        )),
      );
      continue;
    }
    if (!extensionPattern.test(entry.name) || /\.test\./u.test(entry.name)) {
      continue;
    }
    files.push(path);
  }
  return files;
}

function matchingLines(file: string, text: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index]!)) {
      matches.push(`${file}:${index + 1}`);
    }
  }
  return matches;
}

/**
 * Returns 1-based line numbers where a `<Button ...>` opening tag passes a
 * static `absolute` or `fixed` class in its own `className` prop.
 */
function findButtonPositionViolations(source: string): number[] {
  const violations: number[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<Button", cursor);
    if (start === -1) break;
    const afterName = source[start + "<Button".length];
    if (!afterName || !/[\s/>]/u.test(afterName)) {
      cursor = start + "<Button".length;
      continue;
    }
    const parsed = inspectButtonOpeningTag(source, start + "<Button".length);
    if (parsed.violationOffset !== null) {
      violations.push(lineNumberAt(source, parsed.violationOffset));
    }
    cursor = parsed.nextIndex;
  }
  return violations;
}

function inspectButtonOpeningTag(
  source: string,
  start: number,
): { nextIndex: number; violationOffset: number | null } {
  let index = start;
  let braceDepth = 0;
  let violationOffset: number | null = null;

  while (index < source.length) {
    const char = source[index]!;

    if (braceDepth === 0 && source.startsWith("className", index)) {
      const before = source[index - 1] ?? " ";
      const attrStart = index;
      const afterName = index + "className".length;
      if (/[\s]/u.test(before)) {
        const value = readStaticClassName(source, afterName);
        if (value !== null) {
          if (POSITION_UTILITY.test(value.text)) {
            violationOffset = attrStart;
          }
          index = value.nextIndex;
          continue;
        }
      }
    }

    if (char === '"' || char === "'" || char === "`") {
      index = skipStringLiteral(source, index, char);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === ">" && braceDepth === 0) {
      return { nextIndex: index + 1, violationOffset };
    }
    index += 1;
  }

  return { nextIndex: source.length, violationOffset };
}

function readStaticClassName(
  source: string,
  start: number,
): { nextIndex: number; text: string } | null {
  let index = skipWhitespace(source, start);
  if (source[index] !== "=") return null;
  index = skipWhitespace(source, index + 1);

  const quote = source[index];
  if (quote === '"' || quote === "'") {
    const end = skipStringLiteral(source, index, quote);
    return { nextIndex: end, text: source.slice(index + 1, end - 1) };
  }

  if (quote === "{") {
    const innerStart = skipWhitespace(source, index + 1);
    const innerQuote = source[innerStart];
    if (innerQuote === '"' || innerQuote === "'" || innerQuote === "`") {
      const stringEnd = skipStringLiteral(source, innerStart, innerQuote);
      const afterString = skipWhitespace(source, stringEnd);
      if (source[afterString] === "}") {
        return {
          nextIndex: afterString + 1,
          text: source.slice(innerStart + 1, stringEnd - 1),
        };
      }
    }
  }

  return null;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/u.test(source[index]!)) {
    index += 1;
  }
  return index;
}

function skipStringLiteral(
  source: string,
  start: number,
  quote: string,
): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}
