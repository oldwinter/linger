import type { components } from "@linger/wire-contracts/teamhub-public/types";

import type { Translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import { localModelsMessages as m } from "./local-models.messages";
import { formatGigabytes, type MemoryGuidance } from "./local-models-rules";

type Schemas = components["schemas"];

/**
 * Every code the Local models page shows, as the message that words it. The
 * page branches on codes only; diagnostic `detail` text from the Computer is
 * shown only where the contract explicitly exposes it for the owner (BYOK
 * endpoint refusals and local BYOK gateway failures). Typing each map by its
 * generated code set makes a new code a type error here until it has copy.
 */

const actionRefusals: Record<
  Schemas["LocalModelsErrorCode"],
  Message<string>
> = {
  LOCAL_COMPUTER_OFFLINE: m.refusalOffline,
  LOCAL_MODEL_ACTION_FAILED: m.refusalActionFailed,
  LOCAL_MODEL_ACTION_UNCONFIRMED: m.refusalUnconfirmed,
  LOCAL_MODEL_ACTION_FORBIDDEN: m.refusalForbidden,
  LOCAL_MODEL_DISK_INSUFFICIENT: m.refusalDiskInsufficient,
  LOCAL_MODEL_INVALID_STATE: m.refusalInvalidState,
  LOCAL_MODEL_JOB_RUNNING: m.refusalJobRunning,
  LOCAL_MODEL_MEMORY_INSUFFICIENT: m.refusalMemoryInsufficient,
  LOCAL_MODEL_NO_ROOM: m.refusalNoRoom,
  LOCAL_MODEL_PLATFORM_UNSUPPORTED: m.refusalPlatformUnsupported,
  LOCAL_MODEL_UNKNOWN: m.refusalModelUnknown,
  LOCAL_MODELS_SERVICE_UNAVAILABLE: m.refusalServiceUnavailable,
  LOCAL_MODELS_UNAVAILABLE: m.refusalToolsUnavailable,
};

/** Why an action or a read failed: a TeamHub error code, or anything else. */
export function actionErrorCopy(code: string | undefined, t: Translate) {
  if (code === "LOCAL_COMPUTER_NOT_FOUND") {
    return t(m.refusalComputerNotFound);
  }
  return t(
    code && Object.hasOwn(actionRefusals, code)
      ? actionRefusals[code as keyof typeof actionRefusals]
      : m.somethingWentWrong,
  );
}

const modelErrors: Record<Schemas["LocalModelErrorCode"], Message<string>> = {
  CANCELLED: m.errorCancelled,
  CHECKSUM_MISMATCH: m.errorChecksumMismatch,
  DISK_INSUFFICIENT: m.errorDiskInsufficient,
  DOWNLOAD_FAILED: m.errorDownloadFailed,
  ENGINE_START_FAILED: m.errorEngineStartFailed,
  GATEWAY_REGISTRATION_FAILED: m.errorGatewayRegistrationFailed,
  HEALTH_CHECK_FAILED: m.errorHealthCheckFailed,
  INVALID_STATE: m.errorInvalidState,
  JOB_RUNNING: m.errorJobRunning,
  LOAD_NO_ROOM: m.errorLoadNoRoom,
  MEMORY_INSUFFICIENT: m.errorMemoryInsufficient,
  MODEL_FILES_MISSING: m.errorModelFilesMissing,
  MODEL_UNKNOWN: m.errorModelUnknown,
  NETWORK_UNAVAILABLE: m.errorNetworkUnavailable,
  OUT_OF_MEMORY: m.errorOutOfMemory,
  PLATFORM_UNSUPPORTED: m.refusalPlatformUnsupported,
};

const modelErrorCauses = {
  GATEWAY_HOME_NOT_PRIVATE: {
    withPath: m.errorGatewayHomeNotPrivatePath,
    withoutPath: m.errorGatewayHomeNotPrivate,
  },
} satisfies Record<
  NonNullable<Schemas["LocalModelError"]["cause"]>,
  { withPath: Message; withoutPath: Message }
>;

const modelErrorsShort: Record<
  Schemas["LocalModelErrorCode"],
  Message<string> | undefined
> = {
  CANCELLED: m.shortCancelled,
  CHECKSUM_MISMATCH: m.shortChecksumMismatch,
  DISK_INSUFFICIENT: m.shortDiskInsufficient,
  DOWNLOAD_FAILED: undefined,
  ENGINE_START_FAILED: m.shortEngineStartFailed,
  GATEWAY_REGISTRATION_FAILED: m.shortGatewayRegistrationFailed,
  HEALTH_CHECK_FAILED: m.shortHealthCheckFailed,
  INVALID_STATE: m.shortBusy,
  JOB_RUNNING: m.shortBusy,
  LOAD_NO_ROOM: m.shortLoadNoRoom,
  MEMORY_INSUFFICIENT: m.shortMemoryInsufficient,
  MODEL_FILES_MISSING: m.shortModelFilesMissing,
  MODEL_UNKNOWN: m.shortModelUnknown,
  NETWORK_UNAVAILABLE: m.shortNetworkUnavailable,
  OUT_OF_MEMORY: m.shortOutOfMemory,
  PLATFORM_UNSUPPORTED: m.shortNotForComputer,
};

/** Short failure summary for a collapsed model row; undefined when the status label suffices. */
export function modelErrorShortCopy(
  error: Schemas["LocalModelError"] | undefined,
  t: Translate,
) {
  const message = error ? modelErrorsShort[error.code] : undefined;
  return message ? t(message) : undefined;
}

/**
 * Why the last load or download of a model failed. A cause names the fix;
 * its path reaches only the Computer's owner.
 */
export function modelErrorCopy(
  error: Schemas["LocalModelError"],
  t: Translate,
) {
  if (!error.cause) return t(modelErrors[error.code]);
  const cause = modelErrorCauses[error.cause];
  return error.path
    ? t(cause.withPath, { path: error.path })
    : t(cause.withoutPath);
}

const notes = {
  NO_ROOM_TO_LOAD: m.noteNoRoomToLoad,
} satisfies Record<Schemas["LocalModelNote"]["code"], Message>;

/** Why a finished download did not load by itself; `place` names its memory. */
export function modelNoteCopy(
  code: Schemas["LocalModelNote"]["code"],
  place: string | undefined,
  t: Translate,
) {
  return t(notes[code], { place: place ?? t(m.placeMemory) });
}

type AvailabilityReason = Schemas["LocalModelAvailabilityReason"];

/** The short reason on a row that can't be downloaded. */
export function unavailableShortCopy(
  reason: AvailabilityReason | undefined,
  t: Translate,
) {
  if (reason?.code === "PLATFORM_UNSUPPORTED" || !reason)
    return t(m.shortNotForComputer);
  if (reason.need_bytes === undefined)
    return t(
      reason.code === "DISK_INSUFFICIENT"
        ? m.shortNeedsDisk
        : m.shortNeedsMemory,
    );
  const need = formatGigabytes(reason.need_bytes, t);
  return reason.code === "DISK_INSUFFICIENT"
    ? t(m.shortNeedsDiskSize, { need })
    : t(m.shortNeedsSize, { need });
}

/** The full reason a model can't be downloaded, shown in its details. */
export function unavailableCopy(
  reason: AvailabilityReason | undefined,
  reclaimable: boolean,
  t: Translate,
) {
  const sizes =
    reason?.need_bytes === undefined || reason.have_bytes === undefined
      ? undefined
      : {
          have: formatGigabytes(reason.have_bytes, t),
          need: formatGigabytes(reason.need_bytes, t),
        };
  switch (reason?.code) {
    case "MEMORY_INSUFFICIENT":
      if (sizes)
        return t(
          reclaimable
            ? m.unavailableMemorySizesReclaimable
            : m.unavailableMemorySizes,
          sizes,
        );
      return t(
        reclaimable ? m.unavailableMemoryReclaimable : m.unavailableMemory,
      );
    case "DISK_INSUFFICIENT":
      return sizes ? t(m.unavailableDiskSizes, sizes) : t(m.unavailableDisk);
    default:
      return t(m.refusalPlatformUnsupported);
  }
}

const libraryUnavailable = {
  NOT_REPORTED: {
    body: m.libraryNotReportedBody,
    title: m.libraryNotReportedTitle,
  },
  TOOL_FAILED: {
    body: m.libraryToolFailedBody,
    title: m.libraryToolFailedTitle,
  },
  TOOL_NOT_INSTALLED: {
    body: m.libraryToolNotInstalledBody,
    title: m.libraryToolNotInstalledTitle,
  },
} satisfies Record<
  Schemas["LocalModelsViewUnavailableReason"]["code"],
  { body: Message<string>; title: Message }
>;

/** Why a Computer reports no model library. */
export function libraryUnavailableCopy(
  code: Schemas["LocalModelsViewUnavailableReason"]["code"] | undefined,
  computer: string,
  t: Translate,
) {
  const copy = libraryUnavailable[code ?? "NOT_REPORTED"];
  return { body: t(copy.body), title: t(copy.title, { computer }) };
}

const capabilityLabels: Record<
  Schemas["LocalModelCapability"],
  Message<string>
> = {
  coding: m.capabilityCoding,
  multilingual: m.capabilityMultilingual,
  reasoning: m.capabilityReasoning,
  tool_use: m.capabilityToolUse,
  vision: m.capabilityVision,
};

/** Human-readable badge label for a verified model capability. */
export function capabilityCopy(
  capability: Schemas["LocalModelCapability"],
  t: Translate,
) {
  return t(capabilityLabels[capability]);
}

const architectureLabels: Record<
  Schemas["LocalModelArchitecture"],
  Message<string>
> = {
  dense: m.architectureDense,
  moe: m.architectureMoe,
};

/** Human-readable architecture label for display in model details. */
export function architectureCopy(
  architecture: Schemas["LocalModelArchitecture"],
  t: Translate,
) {
  return t(architectureLabels[architecture]);
}

const modelSourceRefusals: Record<
  Schemas["ModelSourceErrorCode"],
  Message<string>
> = {
  AGENT_HAS_ACTIVE_RUNS: m.sourceAgentsWorking,
  BYOK_AUTH_FAILED: m.sourceByokAuthFailed,
  BYOK_GATEWAY_FAILED: m.sourceByokGatewayFailed,
  BYOK_INVALID_CONFIG: m.sourceByokInvalidConfig,
  BYOK_NOT_FOUND: m.sourceByokNotFound,
  BYOK_UNREACHABLE: m.sourceByokUnreachable,
  BYOK_UPSTREAM_REJECTED: m.sourceByokUpstreamRejected,
  LOCAL_COMPUTER_OFFLINE: m.refusalOffline,
  LOCAL_MODEL_NO_ROOM: m.sourceNoRoom,
  LOCAL_MODEL_UNKNOWN: m.refusalModelUnknown,
  MODEL_SOURCE_FAILED: m.sourceSwitchFailed,
  MODEL_SOURCE_FORBIDDEN: m.sourceForbidden,
  MODEL_SOURCE_SERVICE_UNAVAILABLE: m.refusalServiceUnavailable,
  MODEL_SOURCE_UNAVAILABLE: m.sourceUnavailable,
  MODEL_SOURCE_UNCONFIRMED: m.sourceUnconfirmed,
  RUNTIME_NOT_ENABLED: m.sourceRuntimeNotEnabled,
};

/** Why a model-source switch or endpoint test failed. */
export function modelSourceErrorCopy(code: string | undefined, t: Translate) {
  return t(
    code && Object.hasOwn(modelSourceRefusals, code)
      ? modelSourceRefusals[code as keyof typeof modelSourceRefusals]
      : m.somethingWentWrong,
  );
}

// For these the Computer's own message names the address it sent to and the
// endpoint's HTTP status, so it is shown as it is.
const byokEndpointRefusals = new Set([
  "BYOK_AUTH_FAILED",
  "BYOK_NOT_FOUND",
  "BYOK_UNREACHABLE",
  "BYOK_UPSTREAM_REJECTED",
]);

/** Structured failure returned by TeamHub's model-source endpoints. */
export interface ModelSourceFailure {
  code?: string;
  details?: readonly { field: string; reason: string }[];
  message?: string;
}

/**
 * Why a model-source switch failed, preserving owner-visible Computer detail
 * when the contract provides it.
 */
export function modelSourceFailureCopy(
  error: ModelSourceFailure | undefined,
  t: Translate,
) {
  if (error?.code === "BYOK_GATEWAY_FAILED") {
    const detail = error.details
      ?.find((entry) => entry.field === "gateway")
      ?.reason.trim();
    return detail
      ? t(m.sourceByokGatewayFailedDetail, { detail })
      : t(m.sourceByokGatewayFailed);
  }
  return byokFailureCopy(error?.code, error?.message ?? "", t);
}

/** Why a request to a BYOK endpoint (a test or a model listing) failed. */
export function byokFailureCopy(
  code: string | undefined,
  message: string,
  t: Translate,
) {
  return code && byokEndpointRefusals.has(code) && message
    ? message
    : modelSourceErrorCopy(code, t);
}

/** Why reading a Computer's model source failed. */
export function modelSourceReadErrorCopy(
  code: string | undefined,
  t: Translate,
) {
  if (code === "MODEL_SOURCE_SERVICE_UNAVAILABLE") {
    return t(modelSourceRefusals.MODEL_SOURCE_SERVICE_UNAVAILABLE);
  }
  if (code === "MODEL_SOURCE_UNCONFIRMED") {
    return t(m.sourceReadUnconfirmed);
  }
  return t(m.sourceReadFailed);
}

export const modelSourceModeLabels: Record<
  Schemas["ModelSourceMode"],
  Message<string>
> = {
  byok: m.modeByok,
  local: m.modeLocal,
  subscription: m.modeSubscription,
};

/** Product and protocol names read the same in every language. */
export const modelSourceRuntimeLabels: Record<
  Schemas["ModelSourceRuntime"],
  string
> = { claude: "Claude Code", codex: "Codex", pi: "Pi" };

export const byokProtocolLabels: Record<Schemas["ByokProtocol"], string> = {
  anthropic: "Anthropic Messages",
  "openai-chat": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
};

const memoryGuidanceMessages = {
  blocked_download: {
    body: m.guidanceBlockedDownloadBody,
    bodyGpu: m.guidanceBlockedDownloadBodyGpu,
    title: m.guidanceBlockedDownloadTitle,
    titleGpu: m.guidanceBlockedDownloadTitleGpu,
  },
  blocked_load: {
    body: m.guidanceBlockedLoadBody,
    bodyGpu: m.guidanceBlockedLoadBodyGpu,
    title: m.guidanceBlockedLoadTitle,
    titleGpu: m.guidanceBlockedLoadTitleGpu,
  },
  constrained_pool: {
    body: m.guidanceConstrainedBody,
    bodyGpu: m.guidanceConstrainedBodyGpu,
    title: m.guidanceConstrainedTitle,
    titleGpu: m.guidanceConstrainedTitleGpu,
  },
} satisfies Record<
  MemoryGuidance["kind"],
  Record<"body" | "bodyGpu", Message> &
    Record<"title" | "titleGpu", Message<string>>
>;

/** Guidance telling the owner how freeing external memory unlocks larger models. */
export function memoryGuidanceCopy(guidance: MemoryGuidance, t: Translate) {
  const copy = memoryGuidanceMessages[guidance.kind];
  return {
    body: t(guidance.gpu ? copy.bodyGpu : copy.body, {
      free: formatGigabytes(guidance.freeBytes, t),
      other: formatGigabytes(guidance.otherBytes, t),
      total: formatGigabytes(guidance.totalBytes, t),
    }),
    title: t(guidance.gpu ? copy.titleGpu : copy.title),
  };
}
