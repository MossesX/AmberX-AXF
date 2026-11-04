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

## Landing

Lenny's `land-round-2` got a note to skip #296. After CI is green the push banner's auto-merge takes it (up to date
with main, CI on the head). AmberX web (`amberx.amberxai.com`) auto-updates from main every 5 minutes; the console
picks up the shared library and Gizmo's agent add-on on its next update.

## Screenshot

A local phone shot isn't possible: the AmberX build waits for the live axHub look, and the hub only answers its
allow-listed origins. The shot is taken from the live deploy after the merge (see below).
