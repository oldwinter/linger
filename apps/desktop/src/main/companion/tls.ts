import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  discoverAddresses,
  extractHostName,
  isValidDnsName,
} from "./network.js";

export interface TlsMaterial {
  readonly certPem: string;
  readonly keyPem: string;
  // Unpadded base64url of SHA-256(SPKI DER), 43 characters.
  readonly fingerprint: string;
  readonly shortFingerprint: string;
}

export interface GenerateCertificateOptions {
  readonly commonName?: string;
  readonly dnsNames?: readonly string[];
  readonly ipAddresses?: readonly string[];
  readonly now?: Date;
}

export interface EnsureTlsMaterialOptions {
  readonly hostname?: string;
  readonly customHost?: string;
  readonly extraDnsNames?: readonly string[];
  readonly extraIpAddresses?: readonly string[];
  readonly forceRegenerate?: boolean;
}

const OID_ECDSA_WITH_SHA256 = "1.2.840.10045.4.3.2";
const OID_COMMON_NAME = "2.5.4.3";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_KEY_USAGE = "2.5.29.15";
const OID_EXT_KEY_USAGE = "2.5.29.37";
const OID_SERVER_AUTH = "1.3.6.1.5.5.7.3.1";
const OID_SUBJECT_ALT_NAME = "2.5.29.17";

const CERT_FILE = "tls-cert.pem";
const KEY_FILE = "tls-key.pem";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([tag]),
    derLength(content.length),
    content,
  ]);
}

function derSequence(items: readonly Buffer[]): Buffer {
  return derTag(0x30, Buffer.concat(items));
}

function derSet(items: readonly Buffer[]): Buffer {
  return derTag(0x31, Buffer.concat(items));
}

function derOctetString(content: Buffer): Buffer {
  return derTag(0x04, content);
}

function derBitString(content: Buffer, unusedBits = 0): Buffer {
  return derTag(0x03, Buffer.concat([Buffer.from([unusedBits]), content]));
}

function derBoolean(value: boolean): Buffer {
  return derTag(0x01, Buffer.from([value ? 0xff : 0x00]));
}

function derInteger(bytes: Buffer): Buffer {
  let start = 0;
  while (
    start < bytes.length - 1 &&
    bytes[start] === 0 &&
    ((bytes[start + 1] ?? 0) & 0x80) === 0
  ) {
    start += 1;
  }
  const trimmed = bytes.subarray(start);
  const needsZeroPad = ((trimmed[0] ?? 0) & 0x80) !== 0;
  return derTag(
    0x02,
    needsZeroPad ? Buffer.concat([Buffer.from([0x00]), trimmed]) : trimmed,
  );
}

function derSmallInteger(value: number): Buffer {
  return derInteger(Buffer.from([value]));
}

