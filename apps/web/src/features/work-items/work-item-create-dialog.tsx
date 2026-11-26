import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Select, SelectItem } from "@/components/ui/select";
import { idempotencyHeader, teamHubData } from "@/features/teamhub/teamhub-api";
import {
  createTeamHubIdempotencyKey,
  TeamHubError,
} from "@/features/teamhub/teamhub-client";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubRoomListItem,
  TeamHubWorkItemCreateInput,
  TeamHubWorkItemPriority,
} from "@/features/teamhub/teamhub-types";
import { useT } from "@/i18n/use-translation";

import {
  WORK_ITEM_TITLE_LIMIT,
  type WorkItemCreateDraft,
} from "./work-item-create-draft";
import { workItemPriorities, workItemPriorityLabel } from "./work-item-labels";
import {
  tenantWorkItemsDashboardQueryPrefix,
  tenantWorkItemTargetQueryKey,
} from "./work-item-queries";
import { dashboardWorkItemPath } from "./work-item-routes";
import { workItemsMessages as m } from "./work-items.messages";

/** The Rooms the dialog offers as an origin; a Thread is a reply surface. */
export type WorkItemCreateRoom = Pick<
  TeamHubRoomListItem,
  "id" | "kind" | "name"
>;

interface Submission {
  body: TeamHubWorkItemCreateInput;
  idempotencyKey: string;
}

export function WorkItemCreateAction({
  rooms,
  tenantId,
}: {
  rooms: readonly WorkItemCreateRoom[];
  tenantId: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="compact" tone="primary">
        {t(m.newIssue)}
      </Button>
      {open ? (
        <WorkItemCreateDialog
          onClose={() => setOpen(false)}
          rooms={rooms}
          tenantId={tenantId}
        />
      ) : null}
    </>
  );
}

