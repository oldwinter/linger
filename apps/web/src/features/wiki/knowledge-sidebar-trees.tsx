import { type InfiniteData, useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowRight01Icon,
  Calendar03Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLibraryTreeState } from "@/features/library/use-library-tree-state";
import { personalWikiDocumentsQueryKey } from "@/features/teamhub/document-queries";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import {
  WORKSPACE_HEADING_ICON_SIZE,
  workspaceHeadingActionClass,
  workspaceHeadingToggleClass,
} from "@/features/library/workspace-sidebar-styles";
import type { TeamHubDocumentPage } from "@/features/teamhub/teamhub-types";

import { meetingPath } from "@/features/memory/meeting-routes";
import { useMeetings } from "@/features/memory/memory-queries";
import {
  formatMeetingDay,
  formatMeetingWhen,
  meetingsByDate,
  type CalendarMeeting,
} from "@/features/memory/meetings-calendar";
import { meetingsTabPath } from "@/features/memory/meetings-panel";

/**
 * The read-only Meetings collection beside an opened Document or meeting. It
 * starts collapsed and unfolds once when the route opens one of its meetings.
 */
export function MeetingsSidebarTree({
  onFileOpen,
  tenantId,
}: {
  onFileOpen?: () => void;
  tenantId: string;
}) {
  const location = useLocation();
  // A collapsed collection never renders its tree, so it cannot learn from the
  // tree whether it holds the open meeting; the route says so on its own.
  const holdsRoutedMeeting =
    location.pathname.endsWith("/library/meetings") &&
    new URLSearchParams(location.search).has("entry");
  const [collapsed, setCollapsed] = useLibraryTreeState(
    tenantId,
    "meetings-collapsed",
    () => true,
  );
  // A meeting opened by link must be visible in the tree, so the reader can see
  // where it sits. Opening is one-way: collapsing it again stays collapsed.
  const openedForRoutedMeeting = useRef(false);
  useEffect(() => {
    if (!holdsRoutedMeeting) {
      openedForRoutedMeeting.current = false;
      return;
    }
    if (openedForRoutedMeeting.current) return;
    openedForRoutedMeeting.current = true;
    setCollapsed(false);
  }, [holdsRoutedMeeting, setCollapsed]);
  const label = "Meetings";
  const contentId = "library-meetings-collection";

  return (
    <section aria-label={`${label} tree`}>
      {/* The tree marks the open meeting, not the collection holding it. */}
      <div className="flex items-center justify-between gap-1">
        <button
          aria-controls={contentId}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
          className={workspaceHeadingToggleClass}
          onClick={() => setCollapsed((value) => !value)}
          title={`${collapsed ? "Expand" : "Collapse"} ${label}`}
          type="button"
        >
          <Icon
            icon={Calendar03Icon}
            className="shrink-0 text-app-muted"
            size={WORKSPACE_HEADING_ICON_SIZE}
          />
          <span className="truncate">{label}</span>
        </button>
        <Link
          aria-label={`Open ${label}`}
          className={workspaceHeadingActionClass}
          title={`Open ${label}`}
          to={meetingsTabPath(tenantId, "week")}
        >
          <Icon icon={ArrowRight01Icon} size={WORKSPACE_HEADING_ICON_SIZE} />
        </Link>
      </div>
      <div hidden={collapsed} id={contentId}>
        {!collapsed ? (
          <div className="mt-2 ml-4">
            <MeetingFiles onFileOpen={onFileOpen} tenantId={tenantId} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function useWikiDocuments(tenantId: string) {
  const { client } = useTeamHubRuntime();
  const documents = useInfiniteQuery<
    TeamHubDocumentPage,
    Error,
    InfiniteData<TeamHubDocumentPage>,
    ReturnType<typeof personalWikiDocumentsQueryKey>,
    string | undefined
  >({
    getNextPageParam: (lastPage, _pages, _pageParam, pageParams) => {
      const next = lastPage.page.has_more
        ? lastPage.page.next_cursor
        : undefined;
      return next && !pageParams.includes(next) ? next : undefined;
    },
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const page = await teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/personal-wiki/documents", {
          params: {
            path: { tenantId },
            query: { ...(pageParam ? { cursor: pageParam } : {}), limit: 50 },
          },
        }),
      );
      if (
        page.items.some(
          (item) =>
            item.tenant_id !== tenantId ||
            item.owner.tenant_id !== tenantId ||
            item.creator.tenant_id !== tenantId,
        )
      ) {
        throw new Error("Wiki Documents are unavailable.");
      }
      return page;
    },
    queryKey: personalWikiDocumentsQueryKey(tenantId),
    staleTime: 60_000,
  });
  const { data, fetchNextPage, hasNextPage, isError, isFetching } = documents;
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) {
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [data, fetchNextPage, hasNextPage, isError, isFetching]);
  return documents;
}

