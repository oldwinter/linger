import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDirectory } from "../test-support.js";
import {
  computeSpkiFingerprint,
  ensureTlsMaterial,
  generateSelfSignedCertificate,
  shortFingerprint,
} from "./tls.js";

describe("companion TLS certificate builder", () => {
  it("generates a valid ECDSA P-256 X.509v3 certificate parseable by Node crypto", () => {
    const material = generateSelfSignedCertificate({
      dnsNames: ["macbook.local", "host.tailnet.ts.net"],
      ipAddresses: ["192.168.1.42", "100.64.12.34", "fd7a:115c:a1e0::1"],
    });

    const cert = new X509Certificate(material.certPem);
    createPrivateKey(material.keyPem);
    const derivedPub = createPublicKey(material.keyPem);

    expect(cert.subject).toBe("CN=Linger Mobile Companion");
    expect(cert.issuer).toBe("CN=Linger Mobile Companion");
    expect(cert.ca).toBe(false);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.publicKey.asymmetricKeyType).toBe("ec");
    expect(
      cert.publicKey
        .export({ type: "spki", format: "der" })
        .equals(derivedPub.export({ type: "spki", format: "der" })),
    ).toBe(true);

    expect(cert.subjectAltName).toContain("DNS:localhost");
    expect(cert.subjectAltName).toContain("DNS:macbook.local");
    expect(cert.subjectAltName).toContain("DNS:host.tailnet.ts.net");
    expect(cert.subjectAltName).toContain("IP Address:127.0.0.1");
    expect(cert.subjectAltName).toContain("IP Address:0:0:0:0:0:0:0:1");
    expect(cert.subjectAltName).toContain("IP Address:192.168.1.42");
    expect(cert.subjectAltName).toContain("IP Address:100.64.12.34");
    expect(cert.keyUsage).toContain("1.3.6.1.5.5.7.3.1");

    // 32-byte SHA-256 in unpadded base64url is always 43 characters.
    expect(material.fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(computeSpkiFingerprint(material.certPem)).toBe(material.fingerprint);
    expect(computeSpkiFingerprint(cert)).toBe(material.fingerprint);
    expect(material.shortFingerprint).toMatch(
      /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/u,
    );
    expect(shortFingerprint(material.fingerprint)).toBe(
      material.shortFingerprint,
    );

    const validFrom = Date.parse(cert.validFrom);
    const validTo = Date.parse(cert.validTo);
    expect(validFrom).toBeLessThan(Date.now());
    expect(validTo - validFrom).toBeGreaterThan(9 * 365 * 24 * 60 * 60 * 1000);
  });

  it("persists certificate and key with 0600 permissions and reloads deterministically", () => {
    const dir = path.join(tempDirectory(), "companion");
    const first = ensureTlsMaterial(dir, {
      hostname: "dev-box",
      customHost: "custom.example.test",
    });
    const second = ensureTlsMaterial(dir, {
      hostname: "dev-box",
      customHost: "custom.example.test",
    });

    expect(second.certPem).toBe(first.certPem);
    expect(second.keyPem).toBe(first.keyPem);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.shortFingerprint).toBe(first.shortFingerprint);

    if (process.platform !== "win32") {
      expect(statSync(path.join(dir, "tls-cert.pem")).mode & 0o777).toBe(0o600);
      expect(statSync(path.join(dir, "tls-key.pem")).mode & 0o777).toBe(0o600);
    }
  });

  it("regenerates cleanly when persisted key is corrupted or mismatched", () => {
    const dir = path.join(tempDirectory(), "companion");
    const initial = ensureTlsMaterial(dir);

    writeFileSync(path.join(dir, "tls-key.pem"), "not a valid pem", {
      mode: 0o600,
    });
    const recovered = ensureTlsMaterial(dir);

    expect(recovered.fingerprint).not.toBe(initial.fingerprint);
    const cert = new X509Certificate(recovered.certPem);
    expect(cert.verify(cert.publicKey)).toBe(true);
  });

  it("includes bracketed IPv6 [host]:port customHost in certificate IP SANs", () => {
    const dir = path.join(tempDirectory(), "companion-ipv6");
    const material = ensureTlsMaterial(dir, {
      hostname: "dev-box",
      customHost: "[fd7a:115c:a1e0::1]:48210",
    });
    const cert = new X509Certificate(material.certPem);
    expect(cert.subjectAltName).toContain(
      "IP Address:FD7A:115C:A1E0:0:0:0:0:1",
    );
  });
});
