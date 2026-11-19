import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { RoomDocumentE2EHarnessClient } from "../../../apps/web/e2e/room-document-e2e-harness-client";

test("documents: edit through UI and reopen in a fresh browser session", async ({
  page,
  browser,
  request,
  baseURL,
}, testInfo) => {
  await test.step("Doctor: check the managed services before driving", async () => {
    const output = execFileSync(
      fileURLToPath(new URL("scripts/doctor.sh", import.meta.url)),
      { encoding: "utf8" },
    );
    await writeFile(testInfo.outputPath("doctor.txt"), output);
  });
  const harness = new RoomDocumentE2EHarnessClient(request);
  const fixture = await harness.reset();
  const documentUrl = `/t/${fixture.tenant_id}/documents/${fixture.document_id}`;
  const marker = `Verification ${Date.now()}`;

  await test.step("Sign in through the user form", async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("alice@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill("teamhub-dev-alice");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/t\/[^/]+\//);
  });
  await test.step("Open the Document link and type in the editor", async () => {
    await page.goto(documentUrl);
    const surface = page.getByLabel("Room Document editor");
    await expect(surface).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: testInfo.outputPath("before.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Document mode", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /\bEdit$/ }).click();
    await expect(surface).toHaveAttribute("data-editable", "true");
    const editor = surface.locator(".bn-editor");
    await editor.click();
    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially(marker);
    await expect(editor).toContainText(marker);
    await expect(
      page.locator("[data-room-document-save-status]"),
    ).toHaveAttribute("data-room-document-save-status", "Saved", {
      timeout: 30_000,
    });
    await expect
      .poll(async () => (await harness.state()).persisted_seq)
      .toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath("saved.png"),
      fullPage: true,
    });
  });
  await test.step("Read persisted content from a fresh browser context", async () => {
    const context = await browser.newContext({ baseURL });
    try {
      const reopened = await context.newPage();
      await reopened.goto("/login");
      await reopened.getByLabel("Email").fill("alice@example.com");
      await reopened
        .getByLabel("Password", { exact: true })
        .fill("teamhub-dev-alice");
      await reopened
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await expect(reopened).toHaveURL(/\/t\/[^/]+\//);
      await reopened.goto(documentUrl);
      await expect(reopened.getByLabel("Room Document editor")).toContainText(
        marker,
        { timeout: 30_000 },
      );
      await reopened.screenshot({
        path: testInfo.outputPath("reopened.png"),
        fullPage: true,
      });
      await writeFile(
        testInfo.outputPath("reopened.aria.yml"),
        await reopened.locator("body").ariaSnapshot(),
      );
      await writeFile(
        testInfo.outputPath("proof.json"),
        JSON.stringify(
          {
            feature: "documents",
            entry: "direct Document link",
            documentUrl,
            marker,
            freshContext: true,
          },
          null,
          2,
        ),
      );
    } finally {
      await context.close();
    }
  });
});
