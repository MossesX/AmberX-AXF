# Orchestrator Live Sync - Nov 3 2026 notes

## Why the orchestrator was stale
- `_claude/builds/profiles/*/orchestrator.json` is only a read-only export of `_claude/builds/store.json`.
- Sessions write the store on their own feature branch, so main never sees step progress until that branch merges.
- Branch and PR fields were left blank, so finished work was not linked to its build.
- Session start read only the main export; open PRs and branches were not checked.

## Urgent profile reality (Nov 3)
- urgent-builds: complete, merged Nov 1 (2a057cc4). Stale; clear it.
- dock-engine: shows pending; actually done, all 4 steps in open PR #245 (claude/molly-fable).
- md-studio: genuinely not started; depends on dock-engine.
- theme-editor: branch claude/theme-editor exists, unmerged, no PR; Brett says done; verify and PR.
- token-control: shows pending; done. s1-s3 in PR #246 (claude/token-control), s4-s14 in PR #250 (claude/token-control-opus).

## Brett's rule
Every completed step, no matter how small, goes to the orchestrator and appears on main immediately, so the orchestrator can update banners and threads.

## Design
- Status updates always go to main regardless of the session's branch; keyed by build id + step id.
- Tiny status-only commits (store + journal + exports); code still goes through its PR.
- Rebase-retry on push conflicts, never force; merges never regress status (newer rev wins).
- Per-step branch, pr, merged, mergedAt fields (a build can span several branches/PRs).
- No model tokens for status writes (scripts + git plumbing); reconciler is a script on a timer.
- CI: paths-ignore `_claude/builds/**` and THREADS.md so status commits don't trigger deploys; batch writes within a few seconds.

## Build orch-live-sync (Urgent)
Headless Opus on the VPS, tmux axf-orch-live-sync, branch claude/orch-live-sync. Steps: s1 live writes to main, s2 branch/PR auto-link, s3 reconciler, s4 banners + THREADS follow the store, s5 session-start rule, s6 backfill Urgent + reconcile all profiles, s7 tests/report/PR, s8 per-step branch/PR (addendum), s9 cheap status commits (addendum).

## Still to do
- Merge order: #245 then #252; #246 then #250.
- Clean up profiles angel, big-dog, breakroom (matrices.json 91 bytes), refactor (311 KB).
- Wire Build Manager into axHub for a live who's-working view.
- AmberX notes API (token-control s8, PR #250) so Claude can write to AmberX notes directly.
- Claude Doc copy: https://claude.ai/artifact/X1eaPczZFLS7WvnWwVbeki
