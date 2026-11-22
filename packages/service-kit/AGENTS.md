# Service Kit: Shared TypeScript service helpers

Small helpers shared by Web, Node services, Voice Runtime, and the local
installation core.

## Common Commands

- `pnpm --filter @linger/service-kit check`: typecheck, lint, and test the package.

## Structure

- `src/index.ts`: isomorphic entry (`isRecord`, `isNodeError`, `asError`,
  `displayText`, `sleep`, fetch test-double text helpers, and `sourceRegion`
  / `orderByRegion`, which order mirrors of one download by the
  `SIMPLEX_REGION` contract in `scripts/installs/README.md`). It must not import
  `node:` modules because the Web app bundles it, and it stays free of relative
  `.js` imports so raw Node type-stripping can load it directly.
- `src/byok-endpoint.ts`: isomorphic BYOK address entry (`byokProtocolFor`,
  `defaultByokEndpoint`, `normalizeByokPath`, `normalizeByokBaseUrl`,
  `validByokPath`, `isByokProtocol`, and the BYOK path pattern and runtime
  default constants), exported as `@linger/service-kit/byok-endpoint`.
- `src/featured-models.ts`: isomorphic featured partner model constants and
  structured model-ID matching (`INKLING_2_MINI_ANNOUNCEMENT_URL`,
  `INKLING_2_MINI_HF_URL`, `isInkling2MiniModelId`), exported as
  `@linger/service-kit/featured-models` for Web, Desktop, and the installer.
- `src/messages.ts`: isomorphic message formatting (`defineMessages`,
  `formatMessage`, `resolveMessage`; plurals through `Intl.PluralRules`,
  `{name}` placeholders and `<tag>` spans), exported as
  `@linger/service-kit/messages` for the Web client and the desktop shell.
  It holds no catalog and no language choice.
- `src/node.ts`: Node-only entry (`sha256Hex`, `createJsonLogger`,
  `serviceCredential`). `serviceCredential` takes the environment from its
  caller and is checked against `contracts/fixtures/service-credentials/vectors.json`.
- `src/json-logger.ts`: one-JSON-line logger whose shape matches Agent's
  `AgentLogger`; keep the redaction rules aligned with
  `apps/node-services/src/agent/observability/agent-log.ts`.

## Important Conventions

- Add a helper here only when two or more apps need identical behavior; keep
  the package free of runtime dependencies and environment variables.
- The package is built into the Web image (`apps/web/Dockerfile`) and the
  node-services image (`apps/node-services/Dockerfile`, which also carries the
  voice runtime); a new consumer must add the package to that image's
  Dockerfile.
