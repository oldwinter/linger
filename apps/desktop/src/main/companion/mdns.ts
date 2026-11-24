import dgram, { type Socket } from "node:dgram";
import net from "node:net";

import type { Logger } from "../log.js";

export const MDNS_ADDRESS = "224.0.0.251";
export const MDNS_PORT = 5353;
export const LINGER_SERVICE_TYPE = "_linger._tcp.local";
export const DNS_SD_ENUM_SERVICE = "_services._dns-sd._udp.local";

export const DNS_TYPE = {
  A: 1,
  PTR: 12,
  TXT: 16,
  SRV: 33,
  ANY: 255,
} as const;

export const DNS_CLASS_IN = 1;
export const DNS_CLASS_CACHE_FLUSH = 0x8001;

export interface MdnsAnnouncement {
  readonly hostId: string;
  readonly hostName: string;
  readonly port: number;
  readonly tls: boolean;
  readonly tlsFingerprint: string;
  readonly pairingOpen: boolean;
  readonly addresses: readonly string[];
}

export interface DnsQuestion {
  readonly name: string;
  readonly type: number;
  readonly qclass: number;
}

export interface DnsRecord {
  readonly name: string;
  readonly type: number;
  readonly rclass: number;
  readonly ttl: number;
  readonly rdata: Buffer;
  readonly ptrTarget?: string;
  readonly txtEntries?: readonly string[];
  readonly srv?: {
    readonly priority: number;
    readonly weight: number;
    readonly port: number;
    readonly target: string;
  };
  readonly ip?: string;
}

export interface DecodedMdnsPacket {
  readonly id: number;
  readonly flags: number;
  readonly isResponse: boolean;
  readonly questions: readonly DnsQuestion[];
  readonly answers: readonly DnsRecord[];
  readonly additionals: readonly DnsRecord[];
}

export interface MdnsResponderOptions {
  readonly log?: Logger;
  readonly socketFactory?: () => Socket;
}

function sanitizeLabel(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/\.local\.?$/iu, "")
    .replace(/[^A-Za-z0-9 -]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 50);
  return cleaned || fallback;
}

function sanitizeHostLabel(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/\.local\.?$/iu, "")
    .replace(/[^a-z0-9-]/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63);
  return cleaned || "linger-host";
}

export function encodeDnsName(name: string): Buffer {
  const trimmed = name.replace(/\.$/u, "");
  if (!trimmed) return Buffer.from([0]);
  const labels = trimmed.split(".");
  const chunks: Buffer[] = [];
  for (const label of labels) {
    const bytes = Buffer.from(label, "utf8");
    if (bytes.length === 0 || bytes.length > 63) {
      throw new Error(`Invalid DNS label length in "${name}"`);
    }
    chunks.push(Buffer.from([bytes.length]), bytes);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

export function decodeDnsName(
  buffer: Buffer,
  startOffset: number,
): { readonly name: string; readonly nextOffset: number } {
  const labels: string[] = [];
  let offset = startOffset;
  let endOffset = startOffset;
  let jumped = false;
  let jumps = 0;

  while (offset < buffer.length) {
    const len = buffer[offset]!;
    if (len === 0) {
      if (!jumped) endOffset = offset + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (offset + 1 >= buffer.length) {
        throw new Error("Truncated DNS name pointer");
      }
      const ptr = ((len & 0x3f) << 8) | buffer[offset + 1]!;
      if (!jumped) {
        endOffset = offset + 2;
        jumped = true;
      }
      jumps += 1;
      if (jumps > 64 || ptr >= buffer.length) {
        throw new Error("Invalid DNS name compression pointer");
      }
      offset = ptr;
      continue;
    }
    if ((len & 0xc0) !== 0) {
      throw new Error("Unsupported DNS label type");
    }
    const next = offset + 1 + len;
    if (next > buffer.length) {
      throw new Error("Truncated DNS label");
    }
    labels.push(buffer.subarray(offset + 1, next).toString("utf8"));
    offset = next;
    if (!jumped) endOffset = offset;
  }

  return { name: labels.join("."), nextOffset: endOffset };
}

function encodeResourceRecord(
  name: string,
  type: number,
  rclass: number,
  ttl: number,
  rdata: Buffer,
): Buffer {
  const nameBuf = encodeDnsName(name);
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(rclass, 2);
  header.writeUInt32BE(ttl, 4);
  header.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([nameBuf, header, rdata]);
}

function encodeTxtRdata(entries: readonly string[]): Buffer {
  if (entries.length === 0) return Buffer.from([0]);
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry, "utf8");
    const clipped = bytes.length > 255 ? bytes.subarray(0, 255) : bytes;
    parts.push(Buffer.from([clipped.length]), clipped);
  }
  return Buffer.concat(parts);
}

