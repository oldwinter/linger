import { describe, expect, it } from "vitest";

import {
  INKLING_2_MINI_ANNOUNCEMENT_URL,
  INKLING_2_MINI_HF_URL,
  isInkling2MiniModelId,
} from "./featured-models.js";

describe("featured-models", () => {
  it("exports HTTPS partner URLs for Inkling 2 Mini", () => {
    expect(INKLING_2_MINI_ANNOUNCEMENT_URL).toBe(
      "https://thinkingmachines.ai/news/inkling-2-mini/",
    );
    expect(INKLING_2_MINI_HF_URL).toBe(
      "https://huggingface.co/thinkingmachines/Inkling-2-Mini",
    );
  });

  it("matches structured Inkling 2 Mini model IDs across case, tags, siblings, and org prefixes", () => {
    for (const id of [
      "inkling-2-mini",
      "inkling-2-mini:UD-Q4_K_M",
      "inkling-2-mini:UD-IQ3_S",
      "inkling-2-mini-iq3xxs:UD-IQ3_XXS",
      "Inkling-2-Mini",
      "Inkling-2-Mini:Q4_K_M",
      "  inkling-2-mini:UD-Q4_K_M  ",
      "thinkingmachines/Inkling-2-Mini",
      "thinkingmachines/inkling-2-mini-iq4xs:UD-IQ4_XS",
    ]) {
      expect(isInkling2MiniModelId(id), id).toBe(true);
    }
  });

  it("rejects unrelated models, prefix collisions, and empty values", () => {
    for (const id of [
      "qwen3.8-27b:UD-Q4_K_M",
      "spark-x2.6-4b:Q4_K_M",
      "inkling-2",
      "inkling-2-small:UD-Q4_K_M",
      "inkling-2-max:UD-Q4_K_M",
      "inkling-2-mini2:Q4_K_M",
      "inkling-2-minix",
      "custom-inkling-2-mini",
      "",
      "   ",
      undefined,
      null,
    ]) {
      expect(isInkling2MiniModelId(id), String(id)).toBe(false);
    }
  });
});
