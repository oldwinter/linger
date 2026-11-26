import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { useMeetings } from "@/features/memory/memory-queries";
import { meetingPath } from "@/features/memory/meeting-routes";
import { anotherMeQueryOptions } from "@/features/rooms/room-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { commonMessages } from "@/i18n/common.messages";
import { useT } from "@/i18n/use-translation";

import {
  defaultReminderLocalValue,
  formatReminderWhen,
  localValueToRunAt,
  meetingReminderLabel,
  meetingTodoTexts,
  reminderInstruction,
  reminderName,
} from "./meeting-reminders";
import { memorySubpagesMessages as m } from "./memory-subpages.messages";

interface TodoRow {
  text: string;
  when: string;
}

/**
 * Turns a meeting's to-dos into one-time reminders in the chat with Another Me.
 * The meeting itself stays read-only.
 */
export function MeetingRemindersPage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const entryId = useSearchParams()[0].get("entry") ?? "";
  const meetings = useMeetings(tenantId);
  const listed = meetings.data?.find((entry) => entry.id === entryId);
  const selected = useQuery({
    enabled: listed !== undefined,
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/memory/{entryId}", {
          params: { path: { tenantId, entryId: listed?.id ?? "" } },
        }),
      ),
    queryKey: ["teamhub", tenantId, "personal-memory", listed?.id],
  });
  const anotherMe = useQuery(anotherMeQueryOptions(client, tenantId));
  const label = listed ? meetingReminderLabel(listed) : t(m.meetingFallback);
  const todos = useMemo(
    () => (selected.data ? meetingTodoTexts(selected.data.content) : []),
    [selected.data],
  );
  const defaults = useMemo(
    () =>
      todos.map((text) => ({
        text,
        when: defaultReminderLocalValue(new Date()),
      })),
    [todos],
  );
  const [rows, setRows] = useState<TodoRow[] | null>(null);
  const [created, setCreated] = useState<number[]>([]);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planned = rows ?? defaults;
  const roomId = anotherMe.data?.room_id;
  const remaining = planned.flatMap((_, index) =>
    created.includes(index) || skipped.includes(index) ? [] : [index],
  );

  const create = async () => {
    if (!roomId || pending) return;
    setError(null);
    const actorId = anotherMe.data?.agent_actor_id;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setPending(true);
    const saved = [...created];
    try {
      for (const index of remaining) {
        const row = planned[index];
        if (!row) continue;
        const runAt = localValueToRunAt(row.when);
        if (!runAt) {
          setError(t(m.chooseTimeError));
          return;
        }
        await teamHubData(
          client.api.POST("/v0/rooms/{roomId}/routines", {
            params: { path: { roomId } },
            body: {
              name: reminderName(row.text),
              instruction: reminderInstruction(label, row.text),
              mention_actor_id: actorId,
              cadence: { kind: "once", timezone, run_at: runAt },
            },
          }),
        );
        saved.push(index);
        setCreated([...saved]);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t(m.createReminderFailed),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <LibrarySubpageShell
      backLabel={t(m.backToMeeting)}
      backTo={meetingPath(tenantId, entryId)}
      subtitle={t(m.remindersSubtitle)}
      title={t(m.remindersTitle)}
    >
      {meetings.isPending || (listed && selected.isPending) ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.loadingMeeting)}
        </p>
      ) : meetings.isError || selected.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">{t(m.meetingLoadFailed)}</p>
          <Button
            onClick={() => {
              if (meetings.isError) void meetings.refetch();
              if (selected.isError) void selected.refetch();
            }}
            size="compact"
            tone="secondary"
          >
            {t(commonMessages.retry)}
          </Button>
        </div>
      ) : !listed ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.meetingNotInLibrary)}
        </p>
      ) : todos.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.noTodosToRemind)}
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <h2 className="text-lg font-medium text-foreground">{label}</h2>
          <ul className="flex flex-col gap-3">
            {planned.map((row, index) => {
              const saved = created.includes(index);
              const leftOut = skipped.includes(index);
              return (
                <li
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-xs"
                  key={`${index}-${row.text}`}
                >
                  <p className="text-sm text-foreground">{row.text}</p>
                  {leftOut ? (
                    <p className="text-sm text-muted-foreground">
                      {t(m.skipped)}
                    </p>
                  ) : saved ? (
                    <p className="text-sm text-muted-foreground">
                      {t(m.reminderSetFor, {
                        when: formatReminderWhen(row.when),
                      })}
                    </p>
                  ) : (
                    <label
                      className="flex flex-col gap-1 text-xs text-muted-foreground"
                      htmlFor={`todo-when-${index}`}
                    >
                      {t(m.remindMe)}
                      <input
                        className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                        id={`todo-when-${index}`}
                        onChange={(event) => {
                          const when = event.target.value;
                          setRows(
                            planned.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, when } : item,
                            ),
                          );
                        }}
                        required
                        type="datetime-local"
                        value={row.when}
                      />
                    </label>
                  )}
                  {saved || leftOut ? null : (
                    <Button
                      aria-label={t(m.skipTodo, { todo: row.text })}
                      onClick={() => setSkipped([...skipped, index])}
                      size="compact"
                      tone="ghost"
                      type="button"
                    >
                      {t(m.skip)}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {roomId ? null : (
            <p className="text-sm text-muted-foreground" role="status">
              {t(m.anotherMeNotSetUp)}
            </p>
          )}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {created.length > 0 && remaining.length === 0 ? (
            <p className="text-sm text-foreground" role="status">
              {t(m.anotherMeWillRemind, { count: created.length })}
            </p>
          ) : null}
          {roomId && remaining.length > 0 ? (
            <Button disabled={pending} type="submit">
              {pending ? t(m.creatingReminders) : t(m.createReminders)}
            </Button>
          ) : null}
        </form>
      )}
    </LibrarySubpageShell>
  );
}
