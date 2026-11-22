import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import {
  tenantRoomsQueryOptions,
  tenantAgentAvailabilityQueryOptions,
  tenantAgentsQueryOptions,
} from "@/features/rooms/room-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData, teamHubDone } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { Add01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";

import { ComputerBrowserConnection } from "./browser-connection/computer-browser-connection";
import { computerCanDoPath } from "./computer-can-do";
import { ComputerDetail } from "./computer-detail";
import { projectAgentAvailabilitySnapshots } from "./agent-availability";
import { ComputerDirectory } from "./computer-directory";
import { useDesktopComputer } from "./desktop-computer";
import { computerTheDesktopOpens } from "./this-computer";
import {
  ConnectComputerDialog,
  NoComputers,
  UnavailableComputer,
} from "./computer-empty-states";
import { computerSetupMessages } from "./computer-setup.messages";
import { computersMessages } from "./computers.messages";
import {
  localComputersQueryKey,
  localComputersQueryOptions,
} from "./local-computer-queries";
import { subscribeLocalComputerEnrollment } from "./local-computer-enrollment-events";
import { RemoveComputerDialog } from "./remove-computer-dialog";

export function ComputersPage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const navigate = useNavigate();
  const openAgent = useMutation({
    mutationFn: async (peerActorId: string) =>
      (
        await teamHubData(
          client.api.POST("/v0/tenants/{tenantId}/direct-rooms", {
            params: { path: { tenantId } },
            body: { peer_actor_id: peerActorId },
          }),
        )
      ).id,
    onSuccess: async (roomId) => {
      await queryClient.invalidateQueries({
        queryKey: tenantRoomsQueryOptions(client, tenantId).queryKey,
      });
      await navigate(`/t/${tenantId}/rooms/${roomId}/chat`, {
        state: { focusComposer: true },
      });
    },
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const [setupOpen, setSetupOpen] = useState(false);
  const [expectedComputerId, setExpectedComputerId] = useState<string | null>(
    null,
  );
  const [knownComputerIds, setKnownComputerIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [removeComputerId, setRemoveComputerId] = useState<string | null>(null);
  const [showingDirectory, setShowingDirectory] = useState(false);
  // Checked in the auto-open effect so a Back click before the passive effect
  // flushes cannot have its directory navigation overwritten by a stale render.
  const showingDirectoryRef = useRef(false);
  const desktop = useDesktopComputer();
  const { data: inventory } = useSuspenseQuery(
    localComputersQueryOptions(client, tenantId),
  );
  const { data: agents } = useSuspenseQuery(
    tenantAgentsQueryOptions(client, tenantId),
  );
  const { data: agentAvailability } = useSuspenseQuery(
    tenantAgentAvailabilityQueryOptions(client, tenantId),
  );
  const agentAvailabilities = projectAgentAvailabilitySnapshots(
    agentAvailability.items,
  );
  const requestedComputerId = searchParams.get("computer");
  const openThisComputer = computerTheDesktopOpens(
    inventory.items.map((computer) => computer.computer_id),
    {
      requestedId: requestedComputerId,
      showingDirectory,
      thisComputerId: desktop?.status?.computerId,
    },
  );
  const selectedComputer = requestedComputerId
    ? inventory.items.find(
        (computer) => computer.computer_id === requestedComputerId,
      )
    : openThisComputer
      ? inventory.items.find(
          (computer) => computer.computer_id === openThisComputer,
        )
      : inventory.items.length === 1
        ? inventory.items[0]
        : undefined;
  const removeComputer = inventory.items.find(
    (computer) => computer.computer_id === removeComputerId,
  );
  const selectedAgents = selectedComputer
    ? agents.items.filter(
        (agent) =>
          agent.runtime.placement?.type === "local" &&
          agent.runtime.placement.computer_id === selectedComputer.computer_id,
      )
    : [];
  const removeAgents = removeComputer
    ? agents.items.filter(
        (agent) =>
          agent.runtime.placement?.type === "local" &&
          agent.runtime.placement.computer_id === removeComputer.computer_id,
      )
    : [];
  const removeMutation = useMutation({
    mutationFn: (computerId: string) =>
      teamHubDone(
        client.api.DELETE(
          "/v0/tenants/{tenantId}/local-computers/{computerId}",
          { params: { path: { tenantId, computerId } } },
        ),
      ),
    onSuccess: async (_, computerId) => {
      setRemoveComputerId(null);
      if (requestedComputerId === computerId) {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete("computer");
            return next;
          },
          { replace: true },
        );
      }
      await queryClient.invalidateQueries({
        queryKey: localComputersQueryKey(tenantId),
      });
    },
  });
  const setupConnected =
    setupOpen &&
    inventory.items.some((computer) => {
      if (computer.status !== "online") return false;
      return expectedComputerId
        ? computer.computer_id === expectedComputerId
        : !knownComputerIds.has(computer.computer_id);
    });

  useEffect(
    () =>
      subscribeLocalComputerEnrollment((event) => {
        if (event.tenantId === tenantId)
          setExpectedComputerId(event.computerId);
      }),
    [tenantId],
  );

  useEffect(() => {
    if (!openThisComputer || showingDirectoryRef.current) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (next.get("computer") === openThisComputer) return current;
        next.set("computer", openThisComputer);
        return next;
      },
      { replace: true },
    );
  }, [openThisComputer, setSearchParams]);

  function openSetup() {
    setExpectedComputerId(null);
    setKnownComputerIds(
      () => new Set(inventory.items.map(({ computer_id }) => computer_id)),
    );
    setSetupOpen(true);
  }

  function closeSetup() {
    setSetupOpen(false);
    setExpectedComputerId(null);
    setKnownComputerIds(() => new Set());
  }

  function showDirectory() {
    showingDirectoryRef.current = true;
    setShowingDirectory(true);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("computer");
      return next;
    });
  }

  function selectComputer(computerId: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("computer", computerId);
        return next;
      },
      { flushSync: true },
    );
  }

  return (
    <>
      <div
        aria-hidden={setupOpen ? true : undefined}
        // Settings owns the scrolling and main landmark, so this page nests neither.
        className="mx-auto flex min-h-0 w-full max-w-(--app-settings-width) flex-col pb-4"
      >
        <header className="flex items-center justify-between gap-4">
          <h1 className="flex items-center gap-1 text-2xl text-foreground">
            {(requestedComputerId || openThisComputer) &&
            inventory.items.length > 1 ? (
              <Button
                aria-label={t(computersMessages.allComputers)}
                onClick={showDirectory}
                size="icon"
                tone="ghost"
              >
                <Icon icon={ArrowLeft01Icon} size={16} />
              </Button>
            ) : null}
            {t(computersMessages.pageTitle)}
          </h1>
          {inventory.items.length ? (
            <Button
              aria-label={t(computerSetupMessages.label)}
              onClick={openSetup}
              size="compact"
            >
              <Icon icon={Add01Icon} size={14} />
              {t(computersMessages.connect)}
            </Button>
          ) : null}
        </header>
        <div className="mt-6 min-w-0">
          {openAgent.error ? (
            <p role="alert" className="px-2 py-3 text-sm text-app-danger">
              {openAgent.error.message}
            </p>
          ) : null}
          {inventory.items.length === 0 ? (
            <NoComputers onConnect={openSetup} />
          ) : selectedComputer ? (
            <ComputerDetail
              agentAvailabilities={agentAvailabilities}
              agents={selectedAgents}
              browserConnection={(variant) => (
                <ComputerBrowserConnection
                  computerId={selectedComputer.computer_id}
                  online={selectedComputer.status === "online"}
                  tenantId={tenantId}
                  variant={variant}
                />
              )}
              canDoHref={
                selectedComputer.platform === "darwin"
                  ? computerCanDoPath(tenantId, selectedComputer.computer_id)
                  : undefined
              }
              computer={selectedComputer}
              key={selectedComputer.computer_id}
              localModelsHref={`/t/${tenantId}/settings/models?computer=${encodeURIComponent(selectedComputer.computer_id)}`}
              onConnect={openSetup}
              onOpenAgent={(actorId) => {
                if (!openAgent.isPending) openAgent.mutate(actorId);
              }}
              onRemove={() => {
                removeMutation.reset();
                setRemoveComputerId(selectedComputer.computer_id);
              }}
            />
          ) : requestedComputerId ? (
            <UnavailableComputer onBack={showDirectory} onConnect={openSetup} />
          ) : (
            <ComputerDirectory
              agents={agents.items}
              computers={inventory.items}
              onSelect={selectComputer}
            />
          )}
        </div>
      </div>

      {setupOpen ? (
        <ConnectComputerDialog
          tenantId={tenantId}
          connected={setupConnected}
          onClose={closeSetup}
          onDone={closeSetup}
        />
      ) : null}
      {removeComputer ? (
        <RemoveComputerDialog
          agents={removeAgents}
          computer={removeComputer}
          computers={inventory.items}
          error={removeMutation.error}
          onClose={() => setRemoveComputerId(null)}
          onConfirm={() => removeMutation.mutate(removeComputer.computer_id)}
          onConnect={() => {
            setRemoveComputerId(null);
            openSetup();
          }}
          pending={removeMutation.isPending}
          tenantId={tenantId}
        />
      ) : null}
    </>
  );
}
