// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
