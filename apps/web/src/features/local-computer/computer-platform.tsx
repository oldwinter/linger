import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";

import { computerSetupMessages } from "./computer-setup.messages";

export type ComputerPlatform = "darwin" | "linux" | "win32";

export function browserComputerPlatform(): ComputerPlatform {
  const platform = navigator.platform || navigator.userAgent;
  if (/windows|^win(?:32|64)/i.test(platform)) return "win32";
  if (/linux|x11/i.test(platform)) return "linux";
  return "darwin";
}

/**
 * The environment name a Web origin's Computer installs under, as the
 * installers derive it: the host's first label without "-linger",
 * "local" for loopback, or the dashed address for an IP, plus any non-default
 * port.
 */
export function computerEnvironmentName(origin: string): string {
  const url = new URL(origin);
  const host = url.hostname.toLowerCase();
  let name: string;
  if (
    ["localhost", "127.0.0.1", "[::1]"].includes(host) ||
    host.endsWith(".localhost")
  )
    name = "local";
  else if (host.startsWith("["))
    name = `ip-${host.slice(1, -1).replace(/[:.]/gu, "-")}`;
  else if (/^[0-9.]+$/u.test(host)) name = `ip-${host.replaceAll(".", "-")}`;
  else {
    name = host.split(".")[0]!;
    if (name !== "linger") name = name.replace(/-linger$/u, "");
  }
  return url.port ? `${name}-${url.port}` : name;
}

/**
 * Each environment's Computer has its own command, so Computers of several
 * environments can share one machine.
 */
export function computerCommand(): string {
  return `linger-computer-${computerEnvironmentName(window.location.origin)}`;
}

export function computerInstallCommand(platform: ComputerPlatform): string {
  const origin = window.location.origin;
  return platform === "win32"
    ? `irm '${origin}/install/linger-computer.ps1' | iex`
    : `curl -fsSL "${origin}/install/linger-computer.sh" | bash`;
}

export function ComputerPlatformSelector({
  value,
  onChange,
}: {
  value: ComputerPlatform | "";
  onChange: (platform: ComputerPlatform) => void;
}) {
  const t = useT();
  return (
    <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {t(computerSetupMessages.operatingSystem)}
      <span className="relative inline-flex items-center">
        <select
          className="h-8 appearance-none rounded-md border border-border bg-card pl-2.5 pr-8 text-sm text-foreground transition-colors duration-150 hover:border-border-hover focus-visible:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={value}
          onChange={(event) => onChange(event.target.value as ComputerPlatform)}
        >
          <option value="" disabled>
            {t(computerSetupMessages.chooseOperatingSystem)}
          </option>
          <option value="darwin">macOS</option>
          <option value="win32">Windows</option>
          <option value="linux">Linux</option>
        </select>
        <Icon
          className="pointer-events-none absolute right-2 text-muted-foreground"
          icon={ArrowDown01Icon}
          size={14}
        />
      </span>
    </label>
  );
}
