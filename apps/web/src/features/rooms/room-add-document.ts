import type { TeamHubDocument } from "@/features/teamhub/teamhub-types";

/**
 * A Personal Wiki page the caller can read but not manage fails a Room
 * binding. The same rule the Composer uses for sharing a Document.
 */
const wikiBindingKinds: ReadonlySet<string> = new Set([
  "wiki_page",
  "wiki_source",
]);

export function roomAddDocumentPath(tenantId: string, roomId: string) {
  return `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/add-document`;
}

export function canAddDocumentToRoom(document: TeamHubDocument) {
  return (
    document.capabilities.manage ||
    document.from.length === 0 ||
    document.from.some((binding) => !wikiBindingKinds.has(binding.binding_kind))
  );
}
