import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComputerIcon,
  Download04Icon,
  File01Icon,
  FloppyDiskIcon,
  RefreshIcon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";

import { ReadOnlyBlockNoteDocumentLoader } from "@/components/read-only-blocknote-document-loader";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormFeedback } from "@/components/ui/form-feedback";
import { Icon } from "@/components/ui/icon";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Spinner } from "@/components/ui/spinner";
import { useDesktopLocalAccount } from "@/features/auth/desktop-local-account";
import { useTeamHubAuthentication } from "@/features/auth/teamhub-authentication";
import { artifactFileKind } from "@/features/rooms/files/artifact-file-kind";
import { triggerArtifactDownload } from "@/features/rooms/files/artifact-preview-loader";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { teamHubAuthenticationSignals } from "@/features/teamhub/teamhub-authentication";
import {
  createTeamHubIdempotencyKey,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import type { SharedDocumentContent } from "@/features/teamhub/teamhub-document-links";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubSession } from "@/features/teamhub/teamhub-types";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import { sharedDocumentMessages } from "./shared-document.messages";

const sharedDocumentSessionQueryKey = ["shared-document-session"] as const;

export function SharedDocumentPage() {
  const { client } = useTeamHubRuntime();
  const token = useLocation().hash.slice(1);
  return <SharedDocumentSurface key={token} client={client} token={token} />;
}

function SharedDocumentSurface({
  client,
  token,
}: {
  client: TeamHubClient;
  token: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const refreshHintId = useId();
  const valid = /^doc_link_[A-Za-z0-9_-]{43}$/.test(token);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const unsubscribe = teamHubAuthenticationSignals.subscribe((kind) => {
      if (kind === "authentication-required") {
        queryClient.setQueryData(sharedDocumentSessionQueryKey, null);
      }
      if (kind === "authenticated" || kind === "authentication-required") {
        void queryClient.invalidateQueries({
          queryKey: sharedDocumentSessionQueryKey,
        });
      }
    });
    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  const file = useQuery({
    queryKey: ["shared-document", token],
    enabled: valid,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await client.documentLinks.download(token, signal);
      const text =
        result.blob.size <= 1024 * 1024 &&
        (/^(text\/|application\/(json|xml))/i.test(result.mediaType) ||
          result.representationFormat === "markdown")
          ? await result.blob.text()
          : null;
      return { ...result, text };
    },
  });
  const session = useQuery({
    queryKey: sharedDocumentSessionQueryKey,
    queryFn: () => teamHubData(client.api.GET("/v0/session")),
    retry: false,
  });
  const refreshTitle = dirty
    ? "Save your changes before refreshing"
    : t(sharedDocumentMessages.refresh);
  const sharedFilename = file.data?.filename;

  useEffect(() => {
    if (!sharedFilename) return;
    const previousTitle = document.title;
    document.title = `${sharedFilename} — Linger`;
    return () => {
      document.title = previousTitle;
    };
  }, [sharedFilename]);

  return (
    <main className="min-h-dvh bg-app-surface text-app-body">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-app-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Icon
            icon={File01Icon}
            size={20}
            className="shrink-0 text-app-muted"
          />
          <h1 className="min-w-0 break-all text-lg">
            {file.data?.filename ?? t(sharedDocumentMessages.title)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <span
              className="text-xs text-app-muted"
              id={refreshHintId}
              role="status"
            >
              Unsaved changes — save before refreshing
            </span>
          ) : null}
          <span className="inline-flex" title={refreshTitle}>
            <Button
              aria-describedby={dirty ? refreshHintId : undefined}
              aria-label={t(sharedDocumentMessages.refresh)}
              title={refreshTitle}
              disabled={file.isFetching || !valid || dirty}
              onClick={() => void file.refetch()}
              size="compactIcon"
              tone="ghost"
            >
              <Icon icon={RefreshIcon} />
            </Button>
          </span>
        </div>
      </header>
      {file.error && dirty ? (
        <p role="alert" className="px-5 pt-4 text-sm text-app-danger">
          {t(sharedDocumentMessages.unavailableWithChanges)}
        </p>
      ) : null}
      {!valid || (file.error && (!file.data || !dirty)) ? (
        <div className="mx-auto max-w-3xl p-6" role="alert">
          {file.error instanceof Error &&
          !(file.error instanceof TeamHubError && file.error.status === 404)
            ? file.error.message
            : t(sharedDocumentMessages.unavailable)}
        </div>
      ) : file.isPending ? (
        <p className="flex items-center gap-2 p-6 text-sm text-app-muted">
          <Spinner size={16} />
          {t(sharedDocumentMessages.loading)}
        </p>
      ) : (
        <SharedFileEditor
          key={`${token}:${file.data.versionId}`}
          client={client}
          data={file.data}
          token={token}
          signedIn={Boolean(session.data)}
          onDirty={setDirty}
          onSignedIn={(nextSession) => {
            queryClient.setQueryData(
              sharedDocumentSessionQueryKey,
              nextSession,
            );
          }}
          onSaved={async () => {
            setDirty(false);
            await file.refetch();
          }}
        />
      )}
    </main>
  );
}

