import {
  Activity01Icon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import type { HerdrCoreClient } from "@/features/herdr-core/api";
import { useDesktopComputer } from "@/features/local-computer/desktop-computer";
import { localComputersQueryOptions } from "@/features/local-computer/local-computer-queries";
import {
  ComputerPicker,
  type ComputerPickerOption,
} from "@/features/local-models/computer-picker";
import {
  readLastModelsComputer,
  writeLastModelsComputer,
} from "@/features/local-models/last-models-computer";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import type { EventSourceFactory } from "@/features/teamhub/event-stream";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubLocalComputerPage } from "@/features/teamhub/teamhub-types";
import { RichMessage, useT } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

import { MagpieCockpit } from "./magpie-cockpit";
import { systemMonitorMessages as m } from "./system-monitor.messages";
import {
  systemTelemetryQueryOptions,
  type SystemTelemetryStreamStatus,
  useSystemTelemetryStream,
} from "./system-monitor-queries";

type InventoryComputer = TeamHubLocalComputerPage["items"][number];

const LazyHerdrCoreComputerDialog = lazy(() =>
  import("@/features/herdr-core/herdr-core-computer-drawer").then((module) => ({
    default: module.HerdrCoreComputerDialog,
  })),
);

function computersPath(tenantId: string) {
  return `/t/${tenantId}/settings/computers`;
}

function modelsPath(tenantId: string, computerId: string) {
  return `/t/${tenantId}/settings/models?computer=${encodeURIComponent(computerId)}`;
}

function streamBadgeTone(status: SystemTelemetryStreamStatus): string {
  switch (status) {
    case "live":
      return "bg-app-success/15 text-app-success";
    case "connecting":
    case "reconnecting":
      return "bg-app-warning/15 text-app-warning";
    case "paused":
    case "offline":
      return "bg-muted text-muted-foreground";
  }
}

function streamDotTone(status: SystemTelemetryStreamStatus): string {
  switch (status) {
    case "live":
      return "bg-app-success";
    case "connecting":
    case "reconnecting":
      return "bg-app-warning";
    case "paused":
    case "offline":
      return "bg-muted-foreground";
  }
}

export interface SystemMonitorPageProps {
  /** Optional EventSource factory override for tests. */
  readonly eventSourceFactory?: EventSourceFactory;
  /** Optional herdr-core client override for tests. */
  readonly herdrCoreClient?: HerdrCoreClient;
  /** Optional TeamHub base URL override for tests. */
  readonly streamBaseUrl?: string;
}

/**
 * Settings › System (`settings/system?computer=<id>`): live hardware and
 * local LLM inference telemetry cockpit (Magpie Cockpit).
 */
export function SystemMonitorPage({
  eventSourceFactory,
  herdrCoreClient,
  streamBaseUrl,
}: SystemMonitorPageProps = {}) {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const { data: inventory } = useSuspenseQuery(
    localComputersQueryOptions(client, tenantId),
  );
  const desktop = useDesktopComputer();
  const [searchParams, setSearchParams] = useSearchParams();
  const computers = inventory.items;
  const linkedId = searchParams.get("computer");
  const linkedOwned = linkedId
    ? computers.find((item) => item.computer_id === linkedId)
    : undefined;
  const savedId = readLastModelsComputer(tenantId);
  const savedOwned = savedId
    ? computers.find((item) => item.computer_id === savedId)
    : undefined;
  const desktopOwned = desktop?.status?.computerId
    ? computers.find((item) => item.computer_id === desktop.status?.computerId)
    : undefined;
  const defaultComputer =
    computers.find((item) => item.status === "online") ?? computers[0];
  const sharedId = linkedId && !linkedOwned ? linkedId : undefined;
  const computer = sharedId
    ? undefined
    : (linkedOwned ?? savedOwned ?? desktopOwned ?? defaultComputer);

  useEffect(() => {
    if (linkedOwned) {
      writeLastModelsComputer(tenantId, linkedOwned.computer_id);
    }
  }, [linkedOwned, tenantId]);

  function select(computerId: string) {
    if (computers.some((item) => item.computer_id === computerId)) {
      writeLastModelsComputer(tenantId, computerId);
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("computer", computerId);
        return next;
      },
      { replace: true },
    );
  }

  const desktopComputerId = desktop?.status?.computerId;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-col pb-6">
      {sharedId ? (
        <ComputerSystemMonitor
          computerId={sharedId}
          eventSourceFactory={eventSourceFactory}
          herdrCoreClient={herdrCoreClient}
          isDesktopLocalComputer={desktopComputerId === sharedId}
          key={sharedId}
          onSelectComputer={select}
          ownedComputers={computers}
          streamBaseUrl={streamBaseUrl}
          tenantId={tenantId}
        />
      ) : computer ? (
        <ComputerSystemMonitor
          computer={computer}
          computerId={computer.computer_id}
          displayName={computer.display_name}
          eventSourceFactory={eventSourceFactory}
          herdrCoreClient={herdrCoreClient}
          isDesktopLocalComputer={desktopComputerId === computer.computer_id}
          key={computer.computer_id}
          onSelectComputer={select}
          ownedComputers={computers}
          streamBaseUrl={streamBaseUrl}
          tenantId={tenantId}
        />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl text-foreground">{t(m.title)}</h1>
            <p className="text-sm text-muted-foreground">{t(m.subtitle)}</p>
          </div>
          <EmptyState title={t(m.noComputersTitle)}>
            <RichMessage
              message={m.noComputersBody}
              tags={{
                link: (text) => (
                  <ComputersLink tenantId={tenantId}>{text}</ComputersLink>
                ),
              }}
            />
          </EmptyState>
        </>
      )}
    </div>
  );
}

