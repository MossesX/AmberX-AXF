# Banner reference links (`banner-ref-links`, Current profile, Opus)

Brett (Nov 3 2026, voice): "In the banner entries for like in progress and this and that, where things are mentioned
that do have a spot, like if it's part of the UI is getting edited or settings menu is getting edited, there has to be
a hook, like clicking, double clicking something, the text itself, maybe somehow you need to be able to make it open
that part. Whatever it's referenced to."

Agent: Ping Paulie (headless worktree session, not on main; the router is main-only). Branch `claude/banner-ref-links`.

## What it does

Text in banner entries that names a real thing becomes a dotted link:

| Gesture | Result |
|---|---|
| Tap / click | Peek card: kind, name, where it lives, "Being changed by <build>, not live yet" or "New in <build>, not live yet", other matches if the name was ambiguous, **Open** / **UI Review** / **The build** |
| Double-tap / double-click | Opens it and highlights it (the search focuser's flash, same as search and What's New "Go to it") |
| Long-press / right-click | Context menu: Open, Open in new window, Show in UI Review, Show the build that's changing it, Copy link |
| Enter / Shift+Enter (keyboard) | Peek / open |

What links: screens, dialogs, settings tabs, settings sections and single settings, actions, toolbars, menus,
components (assets), plugins, builds (title or id), PRs (`#281`, `PR 281`), agents, files (`apps/…`, `framework/…`,
`deploy/…`, `_claude/…`). A brand-new part that is not live (declared by a build, not in the app yet) opens that
build's UI Review item; an existing part opens the live one and the peek says which build is changing it.

## How

- **s1 `ref@1` resolver** — `framework/core/engines/refs.mjs` (+ `refs.d.mts`). Pure, zero tokens: exact / alias /
  pattern matching against targets the caller hands in. Rules: explicit `touches: settings.terminal, toolbar.terminal`
  refs win (and a declared ref with no live target stays as `missing` = new, not live yet); PR and repo-path
  patterns; names at word boundaries, longest first, never overlapping; several-word names any case, a one-word name
  only as written; names under 3 letters and everyday words (Home, Settings, Open, …) never link alone; a kind word
  after a name ("Terminal settings", "Plan Studio screen", "Banner toolbar") picks the kind; leftover ambiguity is
  settled by explicit refs, then kind order, and marked `ambiguous` with `candidates`. Two targets with one id merge
  (first wins, second fills gaps), so the search index's "where it opens" and the builds store's "what it touches"
  combine. Fixture `framework/spec/fixtures/refs.json` (15 text cases, 6 resolves, 4 peeks), checker
  `framework/spec/check-refs.mjs` (35 checks, in CI). Kotlin twin deferred (PORTING.md).
- **s2 interaction** — `framework/react/components/RefText.tsx` (`RefText`, `addRefSource`, `openRef`, `refLink`,
  `REFS_SETTING`), CSS `.fx-ref` / `.fx-ref-peek` in `framework/ui/axf.css` (tokens only: accent at
  `--fx-opacity-muted`, warning for not-live parts). Targets = the app's search index (every view, dialog, settings
  tab / group / setting, action, asset, plugin, build any library adds) + registered sources. Double-tap timing,
  long-press and drag threshold come from the behaviour theme. Context menu items are runtime contributions
  (`rt.contextExtras` target `axf-ref`) running actions `refs.open|window|review|build|copy:<id>`
  (`effect: 'navigate'`, a new optional `ActionMeta` field the console-commands catalog already reads). "Open in new
  window" opens the app with `?axf-ref=<id>`; the new tab opens and highlights it once its screens are drawn.
- **s3 every section** — RefText is in the entry text of: Push banner (Ready to merge / PR titles, branches, Merged
  and Pulled entries), Codebase changes (In progress entries, "Now:" step, result summaries, the log page's rows,
  steps, results), Build manager (the Building / Waiting banner, its other rows and current step, the Live page),
  Main build status (run title).
- **s4 generic renderer** — there was no shared banner-entry text renderer; RefText is it (framework, every app gets
  it). Banner plugins call `<RefText text={…} />` where they print entry text. Not touched: banner-pack (#251),
  banner-editor (#254), banners-one (both PRs change only baked copies + `_claude` data outside this build's files;
  no overlap in framework source). When those land, their banners pick links up by using RefText for entry text.
- **s5 commands** — new plugin `apps/console-web/plugins/ref-links/` (plugin@1, plugin-lifecycle@1): runner + CLI
  `refs.mjs` (builds store with declared touches + PR, every plugin; console catalog / agents passed in), server
  routes `GET targets`, `POST find|resolve|open` declared once in plugin.json `commands`, so plugin-commands@1
  projects them to REST `/api/control/ref-links/<cmd>`, MCP `ref_links_<cmd>` and CLI `axf ref-links <cmd>`.
  `open` runs `refs.<how>:<id>` in Brett's open console through console-commands@1 (it opens and highlights there).
  Optional capabilities: console-commands@1 (catalog + open), axf.agents@1 (agents), ui-review@1 (review items for
  builds in progress). Web part adds the server's targets as a ref source; Settings → Plugins → Reference links has
  the on/off switch (`axf.refs.links`, device) and a Try-it box. Capability `ref-links@1` for other plugins.

## Tests

| Check | Before | After |
|---|---|---|
| `node framework/spec/check-refs.mjs` | — | 35/35 |
| `node apps/console-web/plugins/ref-links/test.mjs` | — | 19/19 |
| `python3 apps/console-web/plugins/ref-links/server/test_ref_links.py` | — | 17/17 |
| `node framework/spec/check-plugin-commands.mjs` | 57 checks, 54 plugins | 57 checks, 55 plugins |
| `node framework/cli/plugin-lifecycle.mjs check ref-links` | — | clean |
| `node framework/cli/check-theme.mjs` (changed files) / `check-controls.mjs` | pass | pass |
| `apps/console-web`: `tsc --noEmit` | see PR | see PR |

Covered: names, kind words, case rule for one-word names, stop words, ambiguous names with candidates, explicit refs
winning, declared-but-missing refs, PRs (known/unknown, `#fff` and `12#3` not PRs), files in / not in the checkout,
build ids vs longer ids, plugin folder + name, overlap, components and menus, log rows and page words excluded, hyphen
boundaries; server: catalog / agents / UI Review targets, find, resolve, open → `refs.<how>` with the encoded id and
`to` / `by`, bad `how`, nothing to open, unknown PR, Console commands missing.

## Screenshots

UI Review item and Screenshots group "banner-ref-links - Nov 3 …": `shots/` in this folder (Try-it box with links,
the peek card, the context menu; phone + desktop).

## Known gaps

- Swarm agents (Breakroom roster) are not targets: the swarm exposes no capability for its roster, and plugins may not
  read each other's folders. Agents come from axf.agents@1 only. A small `agents@1` read on the swarm would add them.
- Builds declare touches only in text (`touches:` in detail, steps or notes). The orchestrator has no `touches` field
  yet; `refTargetFromBuild` already reads `b.touches` when one appears.
- Show in UI Review opens UI Review (or the item's URL when the item carries one), not a specific item: UI Review has
  no deep link to one item. The predicted shot (`ui-review-predicted`) is not on main yet.
- Kotlin twin deferred (Android on hold).
- Fable review suggested for the ref@1 contract (it is a cross-app GUI behaviour contract built on Opus, like
  plugin-settings-placement s1).