function derOid(oid: string): Buffer {
  const parts = oid.split(".").map((segment) => Number(segment));
  if (parts.length < 2 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Invalid OID: ${oid}`);
  }
  const encoded: number[] = [parts[0]! * 40 + parts[1]!];
  for (let i = 2; i < parts.length; i += 1) {
    const val = parts[i]!;
    if (val === 0) {
      encoded.push(0);
      continue;
    }
    const vlq: number[] = [];
    let current = val;
    while (current > 0) {
      vlq.unshift(current & 0x7f);
      current = Math.floor(current / 128);
    }
    for (let j = 0; j < vlq.length - 1; j += 1) {
      vlq[j] = vlq[j]! | 0x80;
    }
    encoded.push(...vlq);
  }
  return derTag(0x06, Buffer.from(encoded));
}

function derUtf8String(value: string): Buffer {
  return derTag(0x0c, Buffer.from(value, "utf8"));
}

function derTime(date: Date): Buffer {
  const year = date.getUTCFullYear();
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  const rest =
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    "Z";
  // RFC 5280 Section 4.1.2.5: UTCTime through 2049, GeneralizedTime from 2050.
  if (year >= 1950 && year <= 2049) {
    return derTag(0x17, Buffer.from(`${pad2(year % 100)}${rest}`, "ascii"));
  }
  return derTag(
    0x18,
    Buffer.from(`${String(year).padStart(4, "0")}${rest}`, "ascii"),
  );
}

function derExtension(oid: string, valueDer: Buffer, critical = false): Buffer {
  const parts = [derOid(oid)];
  if (critical) parts.push(derBoolean(true));
  parts.push(derOctetString(valueDer));
  return derSequence(parts);
}

function parseIpv4Bytes(ip: string): Buffer | null {
  if (!net.isIPv4(ip)) return null;
  const parts = ip.split(".").map((segment) => Number(segment));
  if (parts.length !== 4 || parts.some((n) => n < 0 || n > 255)) return null;
  return Buffer.from(parts);
}

function parseIpv6Bytes(ip: string): Buffer | null {
  if (!net.isIPv6(ip)) return null;
  const withoutZone = ip.split("%", 1)[0] ?? "";
  let working = withoutZone.toLowerCase();
  // Convert embedded IPv4 suffix (e.g. ::ffff:192.0.2.128) to two 16-bit groups.
  const lastColon = working.lastIndexOf(":");
  if (lastColon !== -1 && working.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4Bytes(working.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const halves = working.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right =
    halves.length === 2 && halves[1]
      ? halves[1].split(":").filter(Boolean)
      : [];
  const missing = 8 - (left.length + right.length);
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 0) return null;

  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => "0"),
    ...right,
  ];
  if (groups.length !== 8) return null;
  const out = Buffer.alloc(16);
  for (let i = 0; i < 8; i += 1) {
    const val = Number.parseInt(groups[i]!, 16);
    if (!Number.isInteger(val) || val < 0 || val > 0xffff) return null;
    out.writeUInt16BE(val, i * 2);
  }
  return out;
}

function encodeSanExtension(
  dnsNames: readonly string[],
  ipAddresses: readonly string[],
): Buffer {
  const entries: Buffer[] = [];
  const seenDns = new Set<string>();
  for (const raw of dnsNames) {
    const dns = raw.trim().toLowerCase().replace(/\.$/u, "");
    if (!dns || seenDns.has(dns) || !isValidDnsName(dns)) continue;
    seenDns.add(dns);
    // GeneralName dNSName: [2] IMPLICIT IA5String (tag 0x82).
    entries.push(derTag(0x82, Buffer.from(dns, "ascii")));
  }

  const seenIp = new Set<string>();
  for (const raw of ipAddresses) {
    const ip = raw.trim().split("%", 1)[0]?.toLowerCase() ?? "";
    if (!ip || seenIp.has(ip)) continue;
    const ipBytes = parseIpv4Bytes(ip) ?? parseIpv6Bytes(ip);
    if (!ipBytes) continue;
    seenIp.add(ip);
    // GeneralName iPAddress: [7] IMPLICIT OCTET STRING (tag 0x87).
    entries.push(derTag(0x87, ipBytes));
  }

  return derExtension(OID_SUBJECT_ALT_NAME, derSequence(entries), false);
}

function toPem(label: string, der: Buffer): string {
  const b64 = der.toString("base64");
  const lines: string[] = [];
  for (let offset = 0; offset < b64.length; offset += 64) {
    lines.push(b64.slice(offset, offset + 64));
  }
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function computeSpkiFingerprint(
  certOrKey: string | KeyObject | X509Certificate,
): string {
  const publicKey =
    typeof certOrKey === "string"
      ? new X509Certificate(certOrKey).publicKey
      : certOrKey instanceof X509Certificate
        ? certOrKey.publicKey
        : certOrKey;
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(spkiDer).digest("base64url");
}

// Formats the first 16 uppercase hex characters of SHA-256(SPKI DER) as
// XXXX-XXXX-XXXX-XXXX for human TOFU verification.
export function shortFingerprint(base64urlFingerprint: string): string {
  const digest = Buffer.from(base64urlFingerprint, "base64url");
  const hex16 = digest.subarray(0, 8).toString("hex").toUpperCase();
  return [
    hex16.slice(0, 4),
    hex16.slice(4, 8),
    hex16.slice(8, 12),
    hex16.slice(12, 16),
  ].join("-");
}

export function generateSelfSignedCertificate(
  options: GenerateCertificateOptions = {},
): TlsMaterial {
  const commonName = options.commonName ?? "Linger Mobile Companion";
  const now = options.now ?? new Date();
  const notBefore = new Date(now.getTime() - FIVE_MINUTES_MS);
  const notAfter = new Date(now.getTime() + TEN_YEARS_MS);

  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });

  const serial = randomBytes(16);
  serial[0] = (serial[0]! & 0x7f) | 0x01;

  // RFC 5758 Section 3.2: ECDSA signature AlgorithmIdentifier omits parameters.
  const signatureAlgorithm = derSequence([derOid(OID_ECDSA_WITH_SHA256)]);

  const name = derSequence([
    derSet([derSequence([derOid(OID_COMMON_NAME), derUtf8String(commonName)])]),
  ]);

  const validity = derSequence([derTime(notBefore), derTime(notAfter)]);
  const spkiDer = publicKey.export({ type: "spki", format: "der" });

  // BasicConstraints: CA:FALSE (default omitted per DER).
  const basicConstraints = derExtension(
    OID_BASIC_CONSTRAINTS,
    derSequence([]),
    true,
  );
  // KeyUsage: digitalSignature (bit 0 = 0x80 with 7 unused bits).
  const keyUsage = derExtension(
    OID_KEY_USAGE,
    derBitString(Buffer.from([0x80]), 7),
    true,
  );
  // ExtendedKeyUsage: id-kp-serverAuth.
  const extKeyUsage = derExtension(
    OID_EXT_KEY_USAGE,
    derSequence([derOid(OID_SERVER_AUTH)]),
    false,
  );

  const dnsNames = ["localhost", ...(options.dnsNames ?? [])];
  const ipAddresses = ["127.0.0.1", "::1", ...(options.ipAddresses ?? [])];
  const san = encodeSanExtension(dnsNames, ipAddresses);

  const extensions = derTag(
    0xa3,
    derSequence([basicConstraints, keyUsage, extKeyUsage, san]),
  );

  const tbsCertificate = derSequence([
    derTag(0xa0, derSmallInteger(2)), // v3
    derInteger(serial),
    signatureAlgorithm,
    name,
    validity,
    name,
    spkiDer,
    extensions,
  ]);

  const signature = sign("sha256", tbsCertificate, privateKey);
  const certDer = derSequence([
    tbsCertificate,
    signatureAlgorithm,
    derBitString(signature, 0),
  ]);

  const certPem = toPem("CERTIFICATE", certDer);
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const fingerprint = computeSpkiFingerprint(publicKey);

  return {
    certPem,
    keyPem,
    fingerprint,
    shortFingerprint: shortFingerprint(fingerprint),
  };
}

function writeAtomicPrivate(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tempPath, content, { mode: 0o600 });
  if (process.platform !== "win32") {
    chmodSync(tempPath, 0o600);
  }
  renameSync(tempPath, filePath);
}

function loadExistingTlsMaterial(
  certPath: string,
  keyPath: string,
  now: Date,
): TlsMaterial | undefined {
  if (!existsSync(certPath) || !existsSync(keyPath)) return undefined;
  try {
    const certPem = readFileSync(certPath, "utf8");
    const keyPem = readFileSync(keyPath, "utf8");
    const cert = new X509Certificate(certPem);
    createPrivateKey(keyPem);
    const derivedPub = createPublicKey(keyPem);
    const certSpki = cert.publicKey.export({ type: "spki", format: "der" });
    const keySpki = derivedPub.export({ type: "spki", format: "der" });
    if (!certSpki.equals(keySpki)) return undefined;

    const validTo = Date.parse(cert.validTo);
    if (!Number.isFinite(validTo) || validTo <= now.getTime()) return undefined;

    const fingerprint = computeSpkiFingerprint(cert);
    return {
      certPem,
      keyPem,
      fingerprint,
      shortFingerprint: shortFingerprint(fingerprint),
    };
  } catch {
    return undefined;
  }
}

export function ensureTlsMaterial(
  directory: string,
  options: EnsureTlsMaterialOptions = {},
): TlsMaterial {
  const certPath = path.join(directory, CERT_FILE);
  const keyPath = path.join(directory, KEY_FILE);
  const now = new Date();

  if (!options.forceRegenerate) {
    const existing = loadExistingTlsMaterial(certPath, keyPath, now);
    if (existing) return existing;
  }

  const machineHost = (options.hostname ?? os.hostname())
    .trim()
    .toLowerCase()
    .replace(/\.$/u, "");
  const shortHost = machineHost.replace(/\.local$/u, "");
  const discovered = discoverAddresses();

  const dnsNames: string[] = [
    "localhost",
    ...(machineHost ? [machineHost] : []),
    ...(shortHost ? [`${shortHost}.local`] : []),
    ...(options.extraDnsNames ?? []),
  ];
  const ipAddresses: string[] = [
    "127.0.0.1",
    "::1",
    ...discovered.lan,
    ...discovered.tailscale,
    ...(options.extraIpAddresses ?? []),
  ];

  if (options.customHost) {
    const trimmed = options.customHost.trim();
    const cleaned = net.isIPv6(trimmed)
      ? trimmed.toLowerCase()
      : (extractHostName(trimmed) ?? "");
    if (cleaned && net.isIP(cleaned)) {
      ipAddresses.push(cleaned);
    } else if (cleaned && isValidDnsName(cleaned)) {
      dnsNames.push(cleaned);
    }
  }

  const material = generateSelfSignedCertificate({
    dnsNames,
    ipAddresses,
    now,
  });

  writeAtomicPrivate(certPath, material.certPem);
  writeAtomicPrivate(keyPath, material.keyPem);

  return material;
}
