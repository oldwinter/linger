# Tenant Library Surface

- Own the Tenant-scoped Library layout and its Home file tree.
- The Library home (`/library`) is for finding Documents: no sidebar, a Recent
  card row, and My pages / Shared with me / Meetings tabs (`?tab=`). **This day**
  (`/library/day`) walks one calendar day across Pocket, meetings, and the Daily.
  The Meetings list is a tab, not a route; `/library/meetings?entry=<meeting id>`
  changed this week (`/library/changed`) is the Monday-through-Sunday list of
  files the library updated, opened from that Recent row. The
  opens one read-only meeting, and without `entry` it redirects to the tab.
- My pages and Shared with me list their tree one Folder level at a time
  (`?folder=` opens a level); a Document inside a Folder never shows at the
  root. The smart view only supplies each row's Visible in sources.
  `?folder=<placement id>` opens one Folder: a breadcrumb, then only its direct
  child Folders and Documents from that tab's tree. On My pages the New menu
  and file drops target the open Folder.
- Uploads (Import, Upload folder, file or folder drops) recreate dropped folder
  structure as personal Folders, then upload files sequentially. The pending
  queue lives in `library-upload-queue.ts` outside React state so it survives
  leaving and reopening the Library; do not move it back into component state.
- The documents view carries a Recently opened strip above the tree, read from a
  per-Account and per-Tenant browser list that the unified document page writes
  when it opens a Document. It issues no request, and an entry without an id or
  name never renders. Trashing a Document forgets it from the strip. Each entry
  can be forgotten on its own, which removes only that Document from this
  browser's list and nothing else; forgetting the last entry keeps the strip
  with an announced empty status so focus has somewhere to land. Clear empties
  the list for this Account in this Tenant and hides the strip, and the
  settings action or logout empties it for every Account.
- The sidebar appears beside an opened Document for switching: Back to
  Library, then personal Documents, Shared with me, and the independent
  read-only Meetings list. Back from a file that lives in a folder opens that
  folder. A file at the root, or one the personal tree does not hold, returns
  to the Library home. Wiki is a primary-rail destination with its own
  file sidebar, retaining `/t/:tenantId/library/wiki`.
  My Documents and Shared with me remain document-tree views.
- `LibraryLayout` is a pathless route over `library/*` and `documents/:documentId`
  and alone renders the Library sidebar (on every route except the home), so
  navigation only swaps the content pane. Pages must not render `LibrarySidebar`; open it at phone width through
  `useWorkspaceTree()`.
- My Documents is the current Human owner's real personal Placement tree. Keep
  its multi-level Folder, inline create/rename, tree-local Move, Duplicate,
  import/export, trash/restore, ancestor expansion, active reveal, scroll
  restoration, keyboard, and menu behavior behind the shared tree module.
- Personal and shared Folder renames ignore Enter and Escape while an input
  method is composing. Submission and cancellation resume after composition
  ends; language-specific key or text matching does not decide this.
- Shared with me is a Binding-derived smart view of accessible Documents not
  owned by the current Human. It never creates a Placement or masquerades as a
  Folder. Copy to My Documents creates an independent Document through the
  canonical Duplicate command and then opens the new identity.
- Do not expose Favorite controls or views; TeamHub keeps no Favorite records
  or events.
- Create and upload Human-owned Documents into personal Placement even when the
  same transaction creates a Room, Work Item, or Wiki Binding. Agent-owned
  Documents stay out of Human personal trees.
- Opening any Document reuses the unified editor and stable `document_id`; do
  not add a Library-owned authority, second editor, shortcut identity, or
  fallback read.
