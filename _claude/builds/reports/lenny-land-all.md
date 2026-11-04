# lenny-land-all — land everything finished (freeze plan step two)

Build `lenny-land-all` (Current profile, Opus, agent Landin' Lenny), Nov 3–4 2026.
Brett (voice, Nov 3 2026): CI fix is done (PR #284 merged 22:42 UTC, main green). "Number two." Plan step two =
merge everything finished. "Give me Lenny."

## Landed

Each one: main merged in, conflicts settled keeping both sides, CI green, merged with a merge commit.

| PR | Build | Landing fixes needed |
|---|---|---|
| #270 | Auto-land (zero-token landing through the push banner) | Molly xLayout `opens` clash with #284 (took main's fix); THREADS carry-on lines named plugin folders (plugin-lifecycle); land.mjs read UI Review by its folder route, now through a new push-banner `ui-hold` route on the `ui-review@1` capability |
| #268 | Menus stay on screen and scroll (menu-fit@1) | bake lock hashes only |
| #265 | crew-retrain: every crew agent an all-rounder | real merge with main's headless meter work (`claude-headless.sh`: agent id for booking, agent name for the tab/meter; env passes both), Greenlight Gina (hired on main meanwhile) made an all-rounder like the rest of the crew, swarm tests for nine skills/job types, a generated export kept out |
| #277 | UI Review pictures load again | help for the Re-capture button |
| #271 | MD Studio | literal nav ids so menu-reach sees the page; test imports `web/model.ts` with its extension (CI runs node strip-types); one flaky ai-assistant CI test re-run (passes locally) |
| #273 | Crew live grid | page head (design language); Breakroom links go through a new `agent-swarm.open` action instead of the swarm's folder name; literal nav ids; `cards.tsx` merged with main's who's-free strip |
| #280 | Follow Amber | help for four new controls (written, not drafts) |
| #274 | Terminal: VPS host health check | none |
| #279 | THREADS: window-resize-fix merged | none |
| #285 | UI Review predicted looks | look-change notes written straight to the builds store (was calling the orchestrator plugin by path); test fixture without a real plugin folder; help for two controls; `claude-headless.sh` and UI Review CSS merged with main (main's phone-layout fix kept) |
| #272 | Toolbars tap-to-confirm (part 1 of the build, as listed) | axHub web and AmberX tests allow the toolbars library; `AxfProvider` installs both menu-fit and tap-confirm; Crew's recent-commands list marked as not a toolbar |
| #276 | agent-pick | Claude session test reaches the plugins CLI only when installed; swarm `cards.tsx` doc + provides both `axf.crew@1` and `axf.swarm-roster@1`; CLAUDE.md keeps both new lines |
| #303 batch | #275 #282 #283 #286 #287 #290 #292 | see below |

The batch (#303): seven finished PRs that each passed CI on their own head, merged together on main for one CI run
instead of seven back-to-back (each overlapped the last one landed). Each keeps its own merge commit. Fixes inside:
- #275 Claude settings: menu entry for its page (menu-reach); the shared Follow Amber switch is labelled by name, not by plugin folder; MCP test blocks and server instructions merged with Follow Amber's and the session mirror's.
- #282 What Brett said: `claude-headless.sh` records his words first, then the predicted-look gate; build-orchestrator, builds page and build manager show both the origin quote and agent avatars; framework help drafts synced.
- #283 Home cards: `card@1` joins the appearance slots (appearance + roll fixtures regenerated); PORTING entries for job types (main's newer text) and cards.
- #286 Terminal sessions nav: sort key `recent` instead of `activity` (another plugin's folder name); the session-feed and headless capabilities both declared; help for the menu item; search/filter row is a toolbar.
- #287 Ref links, #290 What's new fix: imports/exports, PORTING and help drafts merged; `console_dialog` keeps the new close action and main's read-only annotation.
- #292 Terminal drag/chain tree vs #286: settings defaults from both, chain pane keeps its text scaling and the toolbar role, help merged by target.
- The framework re-baked into console, axHub web, AmberX and Molly (their bake locks were behind the framework on main).

Main CI stayed green after every landing except one run (#280's merge commit): `check-builds-live` timing flake
("a rejected push is retried and lands"), green again on the next four runs.

## Held (not landed)

- **#266 console-wake** — its own console-commands server test (a queued command delivered "after reconnect") is timing-dependent and fails on the PR's own head (CI: empty answer; here: `live`). Needs the author to fix the race. Help coverage and THREADS fixes are done locally but not pushed.
- **#288 Molly console commands** — built on #266's branch and fails the same test; lands after #266.
- **#269 Builds page (one page, six views)** — its new Add dialog imports the console-only `@console/api`, but the plugin also ships into AmberX, whose build can't resolve it (AmberX APK and console build red); also two folder references to the orchestrator plugin. Needs an add route on the builds-page server part.
- **#289 Plugin settings placement** — its settings-placement@1 replaces the "Opens in" path #278 (Terminal settings in a dialog, merged today) fixed; main's window-resize check fails on it, and it names the Terminal plugin by id from another plugin. Needs a call on which placement system wins, then #278's behaviour ported.
- **#281 Smart menus** — it and #268 menu-fit (landed) both rework how menus and submenus are laid out (AppMenu, MenuList, Overlays, axf.css: 9 conflict blocks). Needs a real merge of the two menu engines: framework GUI behaviour, Fable work under the model rule.
- **#291 Git status board** — not finished: its head commit is "WIP: git-status-board paused by Brett to free VPS resources" (step 6 of 6 open). Its new job type also reuses the id `ops-fix`, which main already has for system fixes; it needs its own id (e.g. `pr-fix`) when it resumes. It also carries a stray `_claude/fuck-you.md` (a kickoff prompt) and `.axf-queue.log`.

## Closed

- **#267** Fix red main CI — superseded by #284 (same causes, merged with main green). Commented and closed.

## Left for Brett

- **#251 banner pack, #254 banner editor** — untouched except set to **draft** so the push banner's auto-merge can't land them while he reviews (one tap on "Ready for review" puts them back).
- Older PRs, none merged:

| PR | What it is | Still relevant? | Conflicts |
|---|---|---|---|
| #207 | hub-connection plugin + 50 per-state badge icon looks | maybe (plugin never landed; badges since reworked) | yes |
| #208 | Icon picker dialog (Static tab + 50 animated icons) for the connection status plugins | maybe, same family as #207 | yes |
| #209 | X Select: mark build complete (Android lib-readaloud) | stale (Android on hold) | yes |
| #210 | Walkthrough Studio deploy at walkthrough.amberxai.com behind the wall | probably stale (Walkthrough Studio is on main) | yes |
| #211 | plugin-lifecycle: Patches web baked copies aren't stale references | stale (Patches retired) | yes |
| #212 | Developer alerts library (bell, ntfy, web push) | stale (alerts library + bell are on main) | yes |
| #213 | THREADS: Prompt Profiles thread + brief (docs) | stale | yes |
| #214 | AmberX: fix "Note saved to Inbox" repeating (voice echo loop) | still relevant if the loop still happens (2 files) | yes |
| #216 | Persona: load Amber in every session | already on main (0 files differ): close | no |
| #218 | Build profiles registry sync + CI guard | already on main (0 files differ): close | no |
| #227 | Catch Claude's weekly/session limit as out of credits (console badges) | maybe (headless runs already detect limits) | yes |
| #236 | Status files: Molly, walkthrough chapters, waiting threads (CLAUDE.md) | stale | yes |

## Broken and fixed on the way

- **Console down ~12 min (04:27–04:39 UTC).** The console's update cron had no lock (axHub web, AmberX web and Molly
  have one), so each landing started another `install-console.sh`: five image builds stacked up, load average ~40, and
  Docker couldn't start containers (Molly sat in "Created" too). Cancelled the four duplicate installers and their
  builds; the oldest finished and the console came back (401 = sign-in wall, serving). Fix: `flock -n` on the
  console cron, live in `/etc/cron.d/axf-console` and in `deploy/install-console.sh` so the next install keeps it.
- Noticed, not changed: `/usr/local/bin/axf-console-update` (root-only, written by the installer) carries the GitHub
  token in plain text; the installer comment says so on purpose for the re-run.

## Deploy

Apps redeploy by themselves from main: console, axHub web, AmberX web and Molly through their 5-minute update crons,
the demo through the `site` branch (2 minutes). After the last landing (batch #303, `7ce95f6b`, main CI green):
- Console: rebuilt from `97d66c06` (includes the batch), one installer (the new lock held), up and behind its wall (401).
- AmberX web: rebuilt cleanly. Its updates had been failing since earlier landings (baked framework lacked
  `AgentAvatar`, which a console plugin it loads now imports); the batch's re-bake fixed it.
- axHub web and Molly: rebuilt from the new main, up behind their walls (401).
- Demo (axf.amberxai.com): `site` published from `7ce95f6b`, serving (200).

## Cost

One headless Claude Code session on Opus, 22:48 → 05:27 UTC (6 h 40 min): about 193k output tokens, 124M cache-read
and 451k cache-write tokens, **≈ $31** at `framework/schemas/model-pricing.json` Opus rates. GitHub Actions: about
24 CI runs (≈ 9 min each).

## Tools used (scratch, not in the repo)

Two scratch worktrees (`/root/axf-builds/lenny-merge`, `lenny-merge2`) and helper scripts that merge main in, take
main's copy of the live builds-store files (the local `axf-builds` merge driver isn't on GitHub, so a branch's store
must equal the main commit it merged), recompute bake-lock hashes from the merged files, reword THREADS carry-on
lines that named plugin folders, and run a fast subset of CI's checks plus a stale-reference scan on changed files.
