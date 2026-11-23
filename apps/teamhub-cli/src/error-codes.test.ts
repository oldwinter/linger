import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { knownErrorCodes, templatedErrorCodes } from "./command-errors.js";
import { undeclaredTeamHubCodes } from "./errors.js";

const source = path.dirname(fileURLToPath(import.meta.url));

describe("the closed set of error codes", () => {
  it("gives every code TeamHub declares a template and an exit code", async () => {
    const contract = await readFile(
      path.join(
        source,
        "../../../contracts/openapi/components/agent-api-errors.yaml",
      ),
      "utf8",
    );
    const declared = [
      .../AgentApiErrorCode:[\s\S]*?enum:\n((?:\s+- [a-z_]+\n)+)/u
        .exec(contract)![1]!
        .matchAll(/- ([a-z_]+)/gu),
    ].map((match) => match[1]!);
    expect(declared.length).toBeGreaterThan(30);
    for (const code of [...declared, ...undeclaredTeamHubCodes]) {
      expect(templatedErrorCodes).toContain(code);
      expect(knownErrorCodes).toContain(code);
    }
  });
});
