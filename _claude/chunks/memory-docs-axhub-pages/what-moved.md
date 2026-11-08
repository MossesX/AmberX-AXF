<!-- memory-chunk@1 source=_claude/memory/docs/axhub-pages.md lines=7-21 tokens=271 -->
## What moved

| Old hub page (plain HTML, deleted) | Now | Old address |
|---|---|---|
| Approvals grid, filters, pages, auto-approve 5/10/30 min | `#/approvals[?status=]` (view `home`) | `/auth/admin/approvals` → 302 |
| One request: whole call, Approve / Decline / Postpone / Ignore / Revoke / Reopen, history | `#/approvals/<id>` (view `approval`) | `/auth/admin/approvals/<id>` and `/postpone` → 302 |
| Approvals log + auto-approve windows | `#/approvals/log` | `/auth/admin/approvals/log` → 302 (`log.json` download kept) |
| Users | `#/users` | `/auth/admin/users` → 302 |
| Your account, browsers, sign out | `#/account` | `/auth/account` → 302 |
| Apps | `#/apps` | `/apps` → 302 (`/apps.json`, downloads kept) |
| Handoff results + live installation page | `#/handoff`, `#/handoff/<id>[?file=]` | `/handoff…` → 302 (raw files + the run-key progress POST kept) |

Kept on the hub as HTML: sign-in (`/auth/login`), first password (`/auth/first`, now with Sign out), and a 503 page
at `/` for when the web app's container isn't running (says how to approve from the terminal).