/**
 * Every meeting grouped by day, newest day first, so switching to another
 * meeting stays in the sidebar. Day labels are small muted headings over the
 * regular meeting rows.
 */
function MeetingFiles({
  onFileOpen,
  tenantId,
}: {
  onFileOpen?: () => void;
  tenantId: string;
}) {
  const meetings = useMeetings(tenantId);
  const location = useLocation();
  const currentId = new URLSearchParams(location.search).get("entry");
  const days = useMemo(
    () =>
      [...meetingsByDate(meetings.data ?? [])]
        .sort(([left], [right]) => right.localeCompare(left))
        .map(([date, items]) => ({ date, items: [...items].reverse() })),
    [meetings.data],
  );

  if (meetings.isPending)
    return <TreeMessage busy>Loading Meetings…</TreeMessage>;
  if (meetings.error)
    return (
      <TreeError
        label="Retry Meetings"
        message="Meetings are unavailable."
        onRetry={() => void meetings.refetch()}
      />
    );
  if (days.length === 0)
    return <TreeMessage>No completed meetings yet.</TreeMessage>;

  return (
    <div className="space-y-1">
      {days.map((day) => (
        <section aria-label={`Meetings on ${day.date}`} key={day.date}>
          <h3 className="flex h-[24px] items-center px-2 text-[12px] font-medium text-app-muted">
            {formatMeetingDay(day.date)}
          </h3>
          <ul className="space-y-0.5">
            {day.items.map((meeting) => (
              <li key={meeting.id}>
                <MeetingLink
                  current={meeting.id === currentId}
                  meeting={meeting}
                  onOpen={onFileOpen}
                  to={meetingPath(tenantId, meeting.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MeetingLink({
  current,
  meeting,
  onOpen,
  to,
}: {
  current: boolean;
  meeting: CalendarMeeting;
  onOpen?: () => void;
  to: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [current]);
  return (
    <Link
      aria-current={current ? "page" : undefined}
      aria-label={`Meeting ${meeting.date} ${meeting.time}`}
      className={`flex h-[33px] w-full min-w-0 items-center gap-2 rounded-md pl-[26px] pr-2 text-left text-[14px] leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-focus ${current ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-app-hover"}`}
      onClick={onOpen}
      ref={ref}
      title={`Meeting · ${meeting.date} ${meeting.time}`}
      to={to}
    >
      <span className="min-w-0 flex-1 truncate">
        Meeting {formatMeetingWhen(meeting.date, meeting.time)}
      </span>
    </Link>
  );
}

function TreeError({
  label,
  message,
  onRetry,
}: {
  label: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div aria-label={message} className="px-2 py-3" role="alert">
      <p className="text-xs text-app-danger">{message}</p>
      <Button
        className="mt-2"
        onClick={onRetry}
        size="compact"
        tone="secondary"
      >
        <Icon icon={RefreshIcon} size={14} />
        {label}
      </Button>
    </div>
  );
}

function TreeMessage({
  busy = false,
  children,
}: {
  busy?: boolean;
  children: string;
}) {
  return (
    <p
      aria-busy={busy || undefined}
      // Sits under the collection label like My pages' empty state: the
      // tree's 16px indent plus 14px lands on the same 30px column.
      className="flex items-center gap-2 py-3 pl-[14px] pr-2 text-xs text-muted-foreground"
    >
      {busy ? <Spinner size={14} /> : null}
      {children}
    </p>
  );
}
