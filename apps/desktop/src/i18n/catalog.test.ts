import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Message, MessageSource } from "@linger/service-kit/messages";
import { describe, expect, it } from "vitest";

import { offlineMessages } from "../shell/offline.messages.js";
import { setupMessages } from "../shell/setup.messages.js";
import { titlebarMessages } from "../shell/titlebar.messages.js";
import { LANGUAGES, SOURCE_LANGUAGE, catalogFor } from "./language.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every namespace of the shell, found by file name so that a new
// `*.messages.ts` is checked without being listed here.
const messageFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return messageFiles(file);
    return entry.name.endsWith(".messages.ts") ? [file] : [];
  });

const source = new Map<string, MessageSource>();
for (const file of messageFiles(SRC)) {
  const exports = (await import(pathToFileURL(file).href)) as Record<
    string,
    Record<string, Message>
  >;
  for (const messages of Object.values(exports))
    for (const message of Object.values(messages)) {
      if (source.has(message.id))
        throw new Error(`Two messages are named ${message.id}`);
      source.set(message.id, message.source);
    }
}

const forms = (text: MessageSource): string[] =>
  typeof text === "string" ? [text] : Object.values(text);

const names = (text: MessageSource, pattern: RegExp): string =>
  [
    ...new Set(
      forms(text).flatMap((form) =>
        [...form.matchAll(pattern)].map((match) => match[1]!),
      ),
    ),
  ]
    .sort()
    .join();

const placeholder = /\{(\w+)\}/gu;
const openingTag = /<(\w+)>/gu;
const span = /<(\w+)>.*?<\/\1>/gsu;

describe("desktop message catalogs", () => {
  it("finds the message modules of the shell", () => {
    expect(source.size).toBeGreaterThan(0);
    for (const id of source.keys()) expect(id.split(".")).toHaveLength(2);
  });

  describe.each(LANGUAGES.filter((language) => language !== SOURCE_LANGUAGE))(
    "%s",
    (language) => {
      const translated = new Map<string, MessageSource>(
        Object.entries(catalogFor(language) ?? {}).flatMap(
          ([namespace, messages]) =>
            Object.entries(messages).map(
              ([name, text]) => [`${namespace}.${name}`, text] as const,
            ),
        ),
      );

      it("translates every English message", () => {
        expect([...source.keys()].filter((id) => !translated.has(id))).toEqual(
          [],
        );
      });

      it("has no translation without an English message", () => {
        expect([...translated.keys()].filter((id) => !source.has(id))).toEqual(
          [],
        );
      });

      it("keeps the placeholders and tags of each message", () => {
        const different = [...translated]
          .filter(([id]) => source.has(id))
          .filter(([id, text]) => {
            const english = source.get(id)!;
            return (
              names(text, placeholder) !== names(english, placeholder) ||
              names(text, openingTag) !== names(english, openingTag) ||
              forms(text).some(
                (form) =>
                  (form.match(openingTag) ?? []).length !==
                  (form.match(span) ?? []).length,
              )
            );
          })
          .map(([id]) => id);
        expect(different).toEqual([]);
      });

      it("gives plural messages the forms the language uses", () => {
        const categories = [
          ...new Intl.PluralRules(language).resolvedOptions().pluralCategories,
        ]
          .sort()
          .join();
        const wrong = [...translated]
          .filter(([id]) => source.has(id))
          .filter(([id, text]) => {
            const plural = typeof source.get(id) !== "string";
            if (typeof text === "string") return plural;
            return !plural || Object.keys(text).sort().join() !== categories;
          })
          .map(([id]) => id);
        expect(wrong).toEqual([]);
      });
    },
  );
});

// A page names its messages in markup and script; a name the page's
// namespace lacks would show as the bare name.
describe.each([
  ["setup.html", setupMessages],
  ["offline.html", offlineMessages],
  ["titlebar.html", titlebarMessages],
] as const)("%s", (file, messages) => {
  const page = readFileSync(path.join(SRC, "shell", file), "utf8");
  const named = [
    ...page.matchAll(/\bdata-t(?:-[\w-]+)?="(\w+)"/gu),
    ...page.matchAll(/\b(?:t|tSpans|tHtml)\(\s*"(\w+)"/gu),
  ].map((match) => match[1]!);

  it("names only messages of its namespace", () => {
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !(name in messages))).toEqual([]);
  });
});
