import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage, translate } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { byokFailureCopy, modelSourceFailureCopy } from "./local-models-copy";

afterEach(() => {
  resetLanguageForTest();
});

describe("local-models-copy model source failures", () => {
  it("preserves BYOK gateway detail and forwarded BYOK endpoint refusal messages", () => {
    expect(
      modelSourceFailureCopy(
        {
          code: "BYOK_GATEWAY_FAILED",
          details: [{ field: "gateway", reason: "  port 18100 in use  " }],
          message: "The Computer could not configure its local BYOK gateway",
        },
        translate,
      ),
    ).toBe(
      "The computer couldn't configure its local BYOK gateway: port 18100 in use",
    );
    expect(
      modelSourceFailureCopy(
        {
          code: "BYOK_AUTH_FAILED",
          message:
            "https://api.example.com/v1/chat/completions rejected the API key (HTTP 401).",
        },
        translate,
      ),
    ).toBe(
      "https://api.example.com/v1/chat/completions rejected the API key (HTTP 401).",
    );
  });

  it("uses localized client copy when refusal message is empty or code is not passthrough", async () => {
    expect(byokFailureCopy("BYOK_AUTH_FAILED", "", translate)).toBe(
      "The endpoint rejected the API key.",
    );
    expect(
      modelSourceFailureCopy(
        {
          code: "MODEL_SOURCE_FAILED",
          message: "raw server text",
        },
        translate,
      ),
    ).toBe("The computer couldn't switch. Try again.");
    expect(
      modelSourceFailureCopy(
        {
          code: "BYOK_INVALID_CONFIG",
          message: "raw server text",
        },
        translate,
      ),
    ).toBe(
      "The computer can't use this endpoint. An HTTPS endpoint needs an API key; plain HTTP works only on this computer or your local network.",
    );

    await setLanguage("zh-CN");
    expect(byokFailureCopy("BYOK_AUTH_FAILED", "", translate)).toBe(
      zhCN.localModels.sourceByokAuthFailed,
    );
    expect(
      modelSourceFailureCopy(
        {
          code: "MODEL_SOURCE_FAILED",
          message: "raw server text",
        },
        translate,
      ),
    ).toBe(zhCN.localModels.sourceSwitchFailed);
  });

  it("distinguishes BYOK probe timeout wording from model-source switch timeout wording", async () => {
    const switchTimeout = modelSourceFailureCopy(
      {
        code: "MODEL_SOURCE_UNCONFIRMED",
        message: "The Computer did not answer in time",
      },
      translate,
    );
    const probeTimeout = byokFailureCopy(
      "MODEL_SOURCE_UNCONFIRMED",
      "The Computer did not answer in time",
      translate,
    );

    expect(switchTimeout).toBe(
      "The computer didn't answer in time. It may still be switching; check again in a minute.",
    );
    expect(probeTimeout).toBe(
      "The computer didn't answer in time while checking the endpoint. Try again.",
    );
    expect(probeTimeout).not.toContain("switching");

    await setLanguage("zh-CN");
    expect(
      modelSourceFailureCopy({ code: "MODEL_SOURCE_UNCONFIRMED" }, translate),
    ).toBe(zhCN.localModels.sourceUnconfirmed);
    expect(byokFailureCopy("MODEL_SOURCE_UNCONFIRMED", "", translate)).toBe(
      zhCN.localModels.sourceByokProbeUnconfirmed,
    );
  });
});
