import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkItemBoardExportMenu } from "./work-item-board-export-menu";
import { createWorkItemDashboardFilters } from "./work-item-dashboard-filters";
import { DEFAULT_WORK_ITEM_DASHBOARD_SORT } from "./work-item-sort";

const download = vi.hoisted(() => ({ triggerArtifactDownload: vi.fn() }));

vi.mock(
  "@/features/rooms/files/artifact-preview-loader",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/rooms/files/artifact-preview-loader")
    >()),
    triggerArtifactDownload: download.triggerArtifactDownload,
  }),
);

beforeEach(() => {
  download.triggerArtifactDownload.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 30, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

const defaultFilters = createWorkItemDashboardFilters(new URLSearchParams());

function renderExportMenu({
  csv,
  csvDisabled = false,
}: {
  csv: string;
  csvDisabled?: boolean;
}) {
  render(
    <WorkItemBoardExportMenu
      csv={csv}
      csvDisabled={csvDisabled}
      filters={defaultFilters}
      markdown="# Work Items\n"
      sort={DEFAULT_WORK_ITEM_DASHBOARD_SORT}
      tenantId="tenant-northstar"
    />,
  );
}

describe("Work Item board CSV action", () => {
  it("saves the CSV under the board and day's name", async () => {
    const csv = "Title,Status\nFix login failure,Todo\n";
    renderExportMenu({ csv });

    fireEvent.click(screen.getByRole("button", { name: "Export & share" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export CSV" }));

    expect(download.triggerArtifactDownload).toHaveBeenCalledOnce();
    const [blob, filename] = download.triggerArtifactDownload.mock.calls[0] as [
      Blob,
      string,
    ];
    expect(filename).toBe("work-items-2026-07-30.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(await blob.text()).toBe(csv);
  });

  it("says a refused save failed with role alert and can try again", () => {
    download.triggerArtifactDownload.mockImplementationOnce(() => {
      throw new Error("Blob URLs are blocked.");
    });
    download.triggerArtifactDownload.mockImplementationOnce(() => undefined);
    renderExportMenu({ csv: "Title\n" });

    fireEvent.click(screen.getByRole("button", { name: "Export & share" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export CSV" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Download failed");

    fireEvent.click(screen.getByRole("button", { name: "Export & share" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export CSV" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(download.triggerArtifactDownload).toHaveBeenCalledTimes(2);
  });

  it("offers no export for an empty board", () => {
    renderExportMenu({ csv: "Title\n", csvDisabled: true });

    fireEvent.click(screen.getByRole("button", { name: "Export & share" }));
    const item = screen.getByRole("menuitem", { name: "Export CSV" });

    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(download.triggerArtifactDownload).not.toHaveBeenCalled();
  });
});