function SharedFileEditor({
  client,
  data,
  token,
  signedIn,
  onSaved,
  onSignedIn,
  onDirty,
}: {
  client: TeamHubClient;
  data: SharedDocumentContent & { text: string | null };
  token: string;
  signedIn: boolean;
  onSaved: () => Promise<unknown>;
  onSignedIn: (session: TeamHubSession) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const t = useT();
  const [text, setText] = useState(data.text ?? "");
  const [pendingAction, setPendingAction] = useState<"save" | "upload" | null>(
    null,
  );
  const [signInOpen, setSignInOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pending = pendingAction !== null;
  const editable = data.access.role === "editor" && !data.readOnly;
  const fileKind = artifactFileKind(data.filename, data.mediaType);
  const isMarkdown =
    data.representationFormat === "markdown" || fileKind === "markdown";
  const isImage = fileKind === "image" || /^image\//i.test(data.mediaType);

  async function save(file: File, action: "save" | "upload") {
    setPendingAction(action);
    setError(null);
    try {
      await client.uploadDocumentVersion(
        data.documentId,
        {
          file,
          representationFormat: data.representationFormat,
          expectedCurrentVersionId: data.versionId,
          linkToken: token,
        },
        createTeamHubIdempotencyKey(),
      );
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(sharedDocumentMessages.saveFailed),
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-5 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="mr-auto text-sm text-app-muted">
          {t(
            editable
              ? sharedDocumentMessages.canEdit
              : sharedDocumentMessages.readOnly,
          )}
        </span>
        <Button
          tone="secondary"
          onClick={() => triggerArtifactDownload(data.blob, data.filename)}
        >
          <Icon icon={Download04Icon} /> {t(sharedDocumentMessages.download)}
        </Button>
        {editable && !signedIn ? (
          <Button onClick={() => setSignInOpen(true)} tone="primary">
            {t(sharedDocumentMessages.signInToEdit)}
          </Button>
        ) : null}
        {editable && signedIn && data.text !== null ? (
          <Button
            disabled={pending || text === data.text}
            loading={pendingAction === "save"}
            onClick={() =>
              void save(
                new File([text], data.filename, { type: data.mediaType }),
                "save",
              )
            }
            tone="primary"
          >
            <Icon icon={FloppyDiskIcon} />{" "}
            {t(
              pendingAction === "save"
                ? sharedDocumentMessages.saving
                : commonMessages.save,
            )}
          </Button>
        ) : null}
        {editable && signedIn ? (
          <>
            <input
              aria-label={t(sharedDocumentMessages.uploadVersion)}
              className="hidden"
              disabled={pending}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void save(file, "upload");
                event.currentTarget.value = "";
              }}
              ref={fileInputRef}
              aria-hidden="true"
              tabIndex={-1}
              type="file"
            />
            <Button
              disabled={pending}
              loading={pendingAction === "upload"}
              onClick={() => fileInputRef.current?.click()}
              tone="secondary"
            >
              <Icon icon={Upload04Icon} />{" "}
              {t(sharedDocumentMessages.uploadVersion)}
            </Button>
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mb-4 text-sm text-app-danger">
          {error}
        </p>
      ) : null}
      {data.text !== null ? (
        editable && signedIn ? (
          <textarea
            aria-label={t(sharedDocumentMessages.fileContent)}
            disabled={pending}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onDirty(event.target.value !== data.text);
            }}
            className="min-h-[65dvh] w-full resize-y rounded-lg border border-input bg-card p-4 font-mono text-sm leading-6 outline-none transition-colors hover:border-border-hover focus:border-foreground focus:ring-2 focus:ring-ring"
          />
        ) : isMarkdown ? (
          <ReadOnlyBlockNoteDocumentLoader
            ariaLabel={data.filename}
            markdown={data.text}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6">
            {data.text}
          </pre>
        )
      ) : isImage ? (
        <SharedImagePreview
          blob={data.blob}
          filename={data.filename}
          mediaType={data.mediaType}
        />
      ) : (
        <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-app-muted">
          <Icon icon={File01Icon} size={24} />
          {data.mediaType}
        </div>
      )}
      {signInOpen && editable && !signedIn ? (
        <SharedDocumentSignInDialog
          onAuthenticated={(nextSession) => {
            onSignedIn(nextSession);
            setSignInOpen(false);
          }}
          onClose={() => setSignInOpen(false)}
        />
      ) : null}
    </section>
  );
}

