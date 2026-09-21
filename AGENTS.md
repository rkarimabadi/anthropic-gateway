# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A local **gateway** that speaks the Anthropic Messages API and forwards every
request to any OpenAI-compatible provider, forcing all requests to one
configured upstream model. Purpose: make Anthropic-only clients (Claude Code
GUI/CLI, Anthropic-SDK tools) run against arbitrary backends.

## Stack & layout

- **Node.js >= 18, CommonJS.** No build step, no TypeScript in `lib`/`cli.js`.
- Runtime deps: only `fastify` and `openai` (see `package.json`).
- No git repo, no test suite, no linter configured. Do not assume a test
  runner; verify by running the CLI manually.

```
cli.js              CLI entry: setup / start / stop / status / autostart
lib/server.js       Fastify server: /health, GET /v1/models, POST /v1/messages
config.example.json Config template
vendor/             VENDED, PRE-COMPILED claude-adapter core (MIT) — see below
```

## The vendor/ directory (important)

`vendor/dist/**` is **compiled output** of a third-party package
(`claude-adapter`, MIT — see `vendor/LICENSE.claude-adapter`). It is not our
source and is not typechecked here.

- **Do not hand-edit `vendor/dist/**`.** If a conversion bug is needed, the
  fix belongs in the upstream project or a documented, minimal patch with a
  comment explaining why.
- `lib/server.js` only imports a handful of vendor modules. If you change the
  gateway's conversion behavior, you almost always want `lib/server.js`, not
  vendor.

### What the gateway actually pulls from vendor

Directly (`lib/server.js`):
- `vendor/dist/converters/request.js` — `convertRequestToOpenAI`
- `vendor/dist/converters/response.js` — `convertResponseToAnthropic`, `createErrorResponse`
- `vendor/dist/converters/streaming.js` — `streamOpenAIToAnthropic`
- `vendor/dist/utils/validation.js` — `validateAnthropicRequest`, `formatValidationErrors`

Transitively reached by those (request/response/streaming/tools +
`utils/errorLog`, `utils/tokenUsage`, `utils/fileStorage`, `utils/update`,
`utils/metadata`):
- `converters/request.js` rewrites the Claude Code system-prompt identifier
  into a "Claude Adapter" branding string — a deliberate side effect, not a bug.
- `utils/fileStorage.js` / `utils/metadata.js` read/write under
  `~/.claude-adapter/` (a separate dir from our own `~/.anthropic-gateway/`).
- `utils/update.js` can fetch `registry.npmjs.org` to check for updates, but
  that path is only invoked by vendor's own `cli.js`, **not** by our gateway's
  request path — normal `/v1/messages` traffic makes no npm calls.

Files that exist in vendor but are NOT used by the gateway (its own server,
cli, logger, config, ui, provider, types): leave them alone; don't wire them in
unless asked.

## Runtime state & config

- Config/pid/log live in `~/.anthropic-gateway/` (override dir with
  `ANTHROPIC_GATEWAY_HOME`): `config.json`, `gateway.pid`, `gateway.log`.
- `lib/server.js` requires `proxyTokens` (>=1), `upstreamBaseUrl`,
  `upstreamApiKey`, `upstreamModel`. Client auth is `Bearer` or `x-api-key`
  matched with `crypto.timingSafeEqual`.
- Server binds **127.0.0.1 only**. It is a localhost bridge, not a public
  service. Don't expose it; treat proxy tokens as secrets (they are stored
  plaintext in config.json — that is by design, note it in any change).
- `lib/server.js` keeps in-memory per-session token totals (input/output/cached,
  request count) and per-request token logging; `GET /health` exposes them
  plus version/pid/uptime. Full request/response body logging is gated by the
  `fullLogging` config flag and is written to `logFile` only (never console),
  so streaming stdout stays clean. CLI surfaces these via `status` (pretty) and
  `fulllogging on|off`.

## Platform assumptions

Windows-first:
- `autostart on` writes a `.cmd` into the Windows Start Menu Startup folder
  (`AppData/Roaming/.../Startup/anthropic-gateway.cmd`).
- `stop` relies on a pid file + `process.kill`.

## Conventions

- Keep it dependency-free: avoid adding runtime deps; prefer Node built-ins.
- Preserve CommonJS (`require`/`module.exports`) in `lib/` and `cli.js`.
- Errors from the upstream are mapped to Anthropic error envelopes via
  `createErrorResponse`; keep that mapping consistent when adding endpoints.
