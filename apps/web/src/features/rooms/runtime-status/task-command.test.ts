import { describe, expect, it } from "vitest";
import { parseTaskCommand } from "./task-command";

describe("parseTaskCommand", () => {
  it("reads the message of task send from --message", () => {
    expect(
      parseTaskCommand(
        'teamhub task send --task-id workitem_1 --message "Add pricing"',
      ),
    ).toEqual({
      message: "Add pricing",
      operation: "send",
      taskId: "workitem_1",
    });
  });

  it("reads a --message-file - message from its quoted heredoc, literally", () => {
    expect(
      parseTaskCommand(
        "teamhub task send --task-id workitem_1 --message-file - --steer <<'EOF'\nKeep $180/store as typed.\n--json is text here.\nEOF",
      ),
    ).toEqual({
      message: "Keep $180/store as typed.\n--json is text here.",
      operation: "send",
      taskId: "workitem_1",
    });
  });

  it("names a Task created from a heredoc requirement", () => {
    expect(
      parseTaskCommand(
        'teamhub task create --name "Rivals" --requirement-file - <<\'EOF\'\nCompare --name "Other"\nEOF',
      ),
    ).toEqual({ name: "Rivals", operation: "create" });
  });
});
