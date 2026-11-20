import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Select, SelectItem } from "@/components/ui/select";
import { teamHubData, teamHubDone } from "@/features/teamhub/teamhub-api";
import { type TeamHubClient } from "@/features/teamhub/teamhub-client";
import type {
  TeamHubActorRef,
  TeamHubScheduledRoutine,
} from "@/features/teamhub/teamhub-types";

import {
  WEEKDAYS,
  cadenceFromDraft,
  cadenceLabel,
  draftFromRoutine,
  emptyRoutineDraft,
  formatWhen,
  type RoutineDraft,
} from "./routine-cadence";
import { RoutineTimeField } from "./routine-time-field";

type When =
  | "today"
  | "tomorrow"
  | "date"
  | "daily"
  | "weekdays"
  | "weekly"
  | "hours";
type OnceMode = "today" | "tomorrow" | "date";

const WHENS: [When, string][] = [
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["date", "Pick a date"],
  ["daily", "Every day"],
  ["weekdays", "Weekdays"],
  ["weekly", "Every week"],
  ["hours", "Every few hours"],
];
const MON_FRI = WEEKDAYS.slice(0, 5);
const QUICK_TIMES = [
  ["08:00", "8 AM"],
  ["09:00", "9 AM"],
  ["12:00", "12 PM"],
  ["18:00", "6 PM"],
] as const;
const INTERVALS = [1, 2, 3, 4, 6, 12];

