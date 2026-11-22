// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { seedTeamMd } from "@/test/teamhub-seed";

import { CollaborationGraph } from "./collaboration-panel";
import { layoutTeamGraph } from "./team-graph";

const words = zhCN.collaboration;

function agentName(name: string, identity: string) {
  return words.agentIdentity
    .replace("{name}", name)
    .replace("{identity}", identity);
}

describe("Collaboration in the language on screen", () => {
  afterEach(() => resetLanguageForTest());

  it("names each Agent's part in the pattern when the graph is laid out", async () => {
    const english = layoutTeamGraph(seedTeamMd, 360);
    expect(english.nodes.map((node) => node.identity)).toEqual([
      "Coordinator",
      "Verifier",
    ]);
    await setLanguage("zh-CN");
    expect(
      layoutTeamGraph(seedTeamMd, 360).nodes.map((node) => node.identity),
    ).toEqual([words.coordinator, words.verifier]);
  });

  it("switches the graph, its legend and the Agent detail", async () => {
    render(<CollaborationGraph actors={[]} document={seedTeamMd} />);
    expect(screen.getByRole("button", { name: "Handoff" })).toBeVisible();

    await act(() => setLanguage("zh-CN"));
    expect(screen.getByRole("group", { name: words.graph })).toBeVisible();
    expect(screen.getByRole("group", { name: words.legend })).toBeVisible();
    expect(screen.getByRole("button", { name: words.handoff })).toBeVisible();
    expect(screen.getByRole("button", { name: words.report })).toBeVisible();
    expect(screen.getByText(words.selectAgent)).toBeVisible();
    expect(
      screen.getByText(
        words.sourceRevision.replace("{revision}", String(seedTeamMd.revision)),
      ),
    ).toBeVisible();

    const lead = seedTeamMd.orchestrator.name;
    fireEvent.click(
      screen.getByRole("button", { name: agentName(lead, words.coordinator) }),
    );
    expect(screen.getByText(words.receivesFrom)).toBeVisible();
    expect(screen.getByText(words.sendsTo)).toBeVisible();
  });
});
