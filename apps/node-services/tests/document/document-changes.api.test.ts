import {
  readRoomDocumentBlocks,
  restoreRoomDocumentRevision,
} from "@linger/document-model";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { DocumentChangeComputation } from "../../src/document/document-changes.js";
import {
  appendToFirstText,
  connectRealtimeClient,
  documentId,
  memoryBodies,
  startRealtimeServer,
  wsUrl,
} from "./realtime-test-support.js";

// Appends text the way a server change does: computed on the given state.
function appendChange(text: string): DocumentChangeComputation {
  return async (stateBytes) => {
    const document = new Y.Doc({ gc: true });
    Y.applyUpdate(document, stateBytes);
    const vector = Y.encodeStateVector(document);
    appendToFirstText(document, text);
    const result = {
      update: Y.encodeStateAsUpdate(document, vector),
      stateBytes: Y.encodeStateAsUpdate(document),
      stateVector: Y.encodeStateVector(document),
      title: "",
      assetIds: [],
      threadIds: [],
    };
    document.destroy();
    return result;
  };
}

function firstText(stateBytes: Uint8Array): unknown {
  return readRoomDocumentBlocks(stateBytes)[0]?.content;
}

describe("Document Runtime server changes", () => {
  it("saves a change to a Document nobody has open", async () => {
    const { bodies } = await memoryBodies();
    const realtime = await startRealtimeServer(bodies);
    try {
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_1",
          actorId: "actor_agent",
          compute: appendChange(" by agent"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 1 });
      expect(firstText(bodies.rows.get(documentId)!.state)).toMatchObject([
        { text: "Durable initial state by agent" },
      ]);
      expect(bodies.rows.get(documentId)!.editorIds).toEqual(["actor_agent"]);
    } finally {
      await realtime.destroy();
    }
  });

  it("broadcasts a saved change to open connections and keeps their unsaved edits", async () => {
    const { bodies } = await memoryBodies();
    const realtime = await startRealtimeServer(bodies);
    const client = await connectRealtimeClient({
      token: "human_a",
      url: wsUrl(realtime.address),
    });
    try {
      appendToFirstText(client.document, " human");
      await expect.poll(() => bodies.rows.get(documentId)!.seq).toBe(1);
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_2",
          actorId: "actor_agent",
          expectedSeq: 1,
          compute: appendChange(" agent"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 2 });
      await expect
        .poll(() => firstText(Y.encodeStateAsUpdate(client.document)))
        .toMatchObject([{ text: "Durable initial state human agent" }]);
      appendToFirstText(client.document, " again");
      await expect
        .poll(() => firstText(bodies.rows.get(documentId)!.state))
        .toMatchObject([{ text: "Durable initial state human agent again" }]);
      expect(bodies.rows.get(documentId)!.seq).toBe(3);
    } finally {
      client.provider.destroy();
      client.document.destroy();
      await realtime.destroy();
    }
  });

  it("delivers restored content before its durable acknowledgement", async () => {
    const { bodies, initial } = await memoryBodies();
    const realtime = await startRealtimeServer(bodies);
    const document = new Y.Doc({ gc: true });
    const acknowledgements: Array<{
      envelope: unknown;
      content: unknown;
    }> = [];
    let observing = false;
    const client = await connectRealtimeClient({
      document,
      token: "human_a",
      url: wsUrl(realtime.address),
      onStateless: (payload) => {
        if (observing) {
          acknowledgements.push({
            envelope: JSON.parse(payload),
            content: firstText(Y.encodeStateAsUpdate(document)),
          });
        }
      },
    });
    try {
      observing = true;
      appendToFirstText(document, " changed");
      await expect.poll(() => bodies.rows.get(documentId)!.seq).toBe(1);
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_restore",
          actorId: "actor_human_a",
          expectedSeq: 1,
          compute: async (currentStateBytes) => {
            const restored = restoreRoomDocumentRevision({
              restoreOperationId: "operation_restore",
              currentStateBytes,
              targetStateBytes: initial.stateBytes,
            });
            return {
              update: restored.update,
              stateBytes: restored.stateBytes,
              stateVector: restored.endStateVector,
              title: "",
              assetIds: restored.completeReferences.documentAssetIds,
              threadIds: restored.completeReferences.documentThreadIds,
            };
          },
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 2 });
      await expect
        .poll(() => firstText(Y.encodeStateAsUpdate(document)))
        .toMatchObject([{ text: "Durable initial state" }]);

      expect(acknowledgements).toEqual(
        expect.arrayContaining([
          {
            envelope: expect.objectContaining({
              type: "durability_ack",
              head: expect.objectContaining({ persisted_seq: 2 }),
            }),
            content: expect.arrayContaining([
              expect.objectContaining({ text: "Durable initial state" }),
            ]),
          },
        ]),
      );
    } finally {
      client.provider.destroy();
      document.destroy();
      await realtime.destroy();
    }
  });

  it("keeps an open Document in step after a change that leaves the body alone", async () => {
    const { bodies } = await memoryBodies();
    const realtime = await startRealtimeServer(bodies);
    const client = await connectRealtimeClient({
      token: "human_a",
      url: wsUrl(realtime.address),
    });
    // A title-only change saves the same body with an empty update.
    const titleOnly: DocumentChangeComputation = async (stateBytes) => {
      const document = new Y.Doc({ gc: true });
      Y.applyUpdate(document, stateBytes);
      const result = {
        update: new Uint8Array(),
        stateBytes,
        stateVector: Y.encodeStateVector(document),
        title: "Renamed",
        assetIds: [],
        threadIds: [],
      };
      document.destroy();
      return result;
    };
    try {
      appendToFirstText(client.document, " human");
      await expect.poll(() => bodies.rows.get(documentId)!.seq).toBe(1);
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_title",
          actorId: "actor_agent",
          expectedSeq: 1,
          compute: titleOnly,
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 2 });
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_after_title",
          actorId: "actor_agent",
          expectedSeq: 2,
          compute: appendChange(" agent"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 3 });
      await expect
        .poll(() => firstText(Y.encodeStateAsUpdate(client.document)))
        .toMatchObject([{ text: "Durable initial state human agent" }]);
    } finally {
      client.provider.destroy();
      client.document.destroy();
      await realtime.destroy();
    }
  });

  it("reports a retried change applied without applying it again", async () => {
    const { bodies } = await memoryBodies();
    const realtime = await startRealtimeServer(bodies);
    const change = {
      documentId,
      operationId: "operation_retried",
      actorId: "actor_agent",
      expectedSeq: 0,
      compute: appendChange(" once"),
    };
    try {
      const first = await realtime.changes.apply(change);
      expect(first).toMatchObject({ status: "applied", seq: 1 });
      await expect(realtime.changes.apply(change)).resolves.toEqual(first);
      expect(bodies.saves).toHaveLength(1);
      expect(firstText(bodies.rows.get(documentId)!.state)).toMatchObject([
        { text: "Durable initial state once" },
      ]);
    } finally {
      await realtime.destroy();
    }
  });

  it("reports a stale expected sequence without saving", async () => {
    const { bodies } = await memoryBodies();
    const realtime = await startRealtimeServer(bodies);
    try {
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_3",
          actorId: "actor_agent",
          expectedSeq: 3,
          compute: appendChange(" late"),
        }),
      ).resolves.toEqual({ status: "conflicted", reason: "stale_head" });
      expect(bodies.saves).toHaveLength(0);
    } finally {
      await realtime.destroy();
    }
  });

  it("recomputes a change whose body moved while it was computed", async () => {
    const { bodies } = await memoryBodies();
    const realtime = await startRealtimeServer(bodies);
    let moved = false;
    bodies.beforeSave = () => {
      if (moved) return;
      moved = true;
      bodies.commitServerChange((document) =>
        appendToFirstText(document, " other"),
      );
    };
    try {
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_4",
          actorId: "actor_agent",
          compute: appendChange(" agent"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 2 });
      expect(firstText(bodies.rows.get(documentId)!.state)).toMatchObject([
        { text: "Durable initial state other agent" },
      ]);
    } finally {
      await realtime.destroy();
    }
  });

  it("reloads a stale cold open when an unopen server change commits before registration", async () => {
    const { bodies } = await memoryBodies();
    const openLoaded = deferred<void>();
    const releaseOpen = deferred<void>();
    bodies.beforeLoad = async () => {
      if (bodies.loads.length === 1) {
        const staleSnapshot = bodies.snapshot();
        openLoaded.resolve();
        await releaseOpen.promise;
        return staleSnapshot;
      }
    };
    const realtime = await startRealtimeServer(bodies);
    const acks: DurableAck[] = [];
    let client: Awaited<ReturnType<typeof connectRealtimeClient>> | undefined;
    try {
      const connecting = connectRealtimeClient({
        token: "human_a",
        url: wsUrl(realtime.address),
        onStateless: (payload) => acks.push(JSON.parse(payload) as DurableAck),
      });
      await openLoaded.promise;

      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_unopen_race",
          actorId: "actor_agent",
          compute: appendChange(" by agent"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 1 });

      releaseOpen.resolve();
      client = await connecting;

      expect(firstText(Y.encodeStateAsUpdate(client.document))).toMatchObject([
        { text: "Durable initial state by agent" },
      ]);
      await expect
        .poll(() =>
          acks.some(
            (ack) =>
              ack.type === "durability_ack" && ack.head?.persisted_seq === 1,
          ),
        )
        .toBe(true);

      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_after_unopen_race",
          actorId: "actor_agent",
          expectedSeq: 1,
          compute: appendChange(" followup"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 2 });
      await expect
        .poll(() => firstText(Y.encodeStateAsUpdate(client!.document)))
        .toMatchObject([{ text: "Durable initial state by agent followup" }]);
    } finally {
      releaseOpen.resolve();
      client?.provider.destroy();
      client?.document.destroy();
      await realtime.destroy();
    }
  });

  it("serializes a cold open behind an in-flight unopen server change", async () => {
    const { bodies } = await memoryBodies();
    const changeComputing = deferred<void>();
    const releaseChange = deferred<void>();
    const openLoaded = deferred<void>();
    bodies.beforeLoad = () => {
      if (bodies.loads.length === 2) {
        queueMicrotask(() => openLoaded.resolve());
      }
    };
    const realtime = await startRealtimeServer(bodies);
    const acks: DurableAck[] = [];
    let client: Awaited<ReturnType<typeof connectRealtimeClient>> | undefined;
    try {
      const applying = realtime.changes.apply({
        documentId,
        operationId: "operation_inflight_unopen",
        actorId: "actor_agent",
        compute: async (stateBytes) => {
          changeComputing.resolve();
          await releaseChange.promise;
          return appendChange(" inflight")(stateBytes);
        },
      });
      await changeComputing.promise;

      const connecting = connectRealtimeClient({
        token: "human_a",
        url: wsUrl(realtime.address),
        onStateless: (payload) => acks.push(JSON.parse(payload) as DurableAck),
      });
      await openLoaded.promise;
      releaseChange.resolve();

      const [applied, connected] = await Promise.all([applying, connecting]);
      client = connected;
      expect(applied).toMatchObject({ status: "applied", seq: 1 });
      expect(firstText(Y.encodeStateAsUpdate(client.document))).toMatchObject([
        { text: "Durable initial state inflight" },
      ]);
      await expect
        .poll(() =>
          acks.some(
            (ack) =>
              ack.type === "durability_ack" && ack.head?.persisted_seq === 1,
          ),
        )
        .toBe(true);
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_inflight_followup",
          actorId: "actor_agent",
          expectedSeq: 1,
          compute: appendChange(" next"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 2 });
    } finally {
      releaseChange.resolve();
      client?.provider.destroy();
      client?.document.destroy();
      await realtime.destroy();
    }
  });

  it("reloads when a warm open loses its resident document to unload and an unopen change", async () => {
    const { bodies } = await memoryBodies();
    const secondOpenLoaded = deferred<void>();
    const releaseSecondOpen = deferred<void>();
    bodies.beforeLoad = async () => {
      if (bodies.loads.length === 2) {
        const staleSnapshot = bodies.snapshot();
        secondOpenLoaded.resolve();
        await releaseSecondOpen.promise;
        return staleSnapshot;
      }
    };
    const realtime = await startRealtimeServer(bodies);
    const first = await connectRealtimeClient({
      token: "human_a",
      url: wsUrl(realtime.address),
    });
    let second: Awaited<ReturnType<typeof connectRealtimeClient>> | undefined;
    try {
      const connectingSecond = connectRealtimeClient({
        token: "human_b",
        url: wsUrl(realtime.address),
      });
      await secondOpenLoaded.promise;

      const resident = realtime.hocuspocus.documents.get(documentId);
      first.provider.destroy();
      first.document.destroy();
      await expect.poll(() => resident?.getConnectionsCount() ?? 0).toBe(0);
      if (
        resident !== undefined &&
        realtime.hocuspocus.documents.has(documentId)
      ) {
        await realtime.hocuspocus.unloadDocument(resident);
      }
      await expect
        .poll(() => realtime.hocuspocus.documents.has(documentId))
        .toBe(false);

      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_after_unload",
          actorId: "actor_agent",
          compute: appendChange(" while unloaded"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 1 });
      // Confirm the change really ran while no resident was open (3rd load:
      // first open, second open, then unopen apply).
      expect(bodies.loads).toHaveLength(3);

      releaseSecondOpen.resolve();
      second = await connectingSecond;

      expect(firstText(Y.encodeStateAsUpdate(second.document))).toMatchObject([
        { text: "Durable initial state while unloaded" },
      ]);
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_after_warm_reload",
          actorId: "actor_agent",
          expectedSeq: 1,
          compute: appendChange(" synced"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 2 });
      await expect
        .poll(() => firstText(Y.encodeStateAsUpdate(second!.document)))
        .toMatchObject([
          { text: "Durable initial state while unloaded synced" },
        ]);
    } finally {
      releaseSecondOpen.resolve();
      first.provider.destroy();
      first.document.destroy();
      second?.provider.destroy();
      second?.document.destroy();
      await realtime.destroy();
    }
  });

  it("reconciles and broadcasts an open Document when a retried operation finds a lost-reply commit", async () => {
    const { bodies } = await memoryBodies();
    let lostFirstReply = false;
    bodies.beforeSave = (save) => {
      if (!lostFirstReply && save.operation?.id === "operation_lost_reply") {
        lostFirstReply = true;
        bodies.apply(save);
        throw new Error("Connection reset after commit");
      }
    };
    const realtime = await startRealtimeServer(bodies);
    const acks: DurableAck[] = [];
    const client = await connectRealtimeClient({
      token: "human_a",
      url: wsUrl(realtime.address),
      onStateless: (payload) => acks.push(JSON.parse(payload) as DurableAck),
    });
    try {
      const change = {
        documentId,
        operationId: "operation_lost_reply",
        actorId: "actor_agent",
        expectedSeq: 0,
        compute: appendChange(" by agent"),
      };
      await expect(realtime.changes.apply(change)).rejects.toThrow(
        "Connection reset after commit",
      );
      expect(bodies.rows.get(documentId)!.seq).toBe(1);
      expect(firstText(Y.encodeStateAsUpdate(client.document))).toMatchObject([
        { text: "Durable initial state" },
      ]);

      await expect(realtime.changes.apply(change)).resolves.toMatchObject({
        status: "applied",
        seq: 1,
      });
      expect(bodies.saves).toHaveLength(1);
      await expect
        .poll(() => firstText(Y.encodeStateAsUpdate(client.document)))
        .toMatchObject([{ text: "Durable initial state by agent" }]);
      await expect
        .poll(() =>
          acks.some(
            (ack) =>
              ack.type === "durability_ack" && ack.head?.persisted_seq === 1,
          ),
        )
        .toBe(true);

      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_after_lost_reply",
          actorId: "actor_agent",
          expectedSeq: 1,
          compute: appendChange(" followup"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 2 });
      await expect
        .poll(() => firstText(Y.encodeStateAsUpdate(client.document)))
        .toMatchObject([{ text: "Durable initial state by agent followup" }]);

      appendToFirstText(client.document, " human");
      await expect.poll(() => bodies.rows.get(documentId)!.seq).toBe(3);
      expect(firstText(bodies.rows.get(documentId)!.state)).toMatchObject([
        { text: "Durable initial state by agent followup human" },
      ]);
    } finally {
      client.provider.destroy();
      client.document.destroy();
      await realtime.destroy();
    }
  });

  it("refreshes an open resident Document after a stale save so retries apply or report stale_head", async () => {
    const { bodies } = await memoryBodies();
    let lostFirstReply = false;
    bodies.beforeSave = (save) => {
      if (!lostFirstReply && save.operation?.id === "operation_unretried") {
        lostFirstReply = true;
        bodies.apply(save);
        throw new Error("Connection reset after commit");
      }
    };
    const realtime = await startRealtimeServer(bodies);
    const acks: DurableAck[] = [];
    const client = await connectRealtimeClient({
      token: "human_a",
      url: wsUrl(realtime.address),
      onStateless: (payload) => acks.push(JSON.parse(payload) as DurableAck),
    });
    try {
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_unretried",
          actorId: "actor_agent",
          compute: appendChange(" first"),
        }),
      ).rejects.toThrow("Connection reset after commit");

      // A sequenced change with expectedSeq 0 hits stale on the first save,
      // refreshes resident durability to seq 1, and conflicts cleanly.
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_stale_expected",
          actorId: "actor_agent",
          expectedSeq: 0,
          compute: appendChange(" rejected"),
        }),
      ).resolves.toEqual({ status: "conflicted", reason: "stale_head" });
      await expect
        .poll(() => firstText(Y.encodeStateAsUpdate(client.document)))
        .toMatchObject([{ text: "Durable initial state first" }]);

      // Advance persistence again behind the open resident and verify an
      // unsequenced change refreshes and succeeds on retry instead of 503.
      bodies.commitServerChange((document) =>
        appendToFirstText(document, " external"),
      );
      await expect(
        realtime.changes.apply({
          documentId,
          operationId: "operation_unsequenced_after_stale",
          actorId: "actor_agent",
          compute: appendChange(" second"),
        }),
      ).resolves.toMatchObject({ status: "applied", seq: 3 });
      await expect
        .poll(() => firstText(Y.encodeStateAsUpdate(client.document)))
        .toMatchObject([
          { text: "Durable initial state first external second" },
        ]);
      await expect
        .poll(() =>
          acks.some(
            (ack) =>
              ack.type === "durability_ack" && ack.head?.persisted_seq === 3,
          ),
        )
        .toBe(true);
    } finally {
      client.provider.destroy();
      client.document.destroy();
      await realtime.destroy();
    }
  });
});

interface DurableAck {
  type: string;
  head?: { persisted_seq?: number };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
