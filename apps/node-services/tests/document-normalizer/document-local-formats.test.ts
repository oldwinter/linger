import { readFile } from "node:fs/promises";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { normalizeDocumentContent } from "../../src/document-normalizer/document-normalizer-core.js";
import { resolveDocumentSourceKind } from "../../src/document-normalizer/document-source-kind.js";
import { zipFixture } from "./fixtures/document-normalizer-fixtures.js";

const fixtures = new URL("./fixtures/local-documents/", import.meta.url);
const manifest: Array<{ name: string; mediaType: string; facts: string[] }> =
  JSON.parse(await readFile(new URL("manifest.json", fixtures), "utf8"));
const compact = (value: string): string => value.replace(/\s+/gu, "");

async function convert(name: string, source?: Uint8Array): Promise<string> {
  const fixture = manifest.find((item) => item.name === name)!;
  return new TextDecoder().decode(
    await normalizeDocumentContent({
      filename: name,
      mediaType: fixture.mediaType,
      source: source ?? (await readFile(new URL(name, fixtures))),
    }),
  );
}

describe("local document extraction", () => {
  it.each(manifest)(
    "extracts the body of $name",
    async (fixture) => {
      if (fixture.facts.length === 0) {
        await expect(convert(fixture.name)).rejects.toMatchObject({
          code: "DOCUMENT_SOURCE_EMPTY",
        });
        return;
      }
      const markdown = await convert(fixture.name);
      for (const fact of fixture.facts)
        expect(compact(markdown)).toContain(compact(fact));
      expect(markdown).not.toContain("data:image/");
      expect(markdown).not.toContain("file://");
    },
    30_000,
  );

  it.each(["structured.docx", "structured.pptx", "structured.xlsx"])(
    "preserves table column relationships in %s",
    async (name) => {
      const markdown = await convert(name);
      expect(markdown).toContain("| Project | Owner | Budget |");
      expect(markdown).toContain("| Aurora | Alice | 1250 |");
      expect(markdown).toContain("| Borealis | Bob | 2400 |");
    },
  );

  it("preserves sheet names, formatted dates, percentages and slide notes", async () => {
    const sheet = await convert("structured.xlsx");
    expect(sheet).toContain("## Dates");
    expect(sheet).toContain("| Launch | 2026-11-15 | 25% |");
    expect(await convert("structured.pptx")).toContain("SPEAKER-NOTE");
  });

  it.each([
    "sample.odt",
    "sample.ods",
    "sample.odp",
    "sample.epub",
    "sample.dotx",
  ])("recognizes a ZIP-labelled document by its filename: %s", async (name) => {
    const actual = resolveDocumentSourceKind({
      filename: name,
      mediaType: "application/zip",
    });
    expect(actual).not.toBe("zip");
    const markdown = await normalizeDocumentContent({
      filename: name,
      mediaType: "application/zip",
      source: await readFile(new URL(name, fixtures)),
    });
    expect(new TextDecoder().decode(markdown)).toContain("1250");
  });

  it.each([
    [
      "pptx",
      "potx",
      "presentationml.presentation.main",
      "presentationml.template.main",
    ],
    [
      "pptx",
      "ppsx",
      "presentationml.presentation.main",
      "presentationml.slideshow.main",
    ],
    ["xlsx", "xltx", "spreadsheetml.sheet.main", "spreadsheetml.template.main"],
  ])(
    "extracts %s as a %s template or slideshow",
    async (original, extension, before, after) => {
      const zip = await JSZip.loadAsync(
        await readFile(new URL(`structured.${original}`, fixtures)),
      );
      zip.file(
        "[Content_Types].xml",
        (await zip.file("[Content_Types].xml")!.async("string")).replace(
          before,
          after,
        ),
      );
      const result = await normalizeDocumentContent({
        filename: `sample.${extension}`,
        mediaType: "application/octet-stream",
        source: await zip.generateAsync({ type: "uint8array" }),
      });
      expect(new TextDecoder().decode(result)).toContain(
        "| Aurora | Alice | 1250 |",
      );
    },
  );

  it("rejects archives with unsafe paths before parsing Office content", async () => {
    await expect(
      normalizeDocumentContent({
        filename: "bad.docx",
        mediaType: "application/octet-stream",
        source: zipFixture([{ name: "../outside.xml", value: "secret" }]),
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_INVALID" });
  });

  it("decodes MIME transfer encoding and an encoded subject", async () => {
    const source = Buffer.from(
      [
        "MIME-Version: 1.0",
        "Subject: =?UTF-8?B?cHJvamV0IMOJdG9pbGU=?=",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("Budget 1250 €").toString("base64"),
      ].join("\r\n"),
    );
    const result = await normalizeDocumentContent({
      filename: "mail.eml",
      mediaType: "message/rfc822",
      source,
    });
    expect(new TextDecoder().decode(result)).toContain("Budget 1250 €");
    expect(new TextDecoder().decode(result)).toContain("projet Étoile");
  });
});
