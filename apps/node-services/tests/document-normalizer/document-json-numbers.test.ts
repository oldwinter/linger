import { describe, expect, it } from "vitest";

import { normalizeDocumentContent } from "../../src/document-normalizer/document-normalizer-core.js";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array): string => new TextDecoder().decode(value);

describe("JSON document numbers", () => {
  it.each([
    "9223372036854775807",
    "-9223372036854775809",
    "0.12345678901234567890123456789",
    "1e400",
    "1e-400",
    "-0",
  ])(
    "retains the source number %s without a floating-point round trip",
    async (number) => {
      await expect(
        normalizeDocumentContent({
          filename: "value.json",
          mediaType: "application/json",
          source: encode(number),
        }).then(decode),
      ).resolves.toBe(`\`\`\`json\n${number}\n\`\`\`\n`);
    },
  );

  it("preserves nested numeric values while keeping normal JSON formatting", async () => {
    const source =
      '{"id":9223372036854775807,"values":[0.1000000000000000001,{"small":1e-400}],"label":"9223372036854775807","active":true,"empty":null}';
    const expected = [
      "```json",
      "{",
      '  "id": 9223372036854775807,',
      '  "values": [',
      "    0.1000000000000000001,",
      "    {",
      '      "small": 1e-400',
      "    }",
      "  ],",
      '  "label": "9223372036854775807",',
      '  "active": true,',
      '  "empty": null',
      "}",
      "```",
      "",
    ].join("\n");
    await expect(
      normalizeDocumentContent({
        filename: "values.json",
        mediaType: "application/json",
        source: encode(source),
      }).then(decode),
    ).resolves.toBe(expected);
  });

  it.each(["01", "Infinity", '{"value":1e}'])(
    "still rejects invalid JSON numeric syntax: %s",
    async (source) => {
      await expect(
        normalizeDocumentContent({
          filename: "invalid.json",
          mediaType: "application/json",
          source: encode(source),
        }),
      ).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_INVALID" });
    },
  );
});
