# Web: Vite React Product Client for TeamHub

React Router Data Mode and TanStack Query power the active Room-first UI.

## Common Commands

- `pnpm --filter @linger/web test <test-file>`: run one test. Use the script, not `exec vitest`: it disables Node's experimental Web Storage, which hides jsdom's `localStorage`.
- `pnpm --filter @linger/web typecheck`: typecheck Web.
- `pnpm --filter @linger/web test:build`: run real Vite build configuration tests (`*.build.test.ts`, also run by `make check-web-build`).
- `make check-web`: run Web types, tests, and React diagnostics. Run this
  before opening a pull request. If the change adds a static import on the
  Room or app initial graph, also run `pnpm --filter @linger/web run
build:assets` to check the initial JS budget.
  CI runs it as `make check-web-static` plus `make check-web-tests` in three
  shards (`SHARD=1/3` and so on).

## Structure

- `src/app`: routes, providers, route error boundaries, and global CSS.
- `src/features/teamhub`: Human API, Session, error, and realtime adapters.
- `src/features/rooms`: Room routes, Chat, Timeline, the right sidebar (Agent Info, Activity, Thread, Document) and membership UI. Catch up freezes the chats that had new messages or mentions and walks them one at a time; opening a chat leaves the rest of the walk in place. Finishing the walk can keep that list, with each chat's last line, on today's Pocket note. Today's Pocket note can be sent into Another Me's chat; the note is saved first, and Open chat shows the message that was sent. While agents are working, the room list gathers those rooms and says whether each is still on your message or already replying. A one-time reminder that can still run today can be held three hours later; Another Me then runs it at that time. While an agent is working in a Room, Watch the work opens that run on its own page and keeps reading it until the agent replies. Add a document lets the Human choose documents they can share and bind them into the Room. How work moves reads the room's team.md as the sequence of who starts, who receives a handoff, and who the result is reported to. A newly published team.md replaces that page. Who can manage lets an owner choose which people may change the room afterwards. The room keeps those roles. While a run is in progress, Steer this run shows the plan the agent published and can stop it before the next step. Who is speaking (`/t/:tenantId/voices`) names the voices in the open recording; the recording keeps those names on this computer. Right now (`/t/:tenantId/hearing`) shows the words a recording is hearing as they arrive. Who is awake (`/t/:tenantId/awake`) shows which agents can be reached and opens a chat with one. Surprise me (`/t/:tenantId/surprise`) spins the rooms you belong to and opens the one it lands on. Stepping out of a regular room stops new messages and sending until you come back. Hand this off (`/t/:tenantId/rooms/:roomId/hand-off`) creates an issue for someone else in that room, so the job waits on the dashboard. What an agent can do (`/t/:tenantId/agents/:agentId/can-do`) turns that agent's skills on or off for the next time they work. A shared conversation can be watched in the order it happened: each message waits a compressed beat of the gap before it, and a quiet stretch is named. A Room in the sidebar and in search leads with the face of whoever spoke last. When every person in a room has reacted to one message, that message stays above the timeline until the agreement breaks. Earlier conversation takes the room back one stretch of five quiet minutes or a new day; later messages leave until Back to now, and sending a message returns to the live room. Words still in the Room composer sit at the end of the timeline in the writer's place until they are sent or cleared. A voice draft or a message already on its way keeps that place instead. Two messages from different people within three seconds land as one moment, side by side once the room is wide enough. When Another Me says something new while the person is somewhere else in the app, those words arrive where they already are. Opening Another Me's chat or dismissing the arrival leaves it. The first reading only marks the latest message, and quiet hours still hold it. In Another Me's chat, and on the sidebar card while that chat is open, Another Me wears your picture, or your initials when you have not set one. Leaving the chat returns their own figure. Scrolling today's page continues into the newest earlier day that has words; that day stays read-only and is not written onto today. An open Pocket note stays open while you move between rooms. When more than one enabled routine would fire in the same minute, the oldest keeps that minute and its instruction gains the others' work; the rest of that minute is removed. Coming back to this window after a minute opens the one room whose conversation moved while it was hidden, unless you are already there, writing, or a dialog is open. Messages that arrive while this window is hidden stay unread until you click, type, or scroll. A message the server never confirmed is sent again when this window becomes visible after being hidden. A mention of someone who leaves the room is lifted out of the message that has not been sent. A profile stays open only while that person is in the room; once they leave, it closes. Sitting still in an open room that stays quiet lets the timeline rest, so the next message does not pull the view. Words still being said after the last confirmed line stay on the recording while it saves, until that line arrives. A sentence that finishes while someone is still talking stays on the recording, and the words still being said continue after it. When someone you named has not answered for an hour, an empty composer in that room becomes a follow-up to them on that message. If they answer before it is sent, and it was not edited, the follow-up leaves. When a run you started finishes while you are in another room, its reply stays in the working list until you open that room. When two agents answer the same message, those answers sit together. A question you asked yesterday that is still unanswered leads the room this morning, until you speak again or leave.
- `src/features/settings`: Settings. My Rules can review newly learned shadow rules one at a time. Promote makes a rule active; Leave keeps it in shadow. What this changes next shows where a shadow rule would have decided differently, then lets it decide so the next match follows it. On Shortcuts, pressing a shortcut says what it does and every place it works.
- `src/features/work-items`: What happened opens one Work Item's description and the recorded story, and can open the Room doing the work. Two selected cards can be read side by side, including how they differ on state, priority, and whether a room is doing the work. The board itself still edits through its existing peek, selection, and menus. When the Work Item was opened while a meeting was still underway, the story names that meeting, how far in, and opens it. When a Pocket note exists for the day the Work Item was opened, the story shows that note. When someone is assigned and is not a member of the room doing the work, the story says so. A Work Item you created and assigned to yourself, still open after the day you created it, leads Todo. - `src/features/memory`: A finished meeting whose summary has outcomes and no decision opens on the last words of the transcript.
- `src/features/jump`: one field that opens a room, a meeting, or a library
  place. Cmd/Ctrl+J opens it from the shell. It does not search message text.
