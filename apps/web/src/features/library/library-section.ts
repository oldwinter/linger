import type { LibrarySection } from "./library-sidebar";

/**
 * Which Library section a path shows. Kept apart from the lazy layout so the
 * route loading placeholder, on the initial graph, draws the same chrome.
 */
export function workspaceSection(pathname: string): LibrarySection | null {
  const rest = pathname.match(/^\/t\/[^/]+\/library(?=\/|$)(.*)$/)?.[1];
  if (rest === undefined) return null;
  if (rest.startsWith("/wiki")) return "wiki";
  // This day is a reading page, like the Library home, with no file tree.
  if (rest === "/day") return "overview";
  // An open meeting, carrying one of its decisions, and the clock to the next one keep the Library sidebar beside them.
  if (
    rest.startsWith("/meetings") ||
    rest.startsWith("/carry-decision") ||
    rest.startsWith("/up-next")
  )
    return null;
  return "overview";
}

/** The overview and the Wiki fill the page; other sections keep the sidebar. */
export function sectionHasSidebar(section: LibrarySection | null) {
  return section !== "wiki" && section !== "overview";
}
