import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  computerReleaseNote,
  databaseReachable,
  databaseUnavailableMessage,
  isWindowsPlatform,
  parsePostgresAddress,
  runWindowsDevelopment,
  signInGuidance,
  stopProcess,
  windowsDevelopmentPlan,
} from "./dev-windows.ts";

const windows = "win32";
const environment = {
  TEAMHUB_BASE_URL: "http://127.0.0.1:8080/",
  TEAMHUB_DATABASE_URL:
    "postgres://simplexai:simplexai@localhost:5432/simplexai_dev?sslmode=disable",
};
const scratch: string[] = [];

function checkout(files: Record<string, string>): string {
  const directory = mkdtempSync(path.join(tmpdir(), "dev-windows-"));
  scratch.push(directory);
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(directory, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  return directory;
}

afterEach(() => {
  for (const directory of scratch.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Windows development launcher", () => {
  it("targets Windows only", () => {
    expect(isWindowsPlatform(windows)).toBe(true);
    expect(isWindowsPlatform("linux")).toBe(false);
  });

  it.each([
    [environment.TEAMHUB_DATABASE_URL, "localhost", 5432],
    ["postgresql://user:pass@10.0.0.5:6432/database", "10.0.0.5", 6432],
    ["postgres://[::1]:55971/linger?sslmode=disable", "::1", 55971],
    ["postgresql://[::1]/linger", "::1", 5432],
  ])("reads the TCP endpoint from %s", (url, host, port) => {
    expect(parsePostgresAddress(url)).toEqual({ host, port });
  });

  it.each([
    "postgres://localhost,backup/linger",
    "postgres://localhost:5432,backup:6432/linger",
    "postgres://localhost/linger?host=other",
    "postgres://localhost/linger?port=6432",
    "postgres://localhost/linger?service=local",
    "postgres:///linger?host=%2Fvar%2Frun%2Fpostgresql",
    "host=localhost dbname=linger",
    "postgres://localhost:65536/linger",
    undefined,
  ])("leaves %s to the migration without a TCP probe", async (url) => {
    expect(parsePostgresAddress(url)).toBeUndefined();
    await expect(databaseReachable(url)).resolves.toEqual({ ok: true });
  });

  it("explains the ASCII-path constraint when PostgreSQL is unreachable", () => {
    const message = databaseUnavailableMessage(
      environment.TEAMHUB_DATABASE_URL,
      "ECONNREFUSED",
    );
    expect(message).toContain("Cannot reach PostgreSQL at localhost:5432");
    expect(message).toContain("docs/local-postgresql.md");
    expect(message).toContain("Option E (Windows)");
    expect(message).toContain("ASCII");
    expect(message).toContain("0xbc");
    expect(
      databaseUnavailableMessage("postgres://[::1]:55971/linger"),
    ).toContain("Cannot reach PostgreSQL at [::1]:55971");
  });

  it("fails before starting anything when .env is missing", async () => {
    const directory = checkout({});
    await expect(
      runWindowsDevelopment({
        platform: windows,
        root: directory,
        log: () => {},
      }),
    ).rejects.toThrow(/Missing local environment file/);
  });

  it("starts every step through the local environment wrapper", () => {
    const plan = windowsDevelopmentPlan(
      "C:\\checkout",
      environment.TEAMHUB_BASE_URL,
    );
    const wrapper = path.join("C:\\checkout", "scripts", "with-local-env.mjs");

    for (const step of [
      plan.migrate,
      plan.owner,
      plan.teamHub,
      plan.nodeServices,
      plan.web,
      plan.livekit,
    ]) {
      expect(step.command).toBe(process.execPath);
      expect(step.args.slice(0, 2)).toEqual([wrapper, "--"]);
    }
    expect(plan.migrate.args.slice(2)).toEqual(["go", "run", "./cmd/migrate"]);
    expect(plan.migrate.cwd).toBe(path.join("C:\\checkout", "apps", "teamhub"));
    expect(plan.owner.args.slice(2)).toEqual([
      process.execPath,
      "scripts/prepare-local-owner.mjs",
    ]);
    expect(plan.teamHub.args.slice(2)).toEqual(["go", "run", "./cmd/teamhub"]);
    expect(plan.teamHub.env).toEqual({ GIN_MODE: "release" });
    expect(plan.nodeServices.args.slice(2)).toEqual([
      "pnpm",
      "--filter",
      "@linger/node-services",
      "start",
    ]);
    expect(plan.web.args.slice(2)).toEqual([
      "pnpm",
      "--filter",
      "@linger/web",
      "dev",
    ]);
    expect(plan.livekit.args.slice(2)).toEqual([
      process.execPath,
      "--import",
      "tsx",
      "scripts/dev-livekit.ts",
    ]);
  });

  it("points the first sign-in at the owner credentials", () => {
    const directory = checkout({
      ".linger-runtime/local-owner.json": JSON.stringify({
        owner_email: "owner@linger.local",
        owner_password: "one-time-password",
      }),
    });
    const message = signInGuidance(directory);
    expect(message).toContain("Open http://localhost:3000 and sign in as");
    expect(message).toContain("owner@linger.local");
    expect(message).toContain(path.join(".linger-runtime", "local-owner.json"));
    expect(message).toContain("Your session has expired");
  });

  it("keeps the sign-in guidance readable without credentials", () => {
    expect(signInGuidance(checkout({}))).toContain(
      "Open http://localhost:3000 and sign in.",
    );
  });

  it("reports the configured local default when a release was built there", () => {
    const release = path.join(".linger-runtime", "computer-release");
    const directory = checkout({
      ".linger-runtime/computer-release/release.json": '{"version":"1.2.3"}',
    });
    expect(computerReleaseNote(directory, release)).toBe(
      `Computer installers are served from ${path.join(directory, release)}.`,
    );
  });

  it("reports the custom release even when the default one exists", () => {
    const directory = checkout({
      ".linger-runtime/computer-release/release.json": "{}",
      "custom-release/release.json": "{}",
    });
    const absoluteRelease = path.join(directory, "custom-release");
    for (const configured of ["custom-release", absoluteRelease]) {
      expect(computerReleaseNote(directory, configured)).toBe(
        `Computer installers are served from ${absoluteRelease}.`,
      );
    }
  });

  it("reports a missing configured release even when the default exists", () => {
    const directory = checkout({
      ".linger-runtime/computer-release/release.json": "{}",
    });
    const missingRelease = path.join(directory, "missing-release");
    const note = computerReleaseNote(directory, "missing-release");
    expect(note).toContain(`No Computer release in ${missingRelease}`);
    expect(note).toContain("pnpm computer:release:windows");
    expect(note).toContain("503");
  });

  it("uses the service fallback when the configured release path is blank", () => {
    const directory = checkout({
      ".linger-runtime/computer-release/release.json": "{}",
    });
    const fallback = path.resolve(directory, "/app/computer-release");
    expect(computerReleaseNote(directory, " ")).toContain(fallback);
  });

  it("ignores a child that already exited", () => {
    expect(() => stopProcess({ pid: 42, exitCode: 0 }, windows)).not.toThrow();
    expect(() => stopProcess(undefined, windows)).not.toThrow();
  });
});
