import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { documentDetailPath } from "@/features/rooms/files/document-detail-routes";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubDocumentTreeSummary } from "@/features/teamhub/teamhub-types";
import { documentQueryKey } from "@/features/rooms/room-queries";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { libraryMessages as m } from "./library.messages";

export function canRenameDocument(document: TeamHubDocumentTreeSummary) {
  if (document.status !== "active") return false;
  return document.format === "blocknote" || document.can_edit_native_content
    ? document.capabilities.write && document.can_edit_native_content
    : document.capabilities.manage;
}

export function useDocumentRename(tenantId: string) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const t = useT();
  const [document, setDocument] = useState<TeamHubDocumentTreeSummary | null>(
    null,
  );
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  function beginRename(value: TeamHubDocumentTreeSummary) {
    if (!canRenameDocument(value)) return;
    if (value.can_edit_native_content) {
      void navigate(documentDetailPath({ documentId: value.id, tenantId }), {
        state: { editDocumentTitle: true, selectTitleBaseName: true },
      });
      return;
    }
    setDocument(value);
    setName(value.title);
    setError(null);
  }

  async function submit() {
    if (!document || pending || !name.trim()) return;
    if (name.trim() === document.title) {
      setDocument(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const updated = await teamHubData(
        client.api.PATCH("/v0/documents/{documentId}", {
          params: { path: { documentId: document.id } },
          body: { title: name.trim() },
        }),
      );
      queryClient.setQueryData(
        documentQueryKey(tenantId, document.id),
        updated,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["teamhub", tenantId, "document-tree"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["teamhub", tenantId, "shared-document-tree"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["teamhub", "library-documents"],
        }),
      ]);
      setDocument(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(m.fileNotRenamed));
    } finally {
      setPending(false);
    }
  }

  const dialog = document ? (
    <ModalDialog
      closeOnBackdrop
      onClose={() => {
        if (!pending) setDocument(null);
      }}
      size="sm"
      title={t(m.renameFile)}
      footer={
        <>
          <Button
            disabled={pending}
            onClick={() => setDocument(null)}
            tone="secondary"
            type="button"
          >
            {t(commonMessages.cancel)}
          </Button>
          <Button
            disabled={!name.trim()}
            form={formId}
            loading={pending}
            tone="primary"
            type="submit"
          >
            {t(m.rename)}
          </Button>
        </>
      }
    >
      <form
        className="px-5 py-4"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="block text-sm font-medium text-app-body">
          {t(m.fileName)}
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the field is focused on purpose because the user just opened this dialog or inline editor
            autoFocus
            className="mt-1 h-9 w-full rounded-sm border border-app-border-strong bg-app-surface px-2 text-sm text-app-ink focus:outline-none focus:ring-2 focus:ring-app-focus"
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => {
              const extension = event.target.value.lastIndexOf(".");
              event.target.setSelectionRange(
                0,
                extension > 0 ? extension : event.target.value.length,
              );
            }}
            value={name}
          />
        </label>
        {error ? (
          <p className="mt-3 text-sm text-app-danger" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  ) : null;

  return { beginRename, dialog };
}
