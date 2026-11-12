# molly-gap-console-token-handoff: the console frame hands Molly its token; the console API allows Molly's origin

Brett, Nov 10 2026: "Standalone apps keep working until Molly covers them; list gaps as pending builds."
Found by molly-sign-in-once s1. Branch `claude/molly-gap-console-token-handoff`, Opus, headless.

## s1: CORS + embed@1 `credentials`

**CORS (console API).** `apps/console-web/server/cors.py` is the allow-list: every `https://*.amberxai.com` origin,
`http(s)://localhost` / `127.0.0.1` on any port, plus `AXF_CORS_ORIGINS` (exact origins; `*` and junk dropped).
Allow-Headers `authorization, content-type, accept` (+ the session headers), no cookies (`allow_credentials` off), max-age
600. `main.py` adds `CORSMiddleware` after the wall/token gates, so it is the outermost layer: a preflight is answered
before any token check and a gate's 401 still carries CORS headers (Molly reads "signed out", not "unreachable").
At the edge, axHub's wall answered OPTIONS with 401 before the app saw it: `axf_wall_preflight_labels`
(`framework/deploy/axf-deploy.sh`) adds a Traefik router for `OPTIONS` on the console host that skips the wall (strip
only, same service); `deploy/install-console.sh` uses it. The real request still meets the wall.

**embed@1 `credentials` (guest → host).** `{app, scheme: 'bearer', token}` in `framework/core/engines/embed.ts`
(`parseEmbedMessage`, `EMBED_CREDENTIAL_HOSTS = { molly: ['https://molly.amberxai.com'] }`, `embedCredentialTarget`).
Runtime `handCredentials(app, scheme, token)` posts it only when embedded under a recognised host name whose exact origin
matches the parent's browser-reported origin (`ancestorOrigins`, else referrer), targeted at that origin (never `*`),
once per token value, never standalone or from a page shown alone, never logged. The console calls it at start and on
every token change (`apps/console-web/src/main.tsx`). Molly's xLayout host (`ChromeHost.takeCredentials`) accepts it
only from that app's own frame and origin, for the frame's own app and the provider's own scheme, and calls the
provider's `signIn(token)` unless Molly already holds a token that checks as signed in. Engines synced to all four apps;
fixtures regenerated (`credentialMessages` / `credentialTargets` / `credentialExtra` in `embed-takes.json`). Kotlin
twin deferred in `framework/spec/PORTING.md`.

## s2: standalone apps keep working; gaps

- Standalone console: no change (no host, so nothing is handed; same-origin calls never meet CORS). CLI / MCP / curl
  don't use CORS. AmberX reaches console plugins through its own server (same origin). A Capacitor shell
  (`https://localhost`) stays allowed.
- Molly keeps its paste-a-token sign-in (`molly.auth.*` actions) as the fallback.
- New pending build: `molly-gap-expenses-token-handoff` (the Expenses frame hands its token the same way; depends on
  `molly-gap-expenses-cors`). Already pending: `molly-gap-axhub-cors`, `molly-gap-expenses-cors`.

## API

There's no new UI. The handoff runs on its own. Molly's console sign-in state and actions are reached as before through
`molly.auth.*` (console actions, MCP, CLI, voice). The CORS allow-list is server config (`AXF_CORS_ORIGINS`).

## Tests

- `python3 apps/console-web/server/test_cors.py`: 28 checks (new; added to CI next to test_wall_users)
- `check-embed.mts` 464, `check-xlayout.mts` 199, `check-molly-credentials.mts` 148, `framework/deploy/test.sh` 54
- tsc clean for console-web and molly; check-theme, check-controls pass
- `test_wall_users.py` fails locally at "the page itself" on the committed `main.py` too (it fails before this
  change as well), so this build didn't cause it

## After merge

Redeploy the console (`deploy/install-console.sh`) so the preflight router label exists; until then the wall still
answers Molly's preflight with 401.
