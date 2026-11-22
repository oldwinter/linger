import { describe, expect, it } from "vitest";

import { WorkerDocumentNormalizer } from "../../src/document-normalizer/document-normalizer.js";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array): string => new TextDecoder().decode(value);
const request = (source: string) => ({
  filename: "values.json",
  mediaType: "application/json",
  source: encode(source),
});

describe("JSON conversion worker", () => {
  it("keeps the main event loop responsive while preserving numeric values", async () => {
    const normalizer = new WorkerDocumentNormalizer();
    await normalizer.normalizeDocument(request("0"));
    const count = 20_000;
    const number = "9223372036854775807";
    const source = `[${Array.from({ length: count }, () => number).join(",")}]`;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    let result: Uint8Array;
    try {
      result = await normalizer.normalizeDocument(request(source));
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
    expect(decode(result)).toBe(
      `\`\`\`json\n[\n${Array.from({ length: count }, () => `  ${number}`).join(",\n")}\n]\n\`\`\`\n`,
    );
  });

  it("rejects JSON conversion when the caller is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new WorkerDocumentNormalizer().normalizeDocument(
        request("1"),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_NORMALIZATION_UNAVAILABLE" });
  });

  it("keeps invalid JSON errors across the real worker boundary", async () => {
    await expect(
      new WorkerDocumentNormalizer().normalizeDocument(request("01")),
    ).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_INVALID" });
  });

  it("keeps rejecting unsupported JSON charsets before conversion", async () => {
    await expect(
      new WorkerDocumentNormalizer().normalizeDocument({
        ...request("1"),
        mediaType: "application/json; charset=windows-1252",
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_SOURCE_UNSUPPORTED" });
  });
});
