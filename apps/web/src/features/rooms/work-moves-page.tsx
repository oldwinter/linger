import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";
import { requireRoomRouteParam } from "./room-route-params";
import { roomTeamMdQueryOptions } from "./task-sidebar/team-md-query";
import {
  patternAccounts,
  patternTitle,
  workMoves,
  workMoveText,
} from "./work-moves";

/**
 * The room's team.md as a sequence. The query is the one a published team.md
 * refreshes, so a new protocol replaces this page while it is open.
 */
export function WorkMovesPage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const roomId = requireRoomRouteParam(params.roomId, "Room");
  const headingId = useId();
  const protocol = useQuery(roomTeamMdQueryOptions(client, tenantId, roomId));
  const document = protocol.data;
  const steps = document ? workMoves(document) : [];
  const chat = `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(roomId)}/chat`;

  return (
    <section
      aria-labelledby={headingId}
      className="min-h-0 flex-1 overflow-y-auto bg-app-surface px-5 py-7"
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <Link
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to={chat}
          >
            <Icon icon={ArrowLeft01Icon} size={14} />
            Back to room
          </Link>
        </div>
        <header>
          <h2 className="text-xl text-foreground" id={headingId}>
            How work moves
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The path an agent published for this room. A newer team.md replaces
            it here.
          </p>
        </header>
        {protocol.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading how work moves.
          </p>
        ) : protocol.isError ? (
          <div className="flex items-center justify-between gap-3" role="alert">
            <p className="text-sm text-destructive">
              How work moves could not be loaded.
            </p>
            <Button
              onClick={() => void protocol.refetch()}
              size="compact"
              tone="secondary"
              type="button"
            >
              Retry
            </Button>
          </div>
        ) : !document ? (
          <p className="text-sm text-muted-foreground" role="status">
            No collaboration plan yet. When an agent publishes one, the path
            shows up here.
          </p>
        ) : (
          <>
            <section aria-labelledby="work-moves-pattern">
              <h3 className="text-lg text-foreground" id="work-moves-pattern">
                {t(patternTitle(document.collaborate_pattern))}
              </h3>
              <p className="mt-2 text-sm text-foreground">
                {patternAccounts[document.collaborate_pattern]}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                {document.task_goal}
              </p>
            </section>
            <ol aria-label="Work path" className="flex flex-col gap-3">
              {steps.map((step, index) => (
                <li
                  className="rounded-2xl border border-border px-4 py-3"
                  key={`${step.kind}-${step.who}-${step.other ?? ""}-${index}`}
                >
                  <p className="text-sm text-foreground">
                    {workMoveText(step)}
                  </p>
                  {step.role ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {step.role}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
