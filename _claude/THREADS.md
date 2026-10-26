# Threads and builds log

Every Claude session reads this file when it loads the project and keeps it current, so work can be picked up from
any session, account or machine. The repo is the source of truth; chat history is not.

**How to update:** when a thread starts, changes state, opens or merges a PR, or queues an item, edit its row (add one
for a new thread), set *Updated*, commit and push with your branch. Move rows to *Done* once their PR is merged or
the work is dropped. Queued items stay queued until Brett says to run them (project rule). Open PRs: check GitHub,
not this file, before acting on one.

States: `working`, `queued` (waiting for Brett's go), `blocked` (needs Brett), `review` (PR open), `on hold`, `done`.

## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|---|---|---|---|---|
| axHub OAuth 2.1 sign-in for the claude.ai connector | review | axHub `claude/axhub-oauth` (+ AXF `claude/axhub-oauth-thread`) | axHub #9, AXF #102 (log) | Built (Opus, 394 tests). Merge axHub #9, redeploy on Coolify, then connect claude.ai with the client id + secret | 2026-10-26 |
| Separate Console and Patches asset visibility | blocked | `claude/project-thread-k6ckjv` | #94 (draft) | Needs Brett's answer in the thread. 24 commits behind main, conflicts in `framework/plan/pending.json` + `framework/spec/PORTING.md` (small) | 2026-10-26 |
| Add icon picker dialog for status plugins | blocked | `claude/project-thread-4s5igq` (+ `claude/project-thread-v1id7r`) | – | Needs Brett's answer in the thread; unmerged work on both branches, no PR | 2026-10-26 |
| Fix git merge conflicts | blocked | – | – | Needs Brett's answer in the thread | 2026-10-25 |
| Add Push banner action log | on hold | – | – | Held by Brett | 2026-10-25 |
| Store project rules in repo | queued | – | – | Rules file `_claude/rules/PROJECT-RULES.md` | 2026-10-25 |
| Move axHub to console-style pages: deploy | queued | – | AXF #100, axHub #8 (both merged) | Redeploy axHub on Coolify (can't reach Coolify from claude.ai/code) | 2026-10-26 |
| Fix AmberX app sign-in and hosting: rollout | queued | – | #99, #101 (merged) | Re-run `apps/amberx-droid/deploy/install.sh` on the VPS; new APK from CI | 2026-10-26 |

## Done (recent)

| Thread | Result | Updated |
|---|---|---|
| Move axHub to console-style pages (AXF #100 + axHub #8) | merged | 2026-10-26 |
| Codebase changes banner blank-console fix (#101) | merged | 2026-10-26 |
| Fix AmberX app sign-in and hosting (#99) | merged | 2026-10-26 |
| Track threads and builds in the repo (#98) | merged | 2026-10-26 |
| Give axHub the console's settings interface (#95) | merged | 2026-10-26 |
| Require access and refresh Claude tokens (#97) | merged | 2026-10-25 |
| Fix banner rows not expanding (#96) | merged | 2026-10-25 |
| Add assets appearance editing section (#93) | merged | 2026-10-25 |
| Add changes and features grid plugin | merged | 2026-10-25 |
| Edit each Appearance asset individually | merged | 2026-10-25 |
| Build context menu designer plugin | merged | 2026-10-25 |
| Add Amber menu and appearance packages | merged | 2026-10-25 |
| Build AmberX voice-first Android app | merged | 2026-10-25 |
| Restore axHub web app look | merged | 2026-10-25 |
| Hide console App tabs bar | done | 2026-10-25 |
| Carry open threads in handoff prompt | merged | 2026-10-25 |
| Merge passed draft PRs | done | 2026-10-25 |
| Close stale draft PRs (#71 #70 #63 #57, Build-Pilot #4; branches kept) | done | 2026-10-25 |
| Make Patches feel like one app (PR #71 closed unmerged; Fable rebuild `patches-one-app-fable` parked) | closed | 2026-10-25 |
| Show Claude account email from VPS | done | 2026-10-25 |
| Add Claude connection status plugin | done | 2026-10-25 |
| Remove Console-duplicate plugins from Pilot | done | 2026-10-25 |
| Fix axHub layout inside Patches | merged | 2026-10-24 |
| Expand appearance asset customization | merged | 2026-10-24 |
| Fix banners not working | done | 2026-10-24 |
| Track all work in activity banner | merged | 2026-10-24 |
| Build axHub web app on AmberX | merged | 2026-10-24 |
| Sync app settings through axHub | merged | 2026-10-24 |
| Add Vinny VPS root agent | merged | 2026-10-24 |
| Settings interface as asset | merged | 2026-10-23 |
| Banner working icon animation | merged | 2026-10-23 |
| Banner right-click hide menu | merged | 2026-10-23 |
| Pull all repair flow | merged | 2026-10-23 |
| Floating banner group window | done | 2026-10-23 |
| Pending PR merges | done | 2026-10-23 |
