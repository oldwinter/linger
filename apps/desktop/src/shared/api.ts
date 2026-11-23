// Contract between the remote SPA (through preload) and the main process.
// The SPA detects the desktop shell with `typeof window.lingerDesktop`.

export type RuntimeState =
  | "stopped"
  | "starting"
  | "ready"
  | "draining"
  | "crashed";

export interface ComputerStatus {
  readonly bridge: string;
  readonly runtime: RuntimeState;
  readonly computerId?: string;
  readonly activeOperations: number;
  readonly preventSleep: boolean;
}

export interface WorkspaceGrantView {
  readonly grantId: string;
  readonly path: string;
  readonly label: string;
  readonly access: "read_write" | "read_only";
  readonly createdAt: string;
}

export interface DesktopSettings {
  readonly serverUrl: string;
  readonly displayName: string;
}

// Signing in with the owner account of the Linger this app installed; the
// password stays in the main process.
export type LocalAccountSignIn =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type DesktopPermissionId = "screen_recording" | "accessibility";

// A permission step this app takes on its own Mac. Linger is this app, so
// every step for it runs here; CuaDriver's own prompt and restart belong to
// the daemon, so only its System Settings pane opens from here.
export type DesktopPermissionStep =
  | {
      readonly action: "prompt";
      readonly subject: "linger";
      readonly permission: DesktopPermissionId;
    }
  | {
      readonly action: "open_settings";
      readonly subject: "linger" | "computer_use";
      readonly permission: DesktopPermissionId;
    }
  | { readonly action: "relaunch"; readonly subject: "linger" };

// The updater's progress as the page sees it; the same states the tray shows.
export type DesktopUpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | {
      readonly kind:
        | "downloading"
        | "ready"
        | "waiting"
        | "installing"
        | "available";
      readonly version: string;
    }
  | { readonly kind: "failed"; readonly error: string };

export interface LingerDesktopApi {
  readonly version: string;
  readonly platform: "darwin" | "win32" | "linux";
  readonly computer: {
    getStatus(): Promise<ComputerStatus>;
    onStatus(callback: (status: ComputerStatus) => void): () => void;
    enroll(): Promise<{ computerId: string }>;
    unenroll(): Promise<void>;
  };
  readonly workspace: {
    pick(): Promise<WorkspaceGrantView | null>;
    list(): Promise<WorkspaceGrantView[]>;
    revoke(grantId: string): Promise<void>;
  };
  readonly settings: {
    get(): Promise<DesktopSettings>;
    set(patch: { displayName?: string }): Promise<DesktopSettings>;
  };
  // The app icon's unread mention count; zero clears the badge.
  readonly notifications: {
    setBadgeCount(count: number): Promise<void>;
  };
  // The owner account of the Linger installed on this computer.
  readonly localAccount: {
    // Whether the window shows that Linger; false for any other server.
    available(): Promise<boolean>;
    signIn(): Promise<LocalAccountSignIn>;
  };
  // The app's own updates, as in the tray.
  readonly update: {
    getState(): Promise<DesktopUpdateState>;
    onState(callback: (state: DesktopUpdateState) => void): () => void;
    // Restart to Update, or open the release page of an update this
    // installation cannot apply itself.
    install(): Promise<void>;
    // Try Again after a failure.
    check(): Promise<void>;
  };
  readonly connectorOAuth: {
    prepare(): Promise<string>;
    onReturn(callback: (connectedAccountId?: string) => void): () => void;
  };
  // The link preview panel's frame, named PREVIEW_FRAME_PREFIX + an id,
  // refused to be framed; url is the page that refused.
  readonly preview: {
    onFrameRefused(
      callback: (frameName: string, url: string) => void,
    ): () => void;
  };
  // The page floats its Voice Mode and Recording windows in a window of their
  // own opened with `window.open("")`; present only when this app allows that,
  // so an older app keeps them in the page.
  readonly voiceWindow: {
    // Brings the main window to the front, from the floating window.
    showMainWindow(): Promise<void>;
  };
  // The page reports the language the person chose in Settings › Language,
  // and again on every change, so the app's menus, tray, notifications and
  // own windows follow it. No report means no choice yet.
  readonly language: {
    set(language: string): Promise<void>;
  };
  // The tray's Save Diagnostics…: writes the bundle and shows it in its
  // folder. Older apps lack it, so the page shows no entry for it there.
  readonly diagnostics: {
    save(): Promise<void>;
  };
  // macOS only.
  readonly permissions?: {
    act(step: DesktopPermissionStep): Promise<void>;
  };
}

export const IPC = {
  computerStatus: "computer.status",
  computerStatusEvent: "computer.status.event",
  computerEnroll: "computer.enroll",
  computerUnenroll: "computer.unenroll",
  workspacePick: "workspace.pick",
  workspaceList: "workspace.list",
  workspaceRevoke: "workspace.revoke",
  settingsGet: "settings.get",
  settingsSet: "settings.set",
  notificationsBadge: "notifications.badge",
  permissionAct: "permission.act",
  localAccountAvailable: "local-account.available",
  localAccountSignIn: "local-account.sign-in",
  updateState: "update.state",
  updateStateEvent: "update.state.event",
  updateInstall: "update.install",
  updateCheck: "update.check",
  connectorOAuthPrepare: "connector-oauth.prepare",
  connectorOAuthReturn: "connector-oauth.return",
  previewFrameRefused: "preview.frame-refused",
  voiceWindowShowMain: "voice-window.show-main",
  languageSet: "language.set",
  diagnosticsSave: "diagnostics.save",
} as const;
