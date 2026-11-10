# Resolve conflicts and land PR #449 (account order switch)

Build `resolve-conflicts-and-land-pr-449-account-order`, Opus. Brett, Nov 10 2026: "Yeah, land it."

## Outcome

- Merged `origin/main` into `claude/account-order-switch-custom-drag-and-drop-order` (merge commits, no rebase, no
  force push). The PR branch now carries main up to `be5d14cda`.
- The order switch now has the full API surface: read, set, move and reset over REST, MCP, CLI and voice.
- Not merged by hand. The merge queue (`land/merge-queue.mjs`, push-banner auto-merge) merges every open PR on this
  repo, and the standing rules forbid merging a PR from a session. #449 is open, conflict-free and waiting for the
  queue. #449 still contains #448's commit (accounts manager), so both land together.
- No console redeploy and no live check. The console deploys from main, so both happen after the queue lands #449.
- UI Review: not submitted. There is still no preview running the accounts manager. This merge adds no new screens or
  controls, only help text.

## Conflicts and how each was resolved

All code conflicts were in the build orchestrator's account picking. PR #449 (with #448) has one custom account order,
API keys included, plus a Custom / Automatic switch. Main's #450 (retire Build manager) has subscriptions first, then
API overflow (on by default), `routeOptions` / `planFor` / final-pick walk, and a 5-minute account health sweep.

| File | PR side | Main side | Resolution |
|---|---|---|---|
| `build-orchestrator/pipeline-core.mjs` header | `order` / `mode` doc | API overflow on by default, `order` from own.order, planning, health | Both, with a new `overflow` paragraph saying when each rule applies |
| `pipeline-core.mjs` DEFAULTS / `normSettings` | `order`, `orderMode`; `apiOverflow` removed | `apiOverflow: true`, `healthEveryMin` | Keep all four. `apiAccounts` uses the PR's `names()` |
| `pipeline-core.mjs` `accountView` | `rank` from `settings.order`; API usable while listed | health makes an account `limited`; `order` from own/row; API never usable alone | Health and `limited` from main. `rank` only while a custom order is in force (`orderInForce`). API usable when listed (custom order) or, with no order, while `apiOverflow` is on. `order` = rank, else own/row order. Both `rank` and `order`/`health` are returned |
| `pipeline-core.mjs` `candidates` / `apiCandidates` | `rankOf` sort | `byOrder` sort | Custom order in force: rank. Otherwise subscriptions before API, then `byOrder`. `apiCandidates`: rank, then `byOrder` |
| `pipeline-core.mjs` `routeOptions` / `planFor` / health helpers | (absent) | new | Kept. `routeOptions` follows the custom order (rule `order`, API interleaved) when in force; otherwise main's subscriptions-then-API walk (rule `auto` in Automatic, `overflow` otherwise) |
| `pipeline-core.mjs` `routeFor` (auto-merged to PR side) | first candidate, rules order/auto | overflow branch | Rewritten as the first of `routeOptions`, with both sides' wait reasons (`API overflow is off`, `not in the account order`, …) |
| `pipeline.mjs` usage and launch note | order / orderMode, API reason text | health, tab, `pickedAt` / `tried` | Main's lines plus the PR's `order=` / `orderMode=` usage; launch note names order / auto / overflow |
| `web/pipeline.tsx` | order line in the status row, launch label | "Then any API" switch, planned / taken-by lines, step list, pending/queued-only buttons | Both. The order line also says when no order means API overflow. Main's `Switch` import restored (the auto-merge dropped it) |
| `pipeline.test.mjs` settings test | no order by default, overflow gone | overflow on by default | One test covering both |
| `build-orchestrator/server/__init__.py` (auto-merged to PR side) | `order` / `orderMode` allowed + spend guards | `apiOverflow` allowed + its guard | Allowed: `order`, `orderMode`, `apiOverflow`, `healthEveryMin`. All guards kept. `mode_raises_api` counts `apiOverflow` (Automatic opens nothing new when overflow is off or no order is saved) |

Behaviour change from the PR, on purpose: an empty custom order used to mean subscriptions only. It now falls back to
main's default (subscriptions first, then API while `apiOverflow` is on). Main made overflow the default after the PR
branched, and an empty order expresses no preference. A saved order is still followed exactly, and main's health
sweep still takes a listed account out.

Non-code files (`_claude/THREADS.md`, `_claude/builds/*.json`, journals, catalog, status, docs) merged without textual
conflicts. Checked afterwards: every JSON parses, `orchestrator.json` (580) and `store.json` (581) have no duplicate
ids, and no conflict markers are left in the tree. Main's #450 also tightened help `kind`s and set help coverage to
100%. The PR's `help.json` used `page` / `settings` / `dialog` (now `screen` / `tab` / `menu`), and 31 manager
controls got plain help text.

