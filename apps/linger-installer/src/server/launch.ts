import { access } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  currentManagerIdentity,
  startInstallerServer,
  type ServerOptions,
} from "./server.js";
import { openLocalTarget } from "./platform.js";
import { writeLauncher } from "./launcher.js";
import { privateRead } from "./storage.js";
type LaunchOptions = ServerOptions & {
  noOpen?: boolean;
  open?: (file: string) => Promise<void>;
};
interface SessionMetadata {
  origin?: unknown;
  controlToken?: unknown;
  sourceRepo?: unknown;
  externalComputer?: unknown;
  instanceName?: unknown;
  script?: unknown;
  scriptDigest?: unknown;
  pid?: unknown;
}
const busy = (message: string, cause?: unknown) =>
  Object.assign(new Error(message, { cause }), { code: "INSTALLER_BUSY" });
function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.replaceAll("/", "\\").toLowerCase() ===
        right.replaceAll("/", "\\").toLowerCase()
    : left === right;
}
function validSessionControl(
  metadata: SessionMetadata,
): { origin: string; controlToken: string } | undefined {
  if (
    typeof metadata.origin !== "string" ||
    !/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.test(metadata.origin) ||
    new URL(metadata.origin).port === "" ||
    Number(new URL(metadata.origin).port) > 65535 ||
    typeof metadata.controlToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(metadata.controlToken)
  )
    return undefined;
  return { origin: metadata.origin, controlToken: metadata.controlToken };
}
function pidExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ESRCH" || code === "EPERM";
  }
}
/**
 * Retires an idle desktop-owned installation manager for `instanceName`, if
 * one is still running in `home`, without interrupting an active job or
 * failing resume when no manager is reachable.
 */
export async function retireDesktopManager(options: {
  home: string;
  instanceName: string;
  signal?: AbortSignal;
  log?: (message: string) => void;
  fetch?: typeof fetch;
}): Promise<boolean> {
  const file = path.join(options.home, "installer", "session.json");
  let metadata: SessionMetadata;
  try {
    metadata = (await privateRead(file)) as SessionMetadata;
  } catch {
    return false;
  }
  const control = validSessionControl(metadata);
  if (
    !control ||
    metadata.externalComputer !== true ||
    (metadata.instanceName ?? "default") !== options.instanceName
  )
    return false;
  const fetcher = options.fetch ?? fetch;
  try {
    const response = await fetcher(`${control.origin}/api/retire`, {
      method: "POST",
      headers: {
        Origin: control.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: control.controlToken }),
      redirect: "error",
      signal: AbortSignal.any([
        ...(options.signal ? [options.signal] : []),
        AbortSignal.timeout(5_000),
      ]),
    });
    await response.body?.cancel();
    if (!response.ok) return false;
  } catch {
    options.signal?.throwIfAborted();
    return false;
  }
  const pid =
    typeof metadata.pid === "number" &&
    Number.isSafeInteger(metadata.pid) &&
    metadata.pid > 1 &&
    metadata.pid !== process.pid
      ? metadata.pid
      : undefined;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    const sessionGone = await access(file).then(
      () => false,
      () => true,
    );
    if (sessionGone && (pid === undefined || pidExited(pid))) break;
    await delay(50, undefined, { signal: options.signal });
  }
  options.log?.("Retired idle installer manager.\n");
  return true;
}
async function reopenInstaller(options: LaunchOptions) {
  const stateDir = path.join(options.home, "installer");
  let metadata: SessionMetadata;
  try {
    metadata = (await privateRead(
      path.join(stateDir, "session.json"),
    )) as SessionMetadata;
  } catch (error) {
    throw busy(
      "Another installer holds this home but its session is unreadable. Try again in a moment.",
      error,
    );
  }
  const validated = validSessionControl(metadata);
  if (!validated)
    throw busy(
      "Another installer holds this home but its session is invalid. Try again in a moment.",
    );
  const control = async (action: string) => {
    try {
      const response = await fetch(`${validated.origin}/api/${action}`, {
        method: "POST",
        headers: {
          Origin: validated.origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: validated.controlToken }),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      const body = (await response.json().catch(() => ({}))) as {
        code?: unknown;
        message?: unknown;
      };
      return { ok: response.ok, code: body.code, message: body.message };
    } catch (error) {
      throw busy(
        "The running installer did not answer. Try again in a moment.",
        error,
      );
    }
  };
  const sameDesktopInstance =
    options.externalComputer === true &&
    metadata.externalComputer === true &&
    (metadata.instanceName ?? "default") ===
      (options.instanceName ?? "default");
  const identity = sameDesktopInstance
    ? (options.managerIdentity ?? (await currentManagerIdentity()))
    : undefined;
  const desktopManagerStale =
    sameDesktopInstance &&
    identity !== undefined &&
    (typeof metadata.script !== "string" ||
      !samePath(metadata.script, identity.script) ||
      metadata.scriptDigest !== identity.digest);
  if (
    metadata.sourceRepo !== options.sourceRepo ||
    (metadata.externalComputer ?? false) !==
      (options.externalComputer ?? false) ||
    (metadata.instanceName ?? "default") !==
      (options.instanceName ?? "default") ||
    desktopManagerStale
  ) {
    // An idle desktop-owned manager for the same instance steps aside for the
    // desktop's next launch with a newer checkout or moved/updated app bundle.
    // A running job is never interrupted.
    if (!sameDesktopInstance)
      throw busy(
        "The installer is already running for another installation. Finish or close it, then try again.",
      );
    const retired = await control("retire");
    if (!retired.ok)
      throw busy(
        retired.code === "JOB_RUNNING"
          ? "An earlier installation is still running. Wait for it to finish or cancel it, then try again."
          : "The running installer could not step aside. Try again in a moment.",
      );
    return undefined;
  }
  const reopened = await control("reopen");
  if (!reopened.ok)
    throw busy("Could not reopen the installer page. Try again later.");
  const launcher = path.join(stateDir, "launch.html");
  if (!options.noOpen)
    await (options.open ?? openLocalTarget)(launcher).catch(() => {});
  return {
    origin: validated.origin,
    bootstrapToken: "",
    reused: true as const,
    closed: Promise.resolve(),
    close: async () => {},
  };
}
export async function launchInstaller(options: LaunchOptions) {
  let server: Awaited<ReturnType<typeof startInstallerServer>>;
  for (let attempt = 0; ; attempt++) {
    try {
      server = await startInstallerServer(options);
      break;
    } catch (error) {
      if ((error as { code?: unknown })?.code !== "INSTALLER_BUSY") throw error;
      if (attempt === 0) {
        const reopened = await reopenInstaller(options);
        if (reopened) return reopened;
      } else if (attempt >= 50)
        throw busy(
          "The earlier installer is still closing. Try again in a moment.",
          error,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    const launcher = await writeLauncher(
      path.join(options.home, "installer"),
      server.origin,
      server.bootstrapToken,
    );
    if (!options.noOpen)
      await (options.open ?? openLocalTarget)(launcher).catch(() => {});
  } catch {
    await server.close();
    throw new Error(
      "Could not open the installer page. Open the installer again.",
    );
  }
  return { ...server, reused: false as const };
}