function encodeSrvRdata(port: number, target: string): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16BE(0, 0); // priority
  header.writeUInt16BE(0, 2); // weight
  header.writeUInt16BE(port & 0xffff, 4);
  return Buffer.concat([header, encodeDnsName(target)]);
}

function encodeARdata(ipv4: string): Buffer | null {
  if (!net.isIPv4(ipv4)) return null;
  const octets = ipv4.split(".").map((n) => Number(n));
  if (octets.length !== 4) return null;
  return Buffer.from(octets);
}

export function serviceInstanceName(announcement: MdnsAnnouncement): string {
  const shortId = announcement.hostId.replace(/[^A-Za-z0-9]/gu, "").slice(0, 6);
  const label = sanitizeLabel(
    shortId ? `${announcement.hostName}-${shortId}` : announcement.hostName,
    "Linger",
  );
  return `${label}.${LINGER_SERVICE_TYPE}`;
}

export function serviceTargetHost(announcement: MdnsAnnouncement): string {
  return `${sanitizeHostLabel(announcement.hostName)}.local`;
}

export function encodeMdnsResponse(
  announcement: MdnsAnnouncement,
  options: {
    readonly goodbye?: boolean;
    readonly includeServiceEnum?: boolean;
  } = {},
): Buffer {
  const ttl = options.goodbye ? 0 : 120;
  const instanceName = serviceInstanceName(announcement);
  const targetHost = serviceTargetHost(announcement);

  const txtEntries = [
    "v=1",
    `host_id=${announcement.hostId}`,
    `name=${announcement.hostName}`,
    `tls=${announcement.tls ? "1" : "0"}`,
    `fp=${announcement.tlsFingerprint}`,
    `pair=${announcement.pairingOpen ? "1" : "0"}`,
  ];

  const answers: Buffer[] = [];
  if (options.includeServiceEnum) {
    answers.push(
      encodeResourceRecord(
        DNS_SD_ENUM_SERVICE,
        DNS_TYPE.PTR,
        DNS_CLASS_IN,
        ttl,
        encodeDnsName(LINGER_SERVICE_TYPE),
      ),
    );
  }

  answers.push(
    encodeResourceRecord(
      LINGER_SERVICE_TYPE,
      DNS_TYPE.PTR,
      DNS_CLASS_IN,
      ttl,
      encodeDnsName(instanceName),
    ),
    encodeResourceRecord(
      instanceName,
      DNS_TYPE.SRV,
      DNS_CLASS_CACHE_FLUSH,
      ttl,
      encodeSrvRdata(announcement.port, targetHost),
    ),
    encodeResourceRecord(
      instanceName,
      DNS_TYPE.TXT,
      DNS_CLASS_CACHE_FLUSH,
      ttl,
      encodeTxtRdata(txtEntries),
    ),
  );

  for (const addr of announcement.addresses) {
    const rdata = encodeARdata(addr);
    if (!rdata) continue;
    answers.push(
      encodeResourceRecord(
        targetHost,
        DNS_TYPE.A,
        DNS_CLASS_CACHE_FLUSH,
        ttl,
        rdata,
      ),
    );
  }

  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0); // ID = 0 for mDNS
  header.writeUInt16BE(0x8400, 2); // QR=1, AA=1
  header.writeUInt16BE(0, 4); // QDCOUNT
  header.writeUInt16BE(answers.length, 6); // ANCOUNT
  header.writeUInt16BE(0, 8); // NSCOUNT
  header.writeUInt16BE(0, 10); // ARCOUNT

  return Buffer.concat([header, ...answers]);
}

