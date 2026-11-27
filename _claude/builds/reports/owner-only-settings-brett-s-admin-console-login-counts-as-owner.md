# Owner-only settings: Brett's admin console login counts as owner

Build `owner-only-settings-brett-s-admin-console-login-counts-as-owner` (Fix, Opus, Phase 1). Branch
`claude/owner-only-settings-brett-s-admin-console-login-counts-as-owner`.

## Problem

Brett, Nov 6 2026 (voice): Settings → Plugins → Claude would not let him turn on No wait: "owner only … I'm logged in
as admin." Every owner-only switch (No wait, Include irreversible, Launch builds without asking, Default model,
Fable upgrades need my approval, UI Review gate) and every raise was refused from his own signed-in console.

## Cause

The console browser sends the stored console token as well as axHub's signed wall session headers. Auth resolves
the token first, so `request.state.axf_user` was the token caller, and `token-control`'s `owner_approval()` never saw
the admin session. Claude settings asks `control.owner(request)`, which calls `owner_approval()`, so it got `None`.

## Fix

`apps/console-web/plugins/token-control/server/__init__.py` `owner_approval()`: when the resolved user is not an
admin session, it also checks axHub's signed wall headers (`wall.wall_caller`) and accepts a valid admin session from
the console's own origin (`wall.same_origin`). Still refused: the bare token (Claude sessions, MCP, CLI), a forged
signature, a non-admin wall user, a cross-site write, and any request while the server runs inside a Claude session.

The change was first written on `claude/fix-owner-check-start-btn` (commit 59f9ed44c, Nov 8, never opened as a PR).
This build takes only its owner-check part, unchanged; the Build manager Start fix in that commit belongs to the
running build `fix-owner-check-bug-dead-start-button`.

### Client half (second commit)

The server half only helps when axHub forwards the signed session headers alongside a bearer request. The wall
passes a request with `Authorization: Bearer` on `/api/` as `X-Auth-Via: token` with no session headers, so behind
the wall the stored token still hid Brett. `apps/console-web/src/plugins.ts` gains `ownerFetch(folder, path, init)`:
Brett's own actions go out with his signed-in session and **no** console token, so the hub has to stamp the signed
session; it falls back to the token only on 401 or a sign-in redirect (no wall, no session), where the server answers
what the token may do. Used by Claude settings saves (`web/index.tsx` `save()`) and by token-control's veto-pass
owner calls (`web/pass.tsx` `ownerCall`, which had its own copy of the same idea). Documented in
`apps/console-web/plugins/README.md`.

## Reach (API)

No new UI. The setting page is unchanged and keeps its existing routes: deep link Settings → Plugins → Claude,
REST `GET/PUT /api/plugins/claude-settings/settings`, MCP `claude_settings_get` / `claude_settings_set`, CLI
`claude-settings.mjs`, voice through the same MCP tools. Owner-only keys stay owner-only on every path except Brett's
signed-in console, by design.

## Tests

- `python3 apps/console-web/plugins/claude-settings/test.py`: 37 checks pass. The 12 new checks fail against the old
  `owner_approval()` (checked by running them against main's version).
- `node apps/console-web/plugins/claude-settings/test.mjs`: 47 checks pass.
- `node apps/console-web/plugins/token-control/test.mjs`: 20 tests pass.
- `tsc --noEmit -p apps/console-web` clean; `check-theme`, `check-controls`, `plugin-lifecycle check claude-settings` pass.
- No unit harness covers `src/plugins.ts`; `ownerFetch` is checked by type and by the live check below.

## Next

Live check after deploy: Brett flips No wait in Settings → Plugins → Claude from his admin login.
