import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkItemBoardCsvAction } from "./work-item-board-csv-action";

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

describe("Work Item board CSV action", () => {
  it("saves the CSV under the board and day's name", async () => {
    const csv = "Title,Status\nFix login failure,Todo\n";
    render(<WorkItemBoardCsvAction csv={csv} disabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(download.triggerArtifactDownload).toHaveBeenCalledOnce();
    const [blob, filename] = download.triggerArtifactDownload.mock.calls[0] as [
      Blob,
      string,
    ];
    expect(filename).toBe("work-items-2026-07-30.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(await blob.text()).toBe(csv);
  });

  it("says a refused save failed and can try again", () => {
    download.triggerArtifactDownload.mockImplementationOnce(() => {
      throw new Error("Blob URLs are blocked.");
    });
    download.triggerArtifactDownload.mockImplementationOnce(() => undefined);
    render(<WorkItemBoardCsvAction csv={"Title\n"} disabled={false} />);
    const button = screen.getByRole("button", { name: "Export CSV" });

    fireEvent.click(button);

    expect(screen.getByRole("status")).toHaveTextContent("Download failed");

    fireEvent.click(button);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(download.triggerArtifactDownload).toHaveBeenCalledTimes(2);
  });

  it("offers no export for an empty board", () => {
    render(<WorkItemBoardCsvAction csv={"Title\n"} disabled />);

    const button = screen.getByRole("button", { name: "Export CSV" });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(download.triggerArtifactDownload).not.toHaveBeenCalled();
  });
});
