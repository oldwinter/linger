import { describe, expect, it } from "vitest";

import {
  BYOK_PROTOCOL_ENDPOINTS,
  BYOK_URL_PATH_PATTERN,
  DEFAULT_BYOK_PATH,
  MAX_BYOK_URL_PATH,
  byokProtocolFor,
  defaultByokEndpoint,
  isByokProtocol,
  normalizeByokBaseUrl,
  normalizeByokPath,
  validByokPath,
} from "./byok-endpoint.js";

describe("BYOK endpoint helpers", () => {
  it("recognizes only the three supported BYOK wire formats", () => {
    expect(isByokProtocol("openai-chat")).toBe(true);
    expect(isByokProtocol("openai-responses")).toBe(true);
    expect(isByokProtocol("anthropic")).toBe(true);
    expect(isByokProtocol("gemini")).toBe(false);
    expect(isByokProtocol("")).toBe(false);
    expect(isByokProtocol(null)).toBe(false);
  });

  it("maps each Runtime to its native default endpoint", () => {
    expect(DEFAULT_BYOK_PATH).toBe("/v1");
    expect(defaultByokEndpoint("claude")).toBe(
      BYOK_PROTOCOL_ENDPOINTS.anthropic,
    );
    expect(defaultByokEndpoint("codex")).toBe(
      BYOK_PROTOCOL_ENDPOINTS["openai-responses"],
    );
    expect(defaultByokEndpoint("pi")).toBe(
      BYOK_PROTOCOL_ENDPOINTS["openai-chat"],
    );
  });

  it("normalizes base URLs and path segments", () => {
    expect(normalizeByokBaseUrl(" https://api.example.com/// ")).toBe(
      "https://api.example.com",
    );
    expect(normalizeByokPath(" v1/ ")).toBe("/v1");
    expect(normalizeByokPath("/api/paas/v4///")).toBe("/api/paas/v4");
    expect(normalizeByokPath("   ")).toBe("");
    expect(normalizeByokPath("/")).toBe("");
  });

  it("validates path segments against host, query, fragment, whitespace and length bounds", () => {
    expect(validByokPath("")).toBe(true);
    expect(validByokPath("/v1")).toBe(true);
    expect(validByokPath("/api/paas/v4")).toBe(true);
    expect(validByokPath("/chat/completions")).toBe(true);
    expect(validByokPath(`/${"a".repeat(MAX_BYOK_URL_PATH - 1)}`)).toBe(true);
    expect(validByokPath(`/${"a".repeat(MAX_BYOK_URL_PATH)}`)).toBe(false);
    for (const bad of [
      "v1",
      "/v1/",
      "//evil.example/v1",
      "/v1?key=1",
      "/v1#frag",
      "/v1/has space",
      "/v1\\win",
    ]) {
      expect(validByokPath(bad)).toBe(false);
      expect(BYOK_URL_PATH_PATTERN.test(bad)).toBe(false);
    }
  });

  it("derives the wire format from the URL ending and falls back to the Runtime", () => {
    expect(
      byokProtocolFor("https://api.example.com/v1/chat/completions", "claude"),
    ).toEqual({ fromUrl: true, protocol: "openai-chat" });
    expect(
      byokProtocolFor("https://api.example.com/v1/responses", "pi"),
    ).toEqual({ fromUrl: true, protocol: "openai-responses" });
    expect(
      byokProtocolFor("https://api.deepseek.com/anthropic/messages", "codex"),
    ).toEqual({ fromUrl: true, protocol: "anthropic" });
    expect(
      byokProtocolFor("https://gw.example.com/custom-endpoint", "claude"),
    ).toEqual({ fromUrl: false, protocol: "anthropic" });
    expect(
      byokProtocolFor("https://gw.example.com/custom-endpoint", "codex"),
    ).toEqual({ fromUrl: false, protocol: "openai-responses" });
    expect(
      byokProtocolFor("https://gw.example.com/custom-endpoint", "pi"),
    ).toEqual({ fromUrl: false, protocol: "openai-chat" });
  });
});