## Account order: how each way reaches it (Everything comes with an API)

| | Deep link | Read | Set the order | Move one | Reset | Custom / Automatic |
|---|---|---|---|---|---|---|
| REST `/api/plugins/claude-accounts-manager` | — | `GET /order` (mode, order followed, saved, who is in it), `GET /mode`, `GET /accounts` | `POST /order {order}` | `POST /move {name, to\|position}` | `POST /order/reset` (new) | `POST /mode {mode}` |
| MCP | `console_show` / `console_open` `nav:claude-accounts-manager`; `settings.open:claude-accounts-manager` | plugin command `order-get` (new) / `mode`; console action `claude-accounts-manager.order` (new) | `order`; action `order:<a,b,c>` (new) | `move`; action `move:<name>:<to>` | `order-reset` (new); action `reset` (new) | `mode-set`; action `mode:<m>` |
| CLI | — | `axf claude-accounts-manager order-get`; `pipeline.mjs settings` | `… order --order a,b,c`; `pipeline.mjs set order=a,b,c` | `… move --name n --position top` | `… order-reset` | `… mode-set --mode auto`; `pipeline.mjs set orderMode=auto` |
| Voice (AmberX, console actions) | "open the Claude accounts manager" | "what is my account order" | "set account order w-max, w-pro" | "move hulu-api to the top" | "reset my account order" | "account order automatic" |

Every way calls the same server functions (`order_state`, `set_order`, `model.moved`, `reset_order`, `set_mode`), and
the spend guard is the same for all. The CLI runner drops a `--to` flag, so `move` also takes `position`.

## Tests, before → after

| Suite | PR branch before | After merge |
|---|---|---|
| `build-orchestrator/pipeline.test.mjs` | 39 ✓ (PR report) | 44 ✓, including a new test: saved order drives `routeOptions` / `planFor`, health skips a listed account, Automatic = subscriptions then API, overflow off keeps Automatic off API |
| `build-orchestrator/test.py` | 43 ✓ | 44 ✓ (`mode_raises_api` with overflow off or no order) |
| `claude-accounts-manager/test.py` | 55 ✓ | 66 ✓ (GET order agrees with mode/accounts, move by position, reset, REST / MCP / CLI / console-action parity) |
| `claude-accounts/test.py` | 89 ✓ | 89 ✓ |
| `console-terminal/test.py` | — | 151 ✓ |
| `deploy/worker-routing.test.mjs` (routing, failover, caps) | — | 44 ✓ |
| `plugin-commands/test.mjs`, `console-commands/test.mjs` | — | 41 ✓, 7 ✓ |
| `tsc --noEmit` (console-web) | clean | clean |
| check-theme, check-controls, check-toolbars, check-chrome-assets, plugins --check, check-plugin-pages, plugin-commands check, help-coverage --check | pass (help kinds failed against main's new rule) | all pass |

`deploy/claude-workers.test.mjs` and `deploy/claude-token-save.test.mjs` fail on this VPS the same way on a clean
`origin/main` checkout: they hit the host's live dispatch tokens. The merge did not cause these failures.

## CI / mergeability

- After the second push GitHub showed CONFLICTING, but only in `_claude/builds/orchestrator.json`. The builds store
  files merge with the local `axf-builds` driver (`.gitattributes`), which GitHub does not run. I reproduced the conflict
  with a driverless merge in a scratch clone. Main already holds every build, origin and journal line the branch has,
  so the branch now takes main's copies of those files. After that GitHub reports #449 **mergeable, clean**
  (`1d232a9ba`).
- CI "Light PR checks" is **red**, and not because of this PR: `node framework/cli/builds-store.mjs verify` fails with
  1471 `breakroom …` findings on a clean `origin/main` checkout as well. Other open PRs (#conversation-rag,
  #orchestrator-hold-status) fail the same step, as does a main push at 17:34. Every check this PR touches passes
  locally. The builds-store breakage is the subject of `dispatcher-a-worktree-store-write-can-erase-a-fr`.

## Left for after the merge queue

- Merge: the merge queue lands #449 (sessions never merge by hand). It is blocked while the repo-wide builds-store
  check is red.
- Console redeploy and a live check of the order switch, once #449 is on main.
- The "#449 landed" AmberX message. Until #449 lands, the dispatcher's end-of-session alert is the notice.
