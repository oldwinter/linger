import { describe, expect, it, vi } from "vitest";

import { normalizeDocumentContent } from "../../src/document-normalizer/document-normalizer-core.js";
import { WorkerDocumentNormalizer } from "../../src/document-normalizer/document-normalizer.js";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array): string => new TextDecoder().decode(value);
const html = (value: string) => ({
  filename: "notes.html",
  mediaType: "text/html",
  source: encode(value),
});
const convert = (value: string) =>
  normalizeDocumentContent(html(value)).then(decode);

describe("HTML document structure", () => {
  it("keeps identifiers and addresses together across inline elements", async () => {
    await expect(
      convert(
        "<p>Email: agent@example<span>.com</span>; key: order_<span>42</span>.</p>",
      ),
    ).resolves.toBe("Email: agent@example.com; key: order_42.\n");
  });

  it("retains link targets and nested ordered and unordered lists", async () => {
    await expect(
      convert(
        '<p>See <a href="https://example.test/spec?q=a&amp;b=2">the spec</a>.</p><ol><li>First<ul><li>Nested</li></ul></li><li>Second</li></ol>',
      ),
    ).resolves.toBe(
      "See [the spec](https://example.test/spec?q=a&b=2).\n\n1. First\n    - Nested\n2. Second\n",
    );
  });

  it("retains table rows and their column relationships", async () => {
    await expect(
      convert(
        "<table><tr><th>Item</th><th>USD</th></tr><tr><td>Widget</td><td>37.50</td></tr></table>",
      ),
    ).resolves.toBe("| Item | USD |\n| --- | --- |\n| Widget | 37.50 |\n");
  });

  it.each(["", "\uFEFF"])(
    "keeps UTF-8 text and a possible BOM despite stale HTML charset metadata",
    async (prefix) => {
      await expect(
        convert(
          `${prefix}<meta charset="windows-1252"><p>Caf\u00e9 \u20ac</p>`,
        ),
      ).resolves.toBe("Caf\u00e9 \u20ac\n");
    },
  );

  it("preserves indentation and blank lines in a code block", async () => {
    await expect(
      convert(
        "<pre><code>  const total = 12;\n\n    return total;\n</code></pre>",
      ),
    ).resolves.toBe("```\n  const total = 12;\n\n    return total;\n\n```\n");
  });

  it("uses the bounded worker executor for HTML while plain text stays in process", async () => {
    const execute = vi.fn(async () => encode("worker result\n"));
    const normalizer = new WorkerDocumentNormalizer({ execute });
    await expect(
      normalizer.normalizeDocument(html("<p>Hello</p>")).then(decode),
    ).resolves.toBe("worker result\n");
    expect(execute).toHaveBeenCalledOnce();
    await expect(
      normalizer
        .normalizeDocument({
          filename: "notes.txt",
          mediaType: "text/plain",
          source: encode("Hello"),
        })
        .then(decode),
    ).resolves.toBe("Hello\n");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("omits scripts, styles, comments and remote images", async () => {
    await expect(
      convert(
        '<script>throw new Error("script")</script><style>.x{color:red}</style><noscript>Hidden fallback</noscript><!-- comment --><p>Hello &amp; goodbye</p><img src="https://example.invalid/pixel.png">',
      ),
    ).resolves.toBe("Hello & goodbye\n");
  });

  it.each([new Uint8Array([0xff]), encode("<p>bad\u0000text</p>")])(
    "keeps the existing text-decoding validation",
    async (source) => {
      await expect(
        normalizeDocumentContent({ ...html(""), source }),
      ).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_INVALID" });
    },
  );

  it("rejects an unsupported declared charset before worker dispatch", async () => {
    const execute = vi.fn(async () => encode("worker result\n"));
    const normalizer = new WorkerDocumentNormalizer({ execute });
    await expect(
      normalizer.normalizeDocument({
        ...html("<p>ASCII-only body</p>"),
        mediaType: "text/html; charset=iso-8859-1",
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_UNSUPPORTED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps empty HTML terminal and enforces the Markdown byte limit", async () => {
    await expect(convert("<p> </p>")).rejects.toMatchObject({
      code: "DOCUMENT_SOURCE_EMPTY",
    });
    await expect(
      normalizeDocumentContent(html("<p>Long text</p>"), 5),
    ).rejects.toMatchObject({ code: "DOCUMENT_MARKDOWN_TOO_LARGE" });
  });
});
