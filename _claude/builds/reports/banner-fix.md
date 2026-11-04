# Activity banner fix — Nov 1 2026 (Opus, headless)

Brief: Brett, Oct 31 night. Diagnosis: `banner-check.md`. Commits on main: `af027d6e`, `f1ca9aa6`, `25886868`
(live on the console since the 07:05 and 07:15 UTC updates).

## Before → after (live console, real data)

| | Before (196bbbaa, 06:56 UTC) | After (07:25 UTC) |
|---|---|---|
| Banner summary | 37 in progress · 1 stuck · 1 on hold | 8 in progress · 3 stuck · 1 on hold |
| Rows in the open banner | 38 (≈30 ghost command lines) | 9 (Claude sessions, each with its change-log entry folded in, + a CI run) |
| Height at launch | 431 px = 47% phone, 48% desktop (launched open) | 30 px = 3% (one counts line) |
| Height opened | 431 px = 47% / 48% | 272 px = 30% phone, 268 px = 30% desktop; the list scrolls inside |
| Hook events registered | root: 5 of 6 (no PostToolUse); axfbuild: none | root 6/6, axfbuild 6/6 |
| GitHub part | 403 on all 3 repos, no reason given | reads through axHub; says plainly when a token's rate limit is used up and backs off 10 min |
| Feed's GitHub calls | 12 every 20 s ≈ 2,160/h on the console's token | 3 a minute through axHub ≈ 180/h |

The 3 "stuck" after are real Claude sessions that have been running more than 30 minutes (Brett's Oct 22 rule counts
an active item 30 min after it started as stuck). They are not ghosts.

Shots: UI Review → Screenshots, group **"Banner fix - Oct 31 night"** (4 before, 4 after: launch and open, phone and
desktop).

## Each item

1. **Hooks re-registered.** *Wrong:* the hooks were installed before PostToolUse was added (the Oct 23 backup has
   none), so every push/pull/merge/delete/build line opened and never closed; axfbuild had no hooks at all and couldn't
   write to the root-only reports folder anyway. *Changed:* `activity.mjs hooks status` names missing events,
   `hooks ensure [--all]` adds only what's missing (root + every `/home/<user>` with `.claude`), `hooks install --user`
   does one user; other users write through write-only drop folders (data folder 0711, `reports/` + `hooks/` 1733 —
   nobody else can list or read; the systems check's privacy rule now accepts traverse-only). `deploy/claude-headless.sh`
   runs `hooks ensure` before every headless session. Done on the VPS for root and axfbuild. New systems-check item
   **activity-hooks**: each user's hook notes every event (`hooks/<user>.json`); red when a user's settings lack an
   event, when PreToolUse keeps coming without PostToolUse, or when hook events stop while the change log shows a
   session working. Auto fix = `hooks ensure --all` as a veto call (the registry's new `vps_run`). Live: green.
2. **Ghosts close.** *Wrong:* nothing ever closed a line whose PostToolUse didn't come (also true for denied tools,
   e.g. a blocked `rm`). *Changed:* the session line keeps its open command lines; Stop and SessionEnd close them (plus
   any found in the folder). The feed drops a command line after 5 min without word (setting) and every line of a
   session that ended. Existing ghosts went on the first read after deploy: before it there were 48 command-line files (22 still "running"); after it, 26 report files in all.
3. **Matching.** *Wrong:* `git merge-base` counted as Merging, `rm /tmp/...` as Deleting; the before shot also showed
   heredocs (`cat > /tmp/x.sh <<EOF … git merge … EOF`) as Merging. *Changed:* whole git sub-commands only (merge-base,
   rev-parse, log, status, diff are reads); `rm` only as a command, and not when every target is temp or build scratch
   (/tmp, $TMPDIR, dist, build, node_modules, caches, src/axf, *.log/*.tmp); heredoc bodies and quoted text are ignored.
4. **One row per session.** The change-log entry with the same session id is folded into the session's row (its
   progress, and "Change log" in the details). Entries without a Claude Code row (claude.ai, scripts) keep theirs.
5. **Banner size.** Launches folded to the counts line (only this banner's own Banner settings "Open" launches it
   open); open, the list is capped at `30vh` minus the header and scrolls inside. Tokens and framework controls only
   (check-theme, check-controls green).
6. **GitHub 403.** *Wrong:* not a permission. The console runs on the fine-grained GITHUB_TOKEN from
   `.axf-console/secrets.env` (the container's original env has a dead classic token: 401), and that token's 5,000/h
   limit was used up (`x-ratelimit-remaining: 0`); the feed alone polled ~2,160/h, and the error text was thrown away
   ("GitHub answered 403"). *Changed:* the feed reads through `axf.github@1` (axHub), one runs call per repo (was four),
   60 s cache, 10 min back-off with the reason; a repo axHub's token can't see is read with the console's own token.
   New item **activity-github**: amber while it backs off, amber naming a repo axHub's token can't see, red with
   GitHub's words otherwise.
7. **Holds** read the builds store (`_claude/builds/store.json`, found like `builds-store.mjs` does), not the
   `pending.json` export.

Also fixed on the way: `<task-notification>` notices (a background task finishing) came in as prompts and opened
duplicate Codebase changes entries that showed in the Build manager banner; `classify` now ignores harness notices.
`rebuild-shots.mjs` applied only the last `--env` flag; now all of them.

## Still open (needs a look, not this build)

- **axHub's GitHub token can't see MossesX/Build-Pilot** (404). The banner reads it with the console's token meanwhile.
  Fix on github.com: the hub token's Repository access → add Build-Pilot, Actions: read. Shown as the activity-github item.
- **Something else burns the console's GITHUB_TOKEN**: it was at 0 again at 07:25 with the feed off it (measured
  17 calls/min at 07:06, then the remaining 2,000 went within ~15 min). The banner now backs off and says so; the
  consumer is outside this plugin (push banner writes, other sessions using the same token). Worth its own check.
- The **Build manager banner** still lists older `<task-notification>` entries from other sessions until they're closed.

## Tests

- `activity/test.py`: 99 → 142 checks (ghost closing on Stop/SessionEnd, 5-min expiry, lines go with their session,
  matching table incl. heredocs, one row per session, counts, hooks status/ensure, hook notes, health verdicts, Auto fix
  command, builds-store holds, rate-limit back-off, axHub route + 404 fallback, collapsed banner + 30% cap).
- `codebase-changes`: test.mjs 111 → 113, test.py 173; `systems-check/test.py` 216.
- Full local block from `android.yml` (84 steps, Gradle/Android and the template npm sweep not run): all pass except
  tracker `--check`, `plugins.mjs --check`, session-checkin test, axhub-web/amberx-droid tsx tests (no react installed
  here), `test_previews.py`/one `.mts` flake, plugin test.py/test.mts loops and the lifecycle loop — every one fails the
  same way on clean main here, or only because of the session-start sync files in this worktree (`sessions/archive`,
  synced shared rules). Console `npm run build`, check-theme, check-controls and `plugin-lifecycle check activity` pass.
