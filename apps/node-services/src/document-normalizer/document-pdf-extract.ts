import { fileURLToPath } from "node:url";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  DocumentNormalizationError,
  MAX_DOCUMENT_PAGES,
} from "./document-normalizer.js";

const PDFJS_MODULE_URL = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");

export async function extractPdfMarkdown(source: Uint8Array): Promise<string> {
  if (!Buffer.from(source.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) {
    throw new DocumentNormalizationError("DOCUMENT_SOURCE_INVALID");
  }
  const loading = getDocument({
    data: Uint8Array.from(source),
    cMapPacked: true,
    cMapUrl: fileURLToPath(new URL("../../cmaps/", PDFJS_MODULE_URL)),
    standardFontDataUrl: fileURLToPath(
      new URL("../../standard_fonts/", PDFJS_MODULE_URL),
    ),
    wasmUrl: fileURLToPath(new URL("../../wasm/", PDFJS_MODULE_URL)),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
  });
  try {
    const document = await loading.promise;
    if (document.numPages > MAX_DOCUMENT_PAGES) {
      throw new DocumentNormalizationError("DOCUMENT_SOURCE_TOO_LARGE");
    }
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      try {
        const content = await page.getTextContent();
        const native = content.items
          .flatMap((item) =>
            "str" in item ? [item.str, item.hasEOL ? "\n" : " "] : [],
          )
          .join("")
          .replace(/ +\n/g, "\n")
          .trim();
        pages.push(native);
      } finally {
        page.cleanup();
      }
    }
    return pages.join("\n\n");
  } catch (error) {
    if (error instanceof DocumentNormalizationError) throw error;
    throw new DocumentNormalizationError("DOCUMENT_SOURCE_INVALID");
  } finally {
    await loading.destroy().catch(() => undefined);
  }
}