export function encodeMdnsQuery(
  name: string,
  type: number = DNS_TYPE.PTR,
): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x0000, 2);
  header.writeUInt16BE(1, 4);
  const qName = encodeDnsName(name);
  const qTail = Buffer.alloc(4);
  qTail.writeUInt16BE(type, 0);
  qTail.writeUInt16BE(DNS_CLASS_IN, 2);
  return Buffer.concat([header, qName, qTail]);
}

export function decodeMdnsPacket(buffer: Buffer): DecodedMdnsPacket {
  if (buffer.length < 12) {
    throw new Error("mDNS packet shorter than 12-byte header");
  }
  const id = buffer.readUInt16BE(0);
  const flags = buffer.readUInt16BE(2);
  const qdCount = buffer.readUInt16BE(4);
  const anCount = buffer.readUInt16BE(6);
  const nsCount = buffer.readUInt16BE(8);
  const arCount = buffer.readUInt16BE(10);

  let offset = 12;
  const questions: DnsQuestion[] = [];
  for (let i = 0; i < qdCount; i += 1) {
    const decoded = decodeDnsName(buffer, offset);
    offset = decoded.nextOffset;
    if (offset + 4 > buffer.length) throw new Error("Truncated DNS question");
    const type = buffer.readUInt16BE(offset);
    const qclass = buffer.readUInt16BE(offset + 2);
    offset += 4;
    questions.push({ name: decoded.name, type, qclass });
  }

  const readRecords = (count: number): DnsRecord[] => {
    const records: DnsRecord[] = [];
    for (let i = 0; i < count; i += 1) {
      const decoded = decodeDnsName(buffer, offset);
      offset = decoded.nextOffset;
      if (offset + 10 > buffer.length) throw new Error("Truncated DNS record");
      const type = buffer.readUInt16BE(offset);
      const rclass = buffer.readUInt16BE(offset + 2);
      const ttl = buffer.readUInt32BE(offset + 4);
      const rdLength = buffer.readUInt16BE(offset + 8);
      offset += 10;
      if (offset + rdLength > buffer.length) {
        throw new Error("Truncated DNS rdata");
      }
      const rdataOffset = offset;
      const rdata = buffer.subarray(rdataOffset, rdataOffset + rdLength);
      offset += rdLength;

      let ptrTarget: string | undefined;
      let txtEntries: string[] | undefined;
      let srv: DnsRecord["srv"];
      let ip: string | undefined;

      if (type === DNS_TYPE.PTR && rdLength > 0) {
        ptrTarget = decodeDnsName(buffer, rdataOffset).name;
      } else if (type === DNS_TYPE.TXT) {
        txtEntries = [];
        let p = 0;
        while (p < rdata.length) {
          const strLen = rdata[p]!;
          p += 1;
          if (p + strLen > rdata.length) break;
          if (strLen > 0) {
            txtEntries.push(rdata.subarray(p, p + strLen).toString("utf8"));
          }
          p += strLen;
        }
      } else if (type === DNS_TYPE.SRV && rdLength >= 6) {
        const priority = rdata.readUInt16BE(0);
        const weight = rdata.readUInt16BE(2);
        const port = rdata.readUInt16BE(4);
        const target = decodeDnsName(buffer, rdataOffset + 6).name;
        srv = { priority, weight, port, target };
      } else if (type === DNS_TYPE.A && rdLength === 4) {
        ip = `${rdata[0]!}.${rdata[1]!}.${rdata[2]!}.${rdata[3]!}`;
      }

      records.push({
        name: decoded.name,
        type,
        rclass,
        ttl,
        rdata,
        ...(ptrTarget !== undefined ? { ptrTarget } : {}),
        ...(txtEntries !== undefined ? { txtEntries } : {}),
        ...(srv !== undefined ? { srv } : {}),
        ...(ip !== undefined ? { ip } : {}),
      });
    }
    return records;
  };

  const answers = readRecords(anCount);
  // Skip authority records while keeping offset accurate.
  readRecords(nsCount);
  const additionals = readRecords(arCount);

  return {
    id,
    flags,
    isResponse: (flags & 0x8000) !== 0,
    questions,
    answers,
    additionals,
  };
}

export class MdnsResponder {
  readonly #log?: Logger;
  readonly #socketFactory: () => Socket;
  #socket: Socket | undefined;
  #announcement: MdnsAnnouncement | undefined;
  #repeatTimer: NodeJS.Timeout | undefined;
  #active = false;

