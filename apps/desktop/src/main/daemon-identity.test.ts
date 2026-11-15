import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  daemonIdentityPath,
  discardDaemonIdentity,
  keepsDaemonIdentity,
} from "./daemon-identity.js";
import { tempDirectory } from "./test-support.js";

describe("keepsDaemonIdentity", () => {
  it("keeps an identity for the Computer it belongs to", () => {
    expect(
      keepsDaemonIdentity({
        computerId: "computer_1",
        enrolledComputerId: "computer_1",
        present: true,
      }),
    ).toBe(true);
  });

  it("gives up an identity whose Computer the server no longer knows", () => {
    expect(
      keepsDaemonIdentity({
        computerId: undefined,
        enrolledComputerId: "computer_1",
        present: true,
      }),
    ).toBe(false);
  });

  it("gives up an identity when the enrollment created another Computer", () => {
    expect(
      keepsDaemonIdentity({
        computerId: "computer_old",
        enrolledComputerId: "computer_1",
        present: true,
      }),
    ).toBe(false);
  });

  it("has nothing to give up without an identity", () => {
    expect(
      keepsDaemonIdentity({
        computerId: undefined,
        enrolledComputerId: "computer_1",
        present: false,
      }),
    ).toBe(true);
  });
});

describe("daemon identity file", () => {
  it("lives in the daemon state directory", () => {
    expect(daemonIdentityPath(path.join("data", "computer"))).toBe(
      path.join("data", "computer", "state", "daemon-identity.json"),
    );
  });

  it("is removed so the daemon makes one for the enrolled Computer", () => {
    const file = daemonIdentityPath(tempDirectory());
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{}\n");

    discardDaemonIdentity(file);

    expect(existsSync(file)).toBe(false);
    // Nothing left to remove, as on a computer that never enrolled.
    discardDaemonIdentity(file);
  });
});
