# Plan: axHub vault management in AmberX

Status: PLANNED (Nov 2 2026, Brett asked). Not started. Nothing built yet.

## Why
The only way to set an axHub secret today is `axhub vault set` in the Coolify terminal. On Nov 2 the Hostinger audit was blocked because the `hostinger` service has no token in the vault (registered Oct 20, token never set). Brett builds from his phone, so this needs to be a few taps, not a terminal.

## Goal
From the Dev Console and the AmberX app, Brett can:
- see every axHub service and whether its credential is set, missing or unreadable
- set / replace / remove a secret (write-only: values are never shown or sent back)
- jump straight from a "credential not available" error to the Set key screen
- (later) rotate the vault master key without the terminal

## Hard rules (security)
- Write-only. No endpoint, screen or log ever returns a secret value. Status only: set / missing / unreadable, key id, last changed, who changed it.
- Human only. Setting secrets is an admin-session action (signed-in admin, `/auth/api/*`). It is NEVER an MCP tool, so no Claude session, headless build or agent can set, read or remove a secret.
- Every change goes in the audit log (who, which ref, when, outcome), never the value.
- Vault writes are compare-and-swap (roadmap step 4 item) so two screens can't overwrite each other.
- Secret fields: no autofill save, no paste history, cleared on submit, FLAG_SECURE on Android for that screen only.
- Light format check per known service (reuse the patterns in `apps/console-web/server/credentials.py`), never a guarantee.

## Pieces

### A. axHub (repo MossesX/axHub)
1. Admin API, write-only secrets: `GET /auth/api/vault` (refs + status, no values), `PUT /auth/api/vault/<ref>` (value in body, CAS on version), `DELETE /auth/api/vault/<ref>`. Admin session + CSRF.
2. Service credential status: `GET /auth/api/services` gains `credentialRef` and `credentialStatus` (set | missing | unreadable).
3. Test key: `POST /auth/api/services/<ns>/test` runs one fixed read-only call (e.g. GitHub `users/get-authenticated`, Hostinger `VPS_getVirtualMachinesV1`) and returns ok / auth failed / unreachable. No output passed back.
4. Better error: the `unavailable` credential error includes a deep link `axf://vault/<credentialRef>` so Claude can hand Brett a one-tap fix.
5. Tests: contract tests, value never in any response/log/audit, CAS conflict, non-admin refused, MCP has no route to it.

### B. Dev Console (apps/console-web)
1. New plugin `axhub-vault`: list of services with a status chip (green set / red missing / amber unreadable), Set key / Replace / Remove / Test.
2. Built from framework controls + assets (list, status chip, secret-input dialog); new `secret-input` control asset if one doesn't exist.
3. Systems check: link each axHub-backed row to this page. Decide whether the console's own HOSTINGER_API_TOKEN etc. stay separate (default: yes, separate stores, but show both statuses side by side so it's obvious).
4. Register in Directory + help@1 pack + Shortcuts.

### C. AmberX app (apps/amberx-droid)
1. Vault screen (same assets as the console plugin), reachable from Settings and from `axf://vault/<ref>` deep links.
2. Handles the deep link from an approval/push or a Claude reply: opens straight on that one secret's Set key dialog.
3. FLAG_SECURE on this screen only (listeners change removed it app-wide; keep it scoped here).

### D. Later
- Master-key rotation flow from the UI (generate, store, rotate-master, clear previous), guarded by a second confirmation.
- Expiry reminders for tokens that have one (push via ntfy).

## Order
1. A1-A2 (+ tests). Model: **Fable** (API contract, vault data model, security boundary).
2. A3-A4. Opus.
3. B (console plugin). Opus; **Fable** for any new asset type (`secret-input`, status-chip schema).
4. C (AmberX screen + deep links). Opus.
5. Independent security review of A before it ships (separate agent, hasn't seen the code). Fable.
6. D later.

## Done when
- Brett sets the Hostinger token from his phone in under a minute, Test says ok, and `/audit-hosting` runs end to end.
- Grep of responses, logs and audit shows no secret value anywhere.
- A Claude session has no tool that can touch the vault.

## Until then
Coolify -> axHub -> Terminal: `axhub services show hostinger` (read credentialRef), then `axhub vault set <ref>`.
