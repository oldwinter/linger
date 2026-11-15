import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { useWikiLiveFocus, wikiPageExcerpt } from "./wiki-live-focus";
import { WikiLiveWriting } from "./wiki-live-writing";
import type { WikiPreviewPage } from "./wiki-preview-pages";

function page(
  key: string,
  name: string,
  collection: WikiPreviewPage["collection"],
): WikiPreviewPage {
  return {
    collection,
    description: `${name} description`,
    key,
    markdown: `# ${name}\n\nBody of ${name}.`,
    name,
    path: `${key}.md`,
  };
}

const atlas = page("projects/atlas", "Project Atlas", "projects");
const tom = page("contacts/tom", "Tom Becker", "contacts");

describe("live Wiki writing", () => {
  it("features the latest page already written, then a page that appears", () => {
    const view = renderHook(
      ({ pages }: { pages: WikiPreviewPage[] }) => useWikiLiveFocus(pages),
      { initialProps: { pages: [atlas] } },
    );
    expect(view.result.current?.name).toBe("Project Atlas");
    view.rerender({ pages: [atlas, tom] });
    expect(view.result.current?.name).toBe("Tom Becker");
    expect(wikiPageExcerpt(atlas.markdown)).toBe("Body of Project Atlas.");
  });

  it("shows the featured page and how many are written", () => {
    render(
      <MemoryRouter>
        <WikiLiveWriting count={2} page={tom} tenantId="tenant-northstar" />
      </MemoryRouter>,
    );
    const stage = screen.getByRole("region", { name: "Wiki being written" });
    expect(stage).toHaveTextContent("Tom Becker");
    expect(stage).toHaveTextContent("People");
    expect(stage).toHaveTextContent("Body of Tom Becker.");
    expect(stage).toHaveTextContent("2 pages written so far");
    expect(screen.getByRole("link", { name: "Open page" })).toHaveAttribute(
      "href",
      "/t/tenant-northstar/wiki-preview?page=contacts%2Ftom.md",
    );
  });
});