- `src/features/memory`: Meetings. Reading the transcript while its summary is
  still being written keeps that place when the summary arrives. A recording
  already playing while its summary is still being written stays where it is
  when the summary arrives. - `src/features/wiki`: A Wiki page Another Me finished yesterday waits at the
  front of Wiki until that page is opened.
- `src/features/local-computer`: What this Mac can do asks macOS for Screen Recording and Accessibility on one computer, then relaunches Linger when a new grant needs it.
- `src/test`: unit-test support, including the in-process TeamHub test server.
- `e2e`: Playwright product workflows; every spec runs on the real TeamHub and
  Document Runtime stack (`make check-e2e-room-document`).

## Important Conventions

- Active product data comes from TeamHub, never retired Workspace APIs. Web has
  no fixture backend and no build mode that swaps TeamHub out.
- Unit tests that need TeamHub use `createTestTeamHubRuntime`
  (`src/test/teamhub-test-runtime.ts`): the real typed client against an
  in-process `TeamHubTestServer` that answers seeded reads. Declare every write a
  test depends on with `runtime.server.on(...)` or an `accept*` helper; an
  undeclared request fails with `TEST_ROUTE_MISSING`. Tests of one client call
  may inject `fetchRequest` (`fetchDouble`) instead.
- Unit tests must not depend on machine speed: rely on the global 5s async wait (Testing Library and `vi.waitFor`) instead of per-test `timeout` options, use fake timers for time-based behavior, and put real Vite/Rollup builds in `*.build.test.ts`.
- TanStack Query owns remote state; route loaders only ensure feature-owned queries.
- Components do not handwrite TeamHub endpoints or wire DTOs. Every TeamHub
  request names a generated contract path through the `openapi-fetch` client in
  `src/features/teamhub/teamhub-api.ts`; SSE, XHR upload, and download URLs use
  its `teamHubUrl`.
- Web never serves the Local Computer release. The Agent Service owns
  `/install/`: the production static host forwards `/install/`,
  `/v1/runner-gateway`, `/v1/local-mcp-relay/`, and `/v1/context-content/` to
  `TEAMHUB_NODE_SERVICES_URL` when it is set, and Vite
  development forwards `/install/` to the local Agent Service listener. Both
  hosts forward the Computer `teamhub` CLI's `/api/agent/` to
  `TEAMHUB_BASE_URL`, so a Computer needs only the Web origin.
  Never bundle installers or CLI releases into Web.
- Effects owning SSE, WebSocket, polling, timers, or subscriptions may depend only on resource identity; UI callbacks and presentation state must not recreate them. Lifecycle changes require a test proving unrelated rerenders do not resubscribe and identity changes clean up exactly once.
- Browser configuration for local Vite reads `import.meta.env.VITE_*`
  through the app config boundary. Production builds follow the page origin
  (same-origin TeamHub `/v0` and Document Runtime `/document-collaboration`)
  so one image works on every gateway, test environment, and deployed
  environment.
- Use Tailwind and local components; do not add a broad UI library. Render UI icons
  only through `Icon` from `src/components/ui/icon.tsx` with
  `@hugeicons/core-free-icons` (14px in rows and menus, 16px in buttons and the
  rail); `lucide-react` remains only in the Runtime activity views
  (`src/features/rooms/task-sidebar/adapters/runtime-history-view.tsx` and
  `src/features/rooms/runtime-status/runtime-tool-presentation.ts`).
- Styling: Tailwind utilities plus design tokens are the standard. Use token
  classes (Town semantic tokens such as `text-muted-foreground`, or
  `--color-app-*` roles such as `text-app-ink`) instead of hex arbitrary values;
  when no token fits, add one to `src/app/visual-theme.css` and the
  `@theme inline` block in `src/app/globals.css`.
- Compose conditional class names with `cn` from `src/lib/cn.ts`.
- Do not add CSS Modules or feature-level `.css` files, and do not add new hex
  colors in TSX. Use inline `style` only for runtime-computed values.
- Keep element-level CSS resets (for example `button, input { font: inherit }`) inside
  `@layer base`; unlayered rules beat Tailwind utilities and silently disable `text-*`
  classes. Reference CSS variables for font families with
  `font-(family-name:--var)`, never `font-[var(--var)]`, which Tailwind reads as a
  font-weight.
- Two Tailwind utilities that set the same CSS property are resolved by their order
  in the generated stylesheet, not by their order in the `className` string. Writing
  the one you want last does nothing. Never stack competing `display` or `position`
  utilities on one element, and never pass such a utility to a component that already
  hardcodes one: `.relative` is emitted after `.absolute`, so an `absolute` handed to
  a component whose base classes include `relative` is dropped and the element falls
  back into normal flow; `.block` is emitted after `.line-clamp-*`, so adding `block`
  replaces the `display:-webkit-box` the clamp needs and the clamp stops truncating.
  Put the conflicting utility on a wrapper element instead. Neither typecheck nor
  React Doctor catches this and it renders fine in unit tests, so assert the outcome
  (the wrapper carries the positioning, the clamped node carries no `block`) in a test
  and confirm that test fails when the utility is put back on the same element.
