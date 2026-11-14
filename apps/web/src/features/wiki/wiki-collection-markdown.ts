import { escapeLinkText } from "@/features/library/library-selection-links";

/** One page of a collection, as the list shows it. */
export interface WikiCollectionListPage {
  /** The app path the page opens at. */
  path: string;
  /** The name the collection page shows for the page. */
  title: string;
}

/**
 * A collection as a Markdown list: its name as the heading, then one linked
 * entry per page in the order received. An empty collection is its heading
 * alone, and a title stays plain link text.
 */
export function wikiCollectionMarkdown({
  label,
  origin,
  pages,
}: {
  label: string;
  origin: string;
  pages: readonly WikiCollectionListPage[];
}): string {
  return [
    `# ${label}`,
    ...pages.map(
      (page) =>
        `- [${escapeLinkText(page.title)}](${new URL(page.path, origin).toString()})`,
    ),
  ].join("\n");
}
