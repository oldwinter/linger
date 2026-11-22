# Web

Web is the Room-centered React/Vite product client, built on React Router Data Mode and TanStack Query. Active product data comes only from TeamHub.

Commands, conventions and boundaries are in [AGENTS.md](./AGENTS.md).

## Interaction behavior

The Room header adapts to the width left by navigation and side panels. More
actions contains document sharing and Room management links. Below 960 pixels,
Room search and deleted-Agent Room deletion also move into More actions so the
Room identity and conversation controls remain reachable. Watch the work
remains available as an icon while a run is active.
Pinned messages opens a panel within the window; long lists scroll beneath its
title and search. Close or Escape returns focus to the trigger. The first
Escape clears a nonempty pin search.

Pocket notes save edits in order. Closing the editor waits for its latest text to
save; a failed save keeps the editor open and offers Retry. This protects the
mounted editor's draft, but does not provide recovery after a browser reload or
coordinate writes from another tab.

The Work Item peek asks before discarding an unsent comment or changed
description when the reader closes it or opens the full page. Continue editing
is the default. Cancel in the description editor discards only that edit.
Pending saves and comments keep the peek open, and failed submissions retain
their input. These drafts do not survive a reload or a closed browser tab.

Creating an issue keeps entered details until creation succeeds or the reader
confirms discard. Escape and Close default to continuing the edit. Pending
creation prevents dismissal and repeated submission; failure keeps the draft,
and retrying unchanged details reuses its idempotency key. Success focuses the
new issue on the Dashboard.

Room creation dialogs remain open while creation is pending.
Routine dialogs also disable editing and competing actions during create, save,
run, or delete. A failed request preserves the form for retry.

Room name and description stay fixed while their save is pending. Repeated
submission and the editor's close actions wait for the result. A failed save
keeps the entered values available to edit and retry.

Who can manage keeps role choices and Save disabled until submitted changes
and the membership refresh finish. A rejected save retains the selected roles
for correction or retry.

Editing a rule keeps the submitted text fixed until its save finishes. Save,
Cancel, and the editor's keyboard shortcuts cannot discard or submit it again
while pending. A failed save keeps the draft available for correction or retry.

Forwarding to several targets waits for every response. Confirmed targets are
marked Forwarded; only unconfirmed targets stay selected for retry. Each target
keeps its request key while the dialog is open, so retrying a lost response
reuses the committed message. Pending forwarding prevents selection changes
and dismissal. The footer reports partial results beside the retry action.

Search uses Tab to choose a narrower result category when one is available.
Otherwise Tab and Shift+Tab move focus normally. Backspace in an empty query
removes the displayed Room or Thread scope.

Inline Document mentions in Room messages show a file icon and the current
Document title when available, falling back to the original mention text.
They open the referenced Document without adding a separate file card.
