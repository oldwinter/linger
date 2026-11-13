import type { CommandDefinition } from "./command-definition.js";
import { assertPositionals, option } from "./command-input.js";
import { displayText } from "./display-text.js";
import { CliError } from "./errors.js";
import { operationHeaders, teamHubData } from "./http-client.js";

const maxQuestionLength = 2000;
const maxOptionLength = 200;
const maxOptions = 20;

function invalid(message: string): never {
  throw new CliError("usage", message);
}

const herdrAsk: CommandDefinition = {
  command: ["computer", "herdr", "ask"],
  toolName: "ask_herdr_pane",
  operationId: true,
  description:
    "Ask your owner, with a question card, how to answer a blocked coding agent's herdr pane on their computer; TeamHub types their own answer into the pane.",
  readOnly: false,
  usage: [
    "teamhub computer herdr ask --pane <pane-id> --state <n> --question <text> --option <choice> [--option <choice> ...]",
  ],
  options: {
    "--pane": { description: "The pane ID from the herdr event." },
    "--state": {
      description: "The pane state number from the herdr event.",
    },
    "--question": {
      description: `What the coding agent asks, at most ${maxQuestionLength} characters.`,
    },
    "--option": {
      description: `One choice the coding agent offers, at most ${maxOptionLength} characters; repeat for each (1-${maxOptions}). Your owner may also write their own answer.`,
      repeatable: true,
    },
  },
  notes: [
    "Only for a herdr event in your owner's chat. Asking again about the same pane state returns the same card.",
    "You never type into the pane. When your owner answers, TeamHub types exactly their answer into the pane, once, and then tells you whether it arrived; pass that on.",
    "An event that came in during quiet hours or after today's reminders is refused with herdr_ask_gated while that still holds: do not tell your owner now; keep the pane and state in a Tracking Item and ask when its follow-up comes.",
  ],
  inputSchema: {
    type: "object",
    properties: {
      pane_id: { type: "string", minLength: 1, maxLength: 128 },
      state_change_seq: { type: "integer", minimum: 0 },
      question: { type: "string", minLength: 1, maxLength: maxQuestionLength },
      options: {
        type: "array",
        minItems: 1,
        maxItems: maxOptions,
        items: { type: "string", minLength: 1, maxLength: maxOptionLength },
      },
    },
    required: ["pane_id", "state_change_seq", "question", "options"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { enum: ["asked"] },
      computer_id: { type: "string" },
      room_id: { type: "string" },
      message_id: { type: "string" },
      interaction_id: { type: "string" },
    },
    required: [
      "status",
      "computer_id",
      "room_id",
      "message_id",
      "interaction_id",
    ],
  },
  normalize: async (args) => {
    assertPositionals(args, 0);
    const pane = option(args, "--pane")?.trim();
    if (!pane) invalid("Provide --pane from the herdr event.");
    const state = option(args, "--state");
    if (state === undefined || !/^\d{1,15}$/u.test(state))
      invalid("--state must be the pane state number from the herdr event.");
    const question = option(args, "--question")?.trim();
    if (!question) invalid("Provide --question.");
    if ([...question].length > maxQuestionLength)
      invalid(`--question must be at most ${maxQuestionLength} characters.`);
    const options = (args.options["--option"] ?? []).map((value) =>
      value.trim(),
    );
    if (options.length === 0 || options.length > maxOptions)
      invalid(`Provide 1 to ${maxOptions} --option values.`);
    if (
      options.some(
        (value) =>
          !value ||
          [...value].length > maxOptionLength ||
          /\p{Cc}/u.test(value),
      ) ||
      new Set(options).size !== options.length
    )
      invalid(
        `Each --option must be distinct, one line and at most ${maxOptionLength} characters.`,
      );
    return {
      input: {
        pane_id: pane,
        state_change_seq: Number(state),
        question,
        options,
      },
    };
  },
  execute: async (input, context) =>
    teamHubData(
      context.client.api.POST("/api/agent/v1/computer/herdr/ask", {
        body: {
          pane_id: input.pane_id as string,
          state_change_seq: input.state_change_seq as number,
          question: input.question as string,
          options: input.options as string[],
        },
        headers: operationHeaders(context.operationId),
      }),
    ),
  render: (result) =>
    `Question card posted (${displayText(result.message_id)}). End your turn now; TeamHub types your owner's answer into the pane and then tells you whether it arrived.`,
};

export const herdrCommandDefinitions: readonly CommandDefinition[] = [herdrAsk];