export function WorkItemCreateDialog({
  initial,
  onClose,
  rooms,
  tenantId,
}: {
  /** Values another surface already knows, such as a Message's draft. */
  initial?: WorkItemCreateDraft;
  onClose: () => void;
  rooms: readonly WorkItemCreateRoom[];
  tenantId: string;
}) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const formId = useId();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const idempotency = useRef<{ content: string; key: string } | null>(null);
  const submitting = useRef(false);
  const dismissalFocus = useRef<HTMLElement | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState<TeamHubWorkItemPriority>(
    initial?.priority ?? "medium",
  );
  const [originRoomId, setOriginRoomId] = useState(initial?.originRoomId ?? "");
  const createIssue = useMutation({
    mutationFn: (submission: Submission) =>
      teamHubData(
        client.api.POST("/v0/tenants/{tenantId}/work-items", {
          params: {
            path: { tenantId },
            header: idempotencyHeader(submission.idempotencyKey),
          },
          body: submission.body,
        }),
      ),
    onSuccess: async (item) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: tenantWorkItemsDashboardQueryPrefix(tenantId),
        }),
        queryClient.invalidateQueries({
          exact: true,
          queryKey: tenantWorkItemTargetQueryKey(tenantId, item.id),
        }),
      ]);
      onClose();
      await navigate(dashboardWorkItemPath(tenantId, item.id));
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  const trimmedTitle = title.trim();
  const titleTooLong = trimmedTitle.length > WORK_ITEM_TITLE_LIMIT;
  const canSubmit = trimmedTitle.length > 0 && !titleTooLong;
  const dirty =
    title !== (initial?.title ?? "") ||
    description !== (initial?.description ?? "") ||
    priority !== (initial?.priority ?? "medium") ||
    originRoomId !== (initial?.originRoomId ?? "");
  const failureMessage = createIssue.error
    ? createIssue.error instanceof TeamHubError
      ? createIssue.error.message
      : t(m.createUnconfirmed)
    : null;
  const originRooms = rooms
    // A Thread is a reply surface, except when it is the origin already given.
    .filter(
      (room) => room.kind !== "thread" || room.id === initial?.originRoomId,
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || submitting.current || createIssue.isPending) return;

    const content = JSON.stringify([
      trimmedTitle,
      description.trim(),
      priority,
      originRoomId,
    ]);
    // A double submit or a retry after an unclear failure replays one intent;
    // editing any field makes the next submit a new one.
    if (idempotency.current?.content !== content) {
      idempotency.current = { content, key: createTeamHubIdempotencyKey() };
    }
    submitting.current = true;
    setCloseBlocked(false);
    createIssue.mutate({
      body: {
        description: description.trim(),
        kind: "issue",
        priority,
        title: trimmedTitle,
        ...(originRoomId ? { origin_room_id: originRoomId } : {}),
      },
      idempotencyKey: idempotency.current.key,
    });
  }

  function requestClose() {
    if (submitting.current || createIssue.isPending) {
      setCloseBlocked(true);
      return;
    }
    setCloseBlocked(false);
    if (!dirty) {
      onClose();
      return;
    }
    dismissalFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setConfirmDiscard(true);
  }

  function continueEditing() {
    setConfirmDiscard(false);
    requestAnimationFrame(() => dismissalFocus.current?.focus());
  }

  const dialog = (
    <ModalDialog
      onClose={requestClose}
      size="sm"
      title={t(m.newIssue)}
      footer={
        <Button
          disabled={!canSubmit}
          form={formId}
          loading={createIssue.isPending}
          tone="primary"
          type="submit"
        >
          {t(m.createIssue)}
        </Button>
      }
    >
      <form className="px-5 py-4" id={formId} onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-app-ink">
            {t(m.titleLabel)}
          </span>
          <input
            aria-invalid={titleTooLong || undefined}
            className={`ui-field-control w-full ${
              titleTooLong ? "!border-app-danger" : ""
            }`}
            disabled={createIssue.isPending}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t(m.titlePlaceholder)}
            ref={titleInputRef}
            value={title}
          />
        </label>
        {titleTooLong ? (
          <span className="mt-1 block text-sm text-app-danger" role="alert">
            {t(m.titleTooLong, { limit: WORK_ITEM_TITLE_LIMIT })}
          </span>
        ) : null}

        <label className="mt-3 block">
          <span className="mb-1.5 block text-sm font-medium text-app-ink">
            {t(m.descriptionLabel)}
          </span>
          <textarea
            className="ui-field-control min-h-20 w-full"
            disabled={createIssue.isPending}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t(m.descriptionPlaceholder)}
            value={description}
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-app-body">
          {t(m.priority)}
          <Select
            aria-label={t(m.issuePriorityLabel)}
            className="mt-1 w-full"
            disabled={createIssue.isPending}
            onValueChange={(value) =>
              setPriority(value as TeamHubWorkItemPriority)
            }
            value={priority}
          >
            {workItemPriorities.map((option) => (
              <SelectItem key={option} value={option}>
                {workItemPriorityLabel(option, t)}
              </SelectItem>
            ))}
          </Select>
        </label>

        <label className="mt-3 block text-sm font-medium text-app-body">
          {t(m.originRoom)}
          <Select
            aria-label={t(m.originRoom)}
            className="mt-1 w-full"
            disabled={createIssue.isPending}
            onValueChange={setOriginRoomId}
            value={originRoomId}
          >
            <SelectItem value="">{t(m.noRoom)}</SelectItem>
            {originRooms.map((room) => (
              <SelectItem key={room.id} value={room.id}>
                {`#${room.name}`}
              </SelectItem>
            ))}
          </Select>
        </label>

        {failureMessage ? (
          <p className="mt-3 text-sm text-app-danger" role="alert">
            {failureMessage}
          </p>
        ) : null}
        {closeBlocked && createIssue.isPending ? (
          <p className="mt-3 text-sm text-app-muted" role="status">
            {t(m.waitForCreateFinish)}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  );

  return (
    <>
      {dialog}
      {confirmDiscard ? (
        <ModalDialog
          closeOnBackdrop
          description={t(m.discardIssueDescription)}
          footer={
            <>
              <Button
                // eslint-disable-next-line jsx-a11y/no-autofocus -- keeping the draft is the safe default for this dismissal decision
                autoFocus
                onClick={continueEditing}
                tone="primary"
              >
                {t(m.continueEditing)}
              </Button>
              <Button data-voice-risk="never" onClick={onClose} tone="danger">
                {t(m.discardAndClose)}
              </Button>
            </>
          }
          onClose={continueEditing}
          returnFocusTo={dismissalFocus}
          size="sm"
          title={t(m.discardIssueTitle)}
        >
          {null}
        </ModalDialog>
      ) : null}
    </>
  );
}
