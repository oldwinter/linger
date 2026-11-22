import { createSocket } from "node:dgram";
import net from "node:net";

// The addresses a loopback service can be reached on. The product origin is
// `http://localhost:<port>`, which macOS resolves to ::1 first, so a program
// listening on ::1 alone would answer in place of a service that bound
// 127.0.0.1 without an error. A port is free only when both can be bound and
// neither answers.
const LOOPBACK = ["127.0.0.1", "::1"] as const;
// A computer without IPv6 has no ::1; nothing can listen there either.
const NO_IPV6 = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT", "EINVAL"]);

type Protocol = "tcp" | "udp";

function bindConflict(
  port: number,
  host: string,
  protocol: Protocol,
): Promise<string | undefined> {
  const ipv6 = host.includes(":");
  return new Promise((resolve) => {
    const failed = (error: NodeJS.ErrnoException) =>
      resolve(
        ipv6 && NO_IPV6.has(error.code ?? "")
          ? undefined
          : `${host} bind: ${error.code ?? error.name}`,
      );
    if (protocol === "udp") {
      const socket = createSocket(ipv6 ? "udp6" : "udp4");
      socket.once("error", (error) => {
        try {
          socket.close();
        } catch {
          // A socket that never bound is already closed.
        }
        failed(error);
      });
      socket.bind(port, host, () => socket.close(() => resolve(undefined)));
      return;
    }
    const server = net.createServer();
    server.once("error", failed);
    server.listen({ port, host, exclusive: true }, () =>
      server.close(() => resolve(undefined)),
    );
  });
}

// macOS lets a program bind one address under another program's listener on
// every address, so a successful bind does not prove nobody answers there.
function answers(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host, timeout: 500 });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

async function portConflict(
  port: number,
  protocol: Protocol,
): Promise<string | undefined> {
  for (const host of LOOPBACK) {
    const conflict = await bindConflict(port, host, protocol);
    if (conflict) return conflict;
  }
  if (protocol === "udp") return undefined;
  const answered = await Promise.all(
    LOOPBACK.map((host) => answers(port, host)),
  );
  const host = LOOPBACK[answered.indexOf(true)];
  return host ? `${host} already answers TCP connections` : undefined;
}

/** Whether no program uses `port` on IPv4 or IPv6 loopback. */
export async function portFree(
  port: number,
  protocol: Protocol = "tcp",
): Promise<boolean> {
  return (await portConflict(port, protocol)) === undefined;
}

function ephemeral(protocol: Protocol): Promise<number> {
  return new Promise((resolve, reject) => {
    if (protocol === "udp") {
      const socket = createSocket("udp4");
      socket.once("error", reject);
      socket.bind(0, "127.0.0.1", () => {
        const { port } = socket.address();
        socket.close(() => resolve(port));
      });
      return;
    }
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * `preferred` when it is free, else a free port the system offers, never one
 * in `reserved` (the ports this home's instances keep); adds it to `reserved`.
 */
export async function freePort(
  reserved: Set<number>,
  options: { preferred?: number; protocol?: Protocol } = {},
): Promise<number> {
  const protocol = options.protocol ?? "tcp";
  let port = options.preferred;
  let lastConflict: string | undefined;
  for (let attempt = 0; ; attempt++) {
    if (port !== undefined && !reserved.has(port)) {
      lastConflict = await portConflict(port, protocol);
      if (lastConflict === undefined) {
        reserved.add(port);
        return port;
      }
    }
    if (attempt >= 100)
      throw new Error(
        `No free local port is available on this computer. ${protocol.toUpperCase()}: ${lastConflict ?? "all candidates were reserved"}.`,
      );
    port = await ephemeral(protocol);
  }
}
