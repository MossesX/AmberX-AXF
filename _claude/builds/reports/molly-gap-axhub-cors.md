# molly-gap-axhub-cors

**Build:** Molly gap: axHub allows Molly's origin on /auth/api/* (CORS with credentials) so native screens read the hub session
**Origin:** found by `molly-sign-in-once` s1. Brett, 2026-11-10: "Standalone apps keep working until Molly covers them; list gaps as pending builds."
**Model:** Opus, phase 1 (s1–s3)

## Result

- The hub change is in the axHub repo: MossesX/axHub branch `claude/molly-gap-axhub-cors`, commit `752df88`, PR [MossesX/axHub#45](https://github.com/MossesX/axHub/pull/45).
- Tests: `packages/server/test/web.test.ts` 38/38 pass (rerun on 2026-11-15).
- This is not live yet. The hub needs that PR merged and a Coolify redeploy. The live check is the pending build `molly-gap-axhub-cors-live`.

## What changed (axHub)

- `packages/server/src/web.ts`
  - `apiOriginOk()` checks the allow-list: exact https origins from `AXHUB_API_ORIGINS`. Unset means `https://molly.amberxai.com`; empty means none. There is no wildcard and no "anything under the cookie domain" rule.
  - `/auth/api/*` middleware, for a listed origin:
    - echoes `Access-Control-Allow-Origin` (never `*`)
    - sends `Access-Control-Allow-Credentials: true`
    - always sends `Vary: Origin`
    - answers the preflight `OPTIONS` with 204, allowing `Content-Type, Accept, X-AxHub-CSRF` and the methods, `Max-Age 600`
  - The write guard accepts the hub's own origin or a listed origin, and still requires the session's `X-AxHub-CSRF` token. Unlisted origins get no CORS headers and a 403 on writes, as before.
- `.env.example` documents `AXHUB_API_ORIGINS`.
- Session cookie: unchanged (same-site, SameSite=Lax is enough because molly.amberxai.com and axhub.amberxai.com are the same site).

## Molly side

Already in place: `apps/molly/src/molly/credentials.ts` (axhub provider, `credentials: "include"`, `X-AxHub-CSRF` on writes). Nothing changed in AXF.

## Gaps listed as pending builds (s2)

- `molly-gap-axhub-cors-live`: once axHub #45 is deployed, run these checks:
  - the session GET from the Molly origin echoes the origin and sends credentials and Vary
  - the preflight answers 204 with the allowed headers
  - an unlisted origin gets nothing
  - Molly's App connections screen shows axHub signed in
  - logout works from Molly

Until then, standalone apps keep using the hub directly, unchanged.

## API

There is no UI in this build. The change is to the existing `/auth/api/*` REST API, which Molly, the console, MCP and the CLI already reach through their current paths.
