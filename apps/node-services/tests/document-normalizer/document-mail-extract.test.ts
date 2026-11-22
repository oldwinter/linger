import { describe, expect, it } from "vitest";

import { normalizeDocumentContent } from "../../src/document-normalizer/document-normalizer-core.js";

function message(plain: string, html: string): Uint8Array {
  return Buffer.from(
    [
      "MIME-Version: 1.0",
      "Subject: Project update",
      "From: Sender <sender@example.test>",
      'Content-Type: multipart/alternative; boundary="body-alternatives"',
      "",
      "--body-alternatives",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(plain).toString("base64"),
      "--body-alternatives",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(html).toString("base64"),
      "--body-alternatives--",
      "",
    ].join("\r\n"),
  );
}

async function extract(plain: string, html: string): Promise<string> {
  const bytes = await normalizeDocumentContent({
    filename: "update.eml",
    mediaType: "message/rfc822",
    source: message(plain, html),
  });
  return new TextDecoder().decode(bytes);
}

describe("MIME body alternatives", () => {
  it.each([
    ["empty HTML", "<html><body>  </body></html>"],
    ["image-only HTML", '<html><body><img src="cid:logo"></body></html>'],
  ])(
    "uses the recorded plain body after extracting %s",
    async (_name, html) => {
      const markdown = await extract(
        "Approved budget: 1250 €.\nShip on Friday.",
        html,
      );
      expect(markdown).toContain("Approved budget: 1250 €.");
      expect(markdown).toContain("Ship on Friday.");
      expect(markdown).toContain("Project update");
      expect(markdown).toContain("sender@example.test");
      expect(markdown).not.toContain("cid:logo");
    },
  );

  it("prefers extractable HTML over its plain alternative", async () => {
    const markdown = await extract(
      "Plain alternative only",
      "<p>HTML body with <strong>formatting</strong></p>",
    );
    expect(markdown).toContain("HTML body with **formatting**");
    expect(markdown).not.toContain("Plain alternative only");
  });

  it("still rejects header-only mail when neither body has text", async () => {
    await expect(
      extract("  \n", "<html><body> </body></html>"),
    ).rejects.toMatchObject({
      code: "DOCUMENT_SOURCE_EMPTY",
    });
  });
});
