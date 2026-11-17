import { DocumentNormalizationError } from "./document-normalizer.js";
import { decodeXmlEntities } from "./document-office-extract.js";

export function svgToMarkdown(xml: string, filename?: string): string {
  if (!/<svg\b/iu.test(xml)) {
    throw new DocumentNormalizationError("DOCUMENT_SOURCE_INVALID");
  }
  const heading = imageHeading(filename, "SVG");
  const pieces: string[] = [];
  for (const tag of ["title", "desc", "text"] as const) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "giu");
    for (const match of xml.matchAll(pattern)) {
      const text = decodeXmlEntities(stripTags(match[1] ?? ""))
        .replace(/[ \t]+\n/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
      if (text) pieces.push(text);
    }
  }
  if (pieces.length > 0) {
    return `# ${heading}\n\n${pieces.join("\n\n")}`;
  }
  return `# ${heading}\n\n- Format: SVG`;
}

function imageHeading(filename: string | undefined, fallback: string): string {
  const base = filename?.split(/[/\\]/u).at(-1)?.trim();
  return (base && base.length > 0 ? base : fallback).replaceAll("\n", " ");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/gu, " ").replace(/[ \t]{2,}/gu, " ");
}
