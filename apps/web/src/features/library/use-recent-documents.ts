import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { teamHubIdentityQueryKey } from "@/features/rooms/room-queries";
import type {
  TeamHubCurrentIdentity,
  TeamHubDocument,
} from "@/features/teamhub/teamhub-types";

import { documentFormatLabel } from "./document-format-label";
import { documentLogicalTitle } from "./document-display-name";
import { recordRecentDocument } from "./recent-documents";

/**
 * The signed-in Account, read from the identity the route loader cached before
 * any page renders. Reading that cache instead of subscribing keeps the strip
 * free of requests.
 */
export function useRecentDocumentsAccountId(): string | undefined {
  const queryClient = useQueryClient();
  return queryClient.getQueryData<TeamHubCurrentIdentity>(
    teamHubIdentityQueryKey,
  )?.account.id;
}

/**
 * Records the Document the person opened, once its metadata supplies the real
 * name. The Library's Recently opened strip reads what this writes.
 */
export function useRecordRecentDocument(document: TeamHubDocument | undefined) {
  const accountId = useRecentDocumentsAccountId();
  const documentId = document?.id;
  const name = document ? documentLogicalTitle(document) : undefined;
  const formatLabel = document
    ? documentFormatLabel(document.format)
    : undefined;
  useEffect(() => {
    if (!accountId || !documentId || !name || !document?.tenant_id) return;
    recordRecentDocument(accountId, document.tenant_id, {
      formatLabel: formatLabel ?? "",
      id: documentId,
      name,
      openedAt: new Date().toISOString(),
    });
  }, [accountId, document?.tenant_id, documentId, formatLabel, name]);
}
