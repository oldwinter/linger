import { useCallback, useMemo, useState } from "react";

import { teamHubData, teamHubDone } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type {
  TeamHubDocumentPlacementNode,
  TeamHubDocumentTreeSummary,
} from "@/features/teamhub/teamhub-types";
import { writeClipboardText } from "@/lib/clipboard";

import { selectedDocumentsMarkdown } from "./library-selection-links";

export interface LibraryBulkOutcome {
  /** Whether the action failed; the message says what happened. */
  failed: boolean;
  message: string;
}

type BulkTargets =
  | { documents: TeamHubDocumentTreeSummary[]; kind: "move" }
  | { documents: TeamHubDocumentTreeSummary[]; kind: "trash" };

interface LibraryBulkActionsInput {
  client: TeamHubClient;
  documents: readonly TeamHubDocumentTreeSummary[];
  items: readonly TeamHubDocumentPlacementNode[];
  onChanged: () => Promise<unknown>;
  /** The open folder level; a new level starts with an empty selection. */
  resetKey: string;
  tenantId: string;
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/**
 * Multi-select over one Library folder level. Every action runs the existing
 * single-Document request once per selected Document, so a partial failure
 * keeps the failed rows selected and reported instead of reading as success.
 */
export function useLibraryBulkActions({
  client,
  documents,
  items,
  onChanged,
  resetKey,
  tenantId,
}: LibraryBulkActionsInput) {
  const [selection, setSelection] = useState<{
    ids: ReadonlySet<string>;
    key: string;
  }>(() => ({ ids: EMPTY_SELECTION, key: resetKey }));
  const selectedIds =
    selection.key === resetKey ? selection.ids : EMPTY_SELECTION;
  const [targets, setTargets] = useState<BulkTargets | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<LibraryBulkOutcome | null>(null);
  const placements = useMemo(
    () =>
      new Map(
        items.flatMap((item) =>
          item.node_kind === "document"
            ? [[item.document_id, item.id] as const]
            : [],
        ),
      ),
    [items],
  );
  const selected = useMemo(
    () => documents.filter((document) => selectedIds.has(document.id)),
    [documents, selectedIds],
  );

  const toggle = useCallback(
    (documentId: string) => {
      setSelection((current) => {
        const ids = new Set(
          current.key === resetKey ? current.ids : EMPTY_SELECTION,
        );
        if (ids.has(documentId)) ids.delete(documentId);
        else ids.add(documentId);
        return { ids, key: resetKey };
      });
    },
    [resetKey],
  );

  const clear = useCallback(() => {
    setSelection({ ids: EMPTY_SELECTION, key: resetKey });
    setOutcome(null);
  }, [resetKey]);

  function beginMove() {
    setOutcome(null);
    setTargets({ documents: selected, kind: "move" });
  }

  function beginTrash() {
    setOutcome(null);
    setTargets({ documents: selected, kind: "trash" });
  }

  async function run(
    request: (document: TeamHubDocumentTreeSummary) => Promise<unknown>,
  ) {
    const active = targets;
    if (!active) return;
    setTargets(null);
    setPending(true);
    try {
      const results = await Promise.allSettled(
        active.documents.map(async (document) => {
          await request(document);
          return document;
        }),
      );
      const failed = active.documents.filter(
        (_document, index) => results[index]?.status === "rejected",
      );
      const succeeded = new Set(
        active.documents.flatMap((document, index) =>
          results[index]?.status === "fulfilled" ? [document.id] : [],
        ),
      );
      setSelection((current) => ({
        ids: new Set(
          [
            ...(current.key === resetKey ? current.ids : EMPTY_SELECTION),
          ].filter((id) => !succeeded.has(id)),
        ),
        key: resetKey,
      }));
      setOutcome(describeOutcome(active.kind, active.documents.length, failed));
      await onChanged();
    } finally {
      setPending(false);
    }
  }

  async function moveTo(parentId: string) {
    await run(async (document) => {
      const placementId = placements.get(document.id);
      if (!placementId) {
        throw new Error(`${document.title} has no personal folder placement`);
      }
      await teamHubData(
        client.api.PATCH(
          "/v0/tenants/{tenantId}/me/document-placements/{placementId}",
          {
            params: { path: { tenantId, placementId } },
            body:
              parentId === "__root__"
                ? { move_to_root: true }
                : { parent_id: parentId },
          },
        ),
      );
    });
  }

  async function trash() {
    await run(async (document) => {
      if (!document.capabilities.delete) {
        throw new Error(`${document.title} cannot be deleted`);
      }
      await teamHubDone(
        client.api.DELETE("/v0/documents/{documentId}", {
          params: { path: { documentId: document.id } },
        }),
      );
    });
  }

  /**
   * Copies the given Documents as one Markdown link list. The caller passes
   * them in the order the list shows them; the selection stays put so a
   * refused clipboard write can be retried without picking the rows again.
   */
  async function copyLinks(documents: readonly TeamHubDocumentTreeSummary[]) {
    if (!documents.length) return;
    setOutcome(null);
    try {
      await writeClipboardText(
        selectedDocumentsMarkdown({
          documents,
          origin: window.location.origin,
          tenantId,
        }),
      );
      setOutcome({ failed: false, message: "Copied" });
    } catch {
      setOutcome({ failed: true, message: "Copy failed" });
    }
  }

  return {
    beginMove,
    beginTrash,
    canMove: selected.some((document) => placements.has(document.id)),
    canTrash: selected.some((document) => document.capabilities.delete),
    cancel: () => setTargets(null),
    clear,
    copyLinks,
    count: selected.length,
    isSelected: (documentId: string) => selectedIds.has(documentId),
    moving: targets?.kind === "move" ? targets.documents : null,
    moveTo,
    outcome,
    pending,
    selectedDocumentIds: selectedIds,
    toggle,
    trashing: targets?.kind === "trash" ? targets.documents : null,
    trash,
  };
}

function describeOutcome(
  kind: BulkTargets["kind"],
  total: number,
  failed: readonly TeamHubDocumentTreeSummary[],
): LibraryBulkOutcome {
  const verb = kind === "move" ? "Moved" : "Moved to trash";
  const succeeded = total - failed.length;
  return {
    failed: failed.length > 0,
    message:
      failed.length === 0
        ? `${verb} ${documentCount(total)}.`
        : `${verb} ${succeeded} of ${documentCount(total)}. Failed: ${failed
            .map((document) => document.title)
            .join(", ")}.`,
  };
}

function documentCount(count: number) {
  return count === 1 ? "1 document" : `${count} documents`;
}
