import {
  Add01Icon,
  Cancel01Icon,
  File01Icon,
} from "@hugeicons/core-free-icons";
import { parseRoomDocumentAssetReference } from "@linger/document-model";
import {
  queryOptions,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";

import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { translate } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";
import { formatBytes } from "@/lib/format-bytes";
import { uploadRoomDocumentAsset } from "../room-document-assets";
import type { RoomDocumentEditor } from "../room-document-comment-schema";
import { canvasMessages } from "./canvas.messages";

const maxAttachmentMegabytes = 15;
const maxAttachmentBytes = maxAttachmentMegabytes << 20;

function fileBlocks(blocks: RoomDocumentEditor["document"]) {
  const files: { id: string; name: string; url: string }[] = [];
  for (const block of blocks) {
    if (block.type === "file" && block.props.url) {
      files.push({
        id: block.id,
        name: block.props.name,
        url: block.props.url,
      });
    }
    files.push(...fileBlocks(block.children));
  }
  return files;
}

function assetQuery(client: TeamHubClient, reference: string) {
  return queryOptions({
    queryKey: ["document-asset", reference],
    staleTime: Infinity,
    queryFn: () => {
      const documentAssetId = parseRoomDocumentAssetReference(reference);
      if (!documentAssetId) throw new Error("Attachment reference is invalid.");
      return teamHubData(
        client.api.GET("/v0/document-assets/{documentAssetId}", {
          params: { path: { documentAssetId } },
        }),
      );
    },
  });
}

export function CanvasMailAttachments({
  client,
  documentId,
  editable,
  editor,
  scope,
}: {
  client: TeamHubClient;
  documentId: string;
  editable: boolean;
  editor: RoomDocumentEditor;
  scope: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [attachments, setAttachments] = useState(() =>
    fileBlocks(editor.document),
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const canEdit = useRef(editable);
  const active = useRef(true);
  useLayoutEffect(() => {
    canEdit.current = editable;
  }, [editable]);
  useLayoutEffect(() => {
    active.current = true;
    const refresh = () => setAttachments(fileBlocks(editor.document));
    refresh();
    const unsubscribe = editor.onChange(refresh);
    return () => {
      active.current = false;
      unsubscribe();
    };
  }, [editor]);
  const metadata = useQueries({
    queries: attachments.map((file) => assetQuery(client, file.url)),
  });

  async function add(files: File[]) {
    if (!canEdit.current || busy.current || files.length === 0) return;
    busy.current = true;
    setUploading(true);
    setError(undefined);
    try {
      if (files.some((file) => file.size === 0))
        throw new Error(translate(canvasMessages.emptyAttachment));
      const existing = await Promise.all(
        fileBlocks(editor.document).map((file) =>
          queryClient.ensureQueryData(assetQuery(client, file.url)),
        ),
      );
      const total =
        existing.reduce((sum, asset) => sum + asset.size_bytes, 0) +
        files.reduce((sum, file) => sum + file.size, 0);
      if (total > maxAttachmentBytes)
        throw new Error(
          translate(canvasMessages.attachmentsTooLarge, {
            megabytes: maxAttachmentMegabytes,
          }),
        );
      // Insert only durable assets; a failed upload must not leave a file placeholder.
      for (const file of files) {
        if (!active.current || !canEdit.current) return;
        const url = await uploadRoomDocumentAsset(client, documentId, file);
        if (!active.current || !canEdit.current) return;
        const last = editor.document.at(-1);
        if (!last) throw new Error(translate(canvasMessages.emailNotEditable));
        editor.insertBlocks(
          [{ type: "file", props: { name: file.name, url } }],
          last.id,
          "after",
        );
      }
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : translate(canvasMessages.attachFailed),
        );
    } finally {
      busy.current = false;
      if (active.current) setUploading(false);
    }
  }

  async function download(file: { url: string; name: string }) {
    setError(undefined);
    try {
      if (!editor.resolveFileUrl)
        throw new Error(translate(canvasMessages.attachmentUnavailable));
      const url = await editor.resolveFileUrl(file.url);
      if (!active.current) return;
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name || "attachment";
      link.click();
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : translate(canvasMessages.attachmentDownloadFailed),
        );
    }
  }

  return (
    <>
      {attachments.length > 0 ? (
        <style>
          {attachments
            .map(
              (file) =>
                `[data-knowledge-scope=${JSON.stringify(scope)}] .bn-block[data-id=${JSON.stringify(file.id)}] > .bn-block-content { display: none; }`,
            )
            .join("\n")}
        </style>
      ) : null}
      <AutoHeight>
        {attachments.length > 0 || editable ? (
          <section
            aria-label={t(canvasMessages.emailAttachments)}
            className="pt-5"
          >
            <input
              ref={input}
              aria-label={t(canvasMessages.chooseAttachments)}
              className="hidden"
              type="file"
              multiple
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void add(files);
              }}
            />
            <div className="flex flex-wrap gap-2">
              {attachments.map((file, index) => (
                <div
                  key={file.id}
                  className="flex h-16 min-w-0 max-w-60 items-center gap-2 rounded-lg border border-app-border bg-app-surface-soft py-2 pr-1 pl-3 text-sm"
                >
                  <Icon
                    icon={File01Icon}
                    size={18}
                    className="shrink-0 text-app-muted"
                  />
                  <span className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block w-full truncate text-left text-app-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void download(file)}
                      title={file.name || undefined}
                    >
                      {file.name ||
                        metadata[index]?.data?.filename ||
                        t(canvasMessages.attachment)}
                    </button>
                    {metadata[index]?.data ? (
                      <span className="block text-xs text-app-muted">
                        {formatBytes(metadata[index].data.size_bytes)}
                      </span>
                    ) : null}
                  </span>
                  {editable ? (
                    <Button
                      aria-label={
                        file.name
                          ? t(canvasMessages.removeAttachment, {
                              name: file.name,
                            })
                          : t(canvasMessages.removeUnnamedAttachment)
                      }
                      data-voice-risk="never"
                      tone="ghost"
                      size="compactIcon"
                      onClick={() => {
                        if (canEdit.current && editor.getBlock(file.id))
                          editor.removeBlocks([file.id]);
                      }}
                    >
                      <Icon icon={Cancel01Icon} size={14} />
                    </Button>
                  ) : null}
                </div>
              ))}
              {editable ? (
                <button
                  type="button"
                  aria-label={t(canvasMessages.addAttachments)}
                  title={t(canvasMessages.addAttachments)}
                  disabled={uploading}
                  onClick={() => input.current?.click()}
                  className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-app-border text-app-muted transition-colors duration-150 hover:border-app-muted hover:bg-accent hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 motion-reduce:transition-none"
                >
                  {uploading ? (
                    <Spinner size={16} />
                  ) : (
                    <Icon icon={Add01Icon} size={20} />
                  )}
                </button>
              ) : null}
            </div>
            {uploading ? (
              <p role="status" className="pt-2 text-xs text-app-muted">
                {t(canvasMessages.uploadingAttachments)}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="pt-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </section>
        ) : null}
      </AutoHeight>
    </>
  );
}
