/** Thinking Machines announcement for Inkling 2 Mini. */
export const INKLING_2_MINI_ANNOUNCEMENT_URL =
  "https://thinkingmachines.ai/news/inkling-2-mini/";

/** Hugging Face model card for Inkling 2 Mini. */
export const INKLING_2_MINI_HF_URL =
  "https://huggingface.co/thinkingmachines/Inkling-2-Mini";

const INKLING_2_MINI_SLUG = "inkling-2-mini";

/**
 * Whether `modelId` identifies Thinking Machines' Inkling 2 Mini release by
 * its structured model ID (for example `inkling-2-mini`,
 * `inkling-2-mini:UD-Q4_K_M`, `inkling-2-mini-iq3xxs:UD-IQ3_XXS`, or
 * `thinkingmachines/Inkling-2-Mini`), matched case-insensitively and never by
 * display prose.
 */
export function isInkling2MiniModelId(
  modelId: string | null | undefined,
): boolean {
  if (typeof modelId !== "string") return false;
  const trimmed = modelId.trim();
  if (!trimmed) return false;
  const withoutTag = trimmed.split(":", 1)[0] ?? "";
  const slug = (
    withoutTag.includes("/")
      ? withoutTag.slice(withoutTag.lastIndexOf("/") + 1)
      : withoutTag
  ).toLowerCase();
  return (
    slug === INKLING_2_MINI_SLUG || slug.startsWith(`${INKLING_2_MINI_SLUG}-`)
  );
}