function localDay(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function whenOf(draft: RoutineDraft, onceMode: OnceMode): When {
  if (draft.kind === "once") return onceMode;
  if (draft.kind === "every_n_hours") return "hours";
  if (draft.kind === "daily") return "daily";
  return draft.weekdays.length === 5 &&
    MON_FRI.every((day) => draft.weekdays.includes(day))
    ? "weekdays"
    : "weekly";
}

/** A once Routine keeps its clock in `time` and its day in `runAt`. */
function initialDraft(routine?: TeamHubScheduledRoutine): RoutineDraft {
  const draft = routine ? draftFromRoutine(routine) : emptyRoutineDraft();
  return draft.kind === "once" && draft.runAt
    ? { ...draft, time: draft.runAt.slice(11, 16) }
    : draft;
}

/** An unnamed Routine takes the first line of its instruction as its name. */
function routineName(draft: RoutineDraft) {
  return draft.instruction.trim().split("\n")[0]!.slice(0, 60).trim();
}

/** Deletes a scheduled Routine at its current revision. */
export function deleteRoomRoutine(
  client: TeamHubClient,
  routine: Pick<TeamHubScheduledRoutine, "id" | "revision">,
) {
  return teamHubDone(
    client.api.DELETE("/v0/routines/{routineId}", {
      params: {
        path: { routineId: routine.id },
        query: { expected_revision: routine.revision },
      },
    }),
  );
}

export function RoutineDialog({
  agentScoped = false,
  client,
  mentionActorId,
  mentionOptions,
  onClose,
  onSaved,
  roomId,
  routine,
}: {
  agentScoped?: boolean;
  client: TeamHubClient;
  /** The Agent a new Routine wakes; an existing one keeps its own. */
  mentionActorId?: string;
  mentionOptions: TeamHubActorRef[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  roomId: string;
  routine?: TeamHubScheduledRoutine;
}) {
  const [initial] = useState<RoutineDraft>(() => initialDraft(routine));
  const [draft, setDraft] = useState<RoutineDraft>(() => initial);
  const [name, setName] = useState(routine?.name ?? "");
  const [mention, setMention] = useState(
    routine ? (routine.mention_actor_id ?? "") : (mentionActorId ?? ""),
  );
  const formId = useId();
  const runNowHintId = useId();
  const [onceMode, setOnceMode] = useState<OnceMode>(
    routine ? "date" : "tomorrow",
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (fallback: string) => (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : fallback);

  const pastOnceTime =
    draft.kind === "once" &&
    Boolean(draft.runAt) &&
    !Number.isNaN(new Date(draft.runAt).getTime()) &&
    new Date(draft.runAt).getTime() <= Date.now();
  const pastTimeHint = pastOnceTime
    ? draft.runAt.slice(0, 10) === localDay(0)
      ? "That time has already passed today. Choose a later time or another day."
      : "That date and time has already passed. Choose a future time."
    : null;

  const save = useMutation({
    mutationFn: async () => {
      const cadence = cadenceFromDraft(draft);
      if (
        cadence.kind === "once" &&
        Date.parse(cadence.run_at ?? "") <= Date.now()
      ) {
        throw new Error(
          pastTimeHint ?? "Choose a future time for a one-time routine.",
        );
      }
      const nextName = name.trim() || routineName(draft);
      if (!draft.instruction.trim())
        throw new Error("Say what the Routine should do.");
      if (routine) {
        await teamHubData(
          client.api.PATCH("/v0/routines/{routineId}", {
            params: { path: { routineId: routine.id } },
            body: {
              expected_revision: routine.revision,
              name: nextName,
              instruction: draft.instruction.trim(),
              cadence,
              mention_actor_id: mention || null,
              enabled: routine.enabled,
            },
          }),
        );
        return;
      }
      await teamHubData(
        client.api.POST("/v0/rooms/{roomId}/routines", {
          params: { path: { roomId } },
          body: {
            name: nextName,
            instruction: draft.instruction.trim(),
            cadence,
            mention_actor_id: mention || undefined,
          },
        }),
      );
    },
    onSuccess: onSaved,
    onError: fail("Could not save routine."),
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (!routine) return;
      await deleteRoomRoutine(client, routine);
    },
    onSuccess: onSaved,
    onError: (cause) => {
      setConfirmingDelete(false);
      fail("Could not delete routine.")(cause);
    },
  });
  const runNow = useMutation({
    mutationFn: async () => {
      if (!routine) return;
      await teamHubData(
        client.api.POST("/v0/routines/{routineId}/run", {
          params: { path: { routineId: routine.id } },
        }),
      );
    },
    onSuccess: onSaved,
    onError: fail("Could not run routine."),
  });
  const busy = save.isPending || remove.isPending || runNow.isPending;

  function update(patch: Partial<RoutineDraft>) {
    if (!busy) {
      setConfirmingDelete(false);
      setError(null);
      setDraft((current) => ({ ...current, ...patch }));
    }
  }

  function requestClose() {
    if (!busy) onClose();
  }

  const cadence = (() => {
    try {
      return cadenceFromDraft(draft);
    } catch {
      return null;
    }
  })();
  const isDirty = Boolean(
    routine &&
    (JSON.stringify(initial) !== JSON.stringify(draft) ||
      name !== routine.name ||
      mention !== (routine.mention_actor_id ?? "")),
  );
  const unchanged = Boolean(routine && !isDirty);
  const nextRun =
    unchanged && routine?.enabled && routine.next_run_at
      ? `Next ${formatWhen(routine.next_run_at)}`
      : "";

  return (
    <ModalDialog
      closeOnBackdrop
      footer={
        <>
          {routine ? (
            confirmingDelete ? (
              <div
                aria-label="Confirm routine deletion"
                className="mr-auto flex items-center gap-1.5"
                role="group"
              >
                <span className="text-xs font-medium text-foreground">
                  Delete?
                </span>
                <Button
                  aria-label="Confirm delete routine"
                  disabled={busy}
                  loading={remove.isPending}
                  onClick={() => {
                    if (busy) return;
                    setError(null);
                    remove.mutate();
                  }}
                  size="compact"
                  tone="danger"
                  type="button"
                >
                  {remove.isPending ? "Deleting…" : "Confirm delete"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setConfirmingDelete(false)}
                  size="compact"
                  tone="ghost"
                  type="button"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                className="mr-auto text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  setError(null);
                  setConfirmingDelete(true);
                }}
                tone="ghost"
                type="button"
              >
                Delete
              </Button>
            )
          ) : null}
          {routine ? (
            <Button
              aria-describedby={isDirty ? runNowHintId : undefined}
              disabled={busy || isDirty}
              loading={runNow.isPending}
              onClick={() => {
                if (busy || isDirty) return;
                setError(null);
                runNow.mutate();
              }}
              title={isDirty ? "Save changes before running now" : undefined}
              type="button"
            >
              {runNow.isPending ? "Running…" : "Run now"}
            </Button>
          ) : null}
          <Button
            disabled={busy}
            form={formId}
            loading={save.isPending}
            tone="primary"
            type="submit"
          >
            {save.isPending
              ? routine
                ? "Saving…"
                : "Creating…"
              : routine
                ? "Save"
                : "Create"}
          </Button>
        </>
      }
      onClose={requestClose}
      size="md"
      title={routine ? "Edit routine" : "New routine"}
    >
      <form
        aria-busy={busy || undefined}
        className="px-5 py-4"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setError(null);
          save.mutate();
        }}
      >
        <fieldset className="flex min-w-0 flex-col gap-4" disabled={busy}>
          <div>
            <span className="block text-xs font-medium text-foreground">
              When
            </span>
            <WhenEditor
              disabled={busy}
              draft={draft}
              onOnceMode={setOnceMode}
              onceMode={onceMode}
              update={update}
            />
            <p className="mt-2 truncate text-xs tabular-nums text-muted-foreground">
              {cadence ? cadenceLabel(cadence) : "Choose a time"}
              {cadence && nextRun ? ` · ${nextRun}` : ""}
            </p>
            {pastTimeHint ? (
              <p className="mt-1 text-xs text-app-warning">{pastTimeHint}</p>
            ) : null}
          </div>
          <label className="block text-xs font-medium text-foreground">
            Instruction
            <textarea
              className={`${FIELD} mt-1 min-h-28 w-full py-2 leading-relaxed`}
              onChange={(event) => update({ instruction: event.target.value })}
              placeholder="What should it do then?"
              required
              value={draft.instruction}
            />
          </label>
          {!agentScoped ? (
            <label className="block text-xs font-medium text-foreground">
              Name (optional)
              <input
                className={`${FIELD} mt-1 h-9 w-full`}
                maxLength={120}
                onChange={(event) => {
                  setConfirmingDelete(false);
                  setName(event.target.value);
                }}
                value={name}
              />
            </label>
          ) : null}
          {!agentScoped && (mentionOptions.length > 0 || mention) ? (
            <label className="block text-xs font-medium text-foreground">
              Mention
              <Select
                aria-label="Mention"
                className="mt-1 w-full font-normal"
                disabled={busy || (!routine && Boolean(mentionActorId))}
                onValueChange={(value) => {
                  if (!busy) {
                    setConfirmingDelete(false);
                    setMention(value);
                  }
                }}
                value={mention}
              >
                <SelectItem value="">None</SelectItem>
                {mentionOptions.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.display_name}
                  </SelectItem>
                ))}
                {mention &&
                !mentionOptions.some((agent) => agent.id === mention) ? (
                  <SelectItem value={mention}>Current Agent</SelectItem>
                ) : null}
              </Select>
            </label>
          ) : null}
          {isDirty ? (
            <p className="text-xs text-muted-foreground" id={runNowHintId}>
              Save changes before running now.
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
      </form>
    </ModalDialog>
  );
}

