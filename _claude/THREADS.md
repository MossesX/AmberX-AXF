# Threads and builds log

Every Claude session reads this file when it loads the project and keeps it current, so work can be picked up from
any session, account or machine. The repo is the source of truth; chat history is not.

**Read it before doing anything.** Then update it (edit the thread's row, or add one), set *Updated*, commit and push
with your branch, whenever:

- a thread is made, or a session starts something (a build, edit, fix, test run, push, pull or merge);
- a build completes, or anything fails;
- tests start, pass, fail, or stop part way (say where);
- a push or pull is needed, completes or fails;
- a PR is opened, needs merging, is merged, or the merge fails;
- a deploy is needed;
- the session runs out of credits or hits a usage limit (state `stopped`, the step it was on, how to resume);
- it needs Brett (state `blocked`, the exact question), or an item is queued.

Move rows to *Done* once their PR is merged or the work is dropped. Queued items stay queued until Brett says to run
them (project rule). Open PRs: check GitHub, not this file, before acting on one. If a session can't push, it says
so in its reply and puts the row in its change-log entry so the next session can add it.

States: `working`, `testing`, `review` (PR open / needs merge), `deploy` (merged, needs a deploy), `queued` (waiting
for Brett's go), `blocked` (needs Brett), `failed`, `stopped` (cut off: out of credits, usage limit, session ended),
`on hold`, `done`.

## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|---|---|---|---|---|
| No login questions + headless sessions in the console Terminal | review | `claude/no-login-questions-terminal-launches` | #105 | Merge; the VPS picks it up on the 5-minute update. Install tmux there (systems check Auto fix) | 2026-10-26 |
| Move axHub to console-style pages | merging | `claude/project-thread-139zmj` (+ axHub `claude/axhub-console-pages`) | AmberX-AXF #100, axHub #8  | Built (Opus). Merge AXF #100 first, then axHub #8 + Coolify redeploy | 2026-10-26 |
| Fix AmberX app sign-in and hosting | review | `claude/project-thread-kxgzso` | #99 | Merge, then re-run the installer on main; new APK from CI | 2026-10-26 |
| Track threads and builds in the repo | review | `claude/project-thread-usdp87` | (this PR) | Merge | 2026-10-25 |
| Require access and refresh Claude tokens | review | `claude/project-thread-i70ntv` | #97 | Review + merge | 2026-10-25 |
| Fix banner rows not expanding | review | `claude/project-thread-jjbcw6` | #96 | Review + merge | 2026-10-25 |
| Give axHub the console's settings interface | review | `claude/project-thread-74063i` | #95 | Review + merge | 2026-10-25 |
| Separate Console and Patches asset visibility | blocked | `claude/project-thread-k6ckjv` | #94 | Needs Brett's answer in the thread | 2026-10-25 |
| Add assets appearance editing section | review | `claude/project-thread-qwqfp4` | #93 | Review + merge | 2026-10-25 |
| Fix git merge conflicts | blocked | – | – | Needs Brett's answer in the thread | 2026-10-25 |
| Add icon picker dialog for status plugins | blocked | – | – | Needs Brett's answer in the thread | 2026-10-25 |
| Add Push banner action log | on hold | – | – | Held by Brett | 2026-10-25 |
| Store project rules in repo | queued | – | – | Rules file `_claude/rules/PROJECT-RULES.md` | 2026-10-25 |

## Done (recent)

| Thread | Result | Updated |
|---|---|---|
| Fix amberx.amberxai.com + AmberX app (404: Traefik router `amberxweb` clashed with amberx-app; now `amberxdroid`) | merged; the 5-minute update redeploys it | 2026-10-26 |
| Banner text on one line | merged (#110); console updates in 5 min. Fable rebuild parked (`banner-one-line-fable`) | 2026-10-26 |
| axHub: bad OAuth setting never stops the hub (axHub #13, decision #100) | merged; redeploy axHub on Coolify | 2026-10-26 |
| axHub OAuth 2.1 sign-in (axHub #9, AXF #102) | merged; redeploy axHub on Coolify | 2026-10-26 |
| Approval reasons + Go pass (axHub #10 as decision #99, AXF #103) | merged; redeploy axHub on Coolify | 2026-10-26 |
| Fix systems check banner: console re-bake + one-chat-per-task rule (#108) | merged | 2026-10-26 |
| Write install instructions and install steps | merged (#104) | 2026-10-26 |
| axHub connector: OAuth client registration (decision #98) | merged (axHub #11); redeploy axHub, then re-add the connector | 2026-10-26 |
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
