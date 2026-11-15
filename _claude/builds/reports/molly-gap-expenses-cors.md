# molly-gap-expenses-cors

Brett (2026-11-10): "Standalone apps keep working until Molly covers them; list gaps as pending builds."

## Result

Molly (`https://molly.amberxai.com`) can call the Expenses ledger API `/api/expenses/v1/*` cross-origin with the user's `axs_session` cookie.

- s1: CORS with credentials on `/api/expenses/v1/*` and `/api/ai/*` via `apps/expenses/src/server/cors.ts`. This shipped to main in 8662ac865 ("Expenses API: CORS with credentials for Molly, v1/me whoami"). Allowed origins get an exact echo of `Access-Control-Allow-Origin` (never `*`), `Allow-Credentials: true`, `Allow-Methods: GET, POST, PATCH, OPTIONS`, `Vary: Origin` and an `OPTIONS` handler (204; any other origin gets 403). The allow-list is `https://molly.amberxai.com` plus the `EXPENSES_CORS_ORIGINS` env (comma separated).
- s2: Requests without an Origin and same-origin requests get no extra headers, so the standalone app is unchanged. The gap found here, that the API has no DELETE (Molly cannot remove an entry), was filed as pending build `molly-gap-expenses-delete`. The standalone app keeps its undoable delete until that lands.
- s3 (this PR): adds `accept` to `Access-Control-Allow-Headers`, which the gap spec asked for, and extends the preflight test to check the full header set plus the 403 for an unknown origin.

## Live check (2026-11-15, expenses.amberxai.com)

- `OPTIONS /api/expenses/v1/entries` with `Origin: https://molly.amberxai.com`: 204 with Allow-Origin echoed, Allow-Credentials true, methods, headers and `Vary: Origin`.
- `GET /api/expenses/v1/entries?limit=1` signed out: 401 with the CORS headers, so Molly can read the error and send the user to sign in.
- Production does not send the `accept` header yet. It shows up after this PR deploys. It is a CORS-safelisted header, so nothing is blocked in the meantime.

## Tests

`cd apps/expenses && npx tsx scripts/expenses-api.test.mts`: 40 checks pass.

## API

There is no UI in this build. The ledger API is the API surface and is reached through REST (`/api/expenses/v1/*`), the expenses CLI and the console MCP tools, all unchanged except for the CORS headers.
