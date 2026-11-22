import {
  BYOK_PROTOCOL_ENDPOINTS,
  DEFAULT_BYOK_PATH,
} from "@linger/service-kit/byok-endpoint";
import type { components } from "@linger/wire-contracts/teamhub-public/types";

import type { Translate } from "@/i18n/language";

import { localModelsMessages as m } from "./local-models.messages";

type Schemas = components["schemas"];
type ByokProtocol = Schemas["ByokProtocol"];

/** Paths some providers document; any other path can be typed. */
export function byokPathSuggestions(
  t: Translate,
): readonly { label: string; value: string }[] {
  return [
    { label: t(m.byokPathMostProviders), value: DEFAULT_BYOK_PATH },
    {
      label: t(m.byokPathZhipu, { url: "https://open.bigmodel.cn" }),
      value: "/api/paas/v4",
    },
    { label: t(m.byokPathVolcano), value: "/api/v3" },
    { label: "Gemini", value: "/v1beta/openai" },
    { label: t(m.byokPathNone), value: "" },
  ];
}

/** The three endpoints whose ending names a wire format, then none. */
export const byokEndpointSuggestions: readonly {
  protocol?: ByokProtocol;
  value: string;
}[] = [
  { protocol: "openai-chat", value: BYOK_PROTOCOL_ENDPOINTS["openai-chat"] },
  {
    protocol: "openai-responses",
    value: BYOK_PROTOCOL_ENDPOINTS["openai-responses"],
  },
  { protocol: "anthropic", value: BYOK_PROTOCOL_ENDPOINTS.anthropic },
  { value: "" },
];

/** A context window as the BYOK form shows it. */
export function byokContextLabel(tokens: number, t: Translate) {
  return tokens < 1024
    ? t(m.byokContextTokens, { tokens })
    : t(m.byokContextKilo, { thousands: Math.round(tokens / 1024) });
}
