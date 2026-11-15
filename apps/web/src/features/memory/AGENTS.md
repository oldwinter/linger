# Personal Memory Surface

- Own the authenticated Human's Tenant-scoped Memory views: the Timeline graph
  with its Daily and Weekly reports, Meetings (calendar, reader, audio), and
  This day (`/library/day`), which reads Pocket, meetings, and the Daily for
  one calendar day. Shape of today draws one calendar day as open stretches
  and the meetings that sit in them. Searching the Timeline centers the best
  matching page and shows the pages the graph links to it. Opening one
  recenters the search on that page. Tell this story retells a meeting as
  the lines you could say out loud, then the one line you would actually tell.
  The week in memory is the Monday-through-Sunday picture of meetings, dailies,
  and Pocket notes together. Carrying a decision posts that decision into a
  room the reader chooses; the meeting stays unchanged. Up next is the live
  clock to the closest meeting. Personal Wiki navigation in `features/wiki`
  links here.
- Call TeamHub through the generated client (`client.api`) and generated
  Memory types; do not handwrite URLs or wire DTOs in components.
- From a meeting, Ask Another Me writes a follow-up into that room's
  composer (keeping any unsent draft) and opens the chat with the composer
  focused. The meeting itself stays read-only.
- A meeting's to-do list can be checked off on this computer. The checks
  belong to the signed-in account and that capture; the meeting document
  stays read-only.
- Meetings, reports and graph entries are read-only derived reading state, not
  source evidence. Deleting a meeting only hides it from the caller's own
  Meetings through TeamHub's
  `DELETE /v0/tenants/{tenantId}/me/meetings/{captureSessionId}`. From a
  meeting that has to-dos, Turn to-dos into reminders creates one-time
  reminders in the chat with Another Me; the meeting page itself is unchanged.
  Ask the recording (`/t/:tenantId/library/meetings/ask?entry=`) saves a
  question on that meeting's capture and shows the answer that stays with it.
  A question the recording treats as a request for Another Me is not sent from
  this page.
  Web observes Memory generation state; it does not call the
  Memory service directly or orchestrate generation.
- Tracking a meeting Action stages an unsent draft in the Human's Another Me
  Chat and opens it; the reader still sends nothing itself and creates no Work
  Item.
- A reader may copy a report as Markdown or send it to a Room as one Message.
  That Message is a copy of derived reading state, not source evidence, and
  neither action writes Memory state.
- A meeting reader may copy its Action items as a Markdown checklist. The
  clipboard holds a copy of derived reading state and the reader writes none.
- A meeting reader may copy its transcript as plain text, one line per speaker
  turn, once the transcript text has loaded. The clipboard again holds derived
  reading state and the reader writes none.
- A meeting reader may copy its summary as the Markdown the summary view renders
  from. The clipboard again holds derived reading state, and a refused copy says
  so.
- A meeting reader's header may copy the meeting's canonical link, built by
  `meeting-routes.ts` with the origin the app is served from. The clipboard
  again holds derived reading state, and a refused copy says so.
- A meeting reader's recording player remembers the listener's playback speed
  per Account in this browser only, so the next meeting opens at that speed; a
  refused rate keeps the previous one and says so, and the This browser
  settings clear it.
- A meeting reader's recording player remembers where its listener stopped, per
  meeting, in this browser only and keyed per Account. The place is offered on
  reopen, never held by TeamHub, and the This browser settings clear it.
- While the person is inside the meeting, Space plays or pauses the recording
  and the left and right arrows move five seconds, stopping at either end. Keys
  pressed in a field, inside a dialog, or on a focused control stay with it, and
  no keypress announces anything.
- A recording long enough to have a middle can be heard as its opening and its
  close at the same time. That listening plays the file on its own and leaves
  the meeting's playhead where it was; the meeting recording waits while it
  plays. Stopping it, or the stretches ending, ends that listening.
- A meeting reader may send its summary to a Room as one Message from the
  header's Room picker. That Message copies derived reading state, writes no
  Memory state, and reuses its idempotency key only when retrying the same
  Room.
- Keep as a page (`/t/:tenantId/library/meetings/keep?entry=`) uploads that
  same summary as a library page the person can keep writing. The meeting
  stays read-only, and a meeting with no summary words offers no page.
- Timeline is the display label for the existing `graph` entry; keep its route
  and data key. Keep/Delete stay browser-local display decisions through
  `features/wiki/wiki-display-state.ts`: filter displayed graph nodes and edges
  only and never issue backend mutations for them.
- `meeting-page.css` and `wiki-knowledge-graph.css` predate the Web rule
  against feature-level `.css`; do not add more.
