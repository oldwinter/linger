import { describe, expect, it } from "vitest";

import { wikiDocumentPath, wikiPreviewPath } from "./wiki-routes";

describe("wikiDocumentPath", () => {
  it("opens a published page on its Document route", () => {
    expect(wikiDocumentPath("tenant-1", "document-1")).toBe(
      "/t/tenant-1/documents/document-1",
    );
  });

  it("encodes a Tenant and Document identity that need it", () => {
    expect(wikiDocumentPath("tenant one", "document/one")).toBe(
      "/t/tenant%20one/documents/document%2Fone",
    );
  });
});

describe("wikiPreviewPath", () => {
  it("opens a page the refresh has written but not published", () => {
    expect(wikiPreviewPath("tenant-1", "projects/alpha.md")).toBe(
      "/t/tenant-1/wiki-preview?page=projects%2Falpha.md",
    );
  });

  it("encodes the Tenant and page path", () => {
    expect(wikiPreviewPath("tenant one", "projects/alpha beta.md")).toBe(
      "/t/tenant%20one/wiki-preview?page=projects%2Falpha%20beta.md",
    );
  });
});
