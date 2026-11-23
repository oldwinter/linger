import { describe, expect, it } from "vitest";

import type {
  TeamHubLocalComputerPage,
  TeamHubTenantAgent,
} from "@/features/teamhub/teamhub-types";

import {
  computerReadiness,
  preferredComputerRuntime,
} from "./computer-readiness";

type LocalComputer = TeamHubLocalComputerPage["items"][number];

function computer(
  runtimes: LocalComputer["runtimes"],
  overrides: Partial<LocalComputer> = {},
): LocalComputer {
  return {
    active_operations: 0,
    computer_id: "computer-a",
    display_name: "Computer A",
    runtimes,
    status: "online",
    upgrade_required: false,
    workspace_grants: [],
    ...overrides,
  };
}

describe("computerReadiness", () => {
  it("is ready as soon as one AI app is, whatever the others report", () => {
    expect(
      computerReadiness(
        computer([
          { models: [], status: "authentication_required", type: "claude" },
          { models: [], status: "ready", type: "codex" },
          { models: [], status: "not_installed", type: "pi" },
        ]),
        "online",
      ),
    ).toEqual({ app: "codex", kind: "ready" });
  });

  it("asks to sign in before suggesting a new app", () => {
    expect(
      computerReadiness(
        computer([
          { models: [], status: "not_installed", type: "claude" },
          { models: [], status: "authentication_required", type: "pi" },
        ]),
        "online",
      ),
    ).toEqual({ app: "pi", kind: "signIn" });
    expect(computerReadiness(computer([]), "online")).toEqual({
      app: "claude",
      kind: "setUp",
    });
  });

  it("points at an installed app that is outdated or unchecked before suggesting a new one", () => {
    expect(
      computerReadiness(
        computer([
          { models: [], status: "unknown", type: "claude" },
          { models: [], status: "incompatible", type: "codex" },
        ]),
        "online",
      ),
    ).toEqual({ app: "codex", kind: "updateApp" });
    expect(
      computerReadiness(
        computer([
          { models: [], status: "unknown", type: "claude" },
          { models: [], status: "error", type: "pi" },
        ]),
        "online",
      ),
    ).toEqual({ app: "pi", kind: "check" });
    expect(
      computerReadiness(
        computer([{ models: [], status: "unknown", type: "codex" }]),
        "online",
      ),
    ).toEqual({ app: "codex", kind: "check" });
  });

  it("puts a required update ahead of being offline, and reconnecting ahead of both", () => {
    const outdated = computer([], {
      status: "offline",
      upgrade_required: true,
    });
    expect(computerReadiness(outdated, "offline")).toEqual({ kind: "update" });
    expect(computerReadiness(outdated, "reconnecting")).toEqual({
      kind: "reconnecting",
    });
    expect(
      computerReadiness(computer([], { status: "offline" }), "offline"),
    ).toEqual({ kind: "offline" });
  });

  it("prefers the Computer's active model-source runtime when multiple AI apps are ready", () => {
    const multiReady = computer([
      { models: [], status: "ready", type: "claude" },
      { models: [], status: "ready", type: "codex" },
      { models: [], status: "ready", type: "pi" },
    ]);
    expect(computerReadiness(multiReady, "online")).toEqual({
      app: "claude",
      kind: "ready",
    });
    expect(computerReadiness(multiReady, "online", "pi")).toEqual({
      app: "pi",
      kind: "ready",
    });
    expect(
      computerReadiness(
        computer([
          { models: [], status: "ready", type: "claude" },
          { models: [], status: "not_installed", type: "pi" },
        ]),
        "online",
        "pi",
      ),
    ).toEqual({ app: "claude", kind: "ready" });
  });

  it("resolves preferredComputerRuntime from model-source first, then Another Me and local Agents", () => {
    const agent = (
      runtimeType: "claude" | "codex" | "pi",
      agentType: "anotherme" | "general" = "general",
    ) =>
      ({
        agent_type: agentType,
        runtime: {
          model: "localmodels-byok",
          placement: {
            computer_id: "computer-a",
            runtime_type: runtimeType,
            type: "local",
            workspace_grant_id: "grant-1",
          },
        },
      }) as TeamHubTenantAgent;

    expect(
      preferredComputerRuntime([agent("claude"), agent("claude")], "pi"),
    ).toBe("pi");
    expect(
      preferredComputerRuntime([agent("claude"), agent("pi", "anotherme")]),
    ).toBe("pi");
    expect(
      preferredComputerRuntime([agent("claude"), agent("pi"), agent("pi")]),
    ).toBe("pi");
    expect(preferredComputerRuntime([])).toBeUndefined();
  });
});
