import { loadHanFont } from "@/app/han-font";

import {
  formatMessage,
  type Catalog,
  type Message,
  type MessageArguments,
} from "./messages";

/**
 * The languages the interface is offered in, each named in its own language.
 * English is the source every message is written in and the fallback.
 */
export const LANGUAGES = [
  { tag: "en", name: "English" },
  { tag: "zh-CN", name: "\u7b80\u4f53\u4e2d\u6587" },
] as const;

export type Language = (typeof LANGUAGES)[number]["tag"];

export const SOURCE_LANGUAGE = "en" satisfies Language;

/**
 * The choice is kept per browser, not per account: the sign-in page and the
 * desktop shell show text before any account is known. No stored value means
 * the user has not chosen, so a default other than English can be introduced
 * later without rewriting what is stored.
 */
export const LANGUAGE_STORAGE_KEY = "linger.language";

const catalogLoaders: Record<
  Exclude<Language, typeof SOURCE_LANGUAGE>,
  () => Promise<Catalog>
> = {
  "zh-CN": async () => (await import("./locales/zh-CN.json")).default,
};

/** Formats one message in the language of the snapshot it belongs to. */
export type Translate = <M extends Message>(
  message: M,
  ...values: MessageArguments<M["source"]>
) => string;

/** The language on screen and the lookup for it; replaced as one on a switch. */
export interface Translation {
  readonly language: Language;
  /** The loaded translations; English needs none. */
  readonly catalog: Catalog | undefined;
  readonly t: Translate;
}

function createTranslation(
  language: Language,
  catalog: Catalog | undefined,
): Translation {
  return {
    language,
    catalog,
    t: (message, ...values) =>
      formatMessage(message, language, catalog, values[0]),
  };
}

let translation = createTranslation(SOURCE_LANGUAGE, undefined);
// A newer choice wins when two catalogs are still loading.
let latestRequest = 0;
const listeners = new Set<() => void>();

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language.tag === value);
}

export function getTranslation(): Translation {
  return translation;
}

export function getLanguage(): Language {
  return translation.language;
}

export function subscribeToLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Formats a message outside React, in the language on screen right now. */
export const translate: Translate = (message, ...values) =>
  translation.t(message, ...values);

/** The `Intl` locale for dates, numbers and lists in the language on screen. */
export function formatLocale(language: Language = translation.language) {
  // English keeps the US conventions the client has always used.
  return language === "en" ? "en-US" : language;
}

/** The language the person chose on this device; undefined before any choice. */
export function storedLanguage(): Language | undefined {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Shows `language`; false when a newer choice took over while it loaded. */
async function showLanguage(language: Language): Promise<boolean> {
  const request = ++latestRequest;
  const catalog =
    language === SOURCE_LANGUAGE ? undefined : await catalogLoaders[language]();
  if (request !== latestRequest) return false;
  translation = createTranslation(language, catalog);
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
    loadHanFont([language, ...navigator.languages]);
  }
  for (const listener of listeners) listener();
  return true;
}

/**
 * Switches the interface to `language` and remembers the choice. Rejects, with
 * the previous language still on screen, when the catalog cannot be loaded.
 * A newer choice made while the catalog loads, here or in another tab, wins:
 * this one is then neither shown nor remembered.
 */
export async function setLanguage(language: Language) {
  if (!(await showLanguage(language))) return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The switch still holds for this session without saved preferences.
  }
}

let followingOtherTabs = false;

/**
 * Shows the remembered language before the first paint. A catalog that cannot
 * be loaded leaves the interface in English instead of blocking the start.
 */
export async function restoreLanguage() {
  if (typeof window !== "undefined" && !followingOtherTabs) {
    followingOtherTabs = true;
    // Another tab of this browser changed the language: follow it.
    window.addEventListener("storage", (event) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      void showLanguage(storedLanguage() ?? SOURCE_LANGUAGE).catch(() => {});
    });
  }
  const language = storedLanguage();
  if (!language || language === translation.language) return;
  await showLanguage(language).catch(() => {});
}

/** Puts the interface back to English between tests. */
export function resetLanguageForTest() {
  latestRequest += 1;
  translation = createTranslation(SOURCE_LANGUAGE, undefined);
  for (const listener of listeners) listener();
}
