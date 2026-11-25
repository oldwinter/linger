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
import { commonMessages } from "@/i18n/common.messages";
import { translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";
import { useT } from "@/i18n/use-translation";

import {
  WEEKDAYS,
  cadenceFromDraft,
  cadenceLabel,
  draftFromRoutine,
  emptyRoutineDraft,
  formatHour,
  formatWhen,
  type RoutineDraft,
  weekdayName,
} from "./routine-cadence";
import { RoutineTimeField } from "./routine-time-field";
import { routinesMessages as m } from "./routines.messages";

type When =
  | "today"
  | "tomorrow"
  | "date"
  | "daily"
  | "weekdays"
  | "weekly"
  | "hours";
type OnceMode = "today" | "tomorrow" | "date";

const WHENS: [When, Message<string>][] = [
  ["today", m.today],
  ["tomorrow", m.whenTomorrow],
  ["date", m.whenDate],
  ["daily", m.whenDaily],
  ["weekdays", m.whenWeekdays],
  ["weekly", m.whenWeekly],
  ["hours", m.whenHours],
];
const MON_FRI = WEEKDAYS.slice(0, 5);
const QUICK_HOURS = [8, 9, 12, 18];
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
  const t = useT();
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
  const fail = (fallback: Message<string>) => (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : translate(fallback));

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
        throw new Error(translate(m.instructionRequired));
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
    onError: fail(m.saveFailed),
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (!routine) return;
      await deleteRoomRoutine(client, routine);
    },
    onSuccess: onSaved,
    onError: (cause) => {
      setConfirmingDelete(false);
      fail(m.deleteFailed)(cause);
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
    onError: fail(m.runFailed),
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
      ? formatWhen(routine.next_run_at)
      : "";
  const schedule = cadence ? cadenceLabel(cadence, t) : t(m.chooseTime);

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
                  data-voice-risk="never"
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
                  {t(commonMessages.cancel)}
                </Button>
              </div>
            ) : (
              <Button
                className="mr-auto text-destructive hover:text-destructive"
                data-voice-risk="never"
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  setError(null);
                  setConfirmingDelete(true);
                }}
                tone="ghost"
                type="button"
              >
                {t(commonMessages.delete)}
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
              {runNow.isPending ? "Running…" : t(m.runNow)}
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
                ? t(commonMessages.save)
                : t(m.create)}
          </Button>
        </>
      }
      onClose={requestClose}
      size="md"
      title={routine ? t(m.editRoutine) : t(m.newRoutine)}
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
              {t(m.when)}
            </span>
            <WhenEditor
              disabled={busy}
              draft={draft}
              onOnceMode={setOnceMode}
              onceMode={onceMode}
              update={update}
            />
            <p className="mt-2 truncate text-xs tabular-nums text-muted-foreground">
              {cadence && nextRun
                ? t(m.summaryWithNext, { cadence: schedule, when: nextRun })
                : schedule}
            </p>
            {pastTimeHint ? (
              <p className="mt-1 text-xs text-app-warning">{pastTimeHint}</p>
            ) : null}
          </div>
          <label className="block text-xs font-medium text-foreground">
            {t(m.instruction)}
            <textarea
              className={`${FIELD} mt-1 min-h-28 w-full py-2 leading-relaxed`}
              onChange={(event) => update({ instruction: event.target.value })}
              placeholder={t(m.instructionPlaceholder)}
              required
              value={draft.instruction}
            />
          </label>
          {!agentScoped ? (
            <label className="block text-xs font-medium text-foreground">
              {t(m.nameOptional)}
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
            <div className="block text-xs font-medium text-foreground">
              {t(m.mention)}
              <Select
                aria-label={t(m.mention)}
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
                <SelectItem value="">{t(m.mentionNone)}</SelectItem>
                {mentionOptions.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.display_name}
                  </SelectItem>
                ))}
                {mention &&
                !mentionOptions.some((agent) => agent.id === mention) ? (
                  <SelectItem value={mention}>{t(m.currentAgent)}</SelectItem>
                ) : null}
              </Select>
            </div>
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
  const t = useT();
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
        aria-label={t(m.when)}
        className="w-full font-normal"
        disabled={disabled}
        onValueChange={(value) => {
          if (!disabled) choose(value as When);
        }}
        value={when}
      >
        {WHENS.map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {t(label)}
          </SelectItem>
        ))}
      </Select>
      {draft.kind === "weekly" ? (
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">{t(m.weekdays)}</legend>
          {WEEKDAYS.map((weekday) => (
            <label className="cursor-pointer" key={weekday}>
              <input
                aria-label={weekdayName(weekday, "long")}
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
                {weekdayName(weekday, "short")}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {draft.kind === "every_n_hours" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">
            {t(m.every)}
          </span>
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
                {t(m.hoursShort, { count: hours })}
              </button>
            ))}
        </div>
      ) : (
        <>
          {when === "date" ? (
            <input
              aria-label={t(m.date)}
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
            {QUICK_HOURS.map((hour) => {
              const time = `${String(hour).padStart(2, "0")}:00`;
              return (
                <button
                  aria-pressed={draft.time === time}
                  className="select-pill"
                  key={time}
                  onClick={() => setTime(time)}
                  type="button"
                >
                  {formatHour(hour)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
