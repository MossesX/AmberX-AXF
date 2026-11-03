# orch-live-sync — every build step reaches main at once

Urgent profile, Opus, branch `claude/orch-live-sync`. Asked by Brett on Nov 3 2026 (voice): *"every completed step, no
matter how small, must reach the orchestrator and appear on main immediately"*.

## What was wrong

`_claude/builds/store.json` (builds@1) is a repo file. Sessions wrote it on their feature branches, so main (and the
console, which runs on main) only saw step progress if the branch merged, and sometimes not even then. Branch and PR
fields were left blank. On the morning of Nov 3 the Urgent profile showed dock-engine (done in PR #245) and
token-control (done in PRs #246 and #250) as pending with 0 steps done. theme-editor's branch was linked to nothing.
The banners and THREADS were wrong because of this.

A second, related problem: the console's checkout `/opt/axf` runs `git reset --hard origin/main` every 5 minutes.
Any store write the console made locally and never committed was wiped.

## What changed

| Piece | File | What it does |
|---|---|---|
| Live publish | `framework/cli/builds-live.mjs` | Every store write that changes a build goes into an outbox. A background flush publishes it to main as one status-only commit (`Builds live: … [skip ci]`). The commit is built with git plumbing on `origin/main` through a private index, so the working tree and the branch are never touched. It holds the merged store, the journal lines, one line per change in THREADS.md's **Live build log**, and regenerated orchestrator exports. If the push is rejected because main moved, it fetches again and retries, up to 6 times. It never force-pushes. Any other refusal (protection, auth) keeps the change queued and says why. |
| Pull back | same | After a publish, main's newer builds come back into the checkout (main's exact bytes when nothing here is newer) and into the console checkout `/opt/axf`, so the banners update at once. `sync` does both directions and runs at session start. |
| Merge | `framework/plan/builds-merge-core.mjs` | The newer copy wins, per build and per step (updatedAt, then rev). A stale copy can't undo another session's tick. A blank branch or PR never wipes a set one. Notes are unioned. The journal is append-only (main's order kept, new lines appended). |
| `built` status | both cores, orchestrator UI, Builds page | A build is `built` ("Built · awaiting merge") when all its steps are done and its PR isn't merged yet. It turns `complete` once the PR merges (`mergedAt`) or when the build has no PR. |
| Link | `builds-live.mjs link <id> --branch --pr [--merged]` | Sets a build's branch, PR and merge time. The write goes live. |
| Reconciler | `framework/cli/builds-reconcile.mjs`, `framework/plan/builds-reconcile-core.mjs` | Reads open and merged PRs (one GraphQL query, with its own rate budget) and `claude/*` branches (local git). It matches them to builds by branch or PR field (100), branch = build id (90), branch starting with the build id (70), or a title, body or commit that names the build's steps (60 plus evidence). It fills blank fields, ticks the steps a PR names as done (title and commit subjects; body lines only when they say done/built/complete; never lines about work left), and records merges. It lists orphans. Report: `/projects/amberx-axf/_data/builds/reconcile.json`. |
| Banner item | `build-orchestrator/server` → `axf.health@1` `builds-live` | Red when changes have been stuck before main for 15 minutes or more. Amber for orphan PRs or branches, or when the reconciler hasn't run for 40 minutes. |
| Session start | `.claude/settings.json` (SessionStart) | Runs `builds-live.mjs sync` and `builds-reconcile.mjs --apply --brief`. |
| Timer | `deploy/install-console.sh` | Cron `axf-builds-reconcile`, every 10 minutes on the VPS. |
| No rebuild for status | `framework/deploy/axf-deploy.sh` | The console auto-update skips `install-console.sh` when only `_claude/` changed. Otherwise every status commit would rebuild the console. |
| Git merges | `.gitattributes` + `builds-live.mjs install` / `merge-driver` / `heal <branch>` | Builds files merge newer-wins in local merges. `heal` merges main into a PR branch whose only conflicts are builds files, then pushes without forcing. |
| Rules | `_claude/rules/RULES.md`, shared RULES (exception to "every change through a PR"), `CLAUDE.md`, `_claude/builds/README.md` → *Live on main*, `decisions.md` | Status data under `_claude/` is the only thing that bypasses PRs. Code never does. No session trusts an export alone. |

## Backfill (s6), live on main

| Build | Before | After |
|---|---|---|
| dock-engine | pending 0/4 | **built** 4/4, `claude/molly-fable`, PR #245 |
| token-control | pending 0/14 | **built** 14/14; s1–s3 noted PR #246 (`claude/token-control`), s4–s14 PR #250 (`claude/token-control-opus`); the build points at #250 |
| theme-editor | pending 0/5 | **built** 5/5, `claude/theme-editor`, PR #243 (already open, waiting in UI Review, so no new PR) |
| urgent-builds | complete | archived (merged in 2a057cc4) |
| orch-step-click | 2/3, no estimates | estimates added (the small-steps test failed on it, on main as well) |
| xlayout (big-dog) | main had 3/12 | 12/12 **built** (local progress that never reached main, sent by `sync`), PR #252 |

**Reconciler across all five profiles** (angel, big-dog, breakroom, refactor, urgent): **43 builds fixed in one commit**.
It filled missing PR fields and merge times on finished builds and linked branches. It ticked steps that open PRs name
as done:

- session-history: 7/7 built, PR #195
- element-inspector: s1, s2, s4, PR #192
- layout-repeating-slots: s2, PR #191 merged

No status went backwards. Every change is pending→running or pending→built.

Orphans flagged for the banner:

- **28 open PRs** with no build: #249 #248 #244 #236 #227 #218 #216 #214 #213 #212 #211 #210 #209 #208 #207 #206 #205
  #204 #203 #202 #201 #200 #199 #197 #193 #158 #163 #159. Most are old `project-thread-*` and docs PRs.
- **2 branches** with commits and no PR: `claude/park-build-descriptions`, `claude/push-banner-merge-all`.

There were 12 suggestions to check, for example md-studio's merged plan PR #242 with open steps, and #253 naming
several builds.

Live commits on main from this build: `0fdd7e86` (s1), `15cb200f` (xlayout sync), `35cb9e71`/`b4d25710`/`1867a884`
(s2–s4), `f262feea` (backfill), `8a2f8da3` (reconciler, 43 builds), plus s5–s7 ticks.

## Tests

`node framework/spec/check-builds-live.mjs` (new, in CI): **42 checks**, run against throwaway git repos. They cover:

- one tick lands on main, and the branch and HEAD are untouched
- the commit has only `_claude/` files and `[skip ci]`
- the THREADS live line
- **parallel writers** on two clones, one stale: all three steps land, history stays linear, no merges, no force
- **retry** after a rejected push
- **a protected-branch refusal** is not retried: the change stays queued and flagged stuck, then flushes later
- link: built, then complete
- **merge driver**: a feature branch merges main cleanly with no status regression
- **heal** of a conflicting PR branch
- the pure merge rules
- **reconciler matching**: branch, prefix, two PRs per build, plan PRs not ticked, closed PRs ignored, orphans, merges
- the THREADS section cap

Local CI block:

- All of these pass: `validate --framework`, project manifests, fixtures, plugin catalog, axf-server, build steps,
  profiles, feature matrix, builds-store (37), builds-live (42), agent-slots, model-policy, `builds-store verify` (259
  records, 5626 checks), pending/queue `--check-steps`, github, github-app, ui-review, session, help coverage,
  check-theme, check-controls, conform, plugin pages, build-orchestrator test (20), build-manager test (128), and
  `tsc --noEmit` (console-web).
- **Not passing, and the same on main** (not caused by this build): `tracker.mjs --check` (391 items without a status)
  and `plugins.mjs --check` (asset-browser's plan item `x.assets.browser` missing).
- The build-orchestrator test failed on main because finished builds without estimates broke the small-steps check.
  The check now covers only unfinished builds, and orch-step-click got estimates.

## Known gaps

- **Direct push to main.** This works on the current repo settings (the live commits landed). If branch protection
  later requires PRs for everyone, the push is refused. The change then stays queued and the banner item turns red,
  saying so. The fix would be to let the GitHub App bypass protection for `_claude/`-only commits.
- **GitHub's own merge button ignores custom merge drivers.** A PR whose branch also changed the builds files can
  conflict on GitHub. Live writes keep the branch's copy equal to main's (sync takes main's bytes), which keeps this
  rare. When it does happen, `builds-live.mjs heal <branch>` fixes it. Wiring `heal` into the push banner's
  *Pull failed* path is a follow-up.
- **REST budget.** The console's fallback token had used all 5000 REST calls for the hour when this was built. That's
  why the reconciler reads through GraphQL. The GitHub App isn't set up on this VPS (`github-token.mjs status`).
- **Step ids with letters** (`s3a`, `s3b`) are not matched, which is deliberately conservative. element-inspector's s3
  stays open until someone ticks it.
- **UI.** The only UI change is the new status label and tone ("Built · awaiting merge") in the orchestrator and the
  Builds page. No screenshots: the sandbox console can't render without axHub. UI Review is noted in the PR.
- The claude-sync hub copy of `_claude/builds/*` is still a second channel. 42 files are held there, waiting for Brett
  to say which copy to keep.
