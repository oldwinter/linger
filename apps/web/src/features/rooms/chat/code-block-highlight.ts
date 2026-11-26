export type CodeTokenKind =
  | "comment"
  | "keyword"
  | "number"
  | "plain"
  | "punctuation"
  | "string"
  | "type";

export interface CodeToken {
  kind: CodeTokenKind;
  value: string;
}

type CanonicalLanguage =
  | "css"
  | "go"
  | "html"
  | "js"
  | "json"
  | "python"
  | "rust"
  | "sh"
  | "sql"
  | "yaml";

const MAX_HIGHLIGHT_CHARS = 50_000;

const LANGUAGE_ALIASES: Readonly<Record<string, CanonicalLanguage>> = {
  bash: "sh",
  cjs: "js",
  css: "css",
  go: "go",
  golang: "go",
  html: "html",
  javascript: "js",
  js: "js",
  json: "json",
  jsonc: "json",
  jsx: "js",
  mjs: "js",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  scss: "css",
  sh: "sh",
  shell: "sh",
  sql: "sql",
  svg: "html",
  ts: "js",
  tsx: "js",
  typescript: "js",
  xml: "html",
  yaml: "yaml",
  yml: "yaml",
  zsh: "sh",
};

const KEYWORDS: Readonly<Record<CanonicalLanguage, ReadonlySet<string>>> = {
  css: new Set([
    "important",
    "and",
    "not",
    "only",
    "from",
    "to",
    "media",
    "supports",
    "keyframes",
    "layer",
    "import",
    "root",
  ]),
  go: new Set([
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
    "true",
    "false",
    "nil",
    "iota",
  ]),
  html: new Set([]),
  js: new Set([
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "declare",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "keyof",
    "let",
    "new",
    "null",
    "of",
    "private",
    "protected",
    "public",
    "readonly",
    "return",
    "satisfies",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "var",
    "void",
    "while",
    "yield",
  ]),
  json: new Set(["true", "false", "null"]),
  python: new Set([
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "case",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "False",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "match",
    "None",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "True",
    "try",
    "while",
    "with",
    "yield",
  ]),
  rust: new Set([
    "as",
    "async",
    "await",
    "break",
    "const",
    "continue",
    "crate",
    "dyn",
    "else",
    "enum",
    "extern",
    "false",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "pub",
    "ref",
    "return",
    "self",
    "Self",
    "static",
    "struct",
    "super",
    "trait",
    "true",
    "type",
    "unsafe",
    "use",
    "where",
    "while",
  ]),
  sh: new Set([
    "case",
    "do",
    "done",
    "elif",
    "else",
    "esac",
    "export",
    "fi",
    "for",
    "function",
    "if",
    "in",
    "local",
    "readonly",
    "return",
    "select",
    "then",
    "until",
    "while",
    "true",
    "false",
  ]),
  sql: new Set([
    "add",
    "all",
    "alter",
    "and",
    "as",
    "asc",
    "between",
    "by",
    "case",
    "check",
    "column",
    "constraint",
    "create",
    "cross",
    "default",
    "delete",
    "desc",
    "distinct",
    "drop",
    "else",
    "end",
    "exists",
    "false",
    "foreign",
    "from",
    "full",
    "group",
    "having",
    "in",
    "index",
    "inner",
    "insert",
    "into",
    "is",
    "join",
    "key",
    "left",
    "like",
    "limit",
    "not",
    "null",
    "offset",
    "on",
    "or",
    "order",
    "outer",
    "primary",
    "references",
    "returning",
    "right",
    "select",
    "set",
    "table",
    "then",
    "true",
    "union",
    "unique",
    "update",
    "values",
    "when",
    "where",
    "with",
  ]),
  yaml: new Set(["true", "false", "null", "yes", "no", "on", "off"]),
};

