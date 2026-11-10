# Build search: search builds, session histories and build notes; jump to the highlighted spot in the log

Build `search-bar-plugin-add-on-search-builds-session-h` · Phase 1 (Opus) · Nov 10 2026 · branch
`claude/search-bar-plugin-add-on-search-builds-session-h`

## Brett said (verbatim, Nov 10 2026 15:36)

> Make sure you can search for builds, browse all the session histories and building notes, list all the hits, click it
> and it brings you to that session's log with that spot highlighted. More than one instance: instance one, two, three,
> four. Icon by type. Really powerful search plugin with extensive integration and easy actions. Completely API
> controlled without AI. Anything that requires AI has a switch to enable or disable AI use. Not automatically use AI.
> Disable it.

## What was built

New console plugin `apps/console-web/plugins/build-search` (Build search).

- **One box over everything:** builds (title, Brett's words, request, steps from the builds store), build notes,
  build reports (`_claude/builds/reports/*.md`), each headless session's readable log (`<worktree>/<build>.log`,
  colours stripped) and each session's messages (`<build>.jsonl`: what was asked, what Claude said, each tool call).
  The streams are 545 MB on this VPS; their text is cached in the plugin's data folder and read incrementally (only
  bytes added since last time). A warm search over 1,622 documents takes about 0.4–0.8 s.
- **Every hit listed:** grouped per document, icon by type (build = hammer, note = edit, report = file, session log =
  terminal, session message = user, file = folder), each hit numbered **Instance 1, 2, 3, 4…** with its line number
  and the matches marked.
- **Click → the log at that spot, highlighted:** the log viewer opens beside the list (below it on a phone) scrolled
  to the line, highlighted, with "instance 2 of 20", Previous / Next instance and the hit actions.
- **Query language:** words (all on the line), `"a phrase"`, `/regex/`, `-exclude`, `type:log,note`, `build:<id>`;
  type filter buttons; arrow keys walk the hits.
- **Easy actions:** Copy link (a deep link to the exact spot), Copy line, Open the build, Only this build, plus the
  user's own actions (a console action, `nav:<page>` or an https link with `{build} {line} {doc} {type} {n} {q}
  {text} {path}` filled in).
- **Add sources and actions by typing:** start the query with `>`: `>add source docs docs/**/*.md as doc`,
  `>add action PR = https://github.com/…{build}`, `>remove source …`, `>ai off`, `>set maxHits 1000`,
  `>types log,note`, `>sources`, `>actions`, `>help`. The same in Settings → Plugins → Build search.
- **No AI:** search, hits, the viewer, sources and actions are plain code; no route calls a model. The AI switch
  (`ai.enabled`) is **off by default**, only an explicit call turns it on (UI switch, `>ai on`, `PUT /ai`, MCP,
  CLI, action `build-search.ai.on`), and nothing turns it on automatically even when an AI connection exists. No
  feature in this build needs AI, so today the switch only records the choice for future AI features.

## How each part is reached (all four the same)

| What | Deep link / console | REST (`/api/plugins/build-search/…`) | MCP (plugin-commands@1) | CLI |
|---|---|---|---|---|
| The page | `console_open` view `build-search`; action `build-search.open` | — | `console_open` | `axf console open build-search` |
| Search | `?axf-build-search=q:<query>`; action `build-search.query:<q>` | `GET search?q=&type=&build=&limit=&perDoc=` | `build-search_search` | `search.mjs search "<q>"`, `axf build-search search --q …` |
| Open a hit (log at the spot) | `?axf-build-search=<doc>#<line>` (Copy link); action `build-search.hit:<id>` | `GET open?id=<doc>#<line>` | `build-search_open` | `search.mjs open log:<build>#42` |
| Sources | Settings → Plugins → Build search; `>add source` | `GET/POST sources`, `POST sources/remove` | `build-search_sources`, `_source-add`, `_source-remove` | `search.mjs sources / source-add / source-remove` |
| Hit actions | same; `>add action` | `GET/POST actions`, `POST actions/remove` | `build-search_actions`, `_action-add`, `_action-remove` | `search.mjs actions / action-add / action-remove` |
| Settings | same; `>set` | `GET/PUT settings` | `build-search_settings`, `_set` | `search.mjs settings / set` |
| AI switch (off) | Settings switch; actions `build-search.ai.on/off` | `GET/PUT ai` | `build-search_ai`, `_ai-set` | `search.mjs ai [on|off]` |
| Typed command | the box with `>`; action `build-search.command:<text>` | `POST command {text}` | `build-search_command` | `search.mjs run "<text>"` |

Voice (AmberX) reaches the same through the console actions above. Web capability `axf.build-search@1`
(`search`, `open`, `command`, `state`) lets the Search bar plugin (build `search-bar-plugin-snappable-search-asset-globe-e`,
running in parallel, not on main yet) add Builds as one of its scopes without naming this folder. Global search lists
each document of the last Build search (kind `build`).

## Checks

- `node apps/console-web/plugins/build-search/test.mjs`: 11 checks passed (engine rules, instances, filters, AI off by
  default, typed commands, CLI end to end on a fixture, incremental cache, path traversal refused).
- Server routes exercised with FastAPI's test client (search, open, AI switch validation, bad command → 400,
  `log:../x` → 400).
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `plugin-lifecycle check build-search`,
  `plugin-commands check build-search` (8 reads · 14 commands), `plugins.mjs --check`, `tsc --noEmit`: pass.
- `menu-reach.mts` and `help-coverage --check` still fail on main for other plugins (glossary-index, demo-designer,
  book-builder pages; approvals-banner / claude-accounts help); none of it from this plugin (its help coverage is full).
- Screenshots (desktop + phone, real data): hits list and log viewer; UI Review → Screenshots group
  "search-bar-plugin-add-on-search-builds-session-h", and the review item waiting in UI Review.

## Gaps

- Claude.ai chats live in the Chat viewer's store, not here. Add them as a source once that plugin exposes a capability,
  or point a source at an exported folder (`>add source chats /path/*.json`).
- No AmberX (Kotlin) screen: Android work is on hold. This is console plugin code, not a framework engine, so there is
  no PORTING.md twin; AmberX reaches it through the console actions and MCP tools above.
- No AI feature exists yet, so the AI switch has nothing to gate today; any future one must check `ai.enabled` first.
- Hits are found line by line; a phrase split across two lines is not matched.
- The hub-off screenshot harness needs `AXF_APPEARANCE_HUB=off` and a 30 s warm-up for lazy plugins.
