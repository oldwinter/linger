import {
  Cancel01Icon,
  Copy01Icon,
  Note01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useNavigate } from "react-router";

import { Button, buttonClassName } from "@/components/ui/button";
import { Icon, type IconSvgElement } from "@/components/ui/icon";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Select, SelectItem } from "@/components/ui/select";
import { ActorAvatar } from "@/features/rooms/members/actor-avatar";
import { teamHubIdentityQueryOptions } from "@/features/rooms/room-queries";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubWorkItem,
  TeamHubWorkItemComment,
  TeamHubWorkItemPriority,
  TeamHubWorkItemTimelineEntry,
} from "@/features/teamhub/teamhub-types";
import { cn } from "@/lib/cn";
import { dateTimeFormat } from "@/lib/date-format";

import { WorkItemAssigneePicker } from "./work-item-assignee-picker";
import {
  WorkItemCommentComposer,
  type WorkItemDraftStatus,
} from "./work-item-comment-composer";
import { workItemCommentsMarkdown } from "./work-item-comments-markdown";
import { WorkItemCopyStatus } from "./work-item-copy-status";
import { WORK_ITEM_TITLE_LIMIT } from "./work-item-create-draft";
import {
  createWorkItemDashboardFilters,
  currentDashboardActorId,
} from "./work-item-dashboard-filters";
import { updateFailureMessage } from "./work-item-failure";
import {
  workItemPriorities,
  workItemPriorityBadgeClassName,
  workItemPriorityLabel,
  workItemStateLabel,
  workItemStateLabels,
} from "./work-item-labels";
import {
  tenantWorkItemCommentsQueryOptions,
  tenantWorkItemTargetQueryOptions,
  tenantWorkItemTimelineQueryOptions,
  useArchiveWorkItem,
  useAssignWorkItem,
  useUnassignWorkItem,
  useUnarchiveWorkItem,
  useUpdateWorkItem,
  useWorkItemTransition,
} from "./work-item-queries";
import { WorkItemShareAction } from "./work-item-share-action";
import { workItemStoryPath, workRoomPath } from "./work-item-story";
import {
  useWorkItemClipboardCopy,
  useWorkItemCopy,
  type WorkItemCopyState,
} from "./use-work-item-copy";

