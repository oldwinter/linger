import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import {
  computerPermissionActionLabel,
  computerPermissionNames,
  computerPermissionStates,
  computerSubjectNames,
  nextComputerPermissionStep,
} from "./computer-can-do";
import {
  actOnComputerPermission,
  type ComputerPermissionAction,
  computerPermissionsQueryKey,
  computerPermissionsQueryOptions,
} from "./computer-permissions-api";
import { localComputersQueryOptions } from "./local-computer-queries";

/** The owner asks macOS what this computer may do, then relaunches when a grant needs it. */
export function ComputerCanDoPage() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const computerId = requireRoomRouteParam(useParams().computerId, "Computer");
  const computers = useQuery(localComputersQueryOptions(client, tenantId));
  const permissions = useQuery(
    computerPermissionsQueryOptions(client, tenantId, computerId, true),
  );
  const computer = computers.data?.items.find(
    (item) => item.computer_id === computerId,
  );
  const act = useMutation({
    mutationFn: (action: ComputerPermissionAction) =>
      actOnComputerPermission(client, tenantId, computerId, action),
    onSuccess: (status) => {
      queryClient.setQueryData(
        computerPermissionsQueryKey(tenantId, computerId),
        status,
      );
    },
  });
  const name = computer?.display_name ?? "this computer";

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-6 pb-4">
      <header>
        <h1 className="text-2xl text-foreground">{`What ${name} can do`}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Screen Recording and Accessibility are granted on the Mac. A new grant
          applies after Linger relaunches.
        </p>
      </header>
      {permissions.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Checking permissions.
        </p>
      ) : permissions.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Permissions could not be read.
        </p>
      ) : permissions.data.subjects.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          This computer does not use macOS privacy permissions.
        </p>
      ) : (
        permissions.data.subjects.map((subject) => (
          <section
            aria-label={computerSubjectNames[subject.subject]}
            className="flex flex-col gap-3"
            key={subject.subject}
          >
            <h2 className="text-sm text-foreground">
              {computerSubjectNames[subject.subject]}
            </h2>
            <ul className="flex flex-col gap-2">
              {subject.permissions.map((entry) => {
                const step = nextComputerPermissionStep(subject.subject, entry);
                return (
                  <li
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
                    key={entry.id}
                  >
                    <span className="text-sm text-foreground">
                      {computerPermissionNames[entry.id]}
                      <span className="mt-1 block text-muted-foreground">
                        {computerPermissionStates[entry.state]}
                      </span>
                    </span>
                    {step ? (
                      <Button
                        disabled={act.isPending}
                        onClick={() => act.mutate(step)}
                        type="button"
                      >
                        {computerPermissionActionLabel(step)}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {act.isError ? (
        <p className="text-sm text-destructive" role="alert">
          That step did not go through.
        </p>
      ) : null}
      <Link
        className="text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        to={`/t/${encodeURIComponent(tenantId)}/settings/computers?computer=${encodeURIComponent(computerId)}`}
      >
        Back to the computer
      </Link>
    </div>
  );
}
