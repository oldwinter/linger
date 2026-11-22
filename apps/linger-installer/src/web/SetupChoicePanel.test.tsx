// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  INKLING_2_MINI_ANNOUNCEMENT_URL,
  INKLING_2_MINI_HF_URL,
} from "@linger/service-kit/featured-models";
import { afterEach, expect, it, vi } from "vitest";
import { byokEndpoint, emptyByokDraft } from "./ByokPanel.js";
import { SetupChoicePanel, type SetupReport } from "./SetupChoicePanel.js";
import { request } from "./api.js";
vi.mock("./api.js", () => ({ request: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});
const report = {
  choices: ["codex", "claude", "pi"],
  recommendation: "codex",
  runtimes: [],
  localModels: { estimate: { model: "" } },
} as unknown as SetupReport;
function renderByok() {
  const onInstall = vi.fn();
  render(
    <SetupChoicePanel
      report={report}
      choice="byok"
      onChange={() => {}}
      onInstall={onInstall}
      disabled={false}
    />,
  );
  return onInstall;
}
const status = () => document.querySelector(".byok-status")!;
const combobox = (name: string) =>
  screen.getByRole<HTMLInputElement>("combobox", { name });
function pick(box: string, option: RegExp) {
  fireEvent.click(
    screen.getByRole("button", { name: `Show ${box} suggestions` }),
  );
  fireEvent.click(screen.getByRole("option", { name: option }));
}

it("derives the wire format from the address ending, else the runtime", () => {
  const base = { ...emptyByokDraft, baseUrl: "https://ark.example.com/" };
  expect(byokEndpoint({ ...base, runtime: "codex" })).toEqual({
    baseUrl: "https://ark.example.com",
    path: "/v1",
    endpoint: "/responses",
    protocol: "openai-responses",
  });
  expect(
    byokEndpoint({
      ...base,
      baseUrl: "https://ark.example.com/api/v3/chat/completions",
      path: "",
      endpoint: "",
      runtime: "codex",
    }).protocol,
  ).toBe("openai-chat");
  expect(
    byokEndpoint({
      ...base,
      path: "v4/",
      endpoint: "/generate",
      apiKey: " k ",
    }),
  ).toEqual({
    baseUrl: "https://ark.example.com",
    path: "/v4",
    endpoint: "/generate",
    protocol: "anthropic",
    apiKey: "k",
  });
});

it("shows grey defaults that follow the runtime and says where requests go", () => {
  renderByok();
  expect(status().textContent).toBe(
    "Grey values are defaults. Path and endpoint are optional.",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), {
    target: { value: "http://192.168.1.20:8080" },
  });
  expect(combobox("Path").value).toBe("/v1");
  expect(combobox("Endpoint").value).toBe("/messages");
  expect(
    combobox("Endpoint")
      .closest("[data-default]")
      ?.getAttribute("data-default"),
  ).toBe("true");
  expect(status().textContent).toBe(
    "Sends Anthropic Messages requests to http://192.168.1.20:8080/v1/messages",
  );
  fireEvent.click(screen.getByRole("radio", { name: "Pi" }));
  expect(combobox("Endpoint").value).toBe("/chat/completions");
  pick("Endpoint", /^-No endpoint/);
  expect(combobox("Endpoint").value).toBe("");
  expect(status().textContent).toBe(
    "Sends OpenAI Chat Completions (the Pi format) requests to http://192.168.1.20:8080/v1",
  );
  fireEvent.change(combobox("Path"), { target: { value: "/v1?x" } });
  expect(status().textContent).toBe(
    "Path must be empty or a path such as /v1.",
  );
});

