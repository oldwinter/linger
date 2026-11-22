import { createHash } from "node:crypto";

import { extractDocumentImages } from "@linger/document-files";
import { describe, expect, it } from "vitest";

import { normalizeDocumentContent } from "../../src/document-normalizer/document-normalizer-core.js";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array): string => new TextDecoder().decode(value);

describe("fenced document source content", () => {
  it.each([
    ["example.py", "text/x-python", "python", "```"],
    ["example.yaml", "application/yaml", "yaml", "````"],
    ["example.xml", "application/xml", "xml", "`````"],
  ])(
    "keeps a source fence inside the code block: %s",
    async (filename, mediaType, language, embeddedFence) => {
      const source = `before\n${embeddedFence}\n# Literal heading\n${embeddedFence}\nafter`;
      const content = await normalizeDocumentContent({
        filename,
        mediaType,
        source: encode(source),
      });
      const fence = "`".repeat(embeddedFence.length + 1);
      expect(decode(content)).toBe(
        `${fence}${language}\n${source}\n${fence}\n`,
      );
    },
  );

  it("keeps image syntax in imported code out of image extraction", async () => {
    const source =
      'example = """\n```\n![Diagram](data:image/gif;base64,R0lGODlh)\n```\n"""';
    const content = await normalizeDocumentContent({
      filename: "example.py",
      mediaType: "text/x-python",
      source: encode(source),
    });
    const result = extractDocumentImages({
      filePath: "example.md",
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
      sizeBytes: content.byteLength,
    });
    expect(result.files.size).toBe(0);
    expect(decode(result.content)).toContain(source);
  });

  it.each(["example.custom`type", "example.custom\ntype"])(
    "keeps an invalid fence language from changing the block boundary: %s",
    async (filename) => {
      await expect(
        normalizeDocumentContent({
          filename,
          mediaType: "text/javascript",
          source: encode("const value = 1;"),
        }).then(decode),
      ).resolves.toBe("```text\nconst value = 1;\n```\n");
    },
  );

  it("keeps ordinary code fences unchanged", async () => {
    await expect(
      normalizeDocumentContent({
        filename: "example.py",
        mediaType: "text/x-python",
        source: encode("print('hello')\n"),
      }).then(decode),
    ).resolves.toBe("```python\nprint('hello')\n```\n");
  });
});
