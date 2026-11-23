import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { requestUrlText } from "@linger/service-kit";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  createHttpTeamHubClient,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import {
  teamHubErrorResponse,
  TeamHubTestServer,
} from "@/test/teamhub-test-server";
import { defineGlobalProperty } from "@/test/global-properties";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { SharedDocumentPage } from "./shared-document-page";

vi.mock("@/components/read-only-blocknote-document-loader", () => ({
  ReadOnlyBlockNoteDocumentLoader: ({
    ariaLabel,
    markdown,
  }: {
    ariaLabel: string;
    markdown: string;
  }) => (
    <article aria-label={ariaLabel} data-testid="markdown-renderer">
      {markdown}
    </article>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const token = `doc_link_${"a".repeat(43)}`;

function renderPage(
  role: "viewer" | "editor",
  readOnly = false,
  downloadError?: unknown,
  options: {
    blob?: Blob | { size: number; text: () => Promise<string> };
    filename?: string;
    mediaType?: string;
    representationFormat?: string;
    signedIn?: boolean;
  } = {},
) {
  const download = vi.fn();
  if (downloadError) download.mockRejectedValue(downloadError);
  else
    download.mockResolvedValue({
      documentId: "doc-1",
      versionId: "version-1",
      filename: options.filename ?? "shared.txt",
      representationFormat: options.representationFormat ?? "plain_text",
      readOnly,
      access: { role },
      mediaType: options.mediaType ?? "text/plain",
      blob: options.blob ?? { size: 11, text: async () => "initial text" },
    });
  const uploadDocumentVersion = vi
    .fn()
    .mockRejectedValue(new Error("Link revoked"));
  let signedIn = options.signedIn ?? true;
  const server = new TeamHubTestServer()
    .on("GET", "/v0/session", () =>
      signedIn
        ? {
            account_id: "account-1",
            identity: {
              account: { id: "account-1", email: "editor@linger.local" },
              actors: [
                {
                  id: "actor-1",
                  tenant_id: "tenant-1",
                  display_name: "Editor",
                  kind: "human",
                },
              ],
            },
          }
        : teamHubErrorResponse(401, "UNAUTHENTICATED", "Sign in required"),
    )
    .on("POST", "/v0/auth/login", () => {
      signedIn = true;
      return { ok: true };
    });
  const client = {
    api: createHttpTeamHubClient({
      fetchRequest: server.fetch,
      onAuthenticationRequired: () => undefined,
    }).api,
    documentLinks: { download },
    uploadDocumentVersion,
  } as unknown as TeamHubClient;
  const router = createMemoryRouter(
    [{ path: "/shared-documents", element: <SharedDocumentPage /> }],
    { initialEntries: [`/shared-documents#${token}`] },
  );
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider
        runtime={{
          client,
          runStatuses: { subscribe: () => () => undefined },
          events: {
            subscribeRoom: () => () => undefined,
            subscribeSignals: () => () => undefined,
          },
        }}
      >
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
  return { ...view, download, router, server, uploadDocumentVersion };
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

it.each([
  ["viewer", false],
  ["editor", true],
] as const)("keeps %s native=%s content read only", async (role, native) => {
  renderPage(role, native);
  expect(await screen.findByText("initial text")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.queryByLabelText("Upload version")).toBeNull();
});

it("saves with the exact downloaded base and capability, preserving edits on revocation, and protects dirty edits", async () => {
  const { unmount, uploadDocumentVersion } = renderPage("editor");
  const editor = await screen.findByRole("textbox", { name: "File content" });
  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

  fireEvent.change(editor, { target: { value: "changed text" } });
  const refresh = screen.getByRole("button", { name: "Refresh file" });
  expect(refresh).toBeDisabled();
  expect(refresh).toHaveAttribute(
    "title",
    "Save your changes before refreshing",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Unsaved changes — save before refreshing",
  );
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(uploadDocumentVersion).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({
        expectedCurrentVersionId: "version-1",
        linkToken: token,
        representationFormat: "plain_text",
      }),
      expect.any(String),
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Link revoked");
  expect(editor).toHaveValue("changed text");

  unmount();
  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
});

it("triggers a hidden file input from a styled Upload version button", async () => {
  const { uploadDocumentVersion } = renderPage("editor");
  uploadDocumentVersion.mockResolvedValue(undefined);
  await screen.findByRole("textbox", { name: "File content" });

  const input = screen.getByLabelText("Upload version");
  expect(input).toHaveClass("hidden");
  const clickSpy = vi.spyOn(input, "click").mockImplementation(() => undefined);

  fireEvent.click(screen.getByRole("button", { name: "Upload version" }));
  expect(clickSpy).toHaveBeenCalledOnce();

  const file = new File(["replacement"], "shared.txt", { type: "text/plain" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() =>
    expect(uploadDocumentVersion).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({
        expectedCurrentVersionId: "version-1",
        file,
        linkToken: token,
      }),
      expect.any(String),
    ),
  );
});

it("renders read-only Markdown through ReadOnlyBlockNoteDocumentLoader instead of raw pre", async () => {
  renderPage("viewer", false, undefined, {
    blob: { size: 22, text: async () => "# Launch notes\n\nReady." },
    filename: "notes.md",
    mediaType: "text/markdown",
    representationFormat: "markdown",
  });
  const article = await screen.findByTestId("markdown-renderer");
  expect(article).toHaveAccessibleName("notes.md");
  expect(article).toHaveTextContent("# Launch notes");
  expect(article).toHaveTextContent("Ready.");
});

it("previews shared image blobs and revokes the object URL on unmount", async () => {
  const createObjectURL = vi.fn(() => "blob:shared-image-preview");
  const revokeObjectURL = vi.fn();
  defineGlobalProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
    writable: true,
  });
  defineGlobalProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
    writable: true,
  });

  const imageBlob = new Blob(["png-bytes"], { type: "image/png" });
  const { unmount } = renderPage("viewer", false, undefined, {
    blob: imageBlob,
    filename: "diagram.png",
    mediaType: "image/png",
    representationFormat: "binary",
  });

  const img = await screen.findByRole("img", { name: "diagram.png" });
  expect(img).toHaveAttribute("src", "blob:shared-image-preview");
  expect(createObjectURL).toHaveBeenCalledWith(imageBlob);

  unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:shared-image-preview");
});

it("signs in inline without leaving the shared document URL and unlocks editing", async () => {
  const { router } = renderPage("editor", false, undefined, {
    signedIn: false,
  });
  expect(await screen.findByText("initial text")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Sign in to edit" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Sign in to edit" }));
  const dialog = screen.getByRole("dialog", { name: "Sign in to edit" });
  fireEvent.change(within(dialog).getByLabelText("Email"), {
    target: { value: "editor@linger.local" },
  });
  fireEvent.change(within(dialog).getByLabelText("Password"), {
    target: { value: "secret-pass" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign in" }));

  expect(
    await screen.findByRole("textbox", { name: "File content" }),
  ).toHaveValue("initial text");
  expect(screen.queryByRole("dialog", { name: "Sign in to edit" })).toBeNull();
  expect(router.state.location.pathname).toBe("/shared-documents");
  expect(router.state.location.hash).toBe(`#${token}`);
});

it.each([
  [
    new TeamHubError({
      code: "NOT_FOUND",
      message: "link missing",
      status: 404,
    }),
    "This link is unavailable or has been revoked.",
  ],
  [
    new TeamHubError({
      code: "FORBIDDEN",
      message: "Access denied",
      status: 403,
    }),
    "Access denied",
  ],
])("shows the matching download failure text", async (error, text) => {
  renderPage("viewer", false, error);
  expect(await screen.findByRole("alert")).toHaveTextContent(text);
});

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

it.each([
  ["ASCII title via X-Document-Filename", "WIN015-DOC-TITLE.md"],
  ["UTF-8 CJK title via X-Document-Filename", "\u4e2d\u6587\u6587\u6863.md"],
])(
  "displays the real document title in the shared page header for %s",
  async (_label, title) => {
    const body = new TextEncoder().encode("# Shared body\n");
    const contentHeaders: Record<string, string> = {
      "Content-Type": "text/markdown",
      "Content-Disposition": `attachment; filename="document.md"; filename*=utf-8''${encodeURIComponent(title)}`,
      "X-Document-Id": "doc-1",
      "X-Document-Version-Id": "version-1",
      "X-Document-Filename": encodeBase64Url(title),
      "X-Document-Representation-Format": "markdown",
      "X-Document-Read-Only": "true",
      "X-Content-Sha256": bytesToHex(sha256(body)),
    };

    const fetchRequest = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrlText(input);
      if (url.endsWith("/v0/session"))
        return Response.json(
          { error: { code: "UNAUTHENTICATED", message: "Anonymous" } },
          { status: 401 },
        );
      if (url.endsWith("/v0/shared-documents/resolve"))
        return Response.json({
          link_id: "link-1",
          document_id: "doc-1",
          tenant_id: "tenant-1",
          role: "viewer",
          version: 1,
        });
      if (url.endsWith("/v0/shared-documents/content"))
        return new Response(body, { headers: contentHeaders });
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = createHttpTeamHubClient({
      baseUrl: "https://web.test/",
      fetchRequest,
      onAuthenticationRequired: () => undefined,
    });
    const router = createMemoryRouter(
      [{ path: "/shared-documents", element: <SharedDocumentPage /> }],
      { initialEntries: [`/shared-documents#${token}`] },
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TeamHubRuntimeProvider
          runtime={{
            client,
            runStatuses: { subscribe: () => () => undefined },
            events: {
              subscribeRoom: () => () => undefined,
              subscribeSignals: () => () => undefined,
            },
          }}
        >
          <RouterProvider router={router} />
        </TeamHubRuntimeProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    expect(await screen.findByText("# Shared body")).toBeVisible();
  },
);
