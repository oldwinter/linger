import {
  formatMessage,
  type Catalog,
  type Message,
  type MessageArguments,
} from "@linger/service-kit/messages";

import zhCN from "./locales/zh-CN.json" with { type: "json" };

/**
 * The languages the desktop shell is offered in. The tags are the Web
 * client's, which reports its choice with them; English is the source every
 * message is written in and the fallback.
 */
export const LANGUAGES = ["en", "zh-CN"] as const;

export type Language = (typeof LANGUAGES)[number];

export const SOURCE_LANGUAGE = "en" satisfies Language;

// The shell is one small bundle, so every catalog ships with it.
const CATALOGS: Record<Exclude<Language, typeof SOURCE_LANGUAGE>, Catalog> = {
  "zh-CN": zhCN,
};

export function catalogFor(language: Language): Catalog | undefined {
  return language === SOURCE_LANGUAGE ? undefined : CATALOGS[language];
}

/**
 * The first of `preferred` (BCP 47 tags, most wanted first) that the shell
 * speaks, compared by language and script, so `zh-Hans-SG` and `zh-CN` both
 * pick Simplified Chinese and `zh-TW` does not; English when none matches.
 */
export function matchLanguage(preferred: readonly string[]): Language {
  const key = (tag: string): string | undefined => {
    try {
      const locale = new Intl.Locale(tag).maximize();
      return `${locale.language}-${locale.script}`;
    } catch {
      return undefined;
    }
  };
  const offered = LANGUAGES.map((language) => [key(language), language]);
  for (const tag of preferred) {
    const wanted = key(tag);
    const match = offered.find(([offeredKey]) => offeredKey === wanted);
    if (wanted && match) return match[1] as Language;
  }
  return SOURCE_LANGUAGE;
}

/** Formats one message in a fixed language. */
export type Translate = <M extends Message>(
  message: M,
  ...values: MessageArguments<M["source"]>
) => string;

export function translator(language: Language): Translate {
  const catalog = catalogFor(language);
  return (message, ...values) =>
    formatMessage(message, language, catalog, values[0]);
}
