# land-round-2: catch up and land the rest, Molly first

Build `land-round-2` (Current profile, Opus, agent Landin' Lenny), Nov 4 2026, 10:43–13:55 UTC.
Brett (voice, Nov 4 2026): after lenny-land-all every remaining PR conflicted with main; one agent catches them up and
lands them, Molly first (commands must reach the console inside Molly).

**Stopped at the per-build budget cap.** Claude settings cap a build at $15; this session reached about $42 (tokens
from the transcript: 163M cache read, 0.74M cache write, 0.26M output, Opus prices), most of it in cache reads over a
long session that spent about 1.5 h waiting on GitHub (see below). Per the setting it stopped and reports here.

## Landed

| PR | What | Landing fixes |
|---|---|---|
| #288 (+ #266) | Console commands reach the console inside Molly; carries console-wake | console-commands server test polled for stream / wake / queue state instead of fixed sleeps (the race that held it in lenny-land-all); #266's written help for the wake settings folded in; bake lock hashes |
| #294 | Molly: the console's banners as one banner region | bake lock hashes only |
| #295 | Molly: navigation sub menus + Navigation settings (nav-style@1) | `framework/core/types.ts` keeps both `nav-style` and main's `card`; Molly `navigation` plugin `opens: "dialog"` (build-defaults refuses `false`); CONTROL.md names `tokens.nav`; NavTree sets `inert` as a plain attribute (the Next.js template's React 19 types failed on a string); framework help drafts |

#266 closed as superseded by #288 (its only extra commit, the wake-settings help, is in #288).
#297 closed: an orphan duplicate of the main CI fix that landed as #284.

Console + Molly redeployed right after #288 (both containers restarted on main with #288). No console was open at the
time, so a live `console_show` into Molly could not be confirmed; the server test covers the Molly path (72 checks).

## Not landed yet (all merged with main locally and resolved; local CI clean unless noted)

Local branches `land/<pr>` in the VPS repo (`/opt/axf` git dir) hold the resolved merges; the PR branches on GitHub
are behind them.

| PR | State | What was resolved |
|---|---|---|
| #296 Gizmo companion | pushed (e8fb3287); CI: sweep red on one finding, `apps/amberx-droid/src/plugins/companion/web/Chat.tsx:45` `axp-companion__tools` needs `role="toolbar"` + `aria-label` (check-toolbars); the other jobs green | headless-core helpers moved to the claude-session lib also carry main's chain-tree types (`ChainReason`, `ChainNode`, `parentI`, `why`) and keep main's `chainTree` / `revealTick`; roster keeps Greenlight Gina and Gizmo; swarm test counts the companion skill; CI runs both new checks |
| #298 Console lazy loader | local, clean; auto-land pushed its own main merge meanwhile | `App.tsx` installs main's toolbars library next to the lazy loader's disabled-plugin stubs; `.axf-queue.log` (now tracked on main) |
| #281 Smart menus | local, clean against main as of 13:00; **now conflicts with #295 in `framework/core/runtime.ts`** | menu components merged with main's menu-fit@1 (`MenuScroll`, `useMenuFit` in the split `ContextMenuBox`, smart-menu look vars), staggered row animations follow the scroll wrapper, fixtures keep main's agent-card / widgets |
| #291 Git status board | local, clean | its job type renamed `pr-fix` (main added an `ops-fix` with another meaning); push-banner keeps both `merge_hold` and main's `wait_ui`; swarm test allows the merge fixer on `pr-fix` |
| #293 Terminal tab position | local, clean | kept main's sessions rail and #293's tab stack side by side (settings, commands, help, CSS, look levels); dropped the old drag ref main replaced |
| #289 Plugin settings placement | local, clean | `SettingsHost` wraps the terminal body inside main's sessions-rail pane; one "Terminal settings" item at the top of the session menu |
| #269 Builds one page | local, clean | AmberX resolves `@console/api` (vite alias + tsconfig path), the cause of its red AmberX build; main's "What Brett said" (origin bubble, avatar, subtitle) and #309's Build manager hotfix (tap opens a row, ticks stick, `built` is green) folded into the six-view page |
| #300 Profile switcher | not started: draft PR, and it rewrites the same Builds page code #269 replaces; needs a rework on top of #269 | — |

Not touched as asked: #299, #301, #302 (WIP).

## What got in the way

- **GitHub Pull Requests outage** (~11:05–11:45 UTC): #288's push event was lost; the PR kept its old head until a
  fresh push.
- **The shared GitHub token runs out of its 5000/hour budget in ~25 minutes**, three times today (resets at 11:04,
  12:04, 13:05; empty again at 12:27 and 13:37). Something on the VPS polls GitHub hard (candidates: the push banner's
  auto-merge rounds, auto-land every 3 min, the reconciler, What's new). While it is empty no CI result can be read
  and nothing can merge. This needs a fix (the GitHub App's own budget, or slower pollers) before the next landing run.
- **Auto-land works the same branches**: it merged main into #295 and #298 while this session did; harmless, but the
  two raced.
- Main moves every minute (status commits), and branch protection wants a PR up to date before it merges, so every
  merge is: merge main, push, merge at once.

## Next

1. Fix the GitHub budget drain (above).
2. #296: add `role="toolbar"` + `aria-label` to the companion's tools row (Chat.tsx:45), push, CI, merge.
3. #298 #281 (re-resolve `runtime.ts` against #295) #291 #293 #289 #269: `git checkout land/<pr>`, merge main, push to
   the PR branch, CI, merge. Then #300 reworked on top of #269.
4. Redeploy all apps at the end.

## Cost and time

About 3 h 15 min. About $42 in tokens (over the $15 cap; see the top).
