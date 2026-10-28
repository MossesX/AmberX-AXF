# Docs engine: queued plan (waiting for your go)

New console plugin `docs-studio` + a cross-port contract `docs@1`. Own layouts (no nav menu, no application menu). Everything themed through the engines (tokens only, framework controls). All data and settings on axHub (`/projects/amberx-axf/_data/docs/`).

## Builds on what exists
- `walkthrough@1` (molly-guide) and Walkthrough Studio's cue tracks (open, move, click, type, scroll, highlight, caption): reused for narrated walkthroughs.
- `assistant@1` (ai-assistant) and `axf.agents@1` (agent-manager): "Ask the docs", generators, a Docs agent, all through capability services.
- Sources mined: code (framework/, apps/, plugins/), plugin.json files, `_claude/memory` (STATUS, decisions, docs/, rebuilds/), THREADS.md, change log on axHub, orchestrator builds.

## Steps (orchestrator, each 30 min or less)
| # | Step | Model |
|---|---|---|
| 1 | `docs@1` contract: doc page, chain, glossary term, index entry, bookmark, snippet, routine; schema + fixtures | Fable |
| 2 | Indexer engine (TS reference): code walker (exports, imports, call chains, assets, plugins) to one database | Fable |
| 3 | Chains engine: "follow one click" chains from UI to plugin server to axHub, step by step | Fable |
| 4 | Notes miner: STATUS, decisions, rebuild reports, THREADS, change log into feature histories | Opus |
| 5 | Server: plugin server API + axHub storage (db, index, glossary, bookmarks, settings) | Opus |
| 6 | Plugin shell: window manager, splits, tabs, layout switcher, settings tab under Plugins | Opus |
| 7 | Layout 1 + 2 | Opus |
| 8 | Layout 3 + 4 + 5 | Opus |
| 9 | Live browsing windows (open the real console page beside its doc, synced) | Opus |
| 10 | Sandbox: run examples against the real engines in an iframe, editable | Opus |
| 11 | Snippets + code generators (asset, plugin, engine call; AI-assisted via assistant@1) | Opus |
| 12 | Bookmarks: folders, tags, notes, deep links into code lines and chain steps | Opus |
| 13 | Walkthrough player: real browser window, visible cursor, narration, play / pause / stop / skip / speed | Opus |
| 14 | Routine recorder: record mouse + keys into an animated routine, edit, replay | Opus |
| 15 | Generate full docs for every plugin and feature, glossary, index; checks + screenshots | Opus |

About 7 h total. Fable steps 1 to 3 first, then Opus (one switch).

## The 5 layouts
1. **Workbench**: IDE style. Left: explorer tree (features, plugins, code). Centre: tabbed doc editor with split panes. Right: chain inspector and glossary. Bottom dock: sandbox, console output, bookmarks.
2. **Chain Map**: a zoomable graph of how things connect; click a node to open its doc in a side drawer; a timeline strip along the bottom plays the chain step by step.
3. **Reader**: calm, wide reading column with a sticky outline, inline runnable examples, margin notes and bookmarks; best on the phone.
4. **Theatre**: walkthrough mode. Large live browser window with the cursor, a narration transcript beside it, transport bar (play, pause, stop, skip, record), chapter list.
5. **Lab**: sandbox first. Code and preview side by side, snippet library and generators on one side, the matching doc sliding in from the other.

Each layout is an asset (layout@1) so it hot-swaps and themes like everything else.