function SharedImagePreview({
  blob,
  filename,
  mediaType,
}: {
  blob: Blob;
  filename: string;
  mediaType: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!(blob instanceof Blob) || typeof URL.createObjectURL !== "function") {
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [blob]);

  if (!objectUrl) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-app-muted">
        <Icon icon={File01Icon} size={24} />
        {mediaType}
      </div>
    );
  }

  return (
    <div className="flex min-h-48 items-center justify-center rounded-lg border border-app-border bg-app-surface-soft p-4">
      <img
        alt={filename}
        className="max-h-[70dvh] max-w-full rounded object-contain"
        src={objectUrl}
      />
    </div>
  );
}

function SharedDocumentSignInDialog({
  onAuthenticated,
  onClose,
}: {
  onAuthenticated: (session: TeamHubSession) => void;
  onClose: () => void;
}) {
  const localAccount = useDesktopLocalAccount();
  const authentication = useTeamHubAuthentication({
    onAuthenticated: ({ session }) => {
      onAuthenticated(session);
    },
  });
  const { email, error, isSubmitting, password } = authentication.state;

  return (
    <ModalDialog
      closeOnBackdrop={!isSubmitting}
      description="Sign in to edit this shared document without leaving this page."
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      size="sm"
      title="Sign in to edit"
    >
      <div className="space-y-4 px-5 py-4">
        {localAccount ? (
          <Button
            className="w-full"
            disabled={isSubmitting}
            onClick={() => {
              void authentication.signInWithDesktopAccount(localAccount);
            }}
            tone="secondary"
            type="button"
          >
            <Icon icon={ComputerIcon} size={16} />
            <span>Sign in with this computer&apos;s account</span>
          </Button>
        ) : null}
        <form
          className="space-y-3"
          noValidate
          onSubmit={(event) => {
            void authentication.handleSubmit(event);
          }}
        >
          <Field
            autoComplete="email"
            label="Email"
            onChange={(event) =>
              authentication.changeField("email", event.target.value)
            }
            placeholder="you@company.com"
            type="email"
            value={email}
          />
          <Field
            autoComplete="current-password"
            label="Password"
            onChange={(event) =>
              authentication.changeField("password", event.target.value)
            }
            type="password"
            value={password}
          />
          {error ? <FormFeedback tone="danger">{error}</FormFeedback> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              disabled={isSubmitting}
              onClick={onClose}
              tone="secondary"
              type="button"
            >
              Cancel
            </Button>
            <Button
              disabled={isSubmitting}
              loading={isSubmitting}
              tone="primary"
              type="submit"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
