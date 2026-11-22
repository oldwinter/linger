import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import {
  teamHubErrorResponse,
  type TestRouteHandler,
} from "@/test/teamhub-test-server";
import { MessageForwardDialog } from "./message-forward-dialog";

const forwardPath = "/v0/rooms/{roomId}/messages/{messageId}/forward";

function renderForwardDialog() {
  const runtime = createTestTeamHubRuntime();
  const message = runtime.seed.messagesByRoom.get("room-all")![0]!;
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MessageForwardDialog
        client={runtime.client}
        message={message}
        onClose={onClose}
        tenantId={message.tenant_id}
      />
    </QueryClientProvider>,
  );
  return { runtime, onClose };
}

async function selectRooms() {
  fireEvent.click(screen.getByRole("button", { name: "Rooms" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /^gtm-launch\s*Select$/u }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /^product-v0\s*Select$/u }),
  );
}

async function sentTargets(
  runtime: ReturnType<typeof createTestTeamHubRuntime>,
) {
  return Promise.all(
    runtime.server.requestsTo("POST", forwardPath).map(async (request) => ({
      body: await request.clone().json(),
      key: request.headers.get("Idempotency-Key"),
    })),
  );
}

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("MessageForwardDialog", () => {
  it("forwards the message to the selected Agent with an idempotency key", async () => {
    const runtime = createTestTeamHubRuntime();
    const message = runtime.seed.messagesByRoom.get("room-all")![0]!;
    const forward = vi.fn<TestRouteHandler>(() => ({ items: [] }));
    runtime.server.on(
      "POST",
      "/v0/rooms/{roomId}/messages/{messageId}/forward",
      forward,
    );
    const onClose = vi.fn();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MessageForwardDialog
          client={runtime.client}
          message={message}
          onClose={onClose}
          tenantId={message.tenant_id}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Codex/u }));
    fireEvent.click(screen.getByRole("button", { name: /Forward/u }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(forward).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { target: { id: "actor-codex", kind: "agent" } },
        params: { messageId: message.id, roomId: "room-all" },
      }),
    );
    const [request] = runtime.server.requestsTo(
      "POST",
      "/v0/rooms/{roomId}/messages/{messageId}/forward",
    );
    expect(request?.headers.get("Idempotency-Key")).toBeTruthy();
  });

  it("retries only unconfirmed targets and keeps their keys after deselection", async () => {
    const { runtime, onClose } = renderForwardDialog();
    let failProduct = true;
    runtime.server.on("POST", forwardPath, ({ body }) =>
      JSON.stringify(body).includes("room-product-v0") && failProduct
        ? teamHubErrorResponse(503, "SERVICE_UNAVAILABLE")
        : Response.json({ items: [] }, { status: 201 }),
    );
    await selectRooms();
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Forwarded to 1 of 2 targets",
    );
    const selected = screen.getByLabelText("Selected forward targets");
    expect(within(selected).getAllByRole("button")).toHaveLength(1);
    expect(selected).toHaveTextContent("product-v0");
    expect(
      screen.getByRole("button", { name: /^gtm-launch\s*Forwarded$/u }),
    ).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(within(selected).getByRole("button"));
    fireEvent.click(
      screen.getByRole("button", { name: /^product-v0\s*Select$/u }),
    );
    failProduct = false;
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const requests = await sentTargets(runtime);
    expect(requests.map(({ body }) => body)).toEqual([
      { target: { id: "room-gtm-launch", kind: "room" } },
      { target: { id: "room-product-v0", kind: "room" } },
      { target: { id: "room-product-v0", kind: "room" } },
    ]);
    expect(requests[2]?.key).toBe(requests[1]?.key);
    expect(requests[0]?.key).not.toBe(requests[1]?.key);
  });

  it("reuses the same key when the first response is lost after committing", async () => {
    const { runtime, onClose } = renderForwardDialog();
    const committed = new Set<string | null>();
    let loseResponse = true;
    runtime.server.on("POST", forwardPath, ({ request }) => {
      committed.add(request.headers.get("Idempotency-Key"));
      if (loseResponse) {
        loseResponse = false;
        throw new TypeError("The response was lost.");
      }
      return Response.json({ items: [] }, { status: 201 });
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Codex/u }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm forwarding",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("permission");
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(committed.size).toBe(1);
    const requests = await sentTargets(runtime);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.key).toBe(requests[0]?.key);
  });

  it.each(["failure first", "success first"])(
    "waits for every target and guards pending actions when responses settle %s",
    async (order) => {
      const { runtime, onClose } = renderForwardDialog();
      const launch = pendingResponse();
      const product = pendingResponse();
      runtime.server.on("POST", forwardPath, ({ body }) =>
        JSON.stringify(body).includes("room-gtm-launch")
          ? launch.promise
          : product.promise,
      );
      await selectRooms();
      const forward = screen.getByRole("button", {
        name: "Forward",
      });
      act(() => {
        fireEvent.click(forward);
        fireEvent.click(forward);
      });
      await waitFor(() =>
        expect(runtime.server.requestsTo("POST", forwardPath)).toHaveLength(2),
      );
      const dialog = screen.getByRole("dialog", { name: "Forward to" });
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Agents" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Rooms" })).toBeDisabled();
      expect(
        screen.getByRole("textbox", { name: "Search forward targets" }),
      ).toBeDisabled();
      for (const target of within(
        screen.getByLabelText("Selected forward targets"),
      ).getAllByRole("button")) {
        expect(target).toBeDisabled();
      }
      expect(
        screen.getByRole("button", { name: /^product-v0\s*Selected$/u }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      fireEvent.click(dialog);
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => {
        if (order === "failure first") {
          product.resolve(teamHubErrorResponse(503, "SERVICE_UNAVAILABLE"));
        } else {
          launch.resolve(Response.json({ items: [] }, { status: 201 }));
        }
      });
      expect(forward).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => {
        if (order === "failure first") {
          launch.resolve(Response.json({ items: [] }, { status: 201 }));
        } else {
          product.resolve(teamHubErrorResponse(503, "SERVICE_UNAVAILABLE"));
        }
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Forwarded to 1 of 2 targets",
      );
      expect(forward).toBeEnabled();
      expect(
        screen.getByLabelText("Selected forward targets"),
      ).toHaveTextContent("product-v0");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it("filters live as the user types, keeps human labels on filtered chips, preserves selections across tabs, and excludes the current room", async () => {
    const { runtime, onClose } = renderForwardDialog();
    const forward = vi.fn<TestRouteHandler>(() => ({ items: [] }));
    runtime.server.on("POST", forwardPath, forward);

    const forwardButton = screen.getByRole("button", { name: "Forward" });
    expect(forwardButton).toHaveClass("bg-primary");

    const search = screen.getByRole("textbox", {
      name: "Search forward targets",
    });
    await screen.findByRole("button", { name: /^Codex/u });

    // Live filtering updates immediately on change without Enter or submit.
    fireEvent.change(search, { target: { value: "Cod" } });
    fireEvent.click(screen.getByRole("button", { name: /^Codex/u }));

    // Filtering out the selected target still keeps its readable label on the chip.
    fireEvent.change(search, { target: { value: "no-such-target" } });
    expect(screen.getByText("No matching agents.")).toBeVisible();
    const selectedChips = screen.getByLabelText("Selected forward targets");
    expect(selectedChips).toHaveTextContent("Codex");
    expect(selectedChips).not.toHaveTextContent("actor-codex");

    // Switching tabs preserves the Agent selection and excludes the current room.
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByRole("button", { name: "Rooms" }));
    await screen.findByRole("button", { name: /^gtm-launch\s*Select$/u });
    expect(
      screen.queryByRole("button", {
        name: /^all\s*(Select|Selected|Forwarded)$/i,
      }),
    ).toBeNull();
    expect(screen.getByLabelText("Selected forward targets")).toHaveTextContent(
      "Codex",
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^gtm-launch\s*Select$/u }),
    );
    fireEvent.click(forwardButton);

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const requests = await sentTargets(runtime);
    expect(requests.map(({ body }) => body)).toEqual([
      { target: { id: "actor-codex", kind: "agent" } },
      { target: { id: "room-gtm-launch", kind: "room" } },
    ]);
  });

  it("shows explicit loading and error states with retry for target lists", async () => {
    const runtime = createTestTeamHubRuntime();
    const message = runtime.seed.messagesByRoom.get("room-all")![0]!;
    let failActors = true;
    const pending = pendingResponse();
    runtime.server.on("GET", "/v0/tenants/{tenantId}/actors", () => {
      if (failActors) {
        return pending.promise;
      }
      return Response.json({
        items: runtime.seed.actors,
        page: { has_more: false },
      });
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MessageForwardDialog
          client={runtime.client}
          message={message}
          onClose={vi.fn()}
          tenantId={message.tenant_id}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading agents...");

    await act(async () => {
      pending.resolve(teamHubErrorResponse(503, "SERVICE_UNAVAILABLE"));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Agents could not be loaded.",
    );
    failActors = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", { name: /^Codex/u }),
    ).toBeVisible();
  });
});