it("lists models, tests the one request address, and installs its parts", async () => {
  const onInstall = renderByok();
  vi.mocked(request).mockImplementation(async (path) =>
    path === "/byok/models"
      ? {
          url: "https://open.example.com/api/paas/v4/models",
          models: [{ id: "glm-5", name: "GLM 5", contextWindow: 131072 }],
        }
      : {
          ok: true,
          protocol: "openai-chat",
          url: "https://open.example.com/api/paas/v4/chat/completions",
          modelId: "glm-5",
          contextWindow: 131072,
        },
  );
  fireEvent.click(screen.getByRole("radio", { name: "Pi" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), {
    target: { value: "https://open.example.com/" },
  });
  fireEvent.blur(screen.getByRole("textbox", { name: "Base URL" }));
  fireEvent.change(combobox("Path"), { target: { value: "api/paas/v4/" } });
  fireEvent.blur(combobox("Path"));
  expect(combobox("Path").value).toBe("/api/paas/v4");
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "sk-test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "List models" }));
  expect(request).toHaveBeenCalledWith("/byok/models", {
    baseUrl: "https://open.example.com",
    path: "/api/paas/v4",
    endpoint: "/chat/completions",
    protocol: "openai-chat",
    apiKey: "sk-test",
  });
  fireEvent.click(await screen.findByRole("option", { name: /^glm-5GLM 5/ }));
  expect(combobox("Model").value).toBe("glm-5");

  vi.useFakeTimers({ shouldAdvanceTime: true });
  fireEvent.click(screen.getByRole("button", { name: "Test" }));
  expect(request).toHaveBeenLastCalledWith("/byok/check", {
    baseUrl: "https://open.example.com",
    path: "/api/paas/v4",
    endpoint: "/chat/completions",
    protocol: "openai-chat",
    apiKey: "sk-test",
    modelId: "glm-5",
  });
  expect(await screen.findByText("Connected")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(
    "glm-5 · 128k context · OpenAI Chat Completions",
  );
  act(() => void vi.advanceTimersByTime(3800));
  expect(screen.queryByText("Connected")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Install Linger" }));
  expect(onInstall).toHaveBeenCalledWith({
    baseUrl: "https://open.example.com",
    path: "/api/paas/v4",
    endpoint: "/chat/completions",
    protocol: "openai-chat",
    apiKey: "sk-test",
    modelId: "glm-5",
    runtime: "pi",
  });
  expect(screen.getByLabelText<HTMLInputElement>("API key").value).toBe("");
});

it("keeps a failed test on screen until the input changes", async () => {
  renderByok();
  vi.mocked(request).mockRejectedValue(
    new Error(
      "Nothing answered at https://api.example.com/v1/messages (HTTP 404).",
    ),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), {
    target: { value: "https://api.example.com" },
  });
  fireEvent.change(combobox("Model"), { target: { value: "m" } });
  fireEvent.click(screen.getByRole("button", { name: "Test" }));
  expect(await screen.findByText("Couldn't connect")).toBeTruthy();
  expect(
    screen.getByText(
      "Nothing answered at https://api.example.com/v1/messages (HTTP 404).",
    ),
  ).toBeTruthy();
  fireEvent.pointerDown(screen.getByText("Couldn't connect"));
  expect(screen.getByText("Couldn't connect")).toBeTruthy();
  fireEvent.change(combobox("Model"), { target: { value: "m2" } });
  expect(screen.queryByText("Couldn't connect")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Test" }));
  expect(await screen.findByText("Couldn't connect")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() =>
    expect(screen.queryByText("Couldn't connect")).toBeNull(),
  );
});

it("reports a listing failure in the status line and keeps the model box typeable", async () => {
  renderByok();
  vi.mocked(request).mockRejectedValue(
    new Error("https://api.example.com/v1/models answered HTTP 401."),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Base URL" }), {
    target: { value: "https://api.example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "List models" }));
  await waitFor(() =>
    expect(status().textContent).toBe(
      "https://api.example.com/v1/models answered HTTP 401.",
    ),
  );
  expect(status().getAttribute("data-tone")).toBe("err");
  fireEvent.change(combobox("Model"), { target: { value: "typed-model" } });
  expect(combobox("Model").value).toBe("typed-model");
});

it("renders the Inkling 2 Mini spotlight with safe external links and hardware context when not eligible", () => {
  render(
    <SetupChoicePanel
      report={
        {
          ...report,
          localModels: {
            eligible: false,
            estimate: { model: "" },
          },
        } as unknown as SetupReport
      }
      choice="codex"
      onChange={() => {}}
      onInstall={() => {}}
      disabled={false}
    />,
  );
  const spotlight = screen.getByRole("complementary", {
    name: "Featured local model: Inkling 2 Mini",
  });
  expect(spotlight.getAttribute("data-ready")).toBe("false");
  expect(spotlight.textContent).toContain("Featured · Thinking Machines");
  expect(spotlight.textContent).toContain(
    "Inkling 2 Mini — 26.4B looped MoE (3.4B active), native vision, built for local agentic coding (Apache 2.0).",
  );
  expect(spotlight.textContent).toContain(
    "Runs on 16–24 GB GPUs and 32 GB+ Macs · Manage anytime in Settings → Models",
  );

  const announcement = screen.getByRole<HTMLAnchorElement>("link", {
    name: "Thinking Machines",
  });
  expect(announcement.href).toBe(INKLING_2_MINI_ANNOUNCEMENT_URL);
  expect(announcement.target).toBe("_blank");
  expect(announcement.rel).toBe("noopener noreferrer");

  const hf = screen.getByRole<HTMLAnchorElement>("link", {
    name: "Hugging Face",
  });
  expect(hf.href).toBe(INKLING_2_MINI_HF_URL);
  expect(hf.target).toBe("_blank");
  expect(hf.rel).toBe("noopener noreferrer");
});

it("shows ready-to-run status when local models are eligible and badges recommended Inkling 2 Mini plans", () => {
  const eligibleReport = {
    ...report,
    choices: ["local-models", "codex", "claude", "pi"],
    recommendation: "local-models",
    localModels: {
      eligible: true,
      estimate: {
        model: "inkling-2-mini:Q4_K_M",
        downloadBytes: 15 * 1024 ** 3,
        diskBytes: 18 * 1024 ** 3,
        memoryBytes: 22 * 1024 ** 3,
      },
    },
  } as unknown as SetupReport;

  const { rerender } = render(
    <SetupChoicePanel
      report={eligibleReport}
      choice="codex"
      onChange={() => {}}
      onInstall={() => {}}
      disabled={false}
    />,
  );
  const spotlight = screen.getByRole("complementary", {
    name: "Featured local model: Inkling 2 Mini",
  });
  expect(spotlight.getAttribute("data-ready")).toBe("true");
  expect(spotlight.textContent).toContain(
    "Ready to run locally on this computer · Switchable anytime in Settings → Models",
  );
  expect(
    document.querySelector(".recommended-plan .featured-partner-tag"),
  ).toBeNull();

  rerender(
    <SetupChoicePanel
      report={eligibleReport}
      choice="local-models"
      onChange={() => {}}
      onInstall={() => {}}
      disabled={false}
    />,
  );
  expect(
    document.querySelector(".recommended-plan .featured-partner-tag")
      ?.textContent,
  ).toBe("Featured · Thinking Machines");
});

it("does not claim Inkling 2 Mini is ready when another model is planned or hardware is ineligible", () => {
  const otherModelEligible = {
    ...report,
    choices: ["local-models", "codex", "claude", "pi"],
    recommendation: "local-models",
    localModels: {
      eligible: true,
      estimate: {
        model: "qwen3.8-27b:UD-Q4_K_M",
        downloadBytes: 15 * 1024 ** 3,
        diskBytes: 18 * 1024 ** 3,
        memoryBytes: 22 * 1024 ** 3,
      },
    },
  } as unknown as SetupReport;

  const { rerender } = render(
    <SetupChoicePanel
      report={otherModelEligible}
      choice="local-models"
      onChange={() => {}}
      onInstall={() => {}}
      disabled={false}
    />,
  );
  const spotlight = screen.getByRole("complementary", {
    name: "Featured local model: Inkling 2 Mini",
  });
  expect(spotlight.getAttribute("data-ready")).toBe("false");
  expect(spotlight.textContent).toContain(
    "Runs on 16–24 GB GPUs and 32 GB+ Macs · Manage anytime in Settings → Models",
  );
  expect(
    document.querySelector(".recommended-plan .featured-partner-tag"),
  ).toBeNull();

  // Even if choice is local-models and estimate names Inkling, eligible: false stays neutral.
  rerender(
    <SetupChoicePanel
      report={
        {
          ...report,
          localModels: {
            eligible: false,
            estimate: { model: "inkling-2-mini:UD-Q4_K_M" },
          },
        } as unknown as SetupReport
      }
      choice="local-models"
      onChange={() => {}}
      onInstall={() => {}}
      disabled={false}
    />,
  );
  expect(spotlight.getAttribute("data-ready")).toBe("false");
  expect(spotlight.textContent).toContain(
    "Runs on 16–24 GB GPUs and 32 GB+ Macs · Manage anytime in Settings → Models",
  );
});