const FIELD =
  "rounded-md border border-input bg-card px-3 text-sm font-normal text-foreground transition-colors duration-150 placeholder:text-app-placeholder hover:border-border-hover focus:border-foreground focus:outline-none focus:ring-2 focus:ring-ring";

function WhenEditor({
  disabled,
  draft,
  onOnceMode,
  onceMode,
  update,
}: {
  disabled: boolean;
  draft: RoutineDraft;
  onOnceMode: (onceMode: OnceMode) => void;
  onceMode: OnceMode;
  update: (patch: Partial<RoutineDraft>) => void;
}) {
  const when = whenOf(draft, onceMode);
  const day = draft.runAt.slice(0, 10) || localDay(0);
  const setTime = (time: string) =>
    update(
      draft.kind === "once" ? { time, runAt: `${day}T${time}` } : { time },
    );

  function choose(next: When) {
    if (next === "today" || next === "tomorrow" || next === "date") {
      onOnceMode(next);
      const nextDay =
        next === "today"
          ? localDay(0)
          : next === "tomorrow"
            ? localDay(1)
            : day;
      update({
        kind: "once",
        runAt: `${nextDay}T${draft.time}`,
      });
    } else if (next === "daily") update({ kind: "daily" });
    else if (next === "weekdays")
      update({ kind: "weekly", weekdays: [...MON_FRI] });
    else if (next === "weekly")
      update({
        kind: "weekly",
        weekdays:
          when === "weekly"
            ? draft.weekdays
            : [WEEKDAYS[(new Date().getDay() + 6) % 7]!],
      });
    else
      update({
        kind: "every_n_hours",
        intervalHours: Math.max(draft.intervalHours, 2),
      });
  }

  return (
    <div className="mt-1 flex flex-col gap-2.5">
      <Select
        aria-label="When"
        className="w-full font-normal"
        disabled={disabled}
        onValueChange={(value) => {
          if (!disabled) choose(value as When);
        }}
        value={when}
      >
        {WHENS.map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </Select>
      {draft.kind === "weekly" ? (
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Weekdays</legend>
          {WEEKDAYS.map((weekday) => (
            <label className="cursor-pointer" key={weekday}>
              <input
                aria-label={weekday[0]!.toUpperCase() + weekday.slice(1)}
                checked={draft.weekdays.includes(weekday)}
                className="sr-only"
                onChange={(event) =>
                  update({
                    weekdays: event.target.checked
                      ? [...draft.weekdays, weekday]
                      : draft.weekdays.filter(
                          (selected) => selected !== weekday,
                        ),
                  })
                }
                type="checkbox"
              />
              <span className="select-pill w-11 justify-center px-0">
                {weekday[0]!.toUpperCase() + weekday.slice(1, 3)}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {draft.kind === "every_n_hours" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Every</span>
          {[...new Set([...INTERVALS, draft.intervalHours])]
            .sort((left, right) => left - right)
            .map((hours) => (
              <button
                aria-pressed={draft.intervalHours === hours}
                className="select-pill"
                key={hours}
                onClick={() => update({ intervalHours: hours })}
                type="button"
              >
                {hours}h
              </button>
            ))}
        </div>
      ) : (
        <>
          {when === "date" ? (
            <input
              aria-label="Date"
              className="ui-field-control h-9 w-44 text-sm text-foreground"
              min={localDay()}
              onChange={(event) =>
                event.target.value &&
                update({ runAt: `${event.target.value}T${draft.time}` })
              }
              required
              type="date"
              value={day}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="w-32 [&>div]:mt-0">
              <RoutineTimeField onChange={setTime} value={draft.time} />
            </div>
            {QUICK_TIMES.map(([time, label]) => (
              <button
                aria-pressed={draft.time === time}
                className="select-pill"
                key={time}
                onClick={() => setTime(time)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
