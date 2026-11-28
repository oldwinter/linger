import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router";

import { myDocumentTreeQueryKey } from "./library-queries";
import { DesktopBarSlot } from "@/app/desktop-frame";
import { isDesktopShell } from "@/app/desktop-shell";
import { NavigationDrawer } from "@/components/ui/navigation-drawer";
import { documentQueryOptions } from "@/features/rooms/room-queries";
import { RouteContentBoundary } from "@/features/rooms/route-content-boundary";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { libraryFolderBackPath } from "./library-folder-back";
import { MyDocumentsTree } from "./library-documents-page";
import { sectionHasSidebar, workspaceSection } from "./library-section";
import { LibrarySidebar } from "./library-sidebar";
import { WORKSPACE_TREE_ID, WorkspaceTreeContext } from "./workspace-tree";

/**
 * The Workspace home and the Wiki pages are for finding a page and show no
 * sidebar. Once a Document or Memory page is open, the sidebar is for moving between
 * them and outlives each page, so moving only replaces the content beside it.
 */
export function LibraryLayout() {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const location = useLocation();
  const params = useParams();
  const tenantId = requireRoomRouteParam(params.tenantId, "Tenant");
  const documentId = params.documentId;
  const section = workspaceSection(location.pathname);
  const hasList = sectionHasSidebar(section);
  // A tree opened over a phone-width page belongs to that page.
  const [treeOpenAt, setTreeOpenAt] = useState<string | null>(null);
  const treeOpen = treeOpenAt === location.pathname;
  const treeContext = useMemo(
    () => ({
      hasList,
      open: treeOpen,
      setOpen: (open: boolean, pathname = location.pathname) =>
        setTreeOpenAt(open ? pathname : null),
    }),
    [hasList, location.pathname, treeOpen],
  );
  const tree = useQuery({
    queryFn: () =>
      teamHubData(
        client.api.GET("/v0/tenants/{tenantId}/me/document-tree", {
          params: { path: { tenantId } },
        }),
      ),
    queryKey: myDocumentTreeQueryKey(tenantId),
    staleTime: 60_000,
  });
  const openDocument = useQuery({
    ...documentQueryOptions(client, tenantId, documentId ?? ""),
    enabled: documentId !== undefined,
  });
  const holdsWikiPage =
    /\/wiki-preview$/.test(location.pathname) ||
    (documentId !== undefined &&
      openDocument.data?.from.some(
        (source) => source.binding_kind === "wiki_page",
      ) === true);
  const content = (
    <RouteContentBoundary>
      <div
        className="workspace-route-enter flex min-h-0 min-w-0 flex-1"
        key={location.pathname}
      >
        <Outlet />
      </div>
    </RouteContentBoundary>
  );

  return (
    <WorkspaceTreeContext value={treeContext}>
      {/* The desktop app shows the same Library as the browser, as one card
          under an empty grey bar on the window frame. Titles stay in the
          card rather than moving into the frame's bar. */}
      <DesktopBarSlot value={null}>
        <div className="library-layout flex min-h-0 flex-1 flex-col overflow-hidden bg-app-surface">
          {isDesktopShell() ? <div className="library-desktop-bar" /> : null}
          <div className="library-layout-body relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {hasList ? (
              <NavigationDrawer
                ariaLabel="Library pages"
                closeLabel="Close Library pages"
                mobileBreakpoint="sm"
                onClose={() => setTreeOpenAt(null)}
                open={treeOpen}
              >
                <LibrarySidebar
                  active={section}
                  backTo={libraryFolderBackPath(
                    tenantId,
                    tree.data?.items ?? [],
                    documentId,
                  )}
                  holdsOpenFile={holdsWikiPage ? "wiki" : null}
                  id={WORKSPACE_TREE_ID}
                  mobileOpen={treeOpen}
                  onMobileClose={() => setTreeOpenAt(null)}
                  tenantId={tenantId}
                >
                  <MyDocumentsTree
                    activeDocumentId={documentId}
                    // My pages starts shut on every entry page, folders included;
                    // later navigation keeps whatever the reader opened.
                    collapseCollectionInitially
                    collapseFoldersInitially
                    items={tree.data?.items ?? []}
                    loadError={tree.error}
                    onChanged={() =>
                      queryClient.invalidateQueries({
                        queryKey: myDocumentTreeQueryKey(tenantId),
                      })
                    }
                    pending={tree.isPending}
                    tenantId={tenantId}
                  />
                </LibrarySidebar>
              </NavigationDrawer>
            ) : null}
            {content}
          </div>
        </div>
      </DesktopBarSlot>
    </WorkspaceTreeContext>
  );
}
