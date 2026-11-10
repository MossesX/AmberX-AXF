# Shipped features (shipped-features-r2 → shipped-features-fable)

**Landing (Nov 6 2026):** one PR from branch `claude/shipped-features-fable` carries every r4 commit plus the Fable
review below and supersedes the r2 / r3 / r4 branches (draft PR #350 included). See "Fable review" at the end.

**Asked (Brett, Nov 4 2026, voice):** "Where's the list of features that can be sorted, and when they went live?"
**Addendum:** "As soon as a prompt goes through that plans on building the features, they go into that list, and have
it sortable so you can hide completed ones and pending ones." "Anytime a feature in that list is getting changed or
altered, it will appear as an edit. It will update that list and show edits to that feature."
**Model:** s1–s2 Fable (feature-ledger@1, deploy-log@1); s3–s15 Opus because this account had no Fable credits
(Brett, Nov 4: "Finish it with opus redo fable later"). The Fable review list is in the progress file.

## What shipped (branch `claude/shipped-features-r2`, draft PR #350)

- **build-hook@1** (`framework/core/build-hook.mjs`, `framework/cli/build-hooks.mjs`): one event stream from every
  builds store write (created, steps-added, step-done, status, pr-opened, pr-merged, addendum, cancelled, restored),
  stable ids, outbox + listeners from plugin.json `buildHooks`, journal replay. 2358 events from today's journal.
- **feature-ledger@1 conformance** finished: fixture written, build refs without a profile now fold into the same
  build with one (58 checks).
- **SQLite ledger** (`apps/console-web/plugins/shipped-features/ledger/db.mjs`, migrations 001 + 002): features with
  every earlier version kept, feature ↔ build step links, edits table, PRs, builds, prompts, deploys.
- **Planned features on create:** a created build's steps become Planned features (or Planned edits of existing ones)
  with his verbatim prompt; statuses follow the build; cancelled builds keep them as Cancelled.
- **Importers:** builds journal, merged PRs (git or GitHub API), early commits, seed file. On the shallow test clone:
  1854 features, 59 edits, 256 PRs.
- **Deploy log writers:** `axf_deploy_log` (shell) in the console and site installers; failed updates logged too;
  live dates per target from the first deploy containing the merge commit, guessed (~) backfill before the log.
- **Grid:** Builds → Shipped features. View by PR / plugin / app / type / build / day / repo / flat; status and edited
  chips; Hide completed, Hide pending, Show cancelled, status multi-select, Has edits, Being edited now, edit status
  (remembered per device); details with what Brett said, builds, PRs, live per target, the Edits timeline and earlier
  versions; CSV / Markdown export; menu badge; plugin commands (REST / MCP / CLI) with titles.

## Screenshots (mocked API, real ledger data from the test clone)

| Desktop | Phone |
| --- | --- |
| ![](shipped-features/shipped-desktop.png) | ![](shipped-features/shipped-phone.png) |
| ![](shipped-features/shipped-desktop-open.png) | ![](shipped-features/shipped-phone-open.png) |

UI Review: not submitted from this cloud session (no console here). Submit these from the VPS:
`node apps/console-web/plugins/ui-review/review.mjs submit --kind screen --name "Shipped features" --app console --screen shipped-features --group "shipped-features-r2 - Nov 5" --shots <files> --branch claude/shipped-features-r2 --pr 350 --console`.

## Tests

`node apps/console-web/plugins/shipped-features/test.mjs` (7) · `python3 apps/console-web/plugins/shipped-features/test.py` (10) ·
`node framework/spec/check-feature-ledger.mjs` (58) · `node framework/spec/check-build-hook.mjs` (16) ·
`bash framework/deploy/test.sh` (49) · builds store checks unchanged (37 + 5) · console `tsc --noEmit` clean ·
theme, controls, toolbars, plugin pages, plugin lifecycle, plugin commands checks clean.

## Known gaps

- AI feature split and AI edit matching are hook points (`ctx.split`, `ctx.match`, `data/features-seed.json`,
  `ledger.mjs seed-draft`), not wired to a model; the plain fallback is one feature per step and scope + name / file
  matching. Many old build steps have no files, so their app / plugin is guessed from the text or left empty.
- axHub: history needs `AXF_AXHUB_REPO` or `GITHUB_TOKEN` on the VPS; axHub's installer needs its own
  `axf_deploy_log` call (axHub repo).
- Old builds' `createdAt` is the store migration date, so planned dates before Oct 31 are clamped to the merge date.
- The build-hook outbox (`.axf-console/build-hooks/events.jsonl`) only grows; a `compact` that drops lines every
  listener has passed is a follow-up (cursors are line counts, so compaction has to rewrite them together).

## Fable review (Nov 6 2026, `shipped-features-fable`; Brett: "The ship features. Yeah, do that now. Do the fable part now.")

Reviewed: build-hook@1 (core + IO), feature-ledger@1, deploy-log@1, the plugin's listener (`ledger/apply.mjs`) and the
SQLite migrations. The SQLite schema (001 + 002) needed no change: it stores the contract's records as JSON documents
with indexed columns, so a contract field change needs no migration. Verdict per part, and what was fixed:

| Part | Verdict | Fixed |
| --- | --- | --- |
| `buildRepo` | **bug** | a branch named `claude/axhub-adapter-*` (this repo has them) filed the build under axHub. Only a `repo` field or the GitHub repo in the PR URL decides now; the branch never does. New `GITHUB_REPOS` map in the registry. |
| step `model` | **bug** | `o.model === 'Fable'` was case-sensitive: `fable`, `[Fable]`, `claude-fable-5-1` all came out as Opus. Steps now go through model-policy@1 (`coerceModel`), `STEP_MODELS` is derived from the policy's allowed list (a new model joins by itself), the JSON Schema enum follows it. |
| `prNumber` | fix | takes an object (`{ number }` / `{ url }`) and a number, prefers `/pull/N` and `#N` over a trailing digit. |
| delete with no `after` | **gap** | fired nothing. Now one `cancelled` (to `deleted`) event, so a foreign writer or an old journal line still ends the features. |
| `statusFromBuild` (ledger) | **bug** | called an archived build `merged` while build-hook@1 calls it cancelled, and a pending build `queued` while the plugin planned it. Now: pending = planned, archived without a merge (or deleted) = cancelled, a merge wins, failed / blocked with a PR = in PR (stalled). The plugin's own `statusForBuild` now delegates to it, so there is one reading. |
| `iso` (ledger + deploy log) | **bug** | a time with a UTC offset (`+02:00`) was kept as text and sorted against `Z` times by string: a deploy from a host in another zone could land before or after the wrong neighbour. Offsets fold to `Z` in both modules (same answer, tested together). |
| `mergeLedgers` edits | **bug** | the later copy's empty `build` / `commit` / `pr` wiped the earlier copy's; live dates and files were not merged. Filled fields win, live per target merged, files unioned, earliest `at`. |
| `migrate` | fix | a fractional, negative or newer `version` crashed or looped; rounds down, reads a newer document as current, never drops a record. |
| `promptsFromOrigin` | fix | addenda lost `session` / `link` / `from` and ignored `mayBeParaphrased`. |
| delivery (`build-hooks.mjs`) | **race** | every store write spawned a detached `deliver`; two at once read the same outbox and raced on `cursors.json`. One delivery at a time per outbox (`deliver.lock`, mkdir-atomic, stale after 10 min), new lines appended during a round are taken in the same delivery, a turned-away deliverer retries a few times. `deliver({ to })` lets a test inject listeners. |
| `eventsFromChange` cancel path, `steps-added`, `step-done` ids, addendum indexing, `restored` | ok | unchanged; now covered by fixtures (two ticks in one write, late origin as addendum 0, archive after merge = status only). |
| deploy-log shell helper, failed-update record, site record | ok | shapes checked by `framework/deploy/test.sh` (51). |

Tests after the review: `check-build-hook.mjs` 16 → **25**, `check-feature-ledger.mjs` 58 → **66** (fixtures regenerated:
the only changed expected output is `statusFromBuild` pending → planned; everything else is new cases), deploy self-test
51, builds store 37, model policy 18, plugin `test.mjs` 7 (Node 22 in Docker; this VPS runs Node 20 and has no `node:sqlite`).
Console `src/axf` re-baked (`rebake.mjs apply apps/console-web`). No UI changed in the review; the r4 screenshots above
were submitted to UI Review from this session (see the PR).
