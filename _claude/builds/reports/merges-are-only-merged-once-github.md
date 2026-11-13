# Merges are only "merged" once GitHub confirms (merge-confirm@1)

Build `merges-are-only-merged-once-github`, branch
`claude/merges-are-only-merged-once-github`. Phase 1 (Fable): s1–s2, the contract and
core. Phase 2 (Opus): s3–s13.

## What changed

A merge API 200 is no longer treated as proof. Every merge call writes a merge-confirm@1 record first. Right after the call
the record reads **Pending GitHub confirmation**. It becomes **merged** only when the PR, read back from GitHub, shows state
MERGED with `merged_at` and a `merge_commit_sha` that is on main (`compare <sha>...main` ahead or identical). If neither
happens within 10 minutes it becomes **merge-unconfirmed** (GitHub hasn't confirmed, with Recheck). It becomes
**merge-failed** when GitHub refused the merge and the PR is still open, or when the PR was closed without a merge.

- Contract + core: `framework/spec/MERGE-CONFIRM.md`, `framework/schemas/merge-confirm.json`, `framework/core/merge-confirm.mjs`
  (pure state machine, evidence check, backoff 0/5/15/30/60/120 s, 10 min timeout). Kotlin twin deferred (`PORTING.md`).
- IO + store: `framework/cli/merge-confirm.mjs` (token from `github-token.mjs`, ETag cache: a 304 costs no call; reads held
  back below 300 calls left). Shared store `<root>/.axf-console/merge-confirm/records.json`, framework data, because deploy
  scripts and builds-live write to it too.

## Merge paths covered

| Path | What it does now |
|---|---|
| Merge queue (stack + batch) | request → merge call / push → read-back; unconfirmed PRs stay as *awaiting GitHub*, the PRs behind wait, the one-per-stack redeploy hold stays until confirmed |
| Console auto-merge + server merge gate (`POST /merge`) | answers `{merged: false, state: pending-github-confirmation, confirmId}` until the read-back proves it; `merged: true` only from merge-confirm |
| Auto-land | makes no merge call itself; every round ticks the poller and raises / resolves `merge.unconfirmed` alerts |
| GitHub client plugin | capability `axf.merge-confirm@1` (merge / get / list / is_merged / recheck); no bare merge call |
| Scripts | `merge-pr.sh` waits with `merge-confirm.mjs confirm --wait`; sweep found no other caller (`gh pr merge`, `pulls/*/merge`) |
| builds-live / builds-reconcile | a build is `complete` / gets `mergedAt` only on a confirmed merge |

## API reach (Pending chip, Merge confirmations list, Recheck)

| Feature | REST | MCP | CLI | Voice / action | Deep link |
|---|---|---|---|---|---|
| List of confirmations (+ counts, filter) | `GET /api/plugins/push-banner/merge-confirm[?state=&id=]` | `push_banner_mergeconfirm_list` | `merge-confirm.mjs list [--state s]` | — (read) | `console_show push-banner/merge-confirm` |
| One PR's state + evidence | `GET …/merge-confirm/get?id=<repo>#<pr>` | `push_banner_mergeconfirm_get` | `merge-confirm.mjs status <repo> <pr>` | — (read) | `console_show push-banner/merge-confirm/<repo>#<pr>` (row highlighted) |
| Recheck | `POST …/merge-confirm/recheck {id \| repo, pr}` | `push_banner_mergeconfirm_recheck` | `merge-confirm.mjs recheck <repo> <pr>` | `merge.recheck[:<repo>#<pr>]` (none = every unconfirmed) | — |
| Confirm (wait) | — | — | `merge-confirm.mjs confirm <repo> <pr> --wait` | — | — |
| Poller | — | — | `merge-confirm.mjs tick` (land.mjs runs it every round) | — | — |

The deep link runs through `push-banner.focus:<focus>` (MCP `push_banner_action_focus`). `console.settings` opens now carry a
`focus` the same way screens do (`<tab>/<item>` → `<tab>.focus:<item>`). That is a framework change in
`core/engines/console-commands.mjs` plus the console-commands client, and its Kotlin twin is deferred.

Alert: notify type `merge.unconfirmed` (key `confirm:<repo>#<pr>`), one per merge on the change, resolved once GitHub confirms.
health@1 item `push-banner-merge-unconfirmed` with the Recheck auto-fix.

## Checks

`check-merge-confirm` (31), `check-merge-confirm-io` (8, fake GitHub: merged on main, MERGED but not on main, still open,
API error, timeout, ETag, tick), push-banner `test.py` (192), `land.test.mjs` (100), `merge-queue.test.mjs` (18; a pending
round then the confirmed one), `check-console-commands` (102), `check-plugin-commands`, check-theme / controls / toolbars /
chrome-assets: all pass. Both merge-confirm checks now run in CI (`android.yml`).

Not green, and not from this build: `help-coverage --check` is one entry short at console-web 99.9%, because claude-accounts'
"One Claude account" field has no help entry. `plugin-lifecycle check push-banner` flags only untracked local files
(`.axf-brief.md`, `.axf-focus.json`).

## UI Review

Submitted as item **r-20261113-768a822a** with three choices (ui-choices@1, asset type `status`; the option assets are in
`apps/console-web/plugins/push-banner/assets/status/`). It is waiting for Brett. Group:
"merges-are-only-merged-once-github - Nov 13 12:30 PM".

| Option | Chip | |
|---|---|---|
| A (as built) | accent tone, turning refresh icon (still under reduced motion), "Pending GitHub confirmation" | ships unless another is picked |
| B | neutral, still icon, same text | |
| C | warning tone, turning icon, "Waiting for GitHub…" | |

Each option has a desktop shot and a phone shot. All shots show Settings → Plugins → Push banner → Merge confirmations,
opened by the real deep link `push-banner.focus:merge-confirm/mossesx/amberx-axf#1412` (the row is highlighted) with a
seeded store. They were captured with `rebuild-shots.mjs`, hub off (`AXF_APPEARANCE_HUB=off`).

The earlier navigation problem (global search) is avoided: the shot steps take the runtime from the React tree, raise the
settings level through the level select, and dispatch the deep-link action.

Because the hub is off, the shots use the default theme. In that theme the accent, neutral and warning tones look close
to each other.

Found while taking the shots: the chip was cut off ("Pending GitHub conf…") because it shared one line with the row id
and the why text. That is fixed in `push-banner.css`: the chip never shrinks, and a meta line that carries a confirmation
gets its own line.
