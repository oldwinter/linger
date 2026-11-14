# Personal Memory Surface

- Own the authenticated Human's Tenant-scoped Memory views: the Timeline graph
  with its Daily and Weekly reports, and Meetings (calendar, reader, audio).
  Personal Wiki navigation in `features/wiki` links here.
- Call TeamHub through the generated client (`client.api`) and generated
  Memory types; do not handwrite URLs or wire DTOs in components.
- Meetings, reports and graph entries are read-only derived reading state, not
  source evidence. Deleting a meeting only hides it from the caller's own
  Meetings through TeamHub's
  `DELETE /v0/tenants/{tenantId}/me/meetings/{captureSessionId}`. Web observes Memory generation state; it does not call the
  Memory service directly or orchestrate generation.
- Tracking a meeting Action stages an unsent draft in the Human's Another Me
  Chat and opens it; the reader still sends nothing itself and creates no Work
  Item.
- A reader may copy a report as Markdown or send it to a Room as one Message.
  That Message is a copy of derived reading state, not source evidence, and
  neither action writes Memory state.
- Timeline is the display label for the existing `graph` entry; keep its route
  and data key. Keep/Delete stay browser-local display decisions through
  `features/wiki/wiki-display-state.ts`: filter displayed graph nodes and edges
  only and never issue backend mutations for them.
- `meeting-page.css` and `wiki-knowledge-graph.css` predate the Web rule
  against feature-level `.css`; do not add more.
