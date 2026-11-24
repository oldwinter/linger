import net from "node:net";
import os from "node:os";

export interface DiscoveredAddresses {
  readonly lan: readonly string[];
  readonly tailscale: readonly string[];
  readonly allIps: readonly string[];
}

export interface HostValidationOptions {
  readonly localIps: ReadonlySet<string>;
  readonly hostname: string;
  readonly customHost?: string;
}

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function isValidDnsName(value: string): boolean {
  if (!value || value.length > 253) return false;
  const trimmed = value.endsWith(".") ? value.slice(0, -1) : value;
  if (!trimmed) return false;
  return trimmed.split(".").every((label) => DNS_LABEL_PATTERN.test(label));
}

export function isIpv4Loopback(ip: string): boolean {
  return ip.startsWith("127.");
}

export function isIpv4LinkLocal(ip: string): boolean {
  return ip.startsWith("169.254.");
}

// Tailscale IPv4 uses RFC 6598 CGNAT space: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255).
export function isTailscaleIpv4(ip: string): boolean {
  if (net.isIPv4(ip) === false) return false;
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  return first === 100 && second >= 64 && second <= 127;
}

// Tailscale IPv6 uses fd7a:115c:a1e0::/48.
export function isTailscaleIpv6(ip: string): boolean {
  if (net.isIPv6(ip) === false) return false;
  return ip.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

export function isRfc1918Ipv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  const parts = ip.split(".");
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  return (
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

function isIpv6LinkLocalOrLoopback(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fe90:") ||
    lower.startsWith("fea0:") ||
    lower.startsWith("feb0:")
  );
}

function lanPriority(ip: string): number {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  if (isRfc1918Ipv4(ip)) return 2;
  return 3;
}

export function discoverAddresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): DiscoveredAddresses {
  const lanSet = new Set<string>();
  const tailscaleSet = new Set<string>();
  const allSet = new Set<string>(["127.0.0.1", "::1"]);

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const info of entries) {
      const address = info.address.split("%", 1)[0] ?? "";
      if (!address) continue;
      const lower = address.toLowerCase();
      allSet.add(lower);
      if (info.internal) continue;

      if (info.family === "IPv4") {
        if (isIpv4Loopback(address) || isIpv4LinkLocal(address)) continue;
        if (isTailscaleIpv4(address)) {
          tailscaleSet.add(address);
        } else {
          lanSet.add(address);
        }
      } else if (info.family === "IPv6") {
        if (isIpv6LinkLocalOrLoopback(lower)) continue;
        if (isTailscaleIpv6(lower)) {
          tailscaleSet.add(lower);
        }
      }
    }
  }

  const lan = [...lanSet].sort(
    (a, b) => lanPriority(a) - lanPriority(b) || a.localeCompare(b),
  );
  const tailscale = [...tailscaleSet].sort((a, b) => {
    const aV4 = net.isIPv4(a) ? 0 : 1;
    const bV4 = net.isIPv4(b) ? 0 : 1;
    return aV4 - bV4 || a.localeCompare(b);
  });
  const allIps = [...allSet].sort();

  return { lan, tailscale, allIps };
}

export function extractHostName(rawHost: string | undefined): string | null {
  if (!rawHost) return null;
  const trimmed = rawHost.trim();
  if (!trimmed || trimmed.length > 260) return null;
  if (/[\s/@\\?#,]/u.test(trimmed)) return null;

  if (trimmed.startsWith("[")) {
    const closeIdx = trimmed.indexOf("]");
    if (closeIdx === -1) return null;
    const ipv6 = trimmed.slice(1, closeIdx);
    if (!net.isIPv6(ipv6)) return null;
    const rest = trimmed.slice(closeIdx + 1);
    if (rest.length > 0) {
      if (!isValidPortSuffix(rest)) return null;
    }
    return ipv6.toLowerCase();
  }

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx !== -1) {
    // Unbracketed IPv6 has multiple colons and is invalid in Host headers.
    if (trimmed.indexOf(":", colonIdx + 1) !== -1) return null;
    const portSuffix = trimmed.slice(colonIdx);
    if (!isValidPortSuffix(portSuffix)) return null;
    const hostPart = trimmed.slice(0, colonIdx).toLowerCase();
    return hostPart || null;
  }

  return trimmed.toLowerCase();
}

function isValidPortSuffix(suffix: string): boolean {
  if (!suffix.startsWith(":")) return false;
  const portStr = suffix.slice(1);
  if (!/^\d{1,5}$/u.test(portStr)) return false;
  const port = Number(portStr);
  return port >= 1 && port <= 65535;
}

export function normalizeCustomHost(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const extracted = extractHostName(raw);
  return extracted ?? undefined;
}

export function isAllowedHostHeader(
  hostHeader: string | undefined,
  options: HostValidationOptions,
): boolean {
  const host = extractHostName(hostHeader);
  if (!host) return false;

  const bareHost = host.endsWith(".") ? host.slice(0, -1) : host;
  if (!bareHost) return false;

  if (
    bareHost === "localhost" ||
    bareHost === "127.0.0.1" ||
    bareHost === "::1"
  ) {
    return true;
  }

  if (options.localIps.has(bareHost)) {
    return true;
  }

  const machineHost = options.hostname.trim().toLowerCase().replace(/\.$/u, "");
  if (machineHost) {
    const shortHost = machineHost.replace(/\.local$/u, "");
    if (bareHost === machineHost || bareHost === shortHost) {
      return true;
    }
    if (shortHost && bareHost === `${shortHost}.local`) {
      return true;
    }
    if (shortHost && bareHost.endsWith(".ts.net") && isValidDnsName(bareHost)) {
      const labels = bareHost.slice(0, -".ts.net".length).split(".");
      if (labels.length >= 2 && labels[0] === shortHost) {
        return true;
      }
    }
  }

  if (options.customHost) {
    const normalizedCustom = normalizeCustomHost(options.customHost);
    if (normalizedCustom && bareHost === normalizedCustom.replace(/\.$/u, "")) {
      return true;
    }
  }

  return false;
}