const TYPES: Readonly<Record<CanonicalLanguage, ReadonlySet<string>>> = {
  css: new Set([]),
  go: new Set([
    "any",
    "bool",
    "byte",
    "comparable",
    "error",
    "float32",
    "float64",
    "int",
    "int8",
    "int16",
    "int32",
    "int64",
    "rune",
    "string",
    "uint",
    "uint8",
    "uint16",
    "uint32",
    "uint64",
    "uintptr",
  ]),
  html: new Set([]),
  js: new Set([
    "any",
    "Array",
    "bigint",
    "boolean",
    "Date",
    "Error",
    "Map",
    "never",
    "number",
    "object",
    "Promise",
    "Record",
    "RegExp",
    "Set",
    "string",
    "symbol",
    "unknown",
  ]),
  json: new Set([]),
  python: new Set([
    "any",
    "bool",
    "bytes",
    "dict",
    "float",
    "frozenset",
    "int",
    "list",
    "object",
    "set",
    "str",
    "tuple",
    "type",
  ]),
  rust: new Set([
    "bool",
    "Box",
    "char",
    "f32",
    "f64",
    "i8",
    "i16",
    "i32",
    "i64",
    "i128",
    "isize",
    "Option",
    "Result",
    "str",
    "String",
    "u8",
    "u16",
    "u32",
    "u64",
    "u128",
    "usize",
    "Vec",
  ]),
  sh: new Set([
    "cd",
    "curl",
    "echo",
    "env",
    "find",
    "git",
    "grep",
    "make",
    "mkdir",
    "node",
    "npm",
    "pnpm",
    "printf",
    "rm",
    "sed",
    "set",
  ]),
  sql: new Set([
    "bigint",
    "boolean",
    "char",
    "date",
    "decimal",
    "float",
    "int",
    "integer",
    "json",
    "jsonb",
    "numeric",
    "real",
    "serial",
    "smallint",
    "text",
    "timestamp",
    "timestamptz",
    "uuid",
    "varchar",
  ]),
  yaml: new Set([]),
};

export function normalizeCodeLanguage(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^language-/, "");
  return cleaned || undefined;
}

export function isSupportedHighlightLanguage(
  language: string | undefined,
): boolean {
  const normalized = normalizeCodeLanguage(language);
  return Boolean(normalized && normalized in LANGUAGE_ALIASES);
}

/**
 * Lightweight zero-dependency syntax tokenizer for chat code blocks.
 * Guarantees concatenation of token values equals the input string.
 */
export function tokenizeCode(code: string, rawLanguage: string): CodeToken[] {
  const normalized = normalizeCodeLanguage(rawLanguage);
  const lang = normalized ? LANGUAGE_ALIASES[normalized] : undefined;
  if (!lang || code.length === 0 || code.length > MAX_HIGHLIGHT_CHARS) {
    return code.length > 0 ? [{ kind: "plain", value: code }] : [];
  }
  if (lang === "html") return tokenizeHtml(code);
  if (lang === "yaml") return tokenizeYaml(code);
  return tokenizeGeneral(code, lang);
}

function pushToken(tokens: CodeToken[], kind: CodeTokenKind, value: string) {
  if (!value) return;
  const last = tokens.at(-1);
  if (last && last.kind === kind && kind === "plain") {
    last.value += value;
    return;
  }
  tokens.push({ kind, value });
}

function scanQuoted(
  code: string,
  start: number,
  quote: string,
  multiline: boolean,
): number {
  let index = start + quote.length;
  while (index < code.length) {
    const ch = code[index]!;
    if (ch === "\\" && quote !== "`") {
      index += 2;
      continue;
    }
    if (ch === "\\" && quote === "`") {
      index += 2;
      continue;
    }
    if (!multiline && ch === "\n") {
      return index;
    }
    if (code.startsWith(quote, index)) {
      return index + quote.length;
    }
    index += 1;
  }
  return code.length;
}

function scanLineEnd(code: string, start: number): number {
  const newline = code.indexOf("\n", start);
  return newline === -1 ? code.length : newline;
}

function scanBlockComment(code: string, start: number): number {
  const end = code.indexOf("*/", start + 2);
  return end === -1 ? code.length : end + 2;
}

function isIdentStart(ch: string): boolean {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    ch === "_" ||
    ch === "$"
  );
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isPunctuation(ch: string): boolean {
  return "{}()[].,;:=+-*/<>!?&|^~%".includes(ch);
}

