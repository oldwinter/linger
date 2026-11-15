import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import type { TeamHubArtifactContent } from "@/features/teamhub/teamhub-types";

/**
 * The content Download saves for a Document. The Wiki page's Markdown copy
 * reads it here too, so the copied text cannot drift from the saved file.
 */
export function documentDownloadContent(
  client: TeamHubClient,
  documentId: string,
): Promise<TeamHubArtifactContent> {
  return client.downloadLatestDocument(documentId);
}
