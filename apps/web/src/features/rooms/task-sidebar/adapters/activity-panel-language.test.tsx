import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentLiveActivities } from "@/features/rooms/members/agent-live-activities";
import type { RunStatusSubscription } from "@/features/teamhub/run-status-transport";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubMessageActivityRecord,
  TeamHubRunStatus,
  TeamHubTaskExecution,
} from "@/features/teamhub/teamhub-types";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { RuntimeTrajectoryView } from "./runtime-trajectory-view";
import { TaskActivitiesPanelTab } from "./task-activities-panel-tab";

const panel = zhCN.activityPanel;
const run = zhCN.runPanel;
const stamp = "2026-10-09T09:00:00Z";

function zhTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function renderTaskPanel() {
  const runtime = createTestTeamHubRuntime();
  const actor = {
    display_name: "Jenny",
    id: "actor-jenny",
    kind: "human" as const,
    tenant_id: "tenant-northstar",
  };
  runtime.server.on("GET", "/v0/work-items/{workItemId}", ({ params }) => ({
    assignees: [],
    created_at: stamp,
    created_by: actor,
    description: "Inspect the workspace",
    explicit_access_grants: [],
    id: params.workItemId,
    kind: "task",
    number: 17,
    priority: "medium",
    referenced_actors: [],
    state: "in_progress",
    tenant_id: "tenant-northstar",
    title: "Check the workspace",
    updated_at: stamp,
    updated_by: actor,
    version: 1,
    work_room_id: "room-all",
  }));
  const execution: TeamHubTaskExecution = {
    control_revision: 0,
    control_settled_revision: 0,
    current_attempt: { attempt_number: 2 } as never,
    desired_control: "run",
    execution_revision: 1,
    execution_updated_at: stamp,
    generation: 1,
    run_spec: {
      attempt_policy: {
        max_retries: 0,
        policy_version: 1,
        retry_on_agent_failure: false,
        retry_on_timeout: false,
        timeout_seconds: 60,
      },
      result_agent_actor_id: "agent-codex",
      schema_version: 1,
    },
    status: "running",
    task_id: "task-a",
  };
  runtime.server.on("GET", "/v0/tasks/{taskId}/execution", () => execution);
  const active: TeamHubRunStatus = {
    agent: { display_name: "Codex", id: "agent-codex", kind: "agent" },
    created_at: stamp,
    id: "run-1",
    replied: false,
    revision: 1,
    room_id: "room-all",
    run_id: "run-1",
    status: "active",
    updated_at: stamp,
  };
  vi.spyOn(runtime.client.workItems, "listActivities").mockResolvedValue({
    active_items: [active],
    history_items: [],
    work_room_id: "room-all",
  });
  runtime.server.on(
    "GET",
    "/v0/rooms/{roomId}/runs/{runId}/runtime-presentation-events",
    () => ({ has_more: false, items: [], published_through_ordinal: "0" }),
  );
  const testRuntime = {
    ...runtime,
    runStatuses: {
      subscribe: (_input: RunStatusSubscription) => vi.fn(),
    },
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={testRuntime}>
        <MemoryRouter>
          <TaskActivitiesPanelTab
            hidden={false}
            taskId="task-a"
            tenantId="tenant-northstar"
          />
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

describe("activity panels in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("words a Task's activity panel in Chinese and dates it the Chinese way", async () => {
    await setLanguage("zh-CN");
    renderTaskPanel();

    const section = screen.getByRole("region", { name: panel.taskActivities });
    expect(
      await within(section).findByText(
        panel.taskNumber.replace("{number}", "17"),
      ),
    ).toBeVisible();
    expect(
      within(section).getByRole("heading", { name: "Check the workspace" }),
    ).toBeVisible();
    // Refreshing only reloads; it risks nothing, so it carries no marker.
    expect(
      within(section).getByRole("button", { name: panel.refreshTask }),
    ).not.toHaveAttribute("data-voice-risk");
    expect(
      await within(section).findByText(zhCN.runtimeStatus.taskStatusRunning),
    ).toBeVisible();
    expect(
      within(section).getByText(panel.attempt.replace("{number}", "2")),
    ).toBeVisible();
    expect(
      within(section).getByText(panel.updated.replace("{time}", zhTime(stamp))),
    ).toBeVisible();

    const tabs = within(section).getByRole("navigation", {
      name: panel.taskSections,
    });
    expect(
      within(tabs).getByRole("button", { name: panel.tabActivity }),
    ).toHaveAttribute("aria-current", "page");

    const runRow = await within(section).findByRole("button", {
      name: (name) =>
        name.includes("Codex") &&
        name.includes(
          panel.runStarted
            .replace("{time}", zhTime(stamp))
            .replace("{state}", panel.runWorking),
        ),
    });
    expect(
      within(runRow).getByRole("img", { name: panel.agentWorking }),
    ).toBeVisible();

    fireEvent.click(
      within(tabs).getByRole("button", { name: panel.tabDetails }),
    );
    await waitFor(() => expect(section).toHaveTextContent(panel.assignees));
    expect(section).toHaveTextContent(panel.unassigned);
    expect(section).toHaveTextContent(panel.priority);
    expect(section).toHaveTextContent(panel.execution);
    expect(
      within(section).getByRole("heading", { name: panel.description }),
    ).toBeVisible();
  });

  it("words a Run's steps in Chinese and keeps the commands as written", async () => {
    await setLanguage("zh-CN");
    const records = [
      codex(1, "tool_call", "response_item.function_call", {
        arguments: JSON.stringify({ cmd: "pnpm test" }),
        call_id: "c1",
        name: "exec_command",
        type: "function_call",
      }),
      codex(2, "tool_result", "response_item.function_call_output", {
        call_id: "c1",
        output: "12 passed",
        type: "function_call_output",
      }),
    ];
    render(<RuntimeTrajectoryView live={false} records={records} />);

    expect(
      screen.getByRole("list", { name: zhCN.runtimeStatus.activityLog }),
    ).toBeInTheDocument();
    const ran = screen.getByTitle(
      run.ran.replace("<detail>{detail}</detail>", "pnpm test"),
    );
    fireEvent.click(ran);
    expect(screen.getByRole("region", { name: run.output })).toHaveTextContent(
      "12 passed",
    );
  });

  it("titles an Agent's live activities in Chinese", async () => {
    await setLanguage("zh-CN");
    render(
      <AgentLiveActivities
        activities={[{ detail: "2m", id: "a1", label: "Reviewing notes" }]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: zhCN.agentLiveActivities.title }),
    ).toBeVisible();
    expect(screen.getByText("Reviewing notes")).toBeVisible();
  });
});

function codex(
  ordinal: number,
  category: TeamHubMessageActivityRecord["category"],
  nativeType: string,
  payload: Record<string, unknown>,
): TeamHubMessageActivityRecord {
  return {
    category,
    native_record: { payload, type: nativeType.split(".")[0] },
    native_type: nativeType,
    ordinal,
    redacted_fields: [],
    tool_call_id: payload.call_id as string,
    ...(typeof payload.name === "string" ? { tool_name: payload.name } : {}),
    turn_id: "turn-codex",
  };
}
