import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaidMock = {
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
};

vi.mock("mermaid", () => ({
  default: mermaidMock,
}));

import { InlineMermaidBlock } from "./inline-mermaid-block";

describe("InlineMermaidBlock", () => {
  beforeEach(() => {
    mermaidMock.initialize.mockReset();
    mermaidMock.parse.mockReset();
    mermaidMock.render.mockReset();
  });

  it("renders sanitized SVG diagram and toggles cleanly between Diagram and Code", async () => {
    mermaidMock.parse.mockResolvedValue(true);
    mermaidMock.render.mockResolvedValue({
      svg: '<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="100" height="40" /></svg>',
    });
    const onCopy = vi.fn();
    const code = "graph TD\n  A-->B";

    const { container } = render(
      <InlineMermaidBlock
        code={code}
        copied={false}
        copyLabel="Copy code"
        lineCount={2}
        onCopy={onCopy}
      />,
    );

    await waitFor(() => {
      expect(
        container.querySelector(".message-mermaid-canvas svg"),
      ).not.toBeNull();
    });
    expect(container.querySelector("script")).toBeNull();

    // Switch to Code view
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(container.querySelector("pre code")?.textContent).toBe(code);

    // Switch back to Diagram view
    fireEvent.click(screen.getByRole("button", { name: "Diagram" }));
    await waitFor(() => {
      expect(
        container.querySelector(".message-mermaid-canvas svg"),
      ).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("falls back gracefully to source code when mermaid parsing fails", async () => {
    mermaidMock.parse.mockRejectedValue(new Error("Syntax error"));
    const code = "invalid %%% diagram";

    const { container } = render(
      <InlineMermaidBlock
        code={code}
        copied={false}
        copyLabel="Copy code"
        lineCount={1}
        onCopy={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Diagram preview unavailable — showing source."),
    ).toBeVisible();
    expect(container.querySelector("pre code")?.textContent).toBe(code);
  });
});
