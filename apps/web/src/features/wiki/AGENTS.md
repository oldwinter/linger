# Personal Wiki Surface

- Own the authenticated Human's Tenant-scoped Personal Wiki navigation, output reading, and manual source upload UI. Memory views (Timeline graph, reports, Meetings) live in `features/memory`.
- Call TeamHub through the generated client (`client.api`) and generated Personal Wiki types; do not handwrite URLs or wire DTOs in components.
- Treat the current published Markdown Revision as derived reading state, not source evidence or Agent memory.
- Keep selected output-file identity in the route URL and retain visible source references.
- Reuse the Artifact file icon mapping, preview policy, file-type renderers, and shared read-only BlockNote Markdown renderer; do not fork file-type or document-view presentation inside Wiki.
- Published Wiki output and provenance snapshots are always read-only. Human-owned
  Personal Wiki source files may append a new source version through TeamHub;
  they reuse the shared BlockNote visual language but do not become Room
  Documents or bypass Wiki source versioning.
- A Wiki page is a read-only Markdown file Document: open it with the file preview and the knowledge presentation, never a collaboration session.
- A Wiki page's header offers Copy link, Send to Room, and one menu for Copy as
  Markdown and Download. Sending posts one Message with the title, a bounded
  plain-text excerpt, and the link back, and reads the page's Markdown from the
  same download source only when a Room is chosen.
- Web observes generation state. A Human may ask TeamHub to start a refresh; Web shows its outcome and lets the same polling report progress. Web does not call LLM Wiki directly or orchestrate compilation.
  While a refresh is writing pages, Read pages written so far walks those
  previews one at a time and opens each page before it is published.
  The Wiki home also features the page just written. A page that appears in a
  later preview replaces it.

- What Another Me remembers compares the current Profile revision with the
  previous one: name, each module, and the Background timeline. History from
  TeamHub is newest first and includes the current revision.
- How Another Me would introduce you turns the profile into a short card.
  The Human chooses which line leads, then can leave that card on today's
  Pocket note.
- Wiki navigation owns Profile, Timeline, Projects, Topics, People, and Companies. Timeline, People
  and Companies are the display labels for the existing `graph`, `contacts` and
  `clients` entries; keep their routes and data keys.
  The Wiki home's Surprise me action opens one of the pages already listed at
  random through the normal page route, adding no query or refetch.
  A published Wiki page that names exactly one other page and does not link to
  it ends with that page's own sentence. Naming more than one page, or linking
  to the named page, leaves the reading as it was. A page hidden in this
  browser does not speak.
  Wiki routes show the overview and collection pages without a sidebar; the directory
  appears only beside an opened Wiki page and lists that page's own collection,
  following links into other collections, until Back.
  Opened files keep unified Document routes. Keep/Delete are browser-local display
  decisions scoped to the current Account and Tenant (`wiki-display-state.ts`, shared
  with `features/memory`). Filter displayed graph nodes and edges only; never issue
  backend mutations for these decisions.
  The Wiki sidebar's collection list filters by title as a view of the loaded
  pages: every word of the query must appear in a file's name, matches are
  highlighted, and a no-match message takes the list's place. Filtering never
  fetches, never changes the route or the open page, and keeps its per-collection
  query in view state only, so clearing the field restores the full list.
  Pressing / while the directory shows its collection list focuses the filter
  field and keeps the browser's quick-find from opening; it does nothing while
  another field, a dialog, or an IME composition owns the keystroke. Escape in
  the field clears the filter and leaves it. Both go through the shared
  `isShortcutKeyEvent` guard in `src/lib/keyboard-shortcut.ts`.
  A collection page's Copy list copies the cards it shows as a Markdown list:
  the collection name as the heading and one absolute link per card, in that
  order. A filtered page copies only the matches; the action stays disabled
  while the collection loads or is empty, and copying changes nothing else.
  The Wiki home's Wiki tab shows Recently opened above the daily cards: the
  last five pages this Account opened in this Tenant in this browser, newest
  first, with no duplicates, each linking to the page. Each entry can be
  forgotten on its own, which removes only that page from this browser's list;
  forgetting the last entry keeps the section with an announced empty status so
  focus has somewhere to land. Clear empties the list for this Account in this
  Tenant and hides the strip, and the settings action or logout empties it for
  every Account. The directory records the open published page and the preview
  page records the page being written, both from the identity they already
  hold, so opening a page adds no request; the strip stays out of the page
  while nothing has been stored. `recent-wiki-pages.ts` owns the store and is
  registered in the This browser preferences.
