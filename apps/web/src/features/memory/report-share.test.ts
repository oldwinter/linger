import { describe, expect, it } from "vitest";

import { reportShare, reportShareIdempotencyKey } from "./report-share";

const report = {
  content: [
    "---",
    "formatter: internal-only",
    'description: "Shipped the release."',
    "---",
    "",
    "# Daily 2026-09-01",
    "",
    "## Daily Work",
    "",
    "- **Release**: Finalized scope [[source:s1]].",
    "- Read [the brief](../daily/session-a.md).",
    "",
    "## Resolved Items",
    "",
    "None observed.",
    "",
    "## Pattern",
    "",
    "### Follow-up",
    "",
    "Reviewed next steps.",
    "",
    "## Sources",
    "",
    "- [Session](../daily/session-a.md)",
    "",
  ].join("\n"),
  id: "report-2026-09-01",
  summary: "A summary the report body does not need.",
  updated_at: "2026-09-01T06:00:00Z",
};

const expectedText = [
  "# Daily report for 2026-09-01",
  "",
  "## Daily Work",
  "",
  "- Release: Finalized scope.",
  "- Read the brief.",
  "",
  "## Pattern",
  "",
  "### Follow-up",
  "",
  "Reviewed next steps.",
].join("\n");

describe("reportShare", () => {
  it("keeps headings and text, and drops frontmatter, markers, links, and empty sections", () => {
    const share = reportShare({
      day: "2026-09-01",
      entry: report,
      kind: "daily",
    });

    expect(share.text).toBe(expectedText);
    expect(share.version).toBe("report-2026-09-01:2026-09-01T06:00:00Z");
  });

  it("titles a weekly report with its period", () => {
    expect(
      reportShare({ day: "2026-08-31", entry: report, kind: "weekly" }).text,
    ).toMatch(/^# Weekly report for 2026-08-31 – 2026-09-06$/mu);
  });

  it("falls back to the report's one-line summary when it has no sections", () => {
    const entry = {
      content: "---\ndescription: Shipped the release.\n---\n# Daily\n",
      id: "report-empty-body",
      summary: "",
      updated_at: "2026-09-01T06:00:00Z",
    };
    expect(reportShare({ day: "2026-09-01", entry, kind: "daily" }).text).toBe(
      "# Daily report for 2026-09-01\n\nShipped the release.",
    );
  });

  it("returns no text for an empty report", () => {
    const entry = {
      content: "",
      id: "report-missing",
      summary: "",
      updated_at: "2026-09-01T06:00:00Z",
    };
    expect(reportShare({ day: "2026-09-01", entry, kind: "daily" }).text).toBe(
      "",
    );
  });
});

describe("reportShareIdempotencyKey", () => {
  it("names one Message per report version and Room", () => {
    const { version } = reportShare({
      day: "2026-09-01",
      entry: report,
      kind: "daily",
    });
    const key = reportShareIdempotencyKey(version, "room-all");

    expect(key).toBe(`report-share:${version}:room-all`);
    expect(key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);
    expect(reportShareIdempotencyKey(version, "room-product-v0")).not.toBe(key);
    expect(reportShareIdempotencyKey(`${version}-next`, "room-all")).not.toBe(
      key,
    );
  });
});
