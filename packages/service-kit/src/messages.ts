/**
 * Message catalogs without React or the DOM: the English source declared
 * beside the code that shows it, and the lookup that picks a translation,
 * a plural form and the placeholder values.
 */

/** Plural forms by `Intl.PluralRules` category; `other` is the fallback. */
export interface PluralForms {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export type MessageSource = string | PluralForms;

/** One string of the interface: its catalog key and its English source. */
export interface Message<S extends MessageSource = MessageSource> {
  readonly id: string;
  readonly source: S;
}

/** A language's translations, by namespace and then by message name. */
export type Catalog = Readonly<
  Record<string, Readonly<Record<string, MessageSource>>>
>;

type SourceText<S extends MessageSource> = S extends string
  ? S
  : S[keyof S] & string;

type PlaceholderNames<Text extends string> =
  Text extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never;

type TagNames<Text extends string> =
  Text extends `${string}<${infer Name}>${infer Rest}`
    ? (Name extends `/${string}` ? never : Name) | TagNames<Rest>
    : never;

/** The `{name}` values a message needs; a plural message also needs `count`. */
export type MessageValues<S extends MessageSource> = {
  readonly [Name in PlaceholderNames<SourceText<S>>]: string | number;
} & (S extends string ? unknown : { readonly count: number });

/** The `<name>…</name>` spans of a message. */
export type MessageTags<S extends MessageSource> = TagNames<SourceText<S>>;

export type MessageArguments<S extends MessageSource> = [
  keyof MessageValues<S>,
] extends [never]
  ? []
  : [values: MessageValues<S>];

/**
 * Declares the English source of one namespace. Each feature keeps its own
 * namespace beside its components, so English text ships in that feature's
 * chunk and a key that does not exist fails the typecheck.
 */
export function defineMessages<
  const Source extends Readonly<Record<string, MessageSource>>,
>(
  namespace: string,
  source: Source,
): { readonly [Name in keyof Source]: Message<Source[Name]> } {
  return Object.fromEntries(
    Object.entries(source).map(([name, text]) => [
      name,
      { id: `${namespace}.${name}`, source: text },
    ]),
  ) as { readonly [Name in keyof Source]: Message<Source[Name]> };
}

/** A piece of a formatted message: plain text, or the text inside a tag. */
export interface MessagePart {
  readonly tag?: string;
  readonly text: string;
}

interface LanguageRules {
  readonly numbers: Intl.NumberFormat;
  readonly plurals: Intl.PluralRules;
}

const languageRules = new Map<string, LanguageRules>();

function rulesFor(language: string) {
  let rules = languageRules.get(language);
  if (!rules) {
    rules = {
      numbers: new Intl.NumberFormat(language),
      plurals: new Intl.PluralRules(language),
    };
    languageRules.set(language, rules);
  }
  return rules;
}

/**
 * The text a message has in `language` and the language it is really in:
 * English when the catalog does not have it yet. Pages that format on their
 * own, such as the desktop shell's, take it as it is.
 */
export function resolveMessage(
  message: Message,
  language: string,
  catalog: Catalog | undefined,
): { language: string; text: MessageSource } {
  const separator = message.id.indexOf(".");
  const translated =
    catalog?.[message.id.slice(0, separator)]?.[
      message.id.slice(separator + 1)
    ];
  // A string the catalog does not have yet shows its English source.
  return translated === undefined
    ? { language: "en", text: message.source }
    : { language, text: translated };
}

interface ResolvedText {
  readonly rules: LanguageRules;
  readonly text: string;
}

function selectText(
  message: Message,
  language: string,
  catalog: Catalog | undefined,
  values: Readonly<Record<string, string | number>>,
): ResolvedText {
  const resolved = resolveMessage(message, language, catalog);
  const rules = rulesFor(resolved.language);
  const text =
    typeof resolved.text === "string"
      ? resolved.text
      : (resolved.text[rules.plurals.select(Number(values.count))] ??
        resolved.text.other);
  return { rules, text };
}

function interpolate(
  { rules, text }: ResolvedText,
  values: Readonly<Record<string, string | number>>,
) {
  return text.replace(/\{(\w+)\}/gu, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) return placeholder;
    return typeof value === "number" ? rules.numbers.format(value) : value;
  });
}

/**
 * The message in `language`, falling back to English, with the plural form
 * `count` selects and every `{name}` replaced by its value. A number is
 * written the way the language groups digits; pass a string to keep digits
 * as they are, as for a year or an identifier.
 */
export function formatMessage(
  message: Message,
  language: string,
  catalog: Catalog | undefined,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return interpolate(selectText(message, language, catalog, values), values);
}

/**
 * The formatted message cut at its `<name>…</name>` spans, so a caller can
 * wrap each span in an element. Tags do not nest. The spans come from the
 * message alone: a value that happens to contain a tag stays plain text.
 */
export function formatMessageParts(
  message: Message,
  language: string,
  catalog: Catalog | undefined,
  values: Readonly<Record<string, string | number>> = {},
): MessagePart[] {
  const { rules, text } = selectText(message, language, catalog, values);
  const parts: MessagePart[] = [];
  const add = (part: string, tag?: string) => {
    if (part)
      parts.push({ tag, text: interpolate({ rules, text: part }, values) });
  };
  let end = 0;
  for (const match of text.matchAll(/<(\w+)>(.*?)<\/\1>/gsu)) {
    add(text.slice(end, match.index));
    add(match[2]!, match[1]);
    end = match.index + match[0].length;
  }
  add(text.slice(end));
  return parts;
}
