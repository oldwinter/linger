import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { createTeamHubApi } from "@/features/teamhub/teamhub-api";
import {
  fetchDouble,
  type SentRequestInit,
} from "@/features/teamhub/teamhub-client-test-support";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubBrowserConnectionStatus } from "@/features/teamhub/teamhub-types";

import { BrowserConnectionDialog } from "./browser-connection-dialog";

const tenantId = "tenant-northstar";
const token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U_-";
const isolated: TeamHubBrowserConnectionStatus = {
  mode: "isolated",
  platform: "darwin",
  state: "isolated",
};
const connected: TeamHubBrowserConnectionStatus = {
  browser: "chrome",
  message: "Chrome 147 connected",
  mode: "user_chrome",
  platform: "darwin",
  state: "connected",
};

type BrowserRoute = (
  method: string,
  body: unknown,
) => Promise<TeamHubBrowserConnectionStatus>;

const mac = {
  computer_id: "computer-mac",
  display_name: "Alice's Mac",
  status: "online",
};

function setup(
  browser: BrowserRoute,
  options: {
    computers?: {
      computer_id: string;
      display_name: string;
      status: string;
    }[];
    withRouter?: boolean;
  } = {},
) {
  const computers = options.computers ?? [mac];
  const route = vi.fn(browser);
  const request = vi.fn(async (path: string, init: SentRequestInit) => {
    const match =
      /^\/v0\/tenants\/[^/]+\/local-computers\/([^/]+)\/browser-connection$/.exec(
        path,
      );
    if (!computers.some(({ computer_id }) => computer_id === match?.[1]))
      throw new Error(path);
    return route(
      init.method ?? "GET",
      init.body ? JSON.parse(init.body as string) : undefined,
    );
  });
  const api = createTeamHubApi({
    baseUrl: new URL("https://teamhub.test/"),
    fetchRequest: fetchDouble(async (url, init) => {
      try {
        return Response.json(await request(new URL(url).pathname, init));
      } catch (error) {
        if (!(error instanceof TeamHubError)) throw error;
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      }
    }),
    onAuthenticationRequired: vi.fn(),
  });
  const client = {
    listTenantLocalComputers: vi.fn().mockResolvedValue({ items: computers }),
    api,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  const dialog = (
    <BrowserConnectionDialog onClose={onClose} tenantId={tenantId} />
  );
  render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={{ client } as never}>
        {options.withRouter ? <MemoryRouter>{dialog}</MemoryRouter> : dialog}
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { onClose, queryClient, request, route };
}

describe("BrowserConnectionDialog", () => {
  it("connects with the pasted line and keeps the token out of caches and storage", async () => {
    const { queryClient, request, route } = setup(async (method) =>
      method === "PUT" ? connected : isolated,
    );

    const input = await screen.findByLabelText("Extension token");
    // The subtitle names the only Computer, so there is nothing to pick.
    expect(screen.getByText("Alice's Mac")).toBeVisible();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getByRole("link", { name: /Playwright Extension/ }),
    ).toHaveAttribute(
      "href",
      "https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm",
    );
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    const pasted = ` PLAYWRIGHT_MCP_EXTENSION_TOKEN=${token} `;
    fireEvent.change(input, { target: { value: pasted } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Connected");
    // A healthy connection needs no detail.
    expect(screen.queryByText("Chrome 147 connected")).toBeNull();
    expect(screen.getByRole("button", { name: "Replace token" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
    // Token was cleared on success so reopening the form starts blank.
    fireEvent.click(screen.getByRole("button", { name: "Replace token" }));
    expect(screen.getByLabelText("Extension token")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(route).toHaveBeenCalledWith("PUT", { extension_token: pasted });
    expect(request).not.toHaveBeenCalledWith(
      expect.stringContaining(token),
      expect.anything(),
    );

    const cached = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => [query.queryKey, query.state.data]),
      queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.variables),
    ]);
    expect(cached).not.toContain(token);
    expect(JSON.stringify({ ...localStorage })).not.toContain(token);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(token);
  });

  it("offers a picker when there are several Computers and reads the chosen one", async () => {
    const { request } = setup(async () => isolated, {
      computers: [
        mac,
        {
          computer_id: "computer-pc",
          display_name: "Alice's PC",
          status: "online",
        },
      ],
    });

    const picker = await screen.findByRole("combobox", { name: "Computer" });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: "Alice's PC" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.stringContaining("/local-computers/computer-pc/"),
        expect.anything(),
      ),
    );
    expect(picker).toHaveAttribute("value", "computer-pc");
  });

  it("asks for inline confirmation before disconnecting a connected Chrome and shows loading", async () => {
    let resolveDisconnect!: (status: TeamHubBrowserConnectionStatus) => void;
    const { route } = setup(async (method) => {
      if (method === "DELETE") {
        return new Promise<TeamHubBrowserConnectionStatus>((resolve) => {
          resolveDisconnect = resolve;
        });
      }
      return connected;
    });

    const dialog = screen.getByRole("dialog", { name: "Connect Chrome" });
    expect(dialog).toHaveAttribute("data-size", "sm");
    expect(dialog).toHaveClass("app-dialog-standard");
    expect(dialog.className).not.toContain("fixed inset-0");

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    const confirmation = screen.getByRole("group", {
      name: "Confirm browser disconnection",
    });
    expect(within(confirmation).getByText("Disconnect Chrome?")).toBeVisible();
    expect(route).not.toHaveBeenCalledWith("DELETE", undefined);

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );
    expect(
      screen.queryByRole("group", { name: "Confirm browser disconnection" }),
    ).toBeNull();
    expect(route).not.toHaveBeenCalledWith("DELETE", undefined);

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const confirmDisconnect = within(
      screen.getByRole("group", { name: "Confirm browser disconnection" }),
    ).getByRole("button", { name: "Disconnect" });
    fireEvent.click(confirmDisconnect);

    await waitFor(() =>
      expect(confirmDisconnect).toHaveAttribute("aria-busy", "true"),
    );

    await act(async () => {
      resolveDisconnect(isolated);
    });

    expect(await screen.findByLabelText("Extension token")).toBeVisible();
    expect(route).toHaveBeenCalledWith("DELETE", undefined);
  });

  it("sets loading on Connect while configuring", async () => {
    let resolveConnect!: (status: TeamHubBrowserConnectionStatus) => void;
    setup(async (method) => {
      if (method === "PUT") {
        return new Promise<TeamHubBrowserConnectionStatus>((resolve) => {
          resolveConnect = resolve;
        });
      }
      return isolated;
    });

    fireEvent.change(await screen.findByLabelText("Extension token"), {
      target: { value: token },
    });
    const connectButton = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectButton);
    await waitFor(() =>
      expect(connectButton).toHaveAttribute("aria-busy", "true"),
    );
    await act(async () => {
      resolveConnect(connected);
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Connected");
  });

  it("links to Settings › Computers when the user has no Local Computer yet", async () => {
    const { onClose } = setup(async () => isolated, {
      computers: [],
      withRouter: true,
    });

    const link = await screen.findByRole("link", {
      name: "Settings › Computers",
    });
    expect(link).toHaveAttribute(
      "href",
      "/t/tenant-northstar/settings/computers",
    );
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("explains a rejected token and asks for a new paste", async () => {
    setup(async (method) => {
      if (method === "GET") return { ...connected, state: "token_invalid" };
      throw new TeamHubError({
        code: "INVALID_BROWSER_TOKEN",
        message: "Paste the token shown by the Playwright Extension",
        status: 400,
      });
    });

    expect(
      await screen.findByText(
        "Token expired. Copy a new token from the extension, then reconnect.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Replace token" }));
    const input = screen.getByLabelText("Extension token");
    fireEvent.change(input, { target: { value: "not a token" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't read this token",
    );
    expect(input).toHaveValue("not a token");
  });

  it("keeps the pasted token on transient failure so the user can retry without re-copying", async () => {
    let attempts = 0;
    const { route } = setup(async (method) => {
      if (method === "GET") return isolated;
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Network error");
      }
      return connected;
    });

    const input = await screen.findByLabelText("Extension token");
    fireEvent.change(input, { target: { value: token } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(input).toHaveValue(token);

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Connected");
    expect(route).toHaveBeenCalledWith("PUT", { extension_token: token });
    fireEvent.click(screen.getByRole("button", { name: "Replace token" }));
    expect(screen.getByLabelText("Extension token")).toHaveValue("");
  });

  it("tells a token the extension refused apart from a retryable failure", async () => {
    setup(async (method) => {
      if (method === "GET") return isolated;
      throw new TeamHubError({
        code: "BROWSER_TOKEN_REJECTED",
        message: "The Playwright Extension did not accept this token",
        status: 502,
      });
    });

    fireEvent.change(await screen.findByLabelText("Extension token"), {
      target: { value: token },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The extension didn't accept this token",
    );
  });

  it("lets a new paste replace a damaged saved connection", async () => {
    const { route } = setup(async (method) => {
      if (method === "PUT") return connected;
      throw new TeamHubError({
        code: "BROWSER_CONNECTION_INVALID",
        message:
          "The saved browser connection is invalid; connect the browser again",
        status: 502,
      });
    });

    fireEvent.change(await screen.findByLabelText("Extension token"), {
      target: { value: token },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByRole("button", { name: "Replace token" }),
    ).toBeVisible();
    expect(route).toHaveBeenCalledWith("PUT", { extension_token: token });
  });

  it("offers no form when the Computer cannot reuse Chrome", async () => {
    setup(async () => ({ ...isolated, state: "unsupported" }));

    expect(
      await screen.findByText(
        "This Computer can't use your browser. Agents use a separate browser without your sign-ins.",
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByLabelText("Extension token")).toBeNull(),
    );
  });
});
