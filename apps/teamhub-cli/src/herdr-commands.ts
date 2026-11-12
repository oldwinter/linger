import type { CommandDefinition } from "./command-definition.js";
import { assertPositionals, option } from "./command-input.js";
import { displayText } from "./display-text.js";
import { CliError } from "./errors.js";
import { operationHeaders, teamHubData } from "./http-client.js";

const maxAnswerLength = 4000;

function invalid(message: string): never {
  throw new CliError("usage", message);
}

const statusLines: Readonly<Record<string, string>> = {
  sent: "Sent to the pane. Tell the Human their answer reached the agent.",
  pane_closed:
    "Not sent: the pane or its agent is gone. Tell the Human their answer was not delivered.",
  pane_not_blocked:
    "Not sent: the agent already moved on from that question. Tell the Human their answer was not delivered.",
  outcome_unknown:
    "The Computer did not confirm delivery; the answer may have reached the pane. Tell the Human, and do not send it again.",
};

const herdrAnswer: CommandDefinition = {
  command: ["computer", "herdr", "answer"],
  toolName: "answer_herdr_pane",
  operationId: true,
  description:
    "Type the Human's own answer, once, into a blocked coding agent's herdr pane on their computer.",
  readOnly: false,
  usage: [
    "teamhub computer herdr answer --pane <pane-id> --state <n> --text <answer>",
  ],
  options: {
    "--pane": { description: "The pane ID from the herdr event." },
    "--state": {
      description: "The pane state number from the herdr event.",
    },
    "--text": {
      description: `The Human's answer exactly as they gave it: one line of at most ${maxAnswerLength} characters.`,
    },
  },
  notes: [
    "Only for a herdr event in your owner's chat, and only with what your owner answered; never answer for them.",
    "The pane gets the text and Enter only while it still waits on that same state. TeamHub does not deduplicate answers, so never send one again, even with the same --operation-id.",
  ],
  inputSchema: {
    type: "object",
    properties: {
      pane_id: { type: "string", minLength: 1, maxLength: 128 },
      state_change_seq: { type: "integer", minimum: 0 },
      text: { type: "string", minLength: 1, maxLength: maxAnswerLength },
    },
    required: ["pane_id", "state_change_seq", "text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: {
        enum: ["sent", "pane_closed", "pane_not_blocked", "outcome_unknown"],
      },
      computer_id: { type: "string" },
    },
    required: ["status", "computer_id"],
  },
  normalize: async (args) => {
    assertPositionals(args, 0);
    const pane = option(args, "--pane")?.trim();
    if (!pane) invalid("Provide --pane from the herdr event.");
    const state = option(args, "--state");
    if (state === undefined || !/^\d{1,15}$/u.test(state))
      invalid("--state must be the pane state number from the herdr event.");
    const text = option(args, "--text");
    if (text === undefined || !text.trim()) invalid("Provide --text.");
    if ([...text].length > maxAnswerLength)
      invalid(`--text must be at most ${maxAnswerLength} characters.`);
    if (/\p{Cc}/u.test(text))
      invalid("--text must be one line without control characters.");
    return {
      input: { pane_id: pane, state_change_seq: Number(state), text },
    };
  },
  execute: async (input, context) => {
    try {
      return await teamHubData(
        context.client.api.POST("/api/agent/v1/computer/herdr/answer", {
          body: {
            pane_id: input.pane_id as string,
            state_change_seq: input.state_change_seq as number,
            text: input.text as string,
          },
          headers: operationHeaders(context.operationId),
        }),
      );
    } catch (error) {
      // TeamHub cannot take an answer back, so a lost response is never
      // turned into a retry.
      if (
        error instanceof CliError &&
        (error.code === "connection_failed" || error.code === "outcome_unknown")
      )
        throw new CliError(
          "outcome_unknown",
          "The answer may have reached the pane. Tell the Human, and do not send it again.",
          { retryable: false },
          true,
        );
      throw error;
    }
  },
  render: (result) =>
    statusLines[displayText(result.status)] ??
    "TeamHub did not say whether the answer was sent. Do not send it again.",
};

export const herdrCommandDefinitions: readonly CommandDefinition[] = [
  herdrAnswer,
];
