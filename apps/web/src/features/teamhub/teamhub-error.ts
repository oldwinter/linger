import { translate } from "@/i18n/language";

import { teamHubErrorMessages } from "./teamhub-error.messages";
import { teamHubErrorText } from "./teamhub-error-text";
import type { TeamHubErrorResponse } from "./teamhub-types";

export class TeamHubError extends Error {
  readonly code: string;
  readonly details?: TeamHubErrorResponse["error"]["details"];
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly retryable: boolean;
  /** TeamHub's own English message, for diagnostics; `message` is worded. */
  readonly serverMessage?: string;
  readonly status: number;

  constructor(input: {
    code: string;
    details?: TeamHubErrorResponse["error"]["details"];
    message: string;
    requestId?: string;
    retryAfterSeconds?: number;
    retryable?: boolean;
    serverMessage?: string;
    status: number;
  }) {
    super(input.message);
    this.name = "TeamHubError";
    this.code = input.code;
    this.serverMessage = input.serverMessage;
    this.details = input.details;
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.retryable = input.retryable ?? false;
    this.status = input.status;
  }
}

/** A request that never got a response; it reads as a connection problem. */
export class TeamHubTransportError extends Error {
  constructor(message: string = translate(teamHubErrorMessages.unreachable)) {
    super(message);
    this.name = "TeamHubTransportError";
  }
}

export async function readTeamHubError(response: Response) {
  let body: TeamHubErrorResponse | undefined;

  try {
    body = (await response.clone().json()) as TeamHubErrorResponse;
  } catch {
    body = undefined;
  }

  const code = body?.error?.code ?? `HTTP_${response.status}`;
  const serverMessage = body?.error?.message;
  return new TeamHubError({
    code,
    details: body?.error?.details,
    message: teamHubErrorText(
      { code, message: serverMessage, status: response.status },
      translate,
    ),
    requestId: body?.error?.request_id,
    retryAfterSeconds: parseRetryAfterSeconds(
      response.headers.get("Retry-After"),
    ),
    retryable: body?.error?.retryable,
    serverMessage,
    status: response.status,
  });
}

function parseRetryAfterSeconds(value: string | null) {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}
