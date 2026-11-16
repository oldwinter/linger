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
- `src/features/rooms`: Room routes, Chat, Timeline, the right sidebar (Agent Info, Activity, Thread, Document) and membership UI. Catch up freezes the chats that had new messages or mentions and walks them one at a time; opening a chat leaves the rest of the walk in place. Today's Pocket note can be sent into Another Me's chat; the note is saved first, and Open chat shows the message that was sent. While agents are working, the room list gathers those rooms and says whether each is still on your message or already replying. A one-time reminder that can still run today can be held three hours later; Another Me then runs it at that time. While an agent is working in a Room, Watch the work opens that run on its own page and keeps reading it until the agent replies. Add a document lets the Human choose documents they can share and bind them into the Room. How work moves reads the room's team.md as the sequence of who starts, who receives a handoff, and who the result is reported to. A newly published team.md replaces that page. Who can manage lets an owner choose which people may change the room afterwards. The room keeps those roles. While a run is in progress, Steer this run shows the plan the agent published and can stop it before the next step. Who is speaking (`/t/:tenantId/voices`) names the voices in the open recording; the recording keeps those names on this computer. Right now (`/t/:tenantId/hearing`) shows the words a recording is hearing as they arrive. Who is awake (`/t/:tenantId/awake`) shows which agents can be reached and opens a chat with one. Surprise me (`/t/:tenantId/surprise`) spins the rooms you belong to and opens the one it lands on. Stepping out of a regular room stops new messages and sending until you come back. Hand this off (`/t/:tenantId/rooms/:roomId/hand-off`) creates an issue for someone else in that room, so the job waits on the dashboard. What an agent can do (`/t/:tenantId/agents/:agentId/can-do`) turns that agent's skills on or off for the next time they work. When two agents answer the same message, those answers sit together.
- `src/features/settings`: Settings. My Rules can review newly learned shadow rules one at a time. Promote makes a rule active; Leave keeps it in shadow. What this changes next shows where a shadow rule would have decided differently, then lets it decide so the next match follows it.
- `src/features/work-items`: What happened opens one Work Item's description and the recorded story, and can open the Room doing the work. The board itself still edits through its existing peek, selection, and menus.
- `src/features/jump`: one field that opens a room, a meeting, or a library
  place. Cmd/Ctrl+J opens it from the shell. It does not search message text.
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