const peekDateFormatter = dateTimeFormat({
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const commentLimit = 3;
const timelineLimit = 8;

interface PeekTransition {
  label: string;
  resolution?: NonNullable<TeamHubWorkItem["resolution"]>;
  state: TeamHubWorkItem["state"];
}

type PeekDismissal = "close" | "full-page" | "work-room" | "cancel-edit";

/**
 * The board's peek: the Work Item's own facts, its recent conversation and
 * activity, and the moves TeamHub allows from its current state. The full page
 * stays one link away.
 */
export function WorkItemPeek({
  onClose,
  search,
  tenantId,
  workItem,
}: {
  onClose: () => void;
  /** The board's filters, kept on the full-page link. */
  search: string;
  tenantId: string;
  workItem: TeamHubWorkItem;
}) {
  const { client } = useTeamHubRuntime();
  const navigate = useNavigate();
  const target = useQuery(
    tenantWorkItemTargetQueryOptions(client, tenantId, workItem.id),
  );
  const comments = useQuery(
    tenantWorkItemCommentsQueryOptions(client, tenantId, workItem.id),
  );
  const timeline = useQuery(
    tenantWorkItemTimelineQueryOptions(client, tenantId, workItem.id),
  );
  const transition = useWorkItemTransition(tenantId, workItem.id);
  const assign = useAssignWorkItem(tenantId, workItem.id);
  const unassign = useUnassignWorkItem(tenantId, workItem.id);
  const archive = useArchiveWorkItem(tenantId, workItem.id);
  const unarchive = useUnarchiveWorkItem(tenantId, workItem.id);
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const currentActorId = identity.data
    ? currentDashboardActorId(identity.data, tenantId)
    : undefined;
  const item = target.data ?? workItem;
  const [editing, setEditing] = useState(false);
  const editButtonId = useId();
  const [editStatus, setEditStatus] = useState<WorkItemDraftStatus>("clean");
  const [commentStatus, setCommentStatus] =
    useState<WorkItemDraftStatus>("clean");
  const [dismissal, setDismissal] = useState<PeekDismissal>();
  const [closeBlocked, setCloseBlocked] = useState(false);
  const dismissalFocus = useRef<HTMLElement | null>(null);
  const draftPending = editStatus === "pending" || commentStatus === "pending";

  function finishEditing() {
    setEditing(false);
    setEditStatus("clean");
    requestAnimationFrame(() => document.getElementById(editButtonId)?.focus());
  }

  function finishDismissal(action: PeekDismissal) {
    setDismissal(undefined);
    if (action === "cancel-edit") {
      finishEditing();
      return;
    }
    onClose();
    if (action === "full-page") {
      void navigate({
        pathname: workItemStoryPath(tenantId, item.id),
        search,
      });
    } else if (action === "work-room" && item.work_room_id) {
      void navigate(workRoomPath(tenantId, item.work_room_id));
    }
  }

  function requestDismissal(action: PeekDismissal) {
    const cancelEdit = action === "cancel-edit";
    if (editStatus === "pending" || (!cancelEdit && draftPending)) {
      setCloseBlocked(true);
      return;
    }
    setCloseBlocked(false);
    if (editStatus === "dirty" || (!cancelEdit && commentStatus === "dirty")) {
      dismissalFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setDismissal(action);
      return;
    }
    finishDismissal(action);
  }

  function continueEditing() {
    setDismissal(undefined);
    requestAnimationFrame(() => dismissalFocus.current?.focus());
  }

  // Both lists open short; expanding is a view of what is already loaded, so it
  // sends no request and stays with this peek's lifetime.
  const [allComments, setAllComments] = useState(false);
  const [allTimeline, setAllTimeline] = useState(false);
  const commentsCopy = useWorkItemClipboardCopy();
  // The row and the control read the same list, so they cannot disagree about
  // whether this Actor is an assignee.
  const assignedToMe =
    currentActorId !== undefined &&
    item.assignees.some(({ actor }) => actor.id === currentActorId);
  const assignmentPending = assign.isPending || unassign.isPending;
  const assignmentError = assign.error ?? unassign.error;
  function unassignActor(actorId: string) {
    if (assignmentPending) return;
    assign.reset();
    unassign.mutate(actorId);
  }
  function toggleAssignment() {
    if (!currentActorId || assignmentPending) return;
    if (assignedToMe) {
      unassignActor(currentActorId);
    } else {
      unassign.reset();
      assign.mutate({ actorId: currentActorId });
    }
  }
  const archived = Boolean(item.archived_at);
  const archivePending = archive.isPending || unarchive.isPending;
  const archiveError = archive.error ?? unarchive.error;
  const boardShowsArchived = createWorkItemDashboardFilters(
    new URLSearchParams(search),
  ).archived;
  // The drawer outlives the card, so archiving says where the Item went
  // instead of leaving a board behind it that silently lost a card.
  const archiveStatus = unarchive.isSuccess
    ? "Unarchived."
    : archive.isSuccess
      ? boardShowsArchived
        ? "Archived."
        : "Archived. The board hides it until the Archived filter is on."
      : undefined;
  function toggleArchive() {
    if (archivePending) return;
    if (archived) {
      archive.reset();
      unarchive.mutate(item.version);
    } else {
      unarchive.reset();
      archive.mutate(item.version);
    }
  }
  // Comments arrive oldest first; the peek reads as a conversation, newest on top.
  const visibleComments = (comments.data ?? []).filter(
    (comment) => !comment.deleted_at,
  );
  const shownComments = allComments
    ? [...visibleComments].reverse()
    : visibleComments.slice(-commentLimit).reverse();
  const timelineEntries = timeline.data ?? [];
  const shownTimeline = allTimeline
    ? timelineEntries
    : timelineEntries.slice(-timelineLimit);
  const transitions = allowedTransitions(item);
  // The note carries the whole loaded discussion, whatever the short view shows.
  function copyComments() {
    commentsCopy.copy(
      workItemCommentsMarkdown({
        comments: [...visibleComments].reverse().map((comment) => ({
          authorName: comment.author.display_name,
          body: comment.body,
          createdAt: comment.created_at,
        })),
        title: item.title,
      }),
      "Copied",
    );
  }

  const peek = (
    <ModalDialog
      className="work-item-peek"
      closeOnBackdrop
      description={`${item.kind === "issue" ? "Issue" : "Task"} #${item.number}`}
      footer={
        <div className="flex w-full flex-col gap-3">
          {closeBlocked && draftPending ? (
            <p className="text-sm text-app-muted" role="status">
              Wait for saving or sending to finish before leaving.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className={`${buttonClassName({ size: "compact" })} mr-auto`}
              onClick={(event) => {
                if (
                  event.button === 0 &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  requestDismissal("full-page");
                }
              }}
              to={{
                pathname: workItemStoryPath(tenantId, item.id),
                search,
              }}
            >
              Open full page
            </Link>
            {transitions.map((option) => (
              <Button
                disabled={transition.isPending}
                key={`${option.state}:${option.resolution ?? ""}`}
                onClick={() =>
                  transition.mutate({
                    expectedVersion: item.version,
                    resolution: option.resolution,
                    state: option.state,
                  })
                }
                size="compact"
                tone={
                  option.state === "resolved" &&
                  option.resolution === "completed"
                    ? "primary"
                    : "secondary"
                }
              >
                {option.label}
              </Button>
            ))}
            <Button
              aria-busy={archivePending || undefined}
              disabled={archivePending}
              onClick={toggleArchive}
              size="compact"
              tone="secondary"
            >
              {archived ? "Unarchive" : "Archive"}
            </Button>
          </div>
        </div>
      }
      headerActions={
        <>
          <PeekCopyMarkdown tenantId={tenantId} workItem={item} />
          <PeekCopyLink tenantId={tenantId} workItem={item} />
          <WorkItemShareAction item={item} tenantId={tenantId} />
        </>
      }
      onClose={() => requestDismissal("close")}
      title={item.title}
    >
      <div className="space-y-5 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-app-selected px-2 py-0.5 font-medium text-app-ink">
            {workItemStateLabel(item)}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-medium capitalize",
              workItemPriorityBadgeClassName(item.priority),
            )}
            data-priority={item.priority}
          >
            {item.priority}
          </span>
          <span className="text-app-muted">
            Updated {peekDateFormatter.format(new Date(item.updated_at))}
          </span>
          {item.work_room_id ? (
            <Link
              className="ml-auto text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => {
                if (
                  event.button === 0 &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  requestDismissal("work-room");
                }
              }}
              to={workRoomPath(tenantId, item.work_room_id)}
            >
              Open work Room
            </Link>
          ) : null}
        </div>

        {archiveStatus ? (
          <p className="text-xs text-app-muted" role="status">
            {archiveStatus}
          </p>
        ) : null}
        {archiveError ? (
          <p className="text-xs text-app-danger" role="alert">
            {updateFailureMessage(archiveError)}
          </p>
        ) : null}

        {editing ? (
          <WorkItemEditForm
            item={item}
            onCancel={() => requestDismissal("cancel-edit")}
            onDone={finishEditing}
            onDraftStatusChange={setEditStatus}
            tenantId={tenantId}
          />
        ) : (
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6 text-app-body">
              {item.description || "No description."}
            </p>
            <Button
              id={editButtonId}
              onClick={() => setEditing(true)}
              size="compact"
              tone="secondary"
            >
              Edit
            </Button>
          </div>
        )}

        <section aria-label="Assignees" className="space-y-2">
          <h3 className="text-xs font-medium text-app-muted">Assignees</h3>
          {item.assignees.length ? (
            <ul className="space-y-1.5">
              {item.assignees.map(({ actor }) => (
                <li className="flex items-center gap-2 text-sm" key={actor.id}>
                  <ActorAvatar
                    actorId={actor.id}
                    kind={actor.kind}
                    name={actor.display_name}
                    size="micro"
                  />
                  <span className="min-w-0 flex-1 truncate text-app-ink">
                    {actor.display_name}
                  </span>
                  <Button
                    aria-busy={
                      (unassign.isPending && unassign.variables === actor.id) ||
                      undefined
                    }
                    aria-label={`Unassign ${actor.display_name}`}
                    disabled={assignmentPending}
                    onClick={() => unassignActor(actor.id)}
                    size="compactIcon"
                    title={`Unassign ${actor.display_name}`}
                    tone="ghost"
                  >
                    <Icon icon={Cancel01Icon} size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-app-muted">Unassigned</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {currentActorId ? (
              <Button
                aria-busy={assignmentPending || undefined}
                disabled={assignmentPending}
                onClick={toggleAssignment}
                size="compact"
                tone="secondary"
              >
                {assignedToMe ? "Unassign me" : "Assign to me"}
              </Button>
            ) : null}
            <WorkItemAssigneePicker
              assignedActorIds={item.assignees.map(({ actor }) => actor.id)}
              disabled={assignmentPending}
              tenantId={tenantId}
              workItemId={workItem.id}
            />
          </div>
          {assignmentError ? (
            <p className="text-xs text-app-danger" role="alert">
              {updateFailureMessage(assignmentError)}
            </p>
          ) : null}
        </section>

        <section aria-label="Recent comments" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-app-muted">
              Recent comments
            </h3>
            <PeekCopyButton
              copiedLabel={commentsCopy.copiedLabel}
              disabled={!visibleComments.length}
              icon={Copy01Icon}
              label="Copy comments"
              onCopy={copyComments}
              state={commentsCopy.state}
            />
          </div>
          {comments.isPending ? (
            <p className="text-xs text-app-muted">Loading comments…</p>
          ) : null}
          {comments.isError ? (
            <p className="text-xs text-app-danger" role="alert">
              Comments could not be loaded.
            </p>
          ) : null}
          {comments.isSuccess && !shownComments.length ? (
            <p className="text-sm text-app-muted">No comments yet.</p>
          ) : null}
          <ul className="space-y-3">
            {shownComments.map((comment) => (
              <CommentEntry comment={comment} key={comment.id} />
            ))}
          </ul>
          {visibleComments.length > commentLimit ? (
            <PeekListToggle
              expanded={allComments}
              noun="comment"
              onToggle={setAllComments}
              total={visibleComments.length}
            />
          ) : null}
        </section>

        <WorkItemCommentComposer
          onDraftStatusChange={setCommentStatus}
          tenantId={tenantId}
          workItemId={workItem.id}
        />

        <section aria-label="Timeline" className="space-y-2">
          <h3 className="text-xs font-medium text-app-muted">Timeline</h3>
          {timeline.isPending ? (
            <p className="text-xs text-app-muted">Loading timeline…</p>
          ) : null}
          {timeline.isError ? (
            <p className="text-xs text-app-danger" role="alert">
              Timeline could not be loaded.
            </p>
          ) : null}
          {timeline.isSuccess && !shownTimeline.length ? (
            <p className="text-sm text-app-muted">No activity yet.</p>
          ) : null}
          <ol className="space-y-2">
            {shownTimeline.map((entry) => (
              <li
                className="flex items-baseline gap-2 text-xs text-app-muted"
                key={timelineEntryKey(entry)}
              >
                <time
                  className="shrink-0 tabular-nums"
                  dateTime={timelineEntryTime(entry)}
                >
                  {peekDateFormatter.format(new Date(timelineEntryTime(entry)))}
                </time>
                <span className="text-app-body">
                  {timelineEntryLabel(entry)}
                </span>
              </li>
            ))}
          </ol>
          {timelineEntries.length > timelineLimit ? (
            <PeekListToggle
              expanded={allTimeline}
              noun="event"
              onToggle={setAllTimeline}
              total={timelineEntries.length}
            />
          ) : null}
        </section>

        {target.isError ? (
          <p className="text-xs text-app-danger" role="alert">
            The latest Work Item details could not be loaded.
          </p>
        ) : null}
        {transition.error ? (
          <p className="text-xs text-app-danger" role="alert">
            {updateFailureMessage(transition.error)}
          </p>
        ) : null}
      </div>
    </ModalDialog>
  );

  return (
    <>
      {peek}
      {dismissal ? (
        <ModalDialog
          closeOnBackdrop
          description={
            editStatus === "dirty"
              ? dismissal !== "cancel-edit" && commentStatus === "dirty"
                ? "Your changes and comment have not been saved or sent."
                : "Your changes have not been saved."
              : "Your comment has not been sent."
          }
          footer={
            <>
              <Button
                // eslint-disable-next-line jsx-a11y/no-autofocus -- keeping the draft is the safe default for this explicit dismissal decision
                autoFocus
                onClick={continueEditing}
                tone="primary"
              >
                Continue editing
              </Button>
              <Button onClick={() => finishDismissal(dismissal)} tone="danger">
                {dismissal === "cancel-edit"
                  ? "Discard edits"
                  : dismissal === "full-page"
                    ? "Discard and open page"
                    : dismissal === "work-room"
                      ? "Discard and open Room"
                      : "Discard and close"}
              </Button>
            </>
          }
          onClose={continueEditing}
          size="sm"
          title="Discard unsaved work?"
        >
          {null}
        </ModalDialog>
      ) : null}
    </>
  );
}

/** Copies the same board link the card menu copies, with the same feedback. */
function PeekCopyLink({
  tenantId,
  workItem,
}: {
  tenantId: string;
  workItem: TeamHubWorkItem;
}) {
  const { copiedLabel, copyLink, state } = useWorkItemCopy(tenantId, workItem);
  return (
    <PeekCopyButton
      copiedLabel={copiedLabel}
      icon={Copy01Icon}
      label="Copy link"
      onCopy={copyLink}
      state={state}
    />
  );
}

/** Copies the Item as Markdown, the same text the card menu copies. */
function PeekCopyMarkdown({
  tenantId,
  workItem,
}: {
  tenantId: string;
  workItem: TeamHubWorkItem;
}) {
  const { copiedLabel, copyMarkdown, state } = useWorkItemCopy(
    tenantId,
    workItem,
  );
  return (
    <PeekCopyButton
      copiedLabel={copiedLabel}
      icon={Note01Icon}
      label="Copy as Markdown"
      onCopy={copyMarkdown}
      state={state}
    />
  );
}

/** One header copy control: its own icon, its own feedback line. */
function PeekCopyButton({
  copiedLabel,
  disabled = false,
  icon,
  label,
  onCopy,
  state,
}: {
  copiedLabel?: string;
  /** Blocks the action until it has something to copy. */
  disabled?: boolean;
  icon: IconSvgElement;
  label: string;
  onCopy: () => void;
  state: WorkItemCopyState;
}) {
  return (
    <span className="relative inline-flex">
      <button
        aria-label={label}
        className="app-dialog-close disabled:opacity-50"
        disabled={disabled}
        onClick={onCopy}
        type="button"
      >
        <Icon
          icon={
            state === "copied"
              ? Tick02Icon
              : state === "failed"
                ? Cancel01Icon
                : icon
          }
          size={16}
        />
      </button>
      <WorkItemCopyStatus copiedLabel={copiedLabel} state={state} />
    </span>
  );
}

function CommentEntry({ comment }: { comment: TeamHubWorkItemComment }) {
  return (
    <li>
      <div className="flex items-center gap-2 text-xs text-app-muted">
        <ActorAvatar
          actorId={comment.author.id}
          kind={comment.author.kind}
          name={comment.author.display_name}
          size="micro"
        />
        <span className="font-medium text-app-ink">
          {comment.author.display_name}
        </span>
        <span>{peekDateFormatter.format(new Date(comment.created_at))}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-app-body">
        {comment.body}
      </p>
    </li>
  );
}

/**
 * Expands or collapses one peek list in place. The pressed control holds its
 * screen position across the change by shifting the drawer's scroll by the same
 * amount, so a person who was reading near the control stays there while the
 * list grows or shrinks around it.
 */
function PeekListToggle({
  expanded,
  noun,
  onToggle,
  total,
}: {
  expanded: boolean;
  /** The list's word, pluralized on the control; a count above the limit is two or more. */
  noun: "comment" | "event";
  onToggle: (expanded: boolean) => void;
  /** Every entry already loaded for this peek. */
  total: number;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Captured on click, consumed by the render that shows the new height, so an
  // unrelated render in between cannot move the scroll.
  const pending = useRef<{ top: number; to: boolean } | undefined>(undefined);
  useLayoutEffect(() => {
    const request = pending.current;
    if (!request || request.to !== expanded) return;
    pending.current = undefined;
    const button = buttonRef.current;
    if (!button) return;
    const shift = button.getBoundingClientRect().top - request.top;
    if (!shift) return;
    const scroller = button.closest<HTMLElement>(".app-dialog-body");
    if (scroller) scroller.scrollTop += shift;
  }, [expanded]);
  return (
    <button
      className={buttonClassName({ size: "compact", tone: "ghost" })}
      onClick={() => {
        const button = buttonRef.current;
        if (button) {
          pending.current = {
            to: !expanded,
            top: button.getBoundingClientRect().top,
          };
        }
        onToggle(!expanded);
      }}
      ref={buttonRef}
      type="button"
    >
      {expanded ? "Show fewer" : `Show all ${total} ${noun}s`}
    </button>
  );
}

/**
 * Inline editing for the facts a Human can change from the peek. Saves are
 * checked against the revision the form opened with, so a change made
 * elsewhere conflicts instead of being overwritten. Title and description
 * submit trimmed, as the create dialog stores them.
 */
function WorkItemEditForm({
  item,
  onCancel,
  onDone,
  onDraftStatusChange,
  tenantId,
}: {
  item: TeamHubWorkItem;
  onCancel: () => void;
  onDone: () => void;
  onDraftStatusChange: (status: WorkItemDraftStatus) => void;
  tenantId: string;
}) {
  const update = useUpdateWorkItem(tenantId, item.id);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [baseline] = useState(item);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [priority, setPriority] = useState(item.priority);
  const submitting = useRef(false);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const titleTooLong = trimmedTitle.length > WORK_ITEM_TITLE_LIMIT;
  const changes = {
    ...(trimmedTitle === baseline.title ? {} : { title: trimmedTitle }),
    ...(trimmedDescription === baseline.description
      ? {}
      : { description: trimmedDescription }),
    ...(priority === baseline.priority ? {} : { priority }),
  };
  const canSave = trimmedTitle.length > 0 && !titleTooLong;
  const draftStatus = update.isPending
    ? "pending"
    : Object.keys(changes).length
      ? "dirty"
      : "clean";

  useEffect(() => {
    onDraftStatusChange(draftStatus);
  }, [draftStatus, onDraftStatusChange]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || submitting.current) return;
    // An edit that ends where it started has nothing to send.
    if (!Object.keys(changes).length) {
      onDone();
      return;
    }
    submitting.current = true;
    onDraftStatusChange("pending");
    update.mutate(
      { ...changes, expectedVersion: baseline.version },
      {
        onError: () => onDraftStatusChange("dirty"),
        onSettled: () => {
          submitting.current = false;
        },
        onSuccess: onDone,
      },
    );
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-app-ink">
          Title
        </span>
        <input
          aria-invalid={titleTooLong || undefined}
          className={`ui-field-control w-full ${
            titleTooLong ? "!border-app-danger" : ""
          }`}
          disabled={update.isPending}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs to be done?"
          ref={titleInputRef}
          value={title}
        />
      </label>
      {titleTooLong ? (
        <span className="block text-sm text-app-danger" role="alert">
          A title can be at most {WORK_ITEM_TITLE_LIMIT} characters long.
        </span>
      ) : null}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-app-ink">
          Description
        </span>
        <textarea
          className="ui-field-control min-h-20 w-full"
          disabled={update.isPending}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Add details"
          value={description}
        />
      </label>

      <label className="block text-sm font-medium text-app-body">
        Priority
        <Select
          aria-label="Priority"
          className="mt-1 w-full"
          disabled={update.isPending}
          onValueChange={(value) =>
            setPriority(value as TeamHubWorkItemPriority)
          }
          value={priority}
        >
          {workItemPriorities.map((option) => (
            <SelectItem key={option} value={option}>
              {workItemPriorityLabel(option)}
            </SelectItem>
          ))}
        </Select>
      </label>

      {update.error ? (
        <p className="text-sm text-app-danger" role="alert">
          {updateFailureMessage(update.error)}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          disabled={!canSave}
          loading={update.isPending}
          size="compact"
          tone="primary"
          type="submit"
        >
          Save
        </Button>
        <Button
          disabled={update.isPending}
          onClick={onCancel}
          size="compact"
          tone="secondary"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * TeamHub refuses a transition on a managed Task, whose execution is owned by
 * its Agent, so the peek offers none there.
 */
function allowedTransitions(item: TeamHubWorkItem): PeekTransition[] {
  if (item.task_execution) return [];
  switch (item.state) {
    case "open":
      return [
        { label: "Start", state: "in_progress" },
        { label: "Resolve", resolution: "completed", state: "resolved" },
        {
          label: "Close as not planned",
          resolution: "not_planned",
          state: "resolved",
        },
      ];
    case "in_progress":
      return [
        { label: "Move to Todo", state: "open" },
        { label: "Resolve", resolution: "completed", state: "resolved" },
        {
          label: "Close as not planned",
          resolution: "not_planned",
          state: "resolved",
        },
      ];
    case "resolved":
      return [{ label: "Reopen", state: "open" }];
  }
}

function timelineEntryKey(entry: TeamHubWorkItemTimelineEntry) {
  return entry.type === "comment"
    ? `comment:${entry.comment.id}`
    : `activity:${entry.activity.id}`;
}

function timelineEntryTime(entry: TeamHubWorkItemTimelineEntry) {
  return entry.type === "comment"
    ? entry.comment.created_at
    : entry.activity.occurred_at;
}

function timelineEntryLabel(entry: TeamHubWorkItemTimelineEntry) {
  if (entry.type === "comment") {
    return `${entry.comment.author.display_name} commented`;
  }
  const { activity } = entry;
  return `${activity.actor.display_name} ${activityAction(activity)}`;
}

function activityAction(
  activity: Extract<
    TeamHubWorkItemTimelineEntry,
    { type: "activity" }
  >["activity"],
) {
  switch (activity.kind) {
    case "created":
      return "created the item";
    case "metadata_updated":
      return "updated the item";
    case "state_transitioned":
      return activity.to_state
        ? `moved the item to ${workItemStateLabels[activity.to_state]}`
        : "changed the item state";
    case "archived":
      return "archived the item";
    case "unarchived":
      return "unarchived the item";
    case "assignment_added":
      return "added an assignee";
    case "assignment_removed":
      return "removed an assignee";
    case "access_grant_added":
      return "granted access";
    case "access_grant_removed":
      return "revoked access";
    case "comment_edited":
      return "edited a comment";
    case "comment_deleted":
      return "deleted a comment";
    case "work_room_created":
      return "created the work Room";
    case "execution_control_requested":
      return "requested an execution change";
    case "task_recovery_decision":
      return "made a recovery decision";
    case "mandate_recorded":
      return "recorded a mandate";
  }
}
