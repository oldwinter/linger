import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage, translate } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { decisionCardHeading } from "./card-prompts";
import type { DecisionMessageCard } from "./decision-card";

afterEach(() => resetLanguageForTest());

const base = {
  card_type: "personal_notice",
  intent: "decision_requested",
  version: 1,
  decision_id: "decision-1",
  status: "pending",
  decision_owner: { id: "alice", display_name: "Alice", kind: "human" },
  requester: { id: "writer", display_name: "Writer", kind: "agent" },
} as const;

function card(fields: Partial<DecisionMessageCard>): DecisionMessageCard {
  return { ...base, kind: "question", title: "TeamHub title", ...fields };
}

describe("decisionCardHeading", () => {
  it("words TeamHub's asks from the card's kind and fields", () => {
    expect(
      decisionCardHeading(
        card({
          kind: "connection_auth",
          connection_auth: { app_key: "notion", account: "work@example.com" },
        }),
        translate,
      ),
    ).toBe(
      "Please connect and authorize the Notion account work@example.com so I can continue.",
    );
    expect(
      decisionCardHeading(
        card({
          kind: "search_key",
          search_key: {
            backend: "brave",
            origin: "suggested",
            reason: "free_limit",
          },
        }),
        translate,
      ),
    ).toBe(
      "The free web search trial is used up. Please add a web search API key so I can keep searching; Brave Search is suggested.",
    );
  });

  it("follows the interface language", async () => {
    await setLanguage("zh-CN");
    expect(
      decisionCardHeading(card({ kind: "browser_connection" }), translate),
    ).toBe(zhCN.cardPrompts.browserConnection);
    expect(
      decisionCardHeading(
        card({
          kind: "provider_key",
          provider_key: { app_key: "gmail" },
        }),
        translate,
        { app: "Gmail" },
      ),
    ).toBe(zhCN.cardPrompts.providerKeyApp.replace("{app}", "Gmail"));
    expect(
      decisionCardHeading(
        card({
          kind: "agent_change",
          agent_change: {
            action: "create",
            agent_name: "Nova",
            changes: [],
          } as unknown as DecisionMessageCard["agent_change"],
        }),
        translate,
      ),
    ).toBe(zhCN.cardPrompts.agentCreate.replace("{name}", "Nova"));
  });

  it("keeps the title TeamHub sent for anything it does not word", async () => {
    await setLanguage("zh-CN");
    // An Agent's own question, in the Agent's words.
    expect(
      decisionCardHeading(
        card({ title: "Which draft do you prefer?" }),
        translate,
      ),
    ).toBe("Which draft do you prefer?");
    // A kind added to TeamHub after this client was built.
    expect(
      decisionCardHeading(
        card({ kind: "calendar_hold" as never, title: "Hold Friday 3pm?" }),
        translate,
      ),
    ).toBe("Hold Friday 3pm?");
    // A card without the fields its wording needs.
    expect(
      decisionCardHeading(
        card({ kind: "connection_auth", title: "Please connect an app." }),
        translate,
      ),
    ).toBe("Please connect an app.");
  });
});
