import { describe, expect, it } from "vitest";

import {
  defineMessages,
  formatMessage,
  formatMessageParts,
  type Catalog,
} from "./messages.js";

const messages = defineMessages("sample", {
  greeting: "Hello, {name}",
  plain: "Settings",
  unread: { one: "{count} unread message", other: "{count} unread messages" },
  help: "Read <link>the guide for {name}</link> first.",
});

const translated: Catalog = {
  sample: {
    greeting: "Bonjour, {name}",
    unread: {
      one: "{count} message non lu",
      other: "{count} messages non lus",
    },
    help: "Lisez d'abord <link>le guide de {name}</link>.",
  },
};

describe("message formatting", () => {
  it("names each message by its namespace and key", () => {
    expect(messages.greeting).toEqual({
      id: "sample.greeting",
      source: "Hello, {name}",
    });
  });

  it("fills placeholders in the English source and in a translation", () => {
    expect(
      formatMessage(messages.greeting, "en", undefined, { name: "Ada" }),
    ).toBe("Hello, Ada");
    expect(
      formatMessage(messages.greeting, "fr", translated, { name: "Ada" }),
    ).toBe("Bonjour, Ada");
  });

  it("shows the English source for a message the catalog does not have", () => {
    expect(formatMessage(messages.plain, "fr", translated)).toBe("Settings");
    expect(formatMessage(messages.plain, "fr", {})).toBe("Settings");
  });

  it("selects the plural form of the language the text is in", () => {
    const unread = (
      language: string,
      catalog: Catalog | undefined,
      count: number,
    ) => formatMessage(messages.unread, language, catalog, { count });
    expect(unread("en", undefined, 1)).toBe("1 unread message");
    expect(unread("en", undefined, 2)).toBe("2 unread messages");
    // French counts zero as singular; the form follows the translation.
    expect(unread("fr", translated, 0)).toBe("0 message non lu");
    // A language with one form only supplies `other`.
    expect(
      unread("zh-CN", { sample: { unread: { other: "{count} unread" } } }, 1),
    ).toBe("1 unread");
    // An untranslated plural falls back to English text and English rules.
    expect(unread("zh-CN", {}, 1)).toBe("1 unread message");
  });

  it("writes numbers the way the language of the text groups digits", () => {
    expect(
      formatMessage(messages.unread, "en", undefined, { count: 12345 }),
    ).toBe("12,345 unread messages");
    expect(
      formatMessage(
        messages.unread,
        "de",
        { sample: { unread: { other: "{count} ungelesen" } } },
        { count: 12345 },
      ),
    ).toBe("12.345 ungelesen");
    // A string value is never reformatted.
    expect(
      formatMessage(messages.greeting, "en", undefined, { name: "12345" }),
    ).toBe("Hello, 12345");
  });

  it("cuts a message at its tags, wherever the translation puts them", () => {
    expect(
      formatMessageParts(messages.help, "en", undefined, { name: "Ada" }),
    ).toEqual([
      { text: "Read " },
      { tag: "link", text: "the guide for Ada" },
      { text: " first." },
    ]);
    expect(
      formatMessageParts(messages.help, "fr", translated, { name: "Ada" }),
    ).toEqual([
      { text: "Lisez d'abord " },
      { tag: "link", text: "le guide de Ada" },
      { text: "." },
    ]);
  });

  it("keeps a value that looks like a tag as plain text", () => {
    expect(
      formatMessageParts(messages.greeting, "en", undefined, {
        name: "<link>Ada</link>",
      }),
    ).toEqual([{ text: "Hello, <link>Ada</link>" }]);
  });
});
