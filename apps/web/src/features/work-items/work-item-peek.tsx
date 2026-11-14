import {
  Cancel01Icon,
  Copy01Icon,
  Note01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";

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
import { dateTimeFormat } from "@/lib/date-format";

import { WorkItemCommentComposer } from "./work-item-comment-composer";
import { WorkItemCopyStatus } from "./work-item-copy-status";
import { WORK_ITEM_TITLE_LIMIT } from "./work-item-create-draft";
import { currentDashboardActorId } from "./work-item-dashboard-filters";
import {
  workItemPriorities,
  workItemPriorityLabel,
  workItemStateLabel,
  workItemStateLabels,
} from "./work-item-labels";
import {
  tenantWorkItemCommentsQueryOptions,
  tenantWorkItemTargetQueryOptions,
  tenantWorkItemTimelineQueryOptions,
  useAssignWorkItem,
  useUnassignWorkItem,
  useUpdateWorkItem,
  useWorkItemTransition,
} from "./work-item-queries";
import { dashboardWorkItemPath } from "./work-item-routes";
import { WorkItemShareAction } from "./work-item-share-action";
import { useWorkItemCopy, type WorkItemCopyState } from "./use-work-item-copy";

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
  const identity = useQuery(teamHubIdentityQueryOptions(client));
  const currentActorId = identity.data
    ? currentDashboardActorId(identity.data, tenantId)
    : undefined;
  const item = target.data ?? workItem;
  const [editing, setEditing] = useState(false);
  // The row and the control read the same list, so they cannot disagree about
  // whether this Actor is an assignee.
  const assignedToMe =
    currentActorId !== undefined &&
    item.assignees.some(({ actor }) => actor.id === currentActorId);
  const assignmentPending = assign.isPending || unassign.isPending;
  const assignmentError = assign.error ?? unassign.error;
  function toggleAssignment() {
    if (!currentActorId || assignmentPending) return;
    if (assignedToMe) {
      assign.reset();
      unassign.mutate(currentActorId);
    } else {
      unassign.reset();
      assign.mutate(currentActorId);
    }
  }
  // Comments arrive oldest first; the peek reads as a conversation, newest on top.
  const recentComments = (comments.data ?? [])
    .filter((comment) => !comment.deleted_at)
    .slice(-commentLimit)
    .reverse();
  const recentTimeline = (timeline.data ?? []).slice(-timelineLimit);
  const transitions = allowedTransitions(item);

  return (
    <ModalDialog
      className="work-item-peek"
      closeOnBackdrop
      description={`${item.kind === "issue" ? "Issue" : "Task"} #${item.number}`}
      footer={
        <>
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
                onClose();
              }
            }}
            to={{
              pathname: dashboardWorkItemPath(tenantId, item.id),
              search,
            }}
          >
            Open full page
          </Link>
          {transitions.map((option) => (
            <Button
              disabled={transition.isPending}
              key={option.state}
              onClick={() =>
                transition.mutate({
                  expectedVersion: item.version,
                  resolution: option.resolution,
                  state: option.state,
                })
              }
              size="compact"
              tone={option.state === "resolved" ? "primary" : "secondary"}
            >
              {option.label}
            </Button>
          ))}
        </>
      }
      headerActions={
        <>
          <PeekCopyMarkdown tenantId={tenantId} workItem={item} />
          <PeekCopyLink tenantId={tenantId} workItem={item} />
          <WorkItemShareAction item={item} tenantId={tenantId} />
        </>
      }
      onClose={onClose}
      title={item.title}
    >
      <div className="space-y-5 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-app-selected px-2 py-0.5 font-medium text-app-ink">
            {workItemStateLabel(item)}
          </span>
          <span className="rounded-full border border-app-border-strong px-2 py-0.5 capitalize text-app-body">
            {item.priority}
          </span>
          <span className="text-app-muted">
            Updated {peekDateFormatter.format(new Date(item.updated_at))}
          </span>
        </div>

        {editing ? (
          <WorkItemEditForm
            item={item}
            onDone={() => setEditing(false)}
            tenantId={tenantId}
          />
        ) : (
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6 text-app-body">
              {item.description || "No description."}
            </p>
            <Button
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
                  <span className="text-app-ink">{actor.display_name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-app-muted">Unassigned</p>
          )}
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
          {assignmentError ? (
            <p className="text-xs text-app-danger" role="alert">
              {updateFailureMessage(assignmentError)}
            </p>
          ) : null}
        </section>

        <section aria-label="Recent comments" className="space-y-2">
          <h3 className="text-xs font-medium text-app-muted">
            Recent comments
          </h3>
          {comments.isPending ? (
            <p className="text-xs text-app-muted">Loading comments…</p>
          ) : null}
          {comments.isError ? (
            <p className="text-xs text-app-danger" role="alert">
              Comments could not be loaded.
            </p>
          ) : null}
          {comments.isSuccess && !recentComments.length ? (
            <p className="text-sm text-app-muted">No comments yet.</p>
          ) : null}
          <ul className="space-y-3">
            {recentComments.map((comment) => (
              <CommentEntry comment={comment} key={comment.id} />
            ))}
          </ul>
        </section>

        <WorkItemCommentComposer tenantId={tenantId} workItemId={workItem.id} />

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
          {timeline.isSuccess && !recentTimeline.length ? (
            <p className="text-sm text-app-muted">No activity yet.</p>
          ) : null}
          <ol className="space-y-2">
            {recentTimeline.map((entry) => (
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
  icon,
  label,
  onCopy,
  state,
}: {
  copiedLabel?: string;
  icon: IconSvgElement;
  label: string;
  onCopy: () => void;
  state: WorkItemCopyState;
}) {
  return (
    <span className="relative inline-flex">
      <button
        aria-label={label}
        className="app-dialog-close"
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
 * Inline editing for the facts a Human can change from the peek. Saves are
 * checked against the revision the form opened with, so a change made
 * elsewhere conflicts instead of being overwritten. Title and description
 * submit trimmed, as the create dialog stores them.
 */
function WorkItemEditForm({
  item,
  onDone,
  tenantId,
}: {
  item: TeamHubWorkItem;
  onDone: () => void;
  tenantId: string;
}) {
  const update = useUpdateWorkItem(tenantId, item.id);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [baseline] = useState(item);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [priority, setPriority] = useState(item.priority);

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || update.isPending) return;
    // An edit that ends where it started has nothing to send.
    if (!Object.keys(changes).length) {
      onDone();
      return;
    }
    update.mutate(
      { ...changes, expectedVersion: baseline.version },
      { onSuccess: onDone },
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
          onClick={onDone}
          size="compact"
          tone="secondary"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A failed write says what TeamHub said, or that the Item could not change. */
function updateFailureMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The Work Item could not be updated.";
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
      ];
    case "in_progress":
      return [
        { label: "Move to Todo", state: "open" },
        { label: "Resolve", resolution: "completed", state: "resolved" },
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
