import type { components } from "@linger/wire-contracts/teamhub-public/types";
import { translate } from "@/i18n/language";
import {
  readBoundedArtifactContent,
  runBoundedArtifactDownload,
} from "./teamhub-artifact-download";
import {
  teamHubData as data,
  teamHubDone as done,
  type TeamHubApi,
} from "./teamhub-api";
import { TeamHubError } from "./teamhub-error";
import { teamHubExtrasMessages } from "./teamhub-extras.messages";
import type { TeamHubArtifactContent } from "./teamhub-types";

export type DocumentLinkPolicy = components["schemas"]["DocumentLinkShare"];
export type SharedDocumentContent = TeamHubArtifactContent & {
  documentId: string;
  versionId: string;
  filename: string;
  representationFormat: string;
  readOnly: boolean;
  access: components["schemas"]["DocumentLinkAccess"];
};
export interface TeamHubDocumentLinks {
  get(documentId: string): Promise<DocumentLinkPolicy | null>;
  set(
    documentId: string,
    input: components["schemas"]["SetDocumentLinkShare"],
  ): Promise<DocumentLinkPolicy>;
  revoke(
    documentId: string,
    input: components["schemas"]["RevokeDocumentLinkShare"],
  ): Promise<void>;
  download(token: string, signal?: AbortSignal): Promise<SharedDocumentContent>;
}

export function createTeamHubDocumentLinks(
  api: TeamHubApi,
): TeamHubDocumentLinks {
  return {
    async get(documentId) {
      try {
        return await data(
          api.GET("/v0/documents/{documentId}/link-share", {
            params: { path: { documentId } },
          }),
        );
      } catch (error) {
        if (error instanceof TeamHubError && error.status === 404) return null;
        throw error;
      }
    },
    set: (documentId, body) =>
      data(
        api.PUT("/v0/documents/{documentId}/link-share", {
          params: { path: { documentId } },
          body,
        }),
      ),
    revoke: (documentId, body) =>
      done(
        api.DELETE("/v0/documents/{documentId}/link-share", {
          params: { path: { documentId } },
          body,
        }),
      ),
    download(token, externalSignal) {
      return runBoundedArtifactDownload(
        { signal: externalSignal },
        async (downloadSignal) => {
          const controller = new AbortController();
          const signal = AbortSignal.any([downloadSignal, controller.signal]);
          try {
            const [access, { response }] = await Promise.all([
              data(
                api.POST("/v0/shared-documents/resolve", {
                  body: { token },
                  signal,
                }),
              ),
              api.POST("/v0/shared-documents/content", {
                body: { token },
                parseAs: "stream",
                signal,
                credentials: "omit",
                cache: "no-store",
                redirect: "error",
              }),
            ]);
            if (response.status === 202)
              throw new Error(
                translate(teamHubExtrasMessages.sharedFilePreparing),
              );
            const content = await readBoundedArtifactContent(response, {
              signal,
            });
            const documentId = response.headers.get("X-Document-Id");
            const versionId = response.headers.get("X-Document-Version-Id");
            const filename = decodeDocumentFilename(
              response.headers.get("X-Document-Filename"),
            );
            const representationFormat = response.headers.get(
              "X-Document-Representation-Format",
            );
            if (
              documentId !== access.document_id ||
              !versionId ||
              !filename ||
              !representationFormat ||
              content.sha256 !== response.headers.get("X-Content-Sha256")
            )
              throw new Error(
                translate(teamHubExtrasMessages.sharedFileIntegrityFailed),
              );
            return {
              ...content,
              documentId,
              versionId,
              filename,
              representationFormat,
              readOnly: response.headers.get("X-Document-Read-Only") === "true",
              access,
            };
          } finally {
            controller.abort();
          }
        },
      );
    },
  };
}

function decodeDocumentFilename(encoded: string | null): string | null {
  if (!encoded) return null;
  try {
    const bytes = Uint8Array.from(
      atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
      (character) => character.charCodeAt(0),
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}
