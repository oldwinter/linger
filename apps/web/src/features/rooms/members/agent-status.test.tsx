// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { AgentStatus } from "./agent-status";

afterEach(() => {
  cleanup();
  resetLanguageForTest();
});

describe("AgentStatus", () => {
  it("words the online status and the task count in English", () => {
    render(
      <AgentStatus
        availability={{
          status: "online",
          label: "Online",
          active_task_count: 1,
        }}
        showDetails
      />,
    );
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText(/1 task in progress/)).toBeInTheDocument();
  });

  it("follows the interface language", async () => {
    await setLanguage("zh-CN");
    render(
      <AgentStatus
        availability={{
          status: "online",
          label: "Online",
          active_task_count: 2,
        }}
        showDetails
      />,
    );
    expect(screen.getByText(zhCN.agentInfo.online)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          zhCN.agentInfo.tasksInProgress.other.replace("{count}", "2"),
        ),
      ),
    ).toBeInTheDocument();
  });

  it("words the status and its detail from the reason TeamHub sends", async () => {
    await setLanguage("zh-CN");
    render(
      <AgentStatus
        availability={{
          status: "offline",
          label: "Offline",
          reason: "waiting_for_computer",
          active_task_count: 0,
          current_activity: { summary: "Waiting for the computer to connect" },
        }}
        showDetails
      />,
    );
    expect(
      screen.getByText(zhCN.agentAvailability.offline),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(zhCN.agentAvailability.waitingForComputer)),
    ).toBeInTheDocument();
  });

  it("keeps the Runtime's own diagnostic beside a worded label", async () => {
    await setLanguage("zh-CN");
    render(
      <AgentStatus
        availability={{
          status: "error",
          label: "Needs attention",
          reason: "runtime_error",
          active_task_count: 0,
          current_activity: { summary: "codex exited with status 2" },
        }}
        showDetails
      />,
    );
    expect(
      screen.getByText(zhCN.agentAvailability.needsAttention),
    ).toBeInTheDocument();
    expect(screen.getByText(/codex exited with status 2/)).toBeInTheDocument();
  });

  it("shows TeamHub's English label when there is no reason", async () => {
    await setLanguage("zh-CN");
    render(
      <AgentStatus
        availability={{
          status: "unknown",
          label: "Status unavailable",
          active_task_count: 0,
        }}
      />,
    );
    expect(screen.getByText("Status unavailable")).toBeInTheDocument();
  });

  it("falls back to TeamHub's English for a reason it does not know", async () => {
    await setLanguage("zh-CN");
    render(
      <AgentStatus
        availability={{
          status: "offline",
          label: "Paused by admin",
          // A reason added to TeamHub after this client was built.
          reason: "paused_by_admin" as never,
          active_task_count: 0,
          current_activity: { summary: "An admin paused this Agent" },
        }}
        showDetails
      />,
    );
    expect(screen.getByText("Paused by admin")).toBeInTheDocument();
    expect(screen.getByText(/An admin paused this Agent/)).toBeInTheDocument();
  });
});
