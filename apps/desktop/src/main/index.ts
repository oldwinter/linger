import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Notification,
  app,
  desktopCapturer,
  dialog,
  powerMonitor,
  powerSaveBlocker,
  session,
  shell,
  systemPreferences,
} from "electron";

import { lingerHome } from "@linger/local-installation/home";

import { quitRequested } from "./app-window.js";
import { CredentialStore } from "./computer-credential.js";
import {
  ComputerDaemonModule,
  protectWithDaemon,
  spawnDaemon,
} from "./computer-daemon.js";
import { ConfigStore } from "./config.js";
import { DesktopIpcModule } from "./desktop-ipc.js";
import { dialogMessages } from "./dialogs.messages.js";
import { DiagnosticsModule } from "./diagnostics.js";
import { DriverUpdater } from "./driver-updater.js";
import {
  detectWindowsNvidiaGpuName,
  runWindowsDriverInstaller,
  verifyWindowsAuthenticode,
} from "./windows-driver-platform.js";
import { EnrollmentModule } from "./enrollment.js";
import { GlobalShortcutModule } from "./global-shortcut.js";
import { LanguageModule } from "./language.js";
import {
  LocalServerModule,
  signInWithPassword,
  type SourceArchive,
  type SourceDependencies,
} from "./local-server.js";
import { fileLogger, type Logger } from "./log.js";
import { MacPermissions } from "./mac-permissions.js";
import { MobileCompanionModule } from "./mobile-companion.js";
import { EventBus, ModuleHost, type Module } from "./modules.js";
import { parseServerUrl } from "./navigation.js";
import { openWithXdg } from "./open-url.js";
import { PowerGuardModule, type PowerApi } from "./power-guard.js";
import { QuickNoteModule } from "./quick-note.js";
import { createQuitGuard } from "./quit-guard.js";
import { SetupWindowModule } from "./setup-window.js";
import { loginShellEnvironment, withLoginShell } from "./shell-env.js";
import { markStartMenuShortcut } from "./start-menu-shortcut.js";
import { StatusModule } from "./status.js";
import { stopActiveRoomRunsBeforeQuit } from "./stop-tasks.js";
import { SystemPermissions } from "./system-permissions.js";
import { TrayModule } from "./tray.js";
import { updateNotice } from "./tray-menu.js";
import { UpdaterModule, updateInstallFor } from "./updater.js";
import { WindowManagerModule, registerAppScheme } from "./window-manager.js";
import { WorkspaceGrantsModule } from "./workspace-grants.js";

declare const __DESKTOP_VERSION__: string;
declare const __SOURCE_ARCHIVE__: SourceArchive | null;
declare const __SOURCE_DEPENDENCIES__: SourceDependencies | null;
const VERSION = __DESKTOP_VERSION__;
const here = path.dirname(fileURLToPath(import.meta.url));

// Development overrides; installed builds keep LingerX isolated from upstream Linger.
if (process.env.LINGER_DESKTOP_USER_DATA)
  app.setPath("userData", path.resolve(process.env.LINGER_DESKTOP_USER_DATA));
else if (app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "LingerX"));
}

// Windows shows notifications only for an app id that a Start menu shortcut
// carries. The installer makes the shortcut; the app writes the id into it.
const APP_USER_MODEL_ID = "dev.oldwinter.lingerx.desktop";
if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);

// `--quit` (the uninstaller) asks a running Linger to quit, and starts
// nothing when none runs.
if (!app.requestSingleInstanceLock() || quitRequested(process.argv)) {
  app.quit();
} else {
  registerAppScheme();
  void app.whenReady().then(main);
}

