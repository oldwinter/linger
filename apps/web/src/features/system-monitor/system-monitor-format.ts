import { formatLocale, type Language } from "@/i18n/language";

const GIB_BYTES = 1024 ** 3;
const MIB_BYTES = 1024 ** 2;

const numberFormatters = new Map<string, Intl.NumberFormat>();

function getNumberFormat(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}:${digits}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatGiB(
  bytes: number | null | undefined,
  language: Language = "en",
): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes === 0) return "0 GB";
  const locale = formatLocale(language);
  const gib = bytes / GIB_BYTES;
  if (gib < 0.1) {
    const mib = bytes / MIB_BYTES;
    return `${getNumberFormat(locale, 0).format(mib)} MB`;
  }
  const digits = gib >= 100 ? 0 : 1;
  return `${getNumberFormat(locale, digits).format(gib)} GB`;
}

export function formatMs(
  ms: number | null | undefined,
  language: Language = "en",
): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const locale = formatLocale(language);
  if (ms >= 1000) {
    return `${getNumberFormat(locale, 2).format(ms / 1000)}s`;
  }
  return `${getNumberFormat(locale, 0).format(ms)}ms`;
}

export function formatRate(
  value: number | null | undefined,
  language: Language = "en",
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const locale = formatLocale(language);
  const digits = value >= 100 ? 0 : 1;
  return getNumberFormat(locale, digits).format(value);
}

export function formatInteger(
  value: number | null | undefined,
  language: Language = "en",
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return getNumberFormat(formatLocale(language), 0).format(value);
}

export function formatPercent(
  value: number | null | undefined,
  language: Language = "en",
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${getNumberFormat(formatLocale(language), 0).format(value)}%`;
}

export function formatDurationCompact(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const rounded = Math.max(0, Math.round(sec));
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

export function formatTokenCapacity(tokens: number): string {
  if (tokens >= 1024) {
    return `${Math.round(tokens / 1024)}K`;
  }
  return String(Math.max(0, Math.round(tokens)));
}

export function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
