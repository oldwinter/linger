import { test } from "@e2e-dev/web";
import { expect } from "e2e";

// The runner starts apps/web's Vite dev server with TEAMHUB_BASE_URL pointed at a
// closed port (see e2e.config.ts), so these tests prove the shipped shell boots
// and explains its failure states without a TeamHub, database, or agent process.

test("sign-in screen renders", async ({ app, screen, browser }) => {
  await app.open("/login");
  await expect(browser).toHaveTitle("Linger");
  await expect(screen.getByRole("heading", "Log in")).toBeVisible();
  await expect(screen.getByLabel("Email")).toBeVisible();
  await expect(screen.getByRole("button", "Log in")).toBeVisible();
});

test("language switch renders the Chinese sign-in screen", async ({
  app,
  screen,
}) => {
  await app.open("/login");
  await screen.getByRole("button", "简体中文").tap();
  await expect(screen.getByRole("heading", "登录")).toBeVisible();
  await expect(screen.getByRole("button", "登录")).toBeVisible();
});

test("an unreachable TeamHub offers a retry", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/");
  await expect(screen.getByText("Can't reach Linger")).toBeVisible();
  await expect(screen.getByRole("button", "Try again")).toBeVisible();
  await expect(browser).toHaveTitle("Linger");
});

test("a revoked share link is explained", async ({ app, screen }) => {
  await app.open("/shared-documents");
  await expect(
    screen.getByText("This link is unavailable or has been revoked."),
  ).toBeVisible();
});