async function main(): Promise<void> {
  const readyAt = Math.round(process.uptime() * 1000);
  const userData = app.getPath("userData");
  const log = fileLogger(path.join(userData, "logs"), {
    stderr: !app.isPackaged,
  });
  if (process.platform === "win32" && app.isPackaged)
    markStartMenuShortcut({
      appData: app.getPath("appData"),
      execPath: process.execPath,
      appUserModelId: APP_USER_MODEL_ID,
      env: process.env,
      readShortcutLink: (shortcut) => shell.readShortcutLink(shortcut),
      writeShortcutLink: (shortcut, operation, options) =>
        shell.writeShortcutLink(shortcut, operation, options),
      onWriteError: (error) =>
        log.warn("desktop.start_menu_shortcut_failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
    });
  const background = process.argv.includes("--background");
  const envServer = parseServerUrl(process.env.LINGER_SERVER_URL ?? "");
  const config = new ConfigStore(
    path.join(userData, "config.json"),
    envServer ? { serverUrl: envServer } : {},
  );
  const defaultDisplayName = os.hostname();
  const daemonDirectory = path.join(userData, "computer");
  const credentials = new CredentialStore(
    path.join(daemonDirectory, "credential.json"),
  );

  // The default LINGER_HOME of the installer.
  const home = lingerHome();
  // The cookie header of the window's session for a server.
  const webSessionCookie = async (
    serverUrl: string,
  ): Promise<string | undefined> => {
    const cookies = await session.defaultSession.cookies.get({
      url: serverUrl,
    });
    return cookies.length > 0
      ? cookies.map((c) => `${c.name}=${c.value}`).join("; ")
      : undefined;
  };
  const loginShell = resolveLoginShell(log);
  const daemonPath = daemonExecutable();
  const nodeBinaryName = process.platform === "win32" ? "node.exe" : "node";
  const localServer = new LocalServerModule({
    home,
    daemonDirectory,
    daemonExecutable: daemonPath,
    version: VERSION,
    inspectEnv: inspectEnv(loginShell),
    macosVersion: () => process.getSystemVersion(),
    installerDirectory: path.join(here, "../installer"),
    bundledNodePath: app.isPackaged
      ? path.join(process.resourcesPath, "runtime", "bin", nodeBinaryName)
      : path.join(here, "../computer/runtime/bin", nodeBinaryName),
    ...(__SOURCE_ARCHIVE__ ? { sourceArchive: __SOURCE_ARCHIVE__ } : {}),
    ...(__SOURCE_DEPENDENCIES__
      ? { sourceDependencies: __SOURCE_DEPENDENCIES__ }
      : {}),
    // Developers install their own linger checkout instead.
    ...(process.env.LINGER_CHECKOUT
      ? { checkout: process.env.LINGER_CHECKOUT }
      : {}),
    // The window's session is the default one, which enrollment reads too.
    signIn: (server, email, password) =>
      signInWithPassword(server, email, password, (cookie) =>
        session.defaultSession.cookies.set({ url: server.origin, ...cookie }),
      ),
    sessionCookie: webSessionCookie,
    // On Linux the sign-in needs to know when no browser opened.
    openExternal: (url) =>
      process.platform === "linux" ? openWithXdg(url) : shell.openExternal(url),
    // The system proxy (fixed or PAC) the voice services reach Soniox with.
    resolveProxy: (url) => session.defaultSession.resolveProxy(url),
  });
  // Until this computer is connected, the setup window comes first.
  const needsSetup = !config.get().computerId;
  const windows = new WindowManagerModule({
    preload: path.join(here, "../preload/index.cjs"),
    shellPreload: path.join(here, "../preload/shell.cjs"),
    background: background || needsSetup,
    localServerResumable: (url) => localServer.isStarting(url),
  });
  const openExternal = (url: string): Promise<void> =>
    process.platform === "linux" ? openWithXdg(url) : shell.openExternal(url);
  const bus = new EventBus();
  const driverUpdater = new DriverUpdater({
    platform: process.platform as "darwin" | "win32" | "linux",
    arch: process.arch,
    existsSync,
    env: process.env,
    launchExecutable: async (executablePath) => {
      const error = await shell.openPath(executablePath);
      if (error) throw new Error(error);
    },
    openExternal,
    onStateChange: () => bus.emit("driver-update.changed"),
    onBusyChange: (busy) => bus.emit("driver-update.busy", busy),
    ...(process.platform === "win32" && process.arch === "x64"
      ? {
          directInstall: {
            downloadDirectory: path.join(userData, "driver-updates"),
            detectGpuName: detectWindowsNvidiaGpuName,
            verifyAuthenticode: verifyWindowsAuthenticode,
            runInstaller: runWindowsDriverInstaller,
            readPendingUpdate: () => config.get().pendingDriverUpdate,
            writePendingUpdate: (record) => {
              config.update({ pendingDriverUpdate: record });
            },
            systemUptimeSeconds: () => os.uptime(),
          },
        }
      : {}),
  });
  const setup = new SetupWindowModule({
    preload: path.join(here, "../preload/setup.cjs"),
    version: VERSION,
    defaultDisplayName,
    show: () => !background && !config.get().computerId,
    loginItem: {
      get: () => app.getLoginItemSettings().openAtLogin,
      set: (on) =>
        app.setLoginItemSettings({ openAtLogin: on, args: ["--background"] }),
    },
    driverUpdater,
    ...(process.platform === "darwin"
      ? {
          permissions: new MacPermissions({
            home: app.getPath("home"),
            asked: () => config.get().permissionsAsked,
            markAsked: (id) => {
              const asked = config.get().permissionsAsked;
              if (!asked.includes(id))
                config.update({ permissionsAsked: [...asked, id] });
            },
          }),
        }
      : {}),
  });
  const language = new LanguageModule({
    systemLanguages: () => app.getPreferredSystemLanguages(),
  });
  const status = new StatusModule();
  // Set once the bundle was swapped, so quitting relaunches the new version.
  let relaunch = false;
  // Set once the setup program of an update runs; it starts the new version.
  let updating = false;
  const updater = new UpdaterModule({
    version: VERSION,
    platform: process.platform,
    arch: process.arch,
    install: app.isPackaged
      ? updateInstallFor(process.platform, process.execPath, existsSync)
      : undefined,
    downloadDirectory: path.join(userData, "updates"),
    prepareUpdate: (stagedPath, signal) =>
      localServer.prepareUpdateTool(stagedPath, signal),
    announce: (state) => {
      if (!Notification.isSupported()) return;
      const notice = new Notification(updateNotice(state, language.t));
      notice.on("click", () => void updater.install());
      notice.show();
    },
    restart: async () => {
      relaunch = true;
      app.quit();
    },
    quit: async () => {
      updating = true;
      app.quit();
    },
    openExternal: (url) => shell.openExternal(url),
  });
  // The app's own macOS permissions, which the daemon asks about over stdio
  // and the page acts on over IPC.
  const desktopPermissions =
    process.platform === "darwin"
      ? {
          permissions: new SystemPermissions({
            screenAccessStatus: () =>
              systemPreferences.getMediaAccessStatus("screen"),
            isTrustedAccessibilityClient: (prompt) =>
              systemPreferences.isTrustedAccessibilityClient(prompt),
            captureScreens: () =>
              desktopCapturer.getSources({
                types: ["screen"],
                thumbnailSize: { width: 0, height: 0 },
              }),
            openExternal: (url) => shell.openExternal(url),
          }),
          openExternal: (url: string) => shell.openExternal(url),
          // The same quit and relaunch path an installed update takes.
          relaunch: () => {
            relaunch = true;
            app.quit();
          },
        }
      : undefined;
  const daemon = new ComputerDaemonModule({
    spawn: spawnDaemon(
      daemonPath,
      path.join(userData, "logs", "computer-daemon.log"),
    ),
    credentials,
    directory: daemonDirectory,
    // The bundled teamhub CLI, run by the app's own Node, so runtimes reply
    // with a matching version and the computer needs no Node.
    teamhubCliDirectory: path.join(here, "../teamhub-cli"),
    defaultDisplayName,
    env: daemonEnv(loginShell),
    ...(process.platform === "win32"
      ? { protect: protectWithDaemon(daemonPath) }
      : {}),
    ...desktopPermissions,
  });
  const power = new PowerGuardModule(electronPower());
  // The tray tooltip names the badge count the SPA sends over IPC.
  let requestQuit = (): Promise<void> => Promise.resolve();
  const tray = new TrayModule({ quit: () => void requestQuit() });
  const modules: Module[] = [
    {
      name: "Config",
      dependsOn: [],
      start: async () => {},
      stop: async () => {},
    },
    language,
    new EnrollmentModule({
      defaultDisplayName,
      credentials,
      daemonIdentityFile: path.join(
        daemonDirectory,
        "state",
        "daemon-identity.json",
      ),
      sessionCookie: webSessionCookie,
    }),
    new WorkspaceGrantsModule({
      pickDirectory: async () => {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
      defaultDirectory: path.join(app.getPath("home"), "LingerX"),
    }),
    daemon,
    status,
    power,
    windows,
    localServer,
    new MobileCompanionModule({
      preload: path.join(here, "../preload/mobile-companion.cjs"),
      userData,
      version: VERSION,
      defaultHostName: defaultDisplayName,
      localServer,
      status,
      daemon,
      power,
      sessionCookie: webSessionCookie,
    }),
    new DiagnosticsModule({
      userData,
      logs: path.join(userData, "logs"),
      home,
      version: VERSION,
      output: () => app.getPath("downloads"),
      openFolder: (folder) => shell.openPath(folder),
      showFile: (file) => shell.showItemInFolder(file),
      outbox: path.join(userData, "diagnostics-outbox"),
    }),
    setup,
    new QuickNoteModule({
      preload: path.join(here, "../preload/quick-note.cjs"),
      sessionCookie: webSessionCookie,
    }),
    new GlobalShortcutModule(),
    updater,
    tray,
    new DesktopIpcModule({
      defaultDisplayName,
      // Electron's count badge exists on macOS and Linux only.
      ...(process.platform === "win32" ? {} : { badge: app }),
      ...(desktopPermissions ? { permissions: desktopPermissions } : {}),
      tray,
      driverUpdater,
    }),
  ];
  const host = new ModuleHost(modules, { config, log, bus });

  const showApp = (): void => setup.showApp();
  // The uninstaller, or setup replacing this release, asked to quit.
  let replacing = false;
  app.on("second-instance", (_event, argv) => {
    // Without asking: the uninstaller is removing the app.
    if (quitRequested(argv)) {
      replacing = true;
      app.quit();
    } else showApp();
  });
  app.on("activate", showApp);
  // Closing the window only hides it; the tray keeps the app running.
  app.on("window-all-closed", () => {});
  // Tasks run in the app, so quitting takes this computer offline; every
  // user-initiated quit path (Tray, Cmd+Q, Dock, App menu) confirms when
  // tasks are actively running, while automatic updater/uninstaller quits
  // proceed without blocking.
  const quitGuard = createQuitGuard({
    isBusy: () => status.current().tone === "busy",
    isAutomaticQuit: () => relaunch || updating || replacing,
    confirmBusyQuit: async () => {
      const options = {
        type: "warning" as const,
        buttons: [
          language.t(dialogMessages.quitAndStop),
          language.t(dialogMessages.keepRunning),
        ],
        defaultId: 1,
        cancelId: 1,
        message: language.t(dialogMessages.quitConfirm),
        detail: language.t(dialogMessages.quitConfirmDetail),
      };
      const win = windows.window();
      const { response } = await (win && !win.isDestroyed() && win.isVisible()
        ? dialog.showMessageBox(win, options)
        : dialog.showMessageBox(options));
      return response === 0;
    },
    prepareQuit: () => windows.prepareQuit(),
    stopTasksBeforeQuit: async () => {
      const current = config.get();
      await Promise.allSettled([
        stopActiveRoomRunsBeforeQuit({
          serverUrl: current.serverUrl,
          tenantId: current.tenantId,
          sessionCookie: webSessionCookie,
          log,
        }),
        daemon.stopTasksAndTerminate(),
      ]);
    },
    // Setup and the uninstaller stop the services and the local models
    // themselves right after --quit; a stop from here would race theirs.
    stopHost: (reason) => host.stop(reason),
    requestAppQuit: () => app.quit(),
    relaunchIfNeeded: () => {
      if (relaunch) app.relaunch();
    },
    exitApp: () => app.exit(0),
  });
  requestQuit = () => quitGuard.requestQuit();
  app.on("before-quit", (event) => quitGuard.handleBeforeQuit(event));

  try {
    await host.start();
    // Uptime since process start, to see where launch time goes.
    log.info("desktop.started", {
      version: VERSION,
      background,
      readyMs: readyAt,
      startedMs: Math.round(process.uptime() * 1000),
    });
  } catch (error) {
    log.error("desktop.start_failed", { error: String(error) });
    dialog.showErrorBox(
      "LingerX",
      language.t(dialogMessages.startFailed, { error: String(error) }),
    );
    app.exit(1);
  }
}

// LINGER_COMPUTER_DAEMON overrides the daemon for development. Packaged
// builds ship it under resources/computer; development builds it into
// dist/computer/<platform>-<arch>.
function daemonExecutable(): string {
  const name =
    process.platform === "win32"
      ? "linger-computer-daemon.exe"
      : "linger-computer-daemon";
  if (process.env.LINGER_COMPUTER_DAEMON)
    return path.resolve(process.env.LINGER_COMPUTER_DAEMON);
  return app.isPackaged
    ? path.join(process.resourcesPath, "computer", name)
    : path.join(
        here,
        "../computer",
        `${process.platform}-${process.arch}`,
        name,
      );
}

function electronPower(): PowerApi {
  return {
    block: () => powerSaveBlocker.start("prevent-app-suspension"),
    unblock: (id) => powerSaveBlocker.stop(id),
    onPowerEvent: (listener) => {
      const suspend = (): void => listener("suspend");
      const resume = (): void => listener("resume");
      powerMonitor.on("suspend", suspend);
      powerMonitor.on("resume", resume);
      return () => {
        powerMonitor.off("suspend", suspend);
        powerMonitor.off("resume", resume);
      };
    },
  };
}

async function resolveLoginShell(
  log: Logger,
): Promise<Record<string, string> | undefined> {
  const started = Date.now();
  const login = await loginShellEnvironment();
  log.info("computer_daemon.login_shell", {
    resolved: login !== undefined,
    duration_ms: Date.now() - started,
  });
  return login;
}

// The user's terminal environment for read-only setup inspection (--inspect),
// keeping LINGER_* controls while adding the login shell's PATH and profile.
// Never forwarded to --resume, BYOK checks, or the serving installer that
// starts local services.
async function inspectEnv(
  loginShell: Promise<Record<string, string> | undefined>,
): Promise<Record<string, string>> {
  const login = await loginShell;
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    withLoginShell(process.env as Record<string, string>, login),
  )) {
    if (value === undefined) continue;
    env[name] = value;
  }
  return env;
}

// The user's terminal environment, which runtimes inherit, without the app's
// own control variables. The runtime paths stay for the daemon config; the
// daemon keeps LINGER_* from runtimes.
async function daemonEnv(
  loginShell: Promise<Record<string, string> | undefined>,
): Promise<Record<string, string>> {
  const login = await loginShell;
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    withLoginShell(process.env as Record<string, string>, login),
  )) {
    if (value === undefined || /^(ELECTRON_|LINGER_)/i.test(name)) continue;
    env[name] = value;
  }
  for (const name of [
    "LINGER_CODEX_PATH",
    "LINGER_CLAUDE_PATH",
    "LINGER_PI_PATH",
  ]) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}
