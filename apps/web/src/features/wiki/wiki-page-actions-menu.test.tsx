// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TeamHubRuntimeProvider,
  type TeamHubRuntime,
} from "@/features/teamhub/teamhub-runtime";
import type { TeamHubArtifactContent } from "@/features/teamhub/teamhub-types";
import { createDocumentTestRuntime, respond } from "@/test/document-scenarios";

import { WikiPageActionsMenu } from "./wiki-page-actions-menu";

const markdown = "# Casey example\n\nA paragraph.\n";

function content(text: string): TeamHubArtifactContent {
  return {
    blob: new Blob([text]),
    mediaType: "text/markdown",
    sha256: "0".repeat(64),
  };
}

function stubClipboard(write: () => Promise<void>) {
  const writeText = vi.fn(write);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

function renderMenu(
  runtime: TeamHubRuntime,
  onExport = vi.fn(),
  exportPending = false,
) {
  return render(
    <TeamHubRuntimeProvider runtime={runtime}>
      <WikiPageActionsMenu
        documentId="document-wiki"
        exportPending={exportPending}
        onExport={onExport}
      />
    </TeamHubRuntimeProvider>,
  );
}

function openMenu() {
  fireEvent.click(
    screen.getByRole("button", { name: "More Wiki page actions" }),
  );
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
});

describe("WikiPageActionsMenu", () => {
  it("copies the page's Markdown from the download path, only when chosen", async () => {
    const runtime = createDocumentTestRuntime();
    const download = vi.spyOn(runtime.client, "downloadLatestDocument");
    respond(download, content(markdown));
    const writeText = stubClipboard(() => Promise.resolve());
    renderMenu(runtime);

    openMenu();
    expect(download).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy as Markdown" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledWith(markdown);
    expect(download).toHaveBeenCalledWith("document-wiki");
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("blocks a second copy while the page is being obtained", async () => {
    const runtime = createDocumentTestRuntime();
    let release: (value: TeamHubArtifactContent) => void = () => undefined;
    const download = vi
      .spyOn(runtime.client, "downloadLatestDocument")
      .mockImplementationOnce(
        () =>
          new Promise<TeamHubArtifactContent>((resolve) => {
            release = resolve;
          }),
      );
    const writeText = stubClipboard(() => Promise.resolve());
    renderMenu(runtime);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy as Markdown" }));

    openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Copy as Markdown" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy as Markdown" }));
    expect(download).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();

    await act(async () => release(content(markdown)));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  });

  it("reports a refused clipboard write instead of claiming success", async () => {
    const runtime = createDocumentTestRuntime();
    const download = vi.spyOn(runtime.client, "downloadLatestDocument");
    respond(download, content(markdown));
    stubClipboard(() => Promise.reject(new Error("Clipboard is denied")));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    renderMenu(runtime);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy as Markdown" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports a page whose Markdown cannot be obtained", async () => {
    const runtime = createDocumentTestRuntime();
    vi.spyOn(runtime.client, "downloadLatestDocument").mockRejectedValueOnce(
      new Error("The page could not be read."),
    );
    const writeText = stubClipboard(() => Promise.resolve());
    renderMenu(runtime);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy as Markdown" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("downloads through the menu", () => {
    const onExport = vi.fn();
    renderMenu(createDocumentTestRuntime(), onExport);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));

    expect(onExport).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("waits while a download is in flight", () => {
    const onExport = vi.fn();
    renderMenu(createDocumentTestRuntime(), onExport, true);

    openMenu();
    expect(screen.getByRole("menuitem", { name: "Download" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));

    expect(onExport).not.toHaveBeenCalled();
  });
});
