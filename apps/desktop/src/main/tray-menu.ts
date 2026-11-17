import type { StatusSummary } from "./status.js";
import type { UpdateState } from "./updater.js";

export type TrayAction =
  | "enroll"
  | "resolve-identity-conflict"
  | "open"
  | "quick-note"
  | "toggle-prevent-sleep"
  | "install-update"
  | "check-update"
  | "show-logs"
  | "save-diagnostics"
  | "send-diagnostics"
  | "quit";

export type TrayMenuItem =
  | { readonly kind: "label"; readonly label: string }
  | { readonly kind: "separator" }
  | {
      readonly kind: "action";
      readonly action: TrayAction;
      readonly label: string;
      readonly checked?: boolean;
    };

export interface TrayMenuState {
  readonly status: StatusSummary;
  readonly preventSleep: boolean;
  readonly enrolled: boolean;
  readonly identityConflict?: boolean;
  // The updater's progress; a failure says why, since it is otherwise only
  // in the log.
  readonly update?: UpdateState;
  // A diagnostics server is set up, so reports can be sent from here.
  readonly canSendDiagnostics?: boolean;
}

// The tray menu. Items for features that do not exist yet
// (pause, approvals) are added with those features.
export const trayMenu = (state: TrayMenuState): TrayMenuItem[] => [
  { kind: "label", label: state.status.label },
  ...(state.identityConflict
    ? ([
        {
          kind: "action",
          action: "resolve-identity-conflict",
          label: "Set Up Again…",
        },
      ] as const)
    : []),
  ...updateItems(state.update),
  { kind: "separator" },
  { kind: "action", action: "open", label: "Open Linger" },
  // Capture without opening the app.
  { kind: "action", action: "quick-note", label: "New Note" },
  // Reconnecting re-enrolls the same computer, e.g. after its credential
  // was rejected or the server moved.
  {
    kind: "action",
    action: "enroll",
    label: state.enrolled
      ? "Reconnect This Computer"
      : "Connect This Computer…",
  },
  {
    kind: "action",
    action: "toggle-prevent-sleep",
    label: "Prevent Sleep",
    checked: state.preventSleep,
  },
  { kind: "separator" },
  // What to send when something goes wrong.
  { kind: "action", action: "show-logs", label: "Show Logs" },
  { kind: "action", action: "save-diagnostics", label: "Save Diagnostics…" },
  ...(state.canSendDiagnostics
    ? [
        {
          kind: "action" as const,
          action: "send-diagnostics" as const,
          label: "Send Diagnostics…",
        },
      ]
    : []),
  { kind: "separator" },
  // Tasks run in the app, so quitting takes the computer offline.
  { kind: "action", action: "quit", label: "Quit Linger" },
];

// Long native errors would stretch the menu; the log has the full text.
const REASON_LENGTH = 80;

const updateItems = (update: TrayMenuState["update"]): TrayMenuItem[] => {
  switch (update?.kind) {
    case "downloading":
      return [
        { kind: "label", label: `Downloading Update ${update.version}…` },
      ];
    case "ready":
      return [
        {
          kind: "action",
          action: "install-update",
          label: update.services
            ? "Update Linger on This Computer"
            : `Restart to Update (${update.version})`,
        },
      ];
    case "waiting":
      return [
        {
          kind: "label",
          label: update.services
            ? "Updating When Tasks Finish"
            : `Updating to ${update.version} When Tasks Finish`,
        },
      ];
    case "installing":
      return update.services
        ? [{ kind: "label", label: "Updating Linger on This Computer…" }]
        : [];
    case "available":
      return [
        {
          kind: "action",
          action: "install-update",
          label: `Download Linger ${update.version}…`,
        },
      ];
    case "failed": {
      const reason =
        update.error.length > REASON_LENGTH
          ? `${update.error.slice(0, REASON_LENGTH - 1)}…`
          : update.error;
      return [
        { kind: "label", label: `Update Failed: ${reason}` },
        {
          kind: "action",
          action: "check-update",
          label: "Try Updating Again",
        },
      ];
    }
    default:
      return [];
  }
};

// The notification for an update once it is ready or available; clicking it
// does what the tray's update item does.
export function updateNotice(update: UpdateState): {
  title: string;
  body: string;
} {
  if (update.kind === "available")
    return {
      title: "Update available",
      body: `Linger ${update.version} is available. Click to open its download page.`,
    };
  if (update.kind === "ready" && !update.services)
    return {
      title: "Update ready",
      body: `Linger ${update.version} is downloaded. Click to restart Linger and update.`,
    };
  return {
    title: "Update ready",
    body: "Click to update Linger on this computer. It restarts in about a minute.",
  };
}
