import { Link } from "react-router";

import type { WikiGraphNode } from "@/features/memory/wiki-graph-model";

/** How the page you just left reaches this one, through the pages between. */
export function WikiReachNote({
  hrefs,
  path,
}: {
  hrefs: ReadonlyMap<string, string>;
  path: readonly WikiGraphNode[];
}) {
  const earlier = path[0];
  const through = path.slice(1, -1);
  if (!earlier || through.length === 0) return null;
  return (
    <p className="text-sm text-app-body">
      <PageName href={hrefs.get(earlier.id)} title={pageTitle(earlier)} />{" "}
      reaches this page through <ThroughPages hrefs={hrefs} pages={through} />.
    </p>
  );
}

function ThroughPages({
  hrefs,
  pages,
}: {
  hrefs: ReadonlyMap<string, string>;
  pages: readonly WikiGraphNode[];
}) {
  if (pages.length === 1) {
    const only = pages[0]!;
    return <PageName href={hrefs.get(only.id)} title={pageTitle(only)} />;
  }
  return pages.map((page, index) => {
    const last = index === pages.length - 1;
    const name = (
      <PageName
        href={hrefs.get(page.id)}
        key={page.id}
        title={pageTitle(page)}
      />
    );
    if (index === 0) return name;
    return (
      <span key={page.id}>
        {pages.length > 2 && !last ? ", " : null}
        {last ? `${pages.length > 2 ? "," : ""} and ` : null}
        {name}
      </span>
    );
  });
}

function PageName({ href, title }: { href?: string; title: string }) {
  if (!href) return title;
  return (
    <Link
      className="text-app-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-focus"
      to={href}
    >
      {title}
    </Link>
  );
}

function pageTitle(node: WikiGraphNode): string {
  return node.title.trim() || node.id;
}