  constructor(options: MdnsResponderOptions = {}) {
    this.#log = options.log;
    this.#socketFactory =
      options.socketFactory ??
      (() => dgram.createSocket({ type: "udp4", reuseAddr: true }));
  }

  active(): boolean {
    return this.#active;
  }

  async start(announcement: MdnsAnnouncement): Promise<boolean> {
    this.#announcement = announcement;
    if (this.#socket) {
      this.#send(false);
      return this.#active;
    }

    const socket = this.#socketFactory();
    const started = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      socket.on("error", (error) => {
        this.#log?.warn("companion.mdns_error", { error: String(error) });
        if (!settled) {
          try {
            socket.close();
          } catch {
            // Ignore close errors during failed startup.
          }
          finish(false);
        }
      });

      socket.on("message", (msg) => {
        this.#onMessage(msg);
      });

      try {
        socket.bind(MDNS_PORT, () => {
          try {
            socket.addMembership(MDNS_ADDRESS);
            socket.setMulticastTTL(255);
            socket.setMulticastLoopback(true);
          } catch (error) {
            this.#log?.warn("companion.mdns_multicast_warning", {
              error: String(error),
            });
          }
          this.#socket = socket;
          this.#active = true;
          this.#send(false);
          this.#repeatTimer = setTimeout(() => {
            this.#repeatTimer = undefined;
            if (this.#active) this.#send(false);
          }, 1_000);
          this.#repeatTimer.unref();
          finish(true);
        });
      } catch (error) {
        this.#log?.warn("companion.mdns_bind_failed", { error: String(error) });
        try {
          socket.close();
        } catch {
          // Ignore close errors.
        }
        finish(false);
      }
    });

    return started;
  }

  update(announcement: MdnsAnnouncement): void {
    this.#announcement = announcement;
    if (this.#active && this.#socket) {
      this.#send(false);
    }
  }

  async stop(): Promise<void> {
    if (this.#repeatTimer) {
      clearTimeout(this.#repeatTimer);
      this.#repeatTimer = undefined;
    }
    const socket = this.#socket;
    this.#socket = undefined;
    const wasActive = this.#active;
    this.#active = false;
    if (!socket) return;

    if (wasActive && this.#announcement) {
      await this.#sendAsync(true, socket);
    }
    await new Promise<void>((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  #onMessage(msg: Buffer): void {
    const current = this.#announcement;
    if (!current || !this.#socket) return;
    let packet: DecodedMdnsPacket;
    try {
      packet = decodeMdnsPacket(msg);
    } catch {
      return;
    }
    if (packet.isResponse) return;

    const instanceLower = serviceInstanceName(current).toLowerCase();
    const hostLower = serviceTargetHost(current).toLowerCase();
    let includeServiceEnum = false;
    let matches = false;

    for (const q of packet.questions) {
      const qName = q.name.toLowerCase();
      if (qName === DNS_SD_ENUM_SERVICE) {
        includeServiceEnum = true;
        matches = true;
      } else if (
        qName === LINGER_SERVICE_TYPE ||
        qName === instanceLower ||
        qName === hostLower
      ) {
        matches = true;
      }
    }

    if (matches) {
      this.#send(false, includeServiceEnum);
    }
  }

  #send(goodbye: boolean, includeServiceEnum = false): void {
    const socket = this.#socket;
    const current = this.#announcement;
    if (!socket || !current) return;
    const payload = encodeMdnsResponse(current, {
      goodbye,
      includeServiceEnum,
    });
    try {
      socket.send(payload, MDNS_PORT, MDNS_ADDRESS, (error) => {
        if (error) {
          this.#log?.warn("companion.mdns_send_failed", {
            error: String(error),
          });
        }
      });
    } catch (error) {
      this.#log?.warn("companion.mdns_send_failed", { error: String(error) });
    }
  }

  #sendAsync(goodbye: boolean, socket: Socket): Promise<void> {
    const current = this.#announcement;
    if (!current) return Promise.resolve();
    const payload = encodeMdnsResponse(current, { goodbye });
    return new Promise((resolve) => {
      try {
        socket.send(payload, MDNS_PORT, MDNS_ADDRESS, () => resolve());
      } catch {
        resolve();
      }
    });
  }
}
