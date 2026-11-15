import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WikiCopyLink } from "./wiki-copy-link";

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

function stubClipboard(write: () => Promise<void>) {
  const writeText = vi.fn(write);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

describe("WikiCopyLink", () => {
  it("copies the page URL with the app's origin and confirms it", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    render(<WikiCopyLink documentId="document page" tenantId="tenant one" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/t/tenant%20one/documents/document%20page`,
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
  });

  it("reports a refused clipboard write instead of claiming success", async () => {
    stubClipboard(() => Promise.reject(new Error("Clipboard is denied")));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    render(<WikiCopyLink documentId="document-1" tenantId="tenant-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy failed");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
