import { QueryClient } from "@tanstack/react-query";
import {
  matchRoutes,
  RouterContextProvider,
  type LoaderFunction,
  type RouteObject,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";
import { teamHubSessionQueryKey } from "@/features/rooms/room-queries";

import { createAppRoutes } from "./router";

afterEach(() => vi.useRealTimers());

describe("Web app route contract", () => {
  it("bounds an unresponsive landing loader without letting its late failure clear a new Session", async () => {
    vi.useFakeTimers();
    const runtime = createTestTeamHubRuntime();
    runtime.server.on("GET", "/v0/session", () => ({ id: "current" }));
    let respondLate!: (response: Response) => void;
    runtime.server.on(
      "GET",
      "/v0/tenants",
      () =>
        new Promise((resolve) => {
          respondLate = resolve;
        }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const loader = createAppRoutes(queryClient, runtime).find(
      (route) => route.path === "/",
    )!.loader as LoaderFunction;
    const result = Promise.resolve(
      loader({
        request: new Request("http://localhost/"),
        url: new URL("http://localhost/"),
        pattern: "/",
        params: {},
        context: new RouterContextProvider(),
      }),
    );
    const assertion = expect(result).rejects.toMatchObject({
      code: "AUTHENTICATION_TIMEOUT",
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    queryClient.setQueryData(teamHubSessionQueryKey, { id: "new-session" });
    respondLate(teamHubErrorResponse(401, "UNAUTHENTICATED", "old request"));
    await vi.advanceTimersByTimeAsync(0);
    expect(queryClient.getQueryData(teamHubSessionQueryKey)).toEqual({
      id: "new-session",
    });
    queryClient.clear();
  });

  it("mounts the Room-first Product Client surfaces", () => {
    const paths = routePaths();

    expect(paths).toEqual(
      expect.arrayContaining([
        "/",
        "/login",
        "/oauth/composio-complete",
        "/t/:tenantId",
        "rooms",
        "rooms/:roomId",
        "chat",
        "profile",
        "dashboard",
        "dashboard/:workItemId",
        "documents/:documentId",
        "settings",
        "account",
        "security",
        "wiki/:collection?",
        "meetings",
      ]),
    );
  });

  it("keeps Work Item links and Room chat reachable", () => {
    const routes = createAppRoutes(
      new QueryClient(),
      createTestTeamHubRuntime(),
    );
    expect(
      matchRoutes(routes, "/t/tenant-a/dashboard/work-item-a")?.at(-1)?.route
        .path,
    ).toBe("dashboard/:workItemId");
    expect(
      matchRoutes(
        routes,
        "/t/tenant-a/library/meetings/keep?entry=meeting-a",
      )?.at(-1)?.route.path,
    ).toBe("meetings/keep");
    expect(
      matchRoutes(routes, "/t/tenant-a/dashboard")?.at(-1)?.route.path,
    ).toBe("dashboard");
    expect(
      matchRoutes(routes, "/t/tenant-a/rooms/room-a/chat")?.at(-1)?.route.path,
    ).toBe("chat");
    expect(
      matchRoutes(routes, "/t/tenant-a/rooms/room-a/hand-off")?.at(-1)?.route
        .path,
    ).toBe("hand-off");
    expect(
      matchRoutes(
        routes,
        "/t/tenant-a/library/meetings/ask?entry=meeting-a",
      )?.at(-1)?.route.path,
    ).toBe("meetings/ask");
  });

  it("mounts My Documents, Shared with me, and Wiki below Library", () => {
    const tenantRoute = createAppRoutes(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      createTestTeamHubRuntime(),
    ).find((route) => route.path === "/t/:tenantId");

    // Library sits in the pathless Workspace layout beside opened Documents.
    const workspace = tenantRoute?.children?.find((route) =>
      route.children?.some((child) => child.path === "documents/:documentId"),
    );
    const library = workspace?.children?.find(
      (route) => route.path === "library",
    );
    expect(library?.children?.map((route) => route.path)).toEqual(
      expect.arrayContaining([
        "my-documents",
        "shared-with-me",
        "wiki/:collection?",
        "meetings",
      ]),
    );
    expect(routePaths().some((path) => path.includes("artifact"))).toBe(false);
  });

  it("opens every unified Document through one stable identity route", () => {
    expect(routePaths()).toContain("documents/:documentId");
  });

  it("redirects legacy settings/local-models URLs to settings/models with query params", async () => {
    const routes = createAppRoutes(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      createTestTeamHubRuntime(),
    );
    const matched = matchRoutes(routes, "/t/tenant-a/settings/local-models");
    const route = matched?.at(-1)?.route;
    expect(route?.path).toBe("local-models");
    const loader = route?.loader as LoaderFunction;
    let thrown: unknown;
    try {
      await loader({
        context: new RouterContextProvider(),
        params: { tenantId: "tenant-a" },
        pattern: "/t/:tenantId/settings/local-models",
        request: new Request(
          "http://localhost/t/tenant-a/settings/local-models?computer=comp-1",
        ),
        url: new URL(
          "http://localhost/t/tenant-a/settings/local-models?computer=comp-1",
        ),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe(
      "/t/tenant-a/settings/models?computer=comp-1",
    );
  });
});

function routePaths() {
  const routes = createAppRoutes(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    createTestTeamHubRuntime(),
  );

  return flattenRoutes(routes)
    .map((route) => route.path)
    .filter((path): path is string => typeof path === "string");
}

function flattenRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.flatMap((route) => [
    route,
    ...(route.children ? flattenRoutes(route.children) : []),
  ]);
}
