# Data container: axf-data holds all console data

Build `data-container-axf-data-holds-all` · branch `claude/data-container-axf-data-holds-all` · PR #704 · Phase 1 Fable
(contract), Phase 2 Opus (this report).

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need."

## Result

Built and tested end to end; nothing has moved yet. Every namespace is still **local**, so the console behaves exactly
as before until a namespace is moved on purpose. The console-down drill passed: with the console container stopped, a
note and the builds list were read through the axHub route, and a builds-store write from the axf-molly side landed
(`deploy/dryrun/results/console-down-drill.json`).

**The cutover is staged:** per namespace, `data-migrate apply` (backup first, verify) → `data-mode shadow` (writes go to
both sides, differences are logged) → `data-mode cutover` only once shadow has had zero drift for the window (30 min by
default; logged drift must be read and accepted) → `data-mode rollback` any time after.

## What was built

| Piece | Where | How it is reached |
|---|---|---|
| Contract checks: rev conflicts, append-only journals, count manifests, mode shortcuts refused; `--http` replays the client scenario on a live server | `framework/spec/check-data-store.mjs` | CI |
| axf-data service: FastAPI, SQLite + content-addressed blobs, rev / etag checks, token auth (data-token@1 + hashed service tokens), journal triggers, history + restore, SSE watch | `services/axf-data/` | `/v1/…` on the internal network |
| Private deploy: Dockerfile (non-root, healthcheck), Coolify compose, `install-data.sh` (internal network, named volume, tokens made once, restart unless-stopped, deploy log) | `services/axf-data/Dockerfile`, `compose.yaml`, `deploy/install-data.sh` | VPS |
| Daily backups (online SQLite backup + blobs, 14 days + weekly), verify against the live store, restore | `services/axf-data/backup.py`, `deploy/axf-data-backup.cron` | cron, `axf data backup`, console, MCP, voice |
| Systems check item: reachable, last backup age, verify result; Auto fix = backup now or restart (veto calls) | `apps/console-web/plugins/systems-check/server/axf_data.py` | Systems check banner |
| Console server data layer (storage-shaped, mode-aware, drift log) | `apps/console-web/server/data_store.py` | every server writer that adopts it |
| Node data layer + `persist.mjs` readData / writeData, plugin data folders | `framework/core/data-files.mjs` | CLI, plugins |
| Builds store on data-store (lock = rev check in cutover; journal + history from axf-data) | `framework/cli/builds-store.mjs` | orchestrator, headless sessions, axf-molly |
| Claude settings, Plan Studio, UI Review, notes, changes log, shipped-features and chat-viewer SQLite on the data layer | their plugins | unchanged surfaces |
| Migration: dry run, backup first, copy, M0 = M1 manifests + SQLite row counts, refuses on mismatch | `framework/cli/data-migrate.mjs` | `axf data migrate` |
| Modes: status / shadow / cutover / rollback / local, guards, replay, mode + drift log on axf-data | `framework/cli/data-mode.mjs` | `axf data mode`, console, MCP, voice |
| Settings → Plugins → Data store (3 layout options) | `apps/console-web/plugins/data-store/` | deep link `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=data-store` |
| axHub route: MCP tools on axf-data (notes, builds, settings, raw data), downstream document | `services/axf-data/mcp.py`, `deploy/axhub/axf-data.downstream.json` | axHub (`data.*`) |
| Console-down drill | `deploy/dryrun/console-down-drill.sh` | by hand / CI-able |

API parity for the Data store screen: REST `/api/plugins/data-store/{state,drift,backup,verify,mode,voice}`; plugin
commands (MCP) `state`, `drift`, `backup`, `verify`, `mode`, `voice`; CLI `axf data [status|backup|verify|mode|drift|migrate|get|list]`;
voice through the `voice` command ("back up the data", "shadow the planner", "cut settings over", "roll back the builds";
moves ask before they run); control targets on every button (`button:data-store-*`) and row.

## Found on the real data (dry run on this VPS)

- 230 builds-journal entries are over the 256 KiB entry limit: they move as records under `builds/journal-large/` with a
  pointer line in the journal (the same scheme `builds-store.mjs` reads back).
- Some build ids are longer than the 80-character key segment: a stable short form (start + `--` + 16 hex of the
  SHA-256 + extension) is used by both clients.
- `changes/README.md` is excluded (the changes namespace holds records only).
- Remaining unmapped files are the app catalog's APKs (rebuilt from CI, by policy).

## Tests

| Check | Result |
|---|---|
| `node framework/spec/check-data-store.mjs` | 68 ok |
| `node framework/spec/check-data-migrate.mjs` (seeded copy of real data, live axf-data) | 15 ok |
| `node framework/spec/check-builds-store-data.mjs` (live axf-data) | 8 ok |
| `python3 services/axf-data/test_store.py` (incl. the Node contract replayed live, MCP tools, backups) | all ok |
| `python3 apps/console-web/server/test_data_store.py` · `apps/console-web/plugins/data-store/test.py` | all ok |
| claude-settings 47 + 21, plan-studio 27, ui-review 229 + 30 + check-ui-review 65, notes-browser, chat-viewer 98, codebase-changes 113, shipped-features 10, check-builds-store 40, check-builds-live 68, builds-store verify | pass |
| check-theme, check-controls, check-toolbars, check-console-control, glossary `--check`, `plugin-lifecycle check data-store` | pass (lifecycle flags only the untracked session brief) |
| Console-down drill | pass |

Not run here: `apps/console-web/plugins/shipped-features/test.py` needs Node 22's `node:sqlite` (the host has Node 20;
CI runs it). `apps/console-web/plugins/systems-check/test.py` fails one check ("ask first: red with its Auto fix
offered") on the base branch too, without this build's change.

## Open

- **UI Review**: the Data store tab's three layouts (r-20261115-29c7b1b6) wait for Brett; the default is "Three panels"
  until he picks, then the picked layout(s) are built as the default view.
- **VPS install** after the merge: `sudo bash deploy/install-data.sh`, re-run the console installer, then migrate and
  shadow one namespace at a time (settings first, builds last).
- **axHub side**: register `deploy/axhub/axf-data.downstream.json` in the axHub repo (route + token only).
- Console screens that read files directly outside the adopted plugins keep working in local / shadow; they move to the
  data layer before their namespace is cut over (`data-mode status` shows what is still local).
