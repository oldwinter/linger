import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const featuresRoot = join(srcRoot, "features");

const I18N_HOOK_PATTERN = /\b(?:useT|useTranslation)\s*\(/u;
const INLINE_HEX_STYLE_PATTERN =
  /style\s*=\s*\{\{[^}]*?\b(?:color|background|backgroundColor|border|borderColor|fill|stroke)\s*:\s*["']#[0-9a-fA-F]{3,8}["']/u;

describe("UI polish regression guardrails", () => {
  it("keeps every feature *-page.tsx wired to i18n", async () => {
    const pageFiles = await collectPageFiles(featuresRoot);
    const missing: string[] = [];
    for (const page of pageFiles) {
      const source = await readFile(join(featuresRoot, page), "utf8");
      if (!hasI18nHook(source)) {
        missing.push(`features/${page}`);
      }
    }
    expect(
      missing,
      "Every feature *-page.tsx must stay wired to `useT()` or `useTranslation()` instead of reverting to hardcoded prose.",
    ).toEqual([]);
  });

  it("forbids raw inline style hex color literals in feature *-page.tsx files", async () => {
    const pageFiles = await collectPageFiles(featuresRoot);
    const violations = (
      await Promise.all(
        pageFiles.map(async (page) => {
          const source = await readFile(join(featuresRoot, page), "utf8");
          return findInlineHexStyleViolations(source).map(
            (line) => `features/${page}:${line}`,
          );
        }),
      )
    )
      .flat()
      .sort();

    expect(
      violations,
      "Use semantic design tokens and Tailwind classes instead of inline `style={{ color: '#...' }}` hex literals in `*-page.tsx` files.",
    ).toEqual([]);
  });
});

describe("UI polish guardrail detectors", () => {
  it("detects inline hex color styles and allows token-based or runtime-computed styles", () => {
    const bad = [
      "export function BadPage() {",
      '  return <p style={{ color: "#ff0000" }}>Error</p>;',
      "}",
    ].join("\n");
    expect(findInlineHexStyleViolations(bad)).toEqual([2]);

    const good = [
      "export function GoodPage({ width }: { width: string }) {",
      '  return <div style={{ width }} className="text-app-danger" />;',
      "}",
    ].join("\n");
    expect(findInlineHexStyleViolations(good)).toEqual([]);
  });

  it("checks whether a page component uses useT or useTranslation", () => {
    expect(hasI18nHook("const t = useT();")).toBe(true);
    expect(hasI18nHook("const { t } = useTranslation();")).toBe(true);
    expect(hasI18nHook("export function Page() { return <p>Hi</p>; }")).toBe(
      false,
    );
  });
});

function hasI18nHook(source: string): boolean {
  return I18N_HOOK_PATTERN.test(source);
}

function findInlineHexStyleViolations(source: string): number[] {
  const lines = source.split("\n");
  const violations: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (INLINE_HEX_STYLE_PATTERN.test(lines[index]!)) {
      violations.push(index + 1);
    }
  }
  return violations;
}

async function collectPageFiles(dir: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectPageFiles(join(dir, entry.name), path)));
      continue;
    }
    if (entry.name.endsWith("-page.tsx")) {
      files.push(path);
    }
  }
  return files.sort();
}
