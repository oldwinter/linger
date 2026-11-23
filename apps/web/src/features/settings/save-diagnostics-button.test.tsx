import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SaveDiagnosticsButton } from "./save-diagnostics-button";

function desktop(lingerDesktop: unknown) {
  Object.assign(window, { lingerDesktop });
}

afterEach(() => {
  delete (window as { lingerDesktop?: unknown }).lingerDesktop;
});

describe("SaveDiagnosticsButton", () => {
  it("is absent in a browser", () => {
    const { container } = render(<SaveDiagnosticsButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is absent in a desktop app without the bridge's save", () => {
    desktop({ version: "0.1.0" });
    const { container } = render(<SaveDiagnosticsButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("runs the desktop app's save once per click", async () => {
    let finish!: () => void;
    const save = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    desktop({ diagnostics: { save } });
    render(<SaveDiagnosticsButton />);

    const button = screen.getByRole("button", { name: "Save diagnostics…" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(save).toHaveBeenCalledOnce();

    finish();
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when saving failed and clears it on the next try", async () => {
    const save = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce();
    desktop({ diagnostics: { save } });
    render(<SaveDiagnosticsButton />);

    const button = screen.getByRole("button", { name: "Save diagnostics…" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Diagnostics could not be saved. Try again.",
    );

    fireEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });
});
