import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { LibrarySubpageShell } from "@/features/library/library-subpage-shell";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { tenantRoomsQueryOptions } from "@/features/rooms/room-queries";
import { createTeamHubIdempotencyKey } from "@/features/teamhub/teamhub-client";
import { idempotencyHeader, teamHubData } from "@/features/teamhub/teamhub-api";
import { createTeamHubMessageContent } from "@/features/teamhub/teamhub-message-content";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import {
  carryRoomTitle,
  decisionMessage,
  meetingDecisions,
  roomsThatCanReceive,
} from "./carry-decision";
import { useMeetings } from "./memory-queries";
import { memorySubpagesMessages as m } from "./memory-subpages.messages";
import { meetingPath } from "./meeting-routes";
import { formatMeetingWhen, meetingWhen } from "./meetings-calendar";

/** Posts one meeting decision into a room. The meeting itself stays as it is. */
export function CarryDecisionPage() {
  const { client } = useTeamHubRuntime();
  const t = useT();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const entryId = useSearchParams()[0].get("entry");
  const meetings = useMeetings(tenantId);
  const rooms = useQuery(tenantRoomsQueryOptions(client, tenantId));
  const listed = meetings.data?.find((entry) => entry.id === entryId);
  const selected = useQuery({
    enabled: listed !== undefined,
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/memory/{entryId}", {
          params: { path: { tenantId, entryId: listed?.id ?? "" } },
        }),
      ),
    queryKey: ["teamhub", tenantId, "personal-memory", listed?.id, "carry"],
  });
  const entry = selected.data ?? listed;
  const decisions = meetingDecisions(entry?.content ?? "");
  const destinations = roomsThatCanReceive(rooms.data?.items ?? []);
  const when = entry ? meetingWhen(entry.path) : undefined;
  const meetingLabel = when
    ? t(m.meetingHeading, { when: formatMeetingWhen(when.date, when.time) })
    : (entry?.title ?? t(m.thisMeetingFallback));
  const [decisionId, setDecisionId] = useState<string>();
  const [roomId, setRoomId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [sentRoomId, setSentRoomId] = useState<string>();
  const decision =
    decisions.find((item) => item.id === (decisionId ?? decisions[0]?.id)) ??
    decisions[0];
  const room =
    destinations.find((item) => item.id === (roomId ?? destinations[0]?.id)) ??
    destinations[0];
  const sentRoom = destinations.find((item) => item.id === sentRoomId);
  const loading =
    meetings.isPending ||
    rooms.isPending ||
    (listed !== undefined && selected.isPending && !entry?.content);
  const missing = !loading && (!entryId || !entry);

  async function send() {
    if (!decision || !room || pending) return;
    setPending(true);
    setError(false);
    try {
      await teamHubData(
        client.api.POST("/v0/rooms/{roomId}/messages", {
          params: {
            path: { roomId: room.id },
            header: idempotencyHeader(createTeamHubIdempotencyKey()),
          },
          body: createTeamHubMessageContent({
            files: [],
            mentions: [],
            text: decisionMessage(meetingLabel, decision.text),
          }),
        }),
      );
      setSentRoomId(room.id);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <LibrarySubpageShell
      backLabel={t(m.backToMeeting)}
      backTo={
        entry
          ? meetingPath(tenantId, entry.id)
          : `/t/${encodeURIComponent(tenantId)}/library?tab=meetings`
      }
      subtitle={t(m.carrySubtitle, { meeting: meetingLabel })}
      title={t(m.carryTitle)}
    >
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.loadingMeeting)}
        </p>
      ) : missing ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.meetingCouldNotOpen)}
        </p>
      ) : sentRoom ? (
        <p className="text-sm text-foreground" role="status">
          {t(m.sentToRoom, { room: carryRoomTitle(sentRoom) })}
        </p>
      ) : decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.noDecisionToCarry)}
        </p>
      ) : destinations.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(m.noRoomToReceive)}
        </p>
      ) : (
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground">
              {t(m.whichDecision)}
            </legend>
            {decisions.map((item) => (
              <label
                className="flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                key={item.id}
              >
                <input
                  checked={item.id === decision?.id}
                  className="mt-1"
                  name="decision"
                  onChange={() => setDecisionId(item.id)}
                  type="radio"
                  value={item.id}
                />
                <span>{item.text}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground">
              {t(m.whichRoom)}
            </legend>
            {destinations.map((item) => (
              <label
                className="flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                key={item.id}
              >
                <input
                  checked={item.id === room?.id}
                  className="mt-1"
                  name="room"
                  onChange={() => setRoomId(item.id)}
                  type="radio"
                  value={item.id}
                />
                <span>{carryRoomTitle(item)}</span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {t(m.roomDidNotReceive)}
            </p>
          ) : null}
          <Button data-voice-risk="never" disabled={pending} type="submit">
            {pending ? t(m.sending) : t(m.sendItThere)}
          </Button>
        </form>
      )}
      {sentRoom ? (
        <Link
          className="w-fit text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(sentRoom.id)}/chat`}
        >
          {t(m.openRoom, { room: carryRoomTitle(sentRoom) })}
        </Link>
      ) : null}
    </LibrarySubpageShell>
  );
}