function ComputerSystemMonitor({
  computer,
  computerId,
  displayName,
  eventSourceFactory,
  herdrCoreClient,
  isDesktopLocalComputer,
  onSelectComputer,
  ownedComputers,
  streamBaseUrl,
  tenantId,
}: {
  readonly computer?: InventoryComputer;
  readonly computerId: string;
  readonly displayName?: string;
  readonly eventSourceFactory?: EventSourceFactory;
  readonly herdrCoreClient?: HerdrCoreClient;
  readonly isDesktopLocalComputer: boolean;
  readonly onSelectComputer: (computerId: string) => void;
  readonly ownedComputers: readonly InventoryComputer[];
  readonly streamBaseUrl?: string;
  readonly tenantId: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { client, pageActivity } = useTeamHubRuntime();
  const [paused, setPaused] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [workbenchState, setWorkbenchState] = useState<{
    readonly open: boolean;
    readonly initialAddress?: string;
  }>({ open: false });

  const initialQuery = useQuery(
    systemTelemetryQueryOptions(client, tenantId, computerId),
  );

  const initialView = initialQuery.data;
  const querySaysUnsupported =
    initialView?.supported === false ||
    (initialQuery.error instanceof TeamHubError &&
      initialQuery.error.code === "SYSTEM_TELEMETRY_UNSUPPORTED");
  const querySaysOffline =
    initialView?.online === false ||
    (initialQuery.error instanceof TeamHubError &&
      initialQuery.error.code === "LOCAL_COMPUTER_OFFLINE");

  // Wait for the initial REST snapshot to confirm the Computer is online,
  // owned, and supports telemetry before opening a persistent SSE stream.
  const shouldStream = Boolean(
    initialView &&
    initialView.online &&
    initialView.supported &&
    initialView.viewer_is_owner,
  );

  const stream = useSystemTelemetryStream({
    baseUrl: streamBaseUrl,
    computerId,
    enabled: shouldStream,
    eventSourceFactory,
    pageActivity,
    paused,
    retryToken,
    tenantId,
  });

  const activeView = stream.view ?? initialView ?? null;
  const computerLabel = activeView?.display_name || displayName || computerId;

  const isNotOwner = activeView?.viewer_is_owner === false;
  const isUnsupported = activeView?.supported === false || querySaysUnsupported;
  const isOffline =
    activeView?.online === false ||
    (activeView === null &&
      (computer?.status === "offline" || querySaysOffline));

  const effectiveStatus: SystemTelemetryStreamStatus = isOffline
    ? "offline"
    : paused
      ? "paused"
      : activeView?.telemetry
        ? stream.status === "connecting"
          ? "live"
          : stream.status
        : stream.status;

  function statusLabel(status: SystemTelemetryStreamStatus): string {
    switch (status) {
      case "live":
        return t(m.statusLive);
      case "connecting":
        return t(m.statusConnecting);
      case "reconnecting":
        return t(m.statusReconnecting);
      case "paused":
        return t(m.statusPaused);
      case "offline":
        return t(m.statusOffline);
    }
  }

  const pickerOptions: ComputerPickerOption[] = ownedComputers.map((item) => ({
    computerId: item.computer_id,
    displayName: item.display_name,
    online: item.status === "online",
  }));

  function handleRetry() {
    setRetryToken((current) => current + 1);
    void initialQuery.refetch();
    void queryClient.invalidateQueries({
      queryKey: ["herdr-core", "cockpit-status", computerId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["herdr-core", "cockpit-terminals", computerId],
    });
  }

  function openHerdrWorkbench(address?: string) {
    setWorkbenchState({ open: true, initialAddress: address });
  }

  return (
    <div className="space-y-4">
      {/* Header & Live Controls */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div>
            <h1 className="text-2xl text-foreground">{t(m.title)}</h1>
            <p className="text-xs text-muted-foreground">{t(m.subtitle)}</p>
          </div>
          {pickerOptions.length > 1 && computer ? (
            <ComputerPicker
              onSelect={onSelectComputer}
              options={pickerOptions}
              value={computerId}
            />
          ) : (
            <span className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground">
              {computerLabel}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              streamBadgeTone(effectiveStatus),
            )}
            data-stream-status={effectiveStatus}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                streamDotTone(effectiveStatus),
              )}
            />
            {statusLabel(effectiveStatus)}
          </span>

          {!isOffline && !isUnsupported && !isNotOwner ? (
            <Button
              onClick={() => setPaused((current) => !current)}
              size="compact"
              tone="secondary"
            >
              <Icon icon={paused ? PlayIcon : PauseIcon} size={13} />
              {paused ? t(m.resume) : t(m.pause)}
            </Button>
          ) : null}

          <Button
            aria-label={t(m.refresh)}
            loading={initialQuery.isFetching}
            onClick={handleRetry}
            size="compact"
            tone="secondary"
          >
            {initialQuery.isFetching ? null : (
              <Icon icon={RefreshIcon} size={13} />
            )}
            {t(m.refresh)}
          </Button>
        </div>
      </header>

      {/* Main Content or Honest Edge State */}
      {isNotOwner ? (
        <EmptyState title={t(m.ownerOnlyTitle)}>
          {t(m.ownerOnlyBody, { name: computerLabel })}
        </EmptyState>
      ) : isUnsupported ? (
        <EmptyState
          action={
            <Link
              className="mt-4 text-sm font-medium text-app-link underline-offset-2 hover:underline"
              to={computersPath(tenantId)}
            >
              {t(m.openComputers)}
            </Link>
          }
          title={t(m.unsupportedTitle, { name: computerLabel })}
        >
          <RichMessage
            message={m.unsupportedBody}
            tags={{
              link: (text) => (
                <ComputersLink tenantId={tenantId}>{text}</ComputersLink>
              ),
            }}
          />
        </EmptyState>
      ) : isOffline ? (
        <EmptyState
          action={
            <Button
              className="mt-4"
              onClick={handleRetry}
              size="default"
              tone="secondary"
            >
              <Icon icon={RefreshIcon} size={14} />
              {t(m.retry)}
            </Button>
          }
          title={t(m.computerOfflineTitle, { name: computerLabel })}
        >
          {t(m.computerOfflineBody)}
        </EmptyState>
      ) : activeView?.telemetry ? (
        <>
          {initialQuery.isError ? (
            <FormFeedback tone="danger">{t(m.loadFailedBody)}</FormFeedback>
          ) : null}
          <MagpieCockpit
            computerId={computerId}
            herdrCoreClient={herdrCoreClient}
            isDesktopLocalComputer={isDesktopLocalComputer}
            onOpenHerdrWorkbench={openHerdrWorkbench}
            snapshot={activeView.telemetry}
            teamHubApi={client.api}
          />
          <div className="flex items-center justify-end text-xs text-muted-foreground">
            <Link
              className="font-medium text-app-link underline-offset-2 hover:underline"
              to={modelsPath(tenantId, computerId)}
            >
              {t(m.openModels)}
            </Link>
          </div>
        </>
      ) : initialQuery.isError ? (
        <EmptyState
          action={
            <Button
              className="mt-4"
              onClick={handleRetry}
              size="default"
              tone="secondary"
            >
              <Icon icon={RefreshIcon} size={14} />
              {t(m.retry)}
            </Button>
          }
          title={t(m.loadFailedTitle)}
        >
          {t(m.loadFailedBody)}
        </EmptyState>
      ) : (
        <CockpitLoadingSkeleton label={t(m.loading)} />
      )}

      {workbenchState.open ? (
        <Suspense fallback={null}>
          <LazyHerdrCoreComputerDialog
            client={herdrCoreClient}
            computerId={computerId}
            computerName={computerLabel}
            initialAddress={workbenchState.initialAddress}
            isDesktopLocalComputer={isDesktopLocalComputer}
            onClose={() => setWorkbenchState({ open: false })}
            teamHubApi={client.api}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function CockpitLoadingSkeleton({ label }: { readonly label: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className="space-y-4"
      role="status"
    >
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Skeleton className="h-72 w-full rounded-xl lg:col-span-7" />
        <Skeleton className="h-72 w-full rounded-xl lg:col-span-5" />
      </div>
    </div>
  );
}

function EmptyState({
  action,
  children,
  title,
}: {
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section
      aria-label={title}
      className="mt-4 flex flex-col items-center rounded-xl border border-border bg-card px-6 py-12 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-foreground shadow-outline">
        <Icon icon={Activity01Icon} size={24} />
      </span>
      <h2 className="mt-5 text-lg text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        {children}
      </p>
      {action}
    </section>
  );
}

function ComputersLink({
  children,
  tenantId,
}: {
  readonly children: ReactNode;
  readonly tenantId: string;
}) {
  return (
    <Link
      className="font-medium text-app-link underline-offset-2 hover:underline"
      to={computersPath(tenantId)}
    >
      {children}
    </Link>
  );
}
