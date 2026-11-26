import { describe, expect, it } from "vitest";

import {
  isSupportedHighlightLanguage,
  normalizeCodeLanguage,
  tokenizeCode,
} from "./code-block-highlight";

describe("code-block-highlight", () => {
  it("normalizes language hints and recognizes all supported languages", () => {
    expect(normalizeCodeLanguage("language-TSX")).toBe("tsx");
    expect(normalizeCodeLanguage("  Python ")).toBe("python");
    expect(normalizeCodeLanguage("")).toBeUndefined();

    for (const lang of [
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "python",
      "go",
      "sh",
      "bash",
      "zsh",
      "shell",
      "json",
      "yaml",
      "yml",
      "sql",
      "css",
      "html",
      "xml",
      "rust",
      "rs",
    ]) {
      expect(isSupportedHighlightLanguage(lang), lang).toBe(true);
    }
    expect(isSupportedHighlightLanguage("mermaid")).toBe(false);
    expect(isSupportedHighlightLanguage("text")).toBe(false);
  });

  it("tokenizes TypeScript keywords, types, strings, numbers, and comments without losing text", () => {
    const sample = [
      "// greeting helper",
      "export function greet(name: string): Promise<number> {",
      '  const msg = "hello";',
      "  return Promise.resolve(42);",
      "}",
    ].join("\n");
    const tokens = tokenizeCode(sample, "ts");
    expect(tokens.map((token) => token.value).join("")).toBe(sample);
    expect(tokens).toEqual(
      expect.arrayContaining([
        { kind: "comment", value: "// greeting helper" },
        { kind: "keyword", value: "export" },
        { kind: "keyword", value: "function" },
        { kind: "type", value: "string" },
        { kind: "type", value: "Promise" },
        { kind: "string", value: '"hello"' },
        { kind: "number", value: "42" },
      ]),
    );
  });

  it("tokenizes Python, Go, Rust, SQL, JSON, YAML, Shell, CSS, and HTML losslessly", () => {
    const samples: ReadonlyArray<[string, string]> = [
      ["python", '# note\ndef run(x: int) -> str:\n    return "ok"\n'],
      ["go", "package main\nfunc main() { count := 10 }\n"],
      ["rust", "pub fn add(a: i32, b: i32) -> i32 { a + b }\n"],
      ["sql", "-- query\nSELECT id, name FROM rooms WHERE active = TRUE;\n"],
      ["json", '{\n  "enabled": true,\n  "count": 3\n}\n'],
      ["yaml", "# cfg\nname: linger\nenabled: true\nport: 8080\n"],
      ["bash", '# run\nexport PORT=3000\necho "$PORT"\n'],
      ["css", ".box { color: #1a1a16; padding: 12px; }\n"],
      ["html", '<!-- hi --><div class="card">Hello</div>'],
    ];

    for (const [language, source] of samples) {
      const tokens = tokenizeCode(source, language);
      expect(tokens.map((token) => token.value).join(""), language).toBe(
        source,
      );
      expect(
        tokens.some((token) => token.kind !== "plain"),
        `${language} should emit semantic tokens`,
      ).toBe(true);
    }
  });

  it("falls back to plain text for unknown languages or oversized inputs", () => {
    expect(tokenizeCode("hello world", "unknown")).toEqual([
      { kind: "plain", value: "hello world" },
    ]);
    const huge = "const a = 1;\n".repeat(5_000);
    expect(tokenizeCode(huge, "ts")).toEqual([{ kind: "plain", value: huge }]);
  });
});
