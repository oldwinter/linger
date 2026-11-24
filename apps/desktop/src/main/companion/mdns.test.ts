import { EventEmitter } from "node:events";
import type { Socket } from "node:dgram";

import { describe, expect, it, vi } from "vitest";

import { silentLog } from "../test-support.js";
import {
  DNS_TYPE,
  LINGER_SERVICE_TYPE,
  MDNS_ADDRESS,
  MDNS_PORT,
  MdnsResponder,
  decodeMdnsPacket,
  encodeMdnsQuery,
  encodeMdnsResponse,
  serviceInstanceName,
  serviceTargetHost,
  type MdnsAnnouncement,
} from "./mdns.js";

const SAMPLE: MdnsAnnouncement = {
  hostId: "host-12345678",
  hostName: "Office Mac",
  port: 48210,
  tls: true,
  tlsFingerprint: "AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0",
  pairingOpen: true,
  addresses: ["192.168.1.50", "10.0.0.5"],
};

class FakeUdpSocket extends EventEmitter {
  readonly sent: { payload: Buffer; port: number; address: string }[] = [];
  readonly memberships: string[] = [];
  bindShouldFail = false;
  closed = false;

  bind(_port: number, cb?: () => void): void {
    if (this.bindShouldFail) {
      queueMicrotask(() => this.emit("error", new Error("EACCES")));
      return;
    }
    queueMicrotask(() => cb?.());
  }

  addMembership(addr: string): void {
    this.memberships.push(addr);
  }

  setMulticastTTL(): void {}
  setMulticastLoopback(): void {}

  send(
    payload: Buffer,
    port: number,
    address: string,
    cb?: (err: Error | null) => void,
  ): void {
    this.sent.push({ payload: Buffer.from(payload), port, address });
    cb?.(null);
  }

  close(cb?: () => void): void {
    this.closed = true;
    cb?.();
  }
}

describe("mDNS packet codec and responder", () => {
  it("encodes and decodes PTR, SRV, TXT, and A records accurately", () => {
    const packet = encodeMdnsResponse(SAMPLE);
    const decoded = decodeMdnsPacket(packet);

    expect(decoded.isResponse).toBe(true);
    expect(decoded.questions).toHaveLength(0);

    const expectedInstance = serviceInstanceName(SAMPLE);
    const expectedTarget = serviceTargetHost(SAMPLE);

    const ptr = decoded.answers.find((r) => r.type === DNS_TYPE.PTR);
    expect(ptr?.name).toBe(LINGER_SERVICE_TYPE);
    expect(ptr?.ptrTarget).toBe(expectedInstance);
    expect(ptr?.ttl).toBe(120);

    const srv = decoded.answers.find((r) => r.type === DNS_TYPE.SRV);
    expect(srv?.name).toBe(expectedInstance);
    expect(srv?.srv).toEqual({
      priority: 0,
      weight: 0,
      port: 48210,
      target: expectedTarget,
    });

    const txt = decoded.answers.find((r) => r.type === DNS_TYPE.TXT);
    expect(txt?.name).toBe(expectedInstance);
    expect(txt?.txtEntries).toEqual([
      "v=1",
      `host_id=${SAMPLE.hostId}`,
      `name=${SAMPLE.hostName}`,
      "tls=1",
      `fp=${SAMPLE.tlsFingerprint}`,
      "pair=1",
    ]);

    const aRecords = decoded.answers.filter((r) => r.type === DNS_TYPE.A);
    expect(aRecords.map((r) => r.ip)).toEqual(["192.168.1.50", "10.0.0.5"]);
    expect(aRecords.every((r) => r.name === expectedTarget)).toBe(true);
  });

  it("encodes goodbye packets with TTL=0 on every record", () => {
    const goodbye = decodeMdnsPacket(
      encodeMdnsResponse({ ...SAMPLE, pairingOpen: false }, { goodbye: true }),
    );
    expect(goodbye.answers.length).toBeGreaterThanOrEqual(4);
    expect(goodbye.answers.every((r) => r.ttl === 0)).toBe(true);
    const txt = goodbye.answers.find((r) => r.type === DNS_TYPE.TXT);
    expect(txt?.txtEntries).toContain("pair=0");
  });

  it("answers incoming _linger._tcp.local queries and emits goodbye on stop", async () => {
    const fakeSocket = new FakeUdpSocket();
    const responder = new MdnsResponder({
      log: silentLog,
      socketFactory: () => fakeSocket as unknown as Socket,
    });

    const started = await responder.start(SAMPLE);
    expect(started).toBe(true);
    expect(responder.active()).toBe(true);
    expect(fakeSocket.memberships).toEqual([MDNS_ADDRESS]);
    expect(fakeSocket.sent).toHaveLength(1);
    expect(fakeSocket.sent[0]!.port).toBe(MDNS_PORT);
    expect(fakeSocket.sent[0]!.address).toBe(MDNS_ADDRESS);

    // Emit a PTR query for _linger._tcp.local.
    const query = encodeMdnsQuery(LINGER_SERVICE_TYPE, DNS_TYPE.PTR);
    fakeSocket.emit("message", query);
    expect(fakeSocket.sent).toHaveLength(2);

    // Unrelated query should be ignored.
    fakeSocket.emit(
      "message",
      encodeMdnsQuery("_http._tcp.local", DNS_TYPE.PTR),
    );
    expect(fakeSocket.sent).toHaveLength(2);

    // Update announcement pairing flag to false.
    responder.update({ ...SAMPLE, pairingOpen: false });
    expect(fakeSocket.sent).toHaveLength(3);
    const updatedTxt = decodeMdnsPacket(
      fakeSocket.sent[2]!.payload,
    ).answers.find((r) => r.type === DNS_TYPE.TXT);
    expect(updatedTxt?.txtEntries).toContain("pair=0");

    // Stop sends a TTL=0 goodbye packet and closes the socket.
    await responder.stop();
    expect(responder.active()).toBe(false);
    expect(fakeSocket.closed).toBe(true);
    expect(fakeSocket.sent).toHaveLength(4);
    const goodbye = decodeMdnsPacket(fakeSocket.sent[3]!.payload);
    expect(goodbye.answers.every((r) => r.ttl === 0)).toBe(true);
  });

  it("handles restricted UDP bind failures gracefully without throwing", async () => {
    const warn = vi.fn();
    const fakeSocket = new FakeUdpSocket();
    fakeSocket.bindShouldFail = true;
    const responder = new MdnsResponder({
      log: { ...silentLog, warn },
      socketFactory: () => fakeSocket as unknown as Socket,
    });

    const started = await responder.start(SAMPLE);
    expect(started).toBe(false);
    expect(responder.active()).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
