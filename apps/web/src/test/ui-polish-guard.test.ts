import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const featuresRoot = join(srcRoot, "features");

const I18N_HOOK_PATTERN = /\b(?:useT|useTranslation)\s*\(/u;
const INLINE_HEX_STYLE_PATTERN =
  /style\s*=\s*\{\{[^}]*?\b(?:color|background|backgroundColor|border|borderColor|fill|stroke)\s*:\s*["']#[0-9a-fA-F]{3,8}["']/u;

const REQUIRED_LOCALIZED_PAGES = [
  "apps/connected-apps-page.tsx",
  "apps/oauth-complete-page.tsx",
  "auth/teamhub-login-page.tsx",
  "library/library-documents-page.tsx",
  "local-computer/computer-can-do-page.tsx",
  "local-computer/computers-page.tsx",
  "local-computer/connect-computer-page.tsx",
  "local-models/local-models-page.tsx",
  "memory/meeting-page.tsx",
  "memory/wiki-graph-page.tsx",
  "rooms/documents/mark-moment-page.tsx",
  "rooms/documents/shared-document-page.tsx",
  "rooms/members/agent-can-do-page.tsx",
  "rooms/quick-create-general-agent-page.tsx",
  "rooms/room-empty-page.tsx",
  "rooms/sharing/shared-room-history-page.tsx",
  "rooms/voice-control/hearing-page.tsx",
  "rooms/voice-control/who-is-speaking-page.tsx",
  "settings/account-settings-page.tsx",
  "settings/language-settings-page.tsx",
  "settings/my-rules-page.tsx",
  "settings/rule-next-page.tsx",
  "settings/security-settings-page.tsx",
  "settings/settings-page.tsx",
  "settings/shadow-rule-review-page.tsx",
  "settings/shortcuts-settings-page.tsx",
  "wiki/wiki-collection-page.tsx",
  "wiki/wiki-home-page.tsx",
  "wiki/wiki-preview-page.tsx",
  "wiki/wiki-profile-page.tsx",
  "work-items/work-item-pair-page.tsx",
  "work-items/work-item-story-page.tsx",
  "work-items/work-items-page.tsx",
] as const;

describe("UI polish regression guardrails", () => {
  it("keeps computer-can-do, voice/doc subpages, and core feature pages wired to i18n", async () => {
    const missing: string[] = [];
    for (const page of REQUIRED_LOCALIZED_PAGES) {
      const source = await readFile(join(featuresRoot, page), "utf8");
      if (!hasI18nHook(source)) {
        missing.push(`features/${page}`);
      }
    }
    expect(
      missing,
      "Localized feature pages must remain wired to `useT()` or `useTranslation()` instead of reverting to hardcoded prose.",
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
