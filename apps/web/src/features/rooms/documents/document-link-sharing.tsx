import { useQuery } from "@tanstack/react-query";
import {
  Copy01Icon,
  Link01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Select, SelectItem } from "@/components/ui/select";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { writeClipboardText } from "@/lib/clipboard";
import { commonMessages } from "@/i18n/common.messages";
import { translate } from "@/i18n/language";
import { useT } from "@/i18n/use-translation";

import { documentShareMessages as m } from "./document-share.messages";

const LINK_COPIED_MS = 1200;

export function DocumentLinkSharing({
  client,
  documentId,
}: {
  client: TeamHubClient;
  documentId: string;
}) {
  const t = useT();
  const policy = useQuery({
    queryKey: ["teamhub", "document-link-policy", documentId],
    queryFn: () => client.documentLinks.get(documentId),
    retry: false,
  });
  const [link, setLink] = useState<{ url: string; version: number } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const active = policy.data?.status === "active";
  const hasCopyableLink = active && link?.version === policy.data?.version;
  useEffect(() => () => window.clearTimeout(copiedTimerRef.current), []);

  async function copySharedLink() {
    if (!hasCopyableLink || !link) return;
    window.clearTimeout(copiedTimerRef.current);
    setCopied(false);
    setError(null);
    try {
      await writeClipboardText(link.url);
      setCopied(true);
      copiedTimerRef.current = window.setTimeout(
        () => setCopied(false),
        LINK_COPIED_MS,
      );
    } catch {
      setError(translate(m.sharedLinkCopyFailed));
    }
  }

  async function update(role: "disabled" | "viewer" | "editor", reset = false) {
    setPending(true);
    setError(null);
    window.clearTimeout(copiedTimerRef.current);
    setCopied(false);
    try {
      const expected_version = policy.data?.version ?? 0;
      if (role === "disabled") {
        await client.documentLinks.revoke(documentId, { expected_version });
        setLink(null);
      } else {
        const result = await client.documentLinks.set(documentId, {
          role,
          expected_version,
          reset,
        });
        const url =
          result.url ?? (link?.version === expected_version ? link.url : null);
        setLink(url ? { url, version: result.version } : null);
      }
      await policy.refetch();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : translate(m.linkUpdateFailed),
      );
      await policy.refetch();
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="mt-5 border-t border-app-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon icon={Link01Icon} className="text-app-muted" />
        <h3 className="mr-auto text-sm font-medium">{t(m.anyoneWithLink)}</h3>
        <Select
          aria-label={t(m.linkAccess)}
          value={active ? policy.data!.role : "disabled"}
          disabled={pending || policy.isPending || Boolean(policy.error)}
          onValueChange={(value) =>
            void update(value as "disabled" | "viewer" | "editor")
          }
          className="h-8 w-auto"
        >
          <SelectItem value="disabled">{t(m.linkDisabled)}</SelectItem>
          <SelectItem value="viewer">{t(m.canView)}</SelectItem>
          <SelectItem value="editor">{t(m.canEdit)}</SelectItem>
        </Select>
        {active ? (
          <Button
            aria-label={t(m.resetLink)}
            data-voice-risk="confirm"
            title={t(m.resetLink)}
            disabled={pending}
            size="compactIcon"
            tone="ghost"
            onClick={() => setResetConfirmOpen(true)}
          >
            <Icon icon={RefreshIcon} />
          </Button>
        ) : null}
        {hasCopyableLink ? (
          <>
            {copied ? (
              <span className="text-xs text-app-muted" role="status">
                {t(commonMessages.copied)}
              </span>
            ) : null}
            <Button
              aria-label={t(m.copySharedLink)}
              title={t(m.copySharedLink)}
              size="compactIcon"
              tone="ghost"
              onClick={() => void copySharedLink()}
            >
              <Icon icon={Copy01Icon} />
            </Button>
          </>
        ) : null}
      </div>
      {active && !hasCopyableLink ? (
        <p className="mt-2 text-xs text-app-muted">
          For security, this link is shown only when created. Reset the link to
          generate a new copyable URL.
        </p>
      ) : null}
      {error || policy.error ? (
        <p role="alert" className="mt-2 text-sm text-app-danger">
          {error ?? t(m.linkSharingUnavailable)}
        </p>
      ) : null}
      {resetConfirmOpen && active ? (
        <ModalDialog
          closeOnBackdrop={!pending}
          description="Previously shared links will immediately stop working. A new link will be generated."
          footer={
            <>
              <Button
                disabled={pending}
                onClick={() => setResetConfirmOpen(false)}
                tone="secondary"
              >
                {t(commonMessages.cancel)}
              </Button>
              <Button
                data-voice-risk="confirm"
                disabled={pending}
                loading={pending}
                onClick={() => {
                  void update(policy.data!.role, true).finally(() =>
                    setResetConfirmOpen(false),
                  );
                }}
                tone="danger"
              >
                {t(m.resetLink)}
              </Button>
            </>
          }
          onClose={() => {
            if (!pending) setResetConfirmOpen(false);
          }}
          size="sm"
          title="Reset shared link?"
        >
          {null}
        </ModalDialog>
      ) : null}
    </section>
  );
}
