import { expect, it } from "vitest";

import { renderBusinessResult } from "./business-render.js";
import { renderConnectorResult } from "./connector-runtime.js";

const result = (name: string, identityLabel: string) => ({
  account: {
    connectionId: "external_connection_one",
    name,
    displayName: name,
    identityLabel,
  },
  result: {},
});

it("marks an Outlook label as the sign-in name, not the mailbox", () => {
  expect(
    renderConnectorResult(result("outlook", "me@example.net")).split("\n")[0],
  ).toBe(
    "Account: me@example.net - Microsoft sign-in name, the mailbox address may differ (external_connection_one)",
  );
});

it("prints another provider's identity label as it is", () => {
  expect(
    renderConnectorResult(result("gmail", "me@example.com")).split("\n")[0],
  ).toBe("Account: me@example.com (external_connection_one)");
});

it("marks only Outlook identities in the apps list", () => {
  const lines = renderBusinessResult("apps list", {
    connections: [
      {
        connectionId: "external_connection_one",
        name: "outlook",
        displayName: "Outlook Mail",
        identityLabel: "me@example.net",
      },
      {
        connectionId: "external_connection_two",
        name: "gmail",
        displayName: "Gmail",
        identityLabel: "me@example.com",
      },
    ],
  }).split("\n");
  expect(
    lines.find((line) => line.includes("external_connection_one")),
  ).toContain(
    "me@example.net - Microsoft sign-in name, the mailbox address may differ",
  );
  const gmail = lines.find((line) => line.includes("external_connection_two"));
  expect(gmail).toContain("me@example.com");
  expect(gmail).not.toContain("Microsoft sign-in name");
});
