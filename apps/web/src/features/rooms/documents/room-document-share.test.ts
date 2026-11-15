import { describe, expect, it } from "vitest";

import {
  roomDocumentShare,
  roomDocumentShareIdempotencyKey,
} from "./room-document-share";

const url =
  "https://linger.example/t/tenant-northstar/documents/document-brief";

describe("roomDocumentShare", () => {
  it("writes the Document's title and absolute link without its content", () => {
    expect(roomDocumentShare({ document: document(), url }).text).toBe(
      ["# Product brief", url].join("\n\n"),
    );
  });

  it("changes its version with the Document revision", () => {
    expect(roomDocumentShare({ document: document(), url }).version).toBe(
      "document-brief:2026-07-23T08:00:00Z",
    );
    expect(
      roomDocumentShare({
        document: document({ updated_at: "2026-07-24T09:00:00Z" }),
        url,
      }).version,
    ).toBe("document-brief:2026-07-24T09:00:00Z");
  });
});

describe("roomDocumentShareIdempotencyKey", () => {
  it("keeps one key per Document revision and Room", () => {
    expect(
      roomDocumentShareIdempotencyKey(
        "document-brief:2026-07-23T08:00:00Z",
        "room-all",
      ),
    ).toBe("document-share:document-brief:2026-07-23T08:00:00Z:room-all");
    expect(
      roomDocumentShareIdempotencyKey(
        "document-brief:2026-07-23T08:00:00Z",
        "room-all",
      ),
    ).toBe(
      roomDocumentShareIdempotencyKey(
        "document-brief:2026-07-23T08:00:00Z",
        "room-all",
      ),
    );
  });

  it("gives another Room and another revision their own keys", () => {
    expect(
      roomDocumentShareIdempotencyKey(
        "document-brief:2026-07-23T08:00:00Z",
        "room-all",
      ),
    ).not.toBe(
      roomDocumentShareIdempotencyKey(
        "document-brief:2026-07-23T08:00:00Z",
        "room-product-v0",
      ),
    );
    expect(
      roomDocumentShareIdempotencyKey(
        "document-brief:2026-07-23T08:00:00Z",
        "room-all",
      ),
    ).not.toBe(
      roomDocumentShareIdempotencyKey(
        "document-brief:2026-07-24T09:00:00Z",
        "room-all",
      ),
    );
  });
});

type ShareableDocument = Parameters<typeof roomDocumentShare>[0]["document"];

function document(
  override: Partial<ShareableDocument> = {},
): ShareableDocument {
  return {
    draft_capability: "write",
    format: "blocknote",
    id: "document-brief",
    representation_format: "markdown",
    title: "Product brief.md",
    updated_at: "2026-07-23T08:00:00Z",
    ...override,
  };
}
