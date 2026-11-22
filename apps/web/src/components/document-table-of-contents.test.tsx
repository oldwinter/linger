import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineGlobalProperty } from "@/test/global-properties";

import { DocumentTableOfContents } from "./document-table-of-contents";

describe("DocumentTableOfContents", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderToc() {
    const content = document.createElement("div");
    const target = document.createElement("h2");
    target.dataset.id = "heading-1";
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    content.appendChild(target);
    document.body.appendChild(content);

    const view = render(
      <DocumentTableOfContents
        contentRef={{ current: content }}
        headings={[{ id: "heading-1", level: 2, text: "Overview" }]}
        onClose={vi.fn()}
      />,
    );
    return {
      cleanup: () => {
        view.unmount();
        content.remove();
      },
      scrollIntoView,
    };
  }

  it("scrolls smoothly when reduced motion is not requested", () => {
    defineGlobalProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: false }),
      writable: true,
    });
    const { cleanup, scrollIntoView } = renderToc();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Overview" }));
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    } finally {
      cleanup();
    }
  });

  it("uses auto scroll behavior when prefers-reduced-motion is enabled", () => {
    defineGlobalProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: true }),
      writable: true,
    });
    const { cleanup, scrollIntoView } = renderToc();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Overview" }));
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "auto",
        block: "start",
      });
    } finally {
      cleanup();
    }
  });
});
