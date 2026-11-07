# Urgent: land PR #296, Gizmo basic chat (`urgent-land-gizmo-chat`, Current profile)

## What Brett said (verbatim, Nov 4 2026, voice)

> "Is the Claude chat feature built yet?" … "So put another agent on to do it now."

Agent: **Reel Rhonda** (there is no Gizmo card in `agent-swarm/agents/roster.json` on main yet; Gizmo's card arrives with
this PR). Model: Opus 5.5. Branch `claude/gizmo-companion`, PR #296.

## What was done

| Step | Result |
| --- | --- |
| Merge main into `claude/gizmo-companion` | One conflict, `console-terminal/web/headless-core.ts`. Kept main's new-session modes (`planNew`, `NEW_SESSIONS_BADGE`, `newSessionMode`, terminal-no-focus) and the branch's move of the meter and chain helpers into `framework/libs/claude-session`. The lib copies were compared with main's line for line: identical, so the Terminal's behaviour is unchanged. Everything else (#288 console in Molly, #294 Molly banners, last night's batch) merged cleanly. |
| CI red before (toolbars) | `Chat.tsx` tool-call card list was flagged as a toolbar; marked `data-axf-not-toolbar` (it is a list of cards, not a button row). |
| CI red after the merge (design language) | `check-plugin-pages.mjs` came in with main; the companion is a chat window whose title bar is its head: `design-ok: no page head` with the reason, the same way Plugin Manager does it. |
| Half-done part of step 1: window look | Addendum 3 put the Windows Terminal look in this run; the chat was a plain full-screen page. Now `companion.open` (app menu, voice "hey gizmo", context menu, command search) opens Gizmo in a **frameless floating window** like the console Terminal: the chat's title bar is the window's (drag, double-tap to maximize, grip, minimize / maximize / close in Windows order), acrylic surface (`--fx-opacity-glass` + `--fx-blur`), eight resize edges, snap; one window at a time (an open one comes to the front). On a phone it is centred with a margin each side, clear of the back-swipe zone. The nav page keeps the same acrylic look with an *Open in a window* button. Framework pieces only (`useWindowFrame`, `WindowGrip`, `fx-iconbtn`); no control restyled. |

## Checks

- AmberX `tsc --noEmit` clean; console-web `tsc --noEmit` clean; AmberX `vite build` clean.
- AmberX `test.mjs` 2213/2213; `check-claude-session.mts` 43/43; `check-headless-tabs.mts` 63/63; agent-swarm 100;
  agent-manager 178.
- `check-theme`, `check-controls`, `check-toolbars`, `check-plugin-pages`, `shared-assets check`, framework asset
  validation: all pass.

## Queued (current profile)

1. `gizmo-voice` (first in line, Addendum 2): talk mode with the screen off / app in the background (AmberX foreground
   service), transcript, phone test. Push-to-talk, hands-free, interrupt-to-stop, voice and speed already ship in #296.
2. `gizmo-terminal` (Addendum 3): the console Terminal harvested into the shared library and embedded as a panel
   (show / hide, dock top / bottom / left / right, configurable).

The rest of Addendum 4–8 (`appearance-addon` and the four other panels) stay on the gizmo-companion brief for the
orchestrator to split after these two.

## Landed

- **PR #296 merged** at 15:24 UTC, Nov 4 2026 (merge commit `471e66fe`), CI green on its head `09f142608` (Build
  engine sweep, Web Dev Console + Python API, AmberX APK + native tests, Gradle). Main moved three times while landing
  (#298 lazy loader, #307 expenses-port); each time main was merged back in and CI re-run before the merge. The push
  banner had 12 older PRs ahead in its queue, so the merge was done directly (GraphQL, pinned to the tested head).
- CI fixes on the way: tool-card list marked not a toolbar; the chat window's page-head opt-out (design language);
  the lifecycle check's stale references (the claude-session header and the companion api.ts comment named console
  plugin paths; reworded, baked copies and lock hashes updated).
- **Redeployed** by the VPS updaters: AmberX web (`amberx-web`, serves the window build) and the Dev Console (its
  rebuild first hit Docker layer-extraction errors; `urgent-approval-popup-crash` re-ran the update and it came back).
- **Live check:** the console's assistant lists agent `gizmo`; one message got a streamed answer (79 events, stored in
  the chat's history): "I'm Gizmo, your AmberX sidekick: I chat with you, keep tabs on the crew and the codebase, and
  run anything on the server only once you approve it." The test chat was deleted. AmberX's proxy to it
  (`/api/console/…`) answers behind the axHub wall (401 without a hub session, as designed).

## Not done / follow-ups

- **No phone screenshot.** A local AmberX build waits for the live axHub look, and the hub only answers its
  allow-listed origins; the live app needs a hub sign-in this session doesn't have.
- **GitHub API quota.** Only the old personal token is on the VPS (GitHub App: "not set up" in `github-token.mjs
  status`), and the sessions running at once used up its 5,000 REST calls an hour twice during this landing. Setting up
  the GitHub App (Settings → Plugins → GitHub) gives the console and the agents their own quota.
- **Duplicated steps in the store.** `gizmo-voice` and `gizmo-terminal` came back with every step repeated 16 times
  (48 and 64 steps, all with fresh uids) a few minutes after they were added; deduplicated back to 3 and 4. Something
  that re-normalises builds (live merge or reconciler) repeated them; worth a look if it happens again.
