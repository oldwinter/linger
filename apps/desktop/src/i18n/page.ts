import { resolveMessage, type Message } from "@linger/service-kit/messages";

import { catalogFor, type Language } from "./language.js";

const SCRIPT = /<script>([\s\S]*?)<\/script>/u;

/**
 * A shell page in `language`. The pages are static HTML with one inline
 * script and no bundler, so the main process hands each its messages as a
 * JSON block, each already resolved to the language it is in (English for a
 * message the catalog lacks), and puts the page side of the lookup
 * (`runtime`, the script of `src/shell/messages.html`) in front of the
 * page's script. The page then only picks plural forms and fills
 * placeholders, with the same rules as `formatMessage`.
 */
export function localizePage(
  page: string,
  runtime: string,
  messages: Readonly<Record<string, Message>>,
  language: Language,
): string {
  const catalog = catalogFor(language);
  const resolved = Object.fromEntries(
    Object.entries(messages).map(([name, message]) => {
      const { language: shown, text } = resolveMessage(
        message,
        language,
        catalog,
      );
      return [name, [shown, text]];
    }),
  );
  // "<" escaped keeps any text from closing the JSON block.
  const data = JSON.stringify({ language, messages: resolved }).replace(
    /</gu,
    "\\u003c",
  );
  const lookup = SCRIPT.exec(runtime)?.[1];
  if (lookup === undefined || !SCRIPT.test(page))
    throw new Error("A shell page and its message runtime need a <script>");
  return page
    .replace(/<html lang="[^"]*"/u, `<html lang="${language}"`)
    .replace(
      SCRIPT,
      (_match, script: string) =>
        `<script type="application/json" id="linger-messages">${data}</script>\n    <script>${lookup}${script}</script>`,
    );
}