function tokenizeGeneral(
  code: string,
  lang: Exclude<CanonicalLanguage, "html" | "yaml">,
): CodeToken[] {
  const tokens: CodeToken[] = [];
  const keywords = KEYWORDS[lang];
  const types = TYPES[lang];
  const slashComments =
    lang === "js" ||
    lang === "go" ||
    lang === "rust" ||
    lang === "css" ||
    lang === "json";
  const hashComments = lang === "python" || lang === "sh";
  const dashComments = lang === "sql";
  const blockComments = slashComments || lang === "sql";
  let index = 0;

  while (index < code.length) {
    const ch = code[index]!;
    const next = code[index + 1];

    // Comments
    if (slashComments && ch === "/" && next === "/") {
      const end = scanLineEnd(code, index + 2);
      pushToken(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }
    if (blockComments && ch === "/" && next === "*") {
      const end = scanBlockComment(code, index);
      pushToken(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }
    if (hashComments && ch === "#") {
      const end = scanLineEnd(code, index + 1);
      pushToken(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }
    if (dashComments && ch === "-" && next === "-") {
      const end = scanLineEnd(code, index + 2);
      pushToken(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }

    // Python triple-quoted strings
    if (
      lang === "python" &&
      (code.startsWith('"""', index) || code.startsWith("'''", index))
    ) {
      const quote = code.slice(index, index + 3);
      const end = scanQuoted(code, index, quote, true);
      pushToken(tokens, "string", code.slice(index, end));
      index = end;
      continue;
    }

    // Quoted strings (skip Rust lifetime single-quote like 'a)
    if (
      ch === '"' ||
      (ch === "'" &&
        (lang !== "rust" ||
          (next !== undefined &&
            (next === "\\" || code[index + 2] === "'")))) ||
      (ch === "`" && (lang === "js" || lang === "go" || lang === "sh"))
    ) {
      const end = scanQuoted(code, index, ch, ch === "`" || lang === "sql");
      const raw = code.slice(index, end);
      if (lang === "json" && ch === '"') {
        let lookahead = end;
        while (
          lookahead < code.length &&
          (code[lookahead] === " " || code[lookahead] === "\t")
        ) {
          lookahead += 1;
        }
        pushToken(tokens, code[lookahead] === ":" ? "type" : "string", raw);
      } else {
        pushToken(tokens, "string", raw);
      }
      index = end;
      continue;
    }

    // CSS @at-rules & #hex colors
    if (lang === "css" && ch === "@" && next && isIdentStart(next)) {
      let end = index + 2;
      while (
        end < code.length &&
        (isIdentPart(code[end]!) || code[end] === "-")
      ) {
        end += 1;
      }
      pushToken(tokens, "keyword", code.slice(index, end));
      index = end;
      continue;
    }
    if (lang === "css" && ch === "#" && next && /[0-9a-fA-F]/.test(next)) {
      let end = index + 2;
      while (end < code.length && /[0-9a-fA-F]/.test(code[end]!)) {
        end += 1;
      }
      pushToken(tokens, "number", code.slice(index, end));
      index = end;
      continue;
    }

    // Shell variables ($VAR, ${VAR})
    if (lang === "sh" && ch === "$") {
      if (next === "{") {
        const close = code.indexOf("}", index + 2);
        const end = close === -1 ? index + 2 : close + 1;
        pushToken(tokens, "type", code.slice(index, end));
        index = end;
        continue;
      }
      if (
        next &&
        (isIdentStart(next) || isDigit(next) || "?$#@*!".includes(next))
      ) {
        let end = index + 2;
        if (isIdentStart(next)) {
          while (end < code.length && isIdentPart(code[end]!)) end += 1;
        }
        pushToken(tokens, "type", code.slice(index, end));
        index = end;
        continue;
      }
    }

    // Numbers
    if (isDigit(ch)) {
      let end = index + 1;
      while (end < code.length && /[0-9a-fA-FxXbBoO._eE]/.test(code[end]!)) {
        end += 1;
      }
      if (lang === "css") {
        while (end < code.length && /[a-zA-Z%]/.test(code[end]!)) end += 1;
      }
      pushToken(tokens, "number", code.slice(index, end));
      index = end;
      continue;
    }

    // Identifiers, keywords, types
    if (isIdentStart(ch) || (lang === "css" && ch === "-" && next === "-")) {
      let end = index + 1;
      while (
        end < code.length &&
        (isIdentPart(code[end]!) || (lang === "css" && code[end] === "-"))
      ) {
        end += 1;
      }
      const word = code.slice(index, end);
      const lookup = lang === "sql" ? word.toLowerCase() : word;
      if (keywords.has(lookup)) {
        pushToken(tokens, "keyword", word);
      } else if (
        types.has(lookup) ||
        (lang !== "sql" &&
          lang !== "sh" &&
          lang !== "css" &&
          word.length > 1 &&
          word[0]! >= "A" &&
          word[0]! <= "Z" &&
          /[a-z]/.test(word))
      ) {
        pushToken(tokens, "type", word);
      } else if (lang === "css") {
        let lookahead = end;
        while (
          lookahead < code.length &&
          (code[lookahead] === " " || code[lookahead] === "\t")
        ) {
          lookahead += 1;
        }
        pushToken(tokens, code[lookahead] === ":" ? "type" : "plain", word);
      } else {
        pushToken(tokens, "plain", word);
      }
      index = end;
      continue;
    }

    // Punctuation
    if (isPunctuation(ch)) {
      pushToken(tokens, "punctuation", ch);
      index += 1;
      continue;
    }

    // Whitespace or other characters
    pushToken(tokens, "plain", ch);
    index += 1;
  }

  return tokens;
}

function tokenizeHtml(code: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < code.length) {
    if (code.startsWith("<!--", index)) {
      const close = code.indexOf("-->", index + 4);
      const end = close === -1 ? code.length : close + 3;
      pushToken(tokens, "comment", code.slice(index, end));
      index = end;
      continue;
    }

    if (code[index] === "<") {
      let end = index + 1;
      pushToken(tokens, "punctuation", "<");
      if (code[end] === "/" || code[end] === "!") {
        pushToken(tokens, "punctuation", code[end]!);
        end += 1;
      }
      const tagStart = end;
      while (end < code.length && /[a-zA-Z0-9:_-]/.test(code[end]!)) {
        end += 1;
      }
      if (end > tagStart) {
        pushToken(tokens, "keyword", code.slice(tagStart, end));
      }
      // Attributes until closing >
      while (end < code.length && code[end] !== ">") {
        const ch = code[end]!;
        if (ch === '"' || ch === "'") {
          const strEnd = scanQuoted(code, end, ch, true);
          pushToken(tokens, "string", code.slice(end, strEnd));
          end = strEnd;
        } else if (/[a-zA-Z_:@-]/.test(ch)) {
          const attrStart = end;
          while (end < code.length && /[a-zA-Z0-9_:.-]/.test(code[end]!)) {
            end += 1;
          }
          pushToken(tokens, "type", code.slice(attrStart, end));
        } else if (ch === "=" || ch === "/") {
          pushToken(tokens, "punctuation", ch);
          end += 1;
        } else {
          pushToken(tokens, "plain", ch);
          end += 1;
        }
      }
      if (code[end] === ">") {
        pushToken(tokens, "punctuation", ">");
        end += 1;
      }
      index = end;
      continue;
    }

    const nextTag = code.indexOf("<", index);
    const end = nextTag === -1 ? code.length : nextTag;
    pushToken(tokens, "plain", code.slice(index, end));
    index = end;
  }

  return tokens;
}

function tokenizeYaml(code: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const lines = code.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (lineIndex > 0) pushToken(tokens, "plain", "\n");

    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) {
      const indent = line.length - trimmed.length;
      if (indent > 0) pushToken(tokens, "plain", line.slice(0, indent));
      pushToken(tokens, "comment", trimmed);
      continue;
    }

    const keyMatch = /^(\s*(?:-\s+)?)([^:#\n]+?)(:)(\s*)(.*)$/.exec(line);
    if (keyMatch) {
      const [, prefix, key, colon, space, rest] = keyMatch;
      if (prefix) pushToken(tokens, "plain", prefix);
      pushToken(tokens, "type", key!);
      pushToken(tokens, "punctuation", colon!);
      if (space) pushToken(tokens, "plain", space);
      if (rest) tokenizeYamlValue(tokens, rest);
      continue;
    }

    tokenizeYamlValue(tokens, line);
  }

  return tokens;
}

function tokenizeYamlValue(tokens: CodeToken[], value: string) {
  let index = 0;
  while (index < value.length) {
    const ch = value[index]!;
    if (ch === "#" && (index === 0 || value[index - 1] === " ")) {
      pushToken(tokens, "comment", value.slice(index));
      return;
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(value, index, ch, false);
      pushToken(tokens, "string", value.slice(index, end));
      index = end;
      continue;
    }
    if (isDigit(ch) && (index === 0 || /[\s[,:]/.test(value[index - 1]!))) {
      let end = index + 1;
      while (end < value.length && /[0-9._eE+-]/.test(value[end]!)) end += 1;
      pushToken(tokens, "number", value.slice(index, end));
      index = end;
      continue;
    }
    if (isIdentStart(ch)) {
      let end = index + 1;
      while (end < value.length && isIdentPart(value[end]!)) end += 1;
      const word = value.slice(index, end);
      pushToken(
        tokens,
        KEYWORDS.yaml.has(word.toLowerCase()) ? "keyword" : "plain",
        word,
      );
      index = end;
      continue;
    }
    if (isPunctuation(ch)) {
      pushToken(tokens, "punctuation", ch);
      index += 1;
      continue;
    }
    pushToken(tokens, "plain", ch);
    index += 1;
  }
}
