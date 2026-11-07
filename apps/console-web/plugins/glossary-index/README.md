# Glossary, Index & Demos

An encyclopedia of AmberX AXF inside the Dev Console, and the demonstrations written from it:

- a **glossary** (A–Z definitions) and an **index** (a categorized tree, like the back of a book) of every plugin,
  feature, screen, control, setting, command, asset, asset type, CLI tool, build option, job type and core concept,
  plus a **grid** of all of it;
- a **Demonstration Designer**: from any entry, *Generate demonstration* writes a narrated demo (no model, no tokens);
  edit its steps, play it against the live UI, chain demos into tours, keep every recorded clip as a tagged asset;
- a **Book Builder**: write books of chapters from dragged-in entries, demonstrations and clips, preview any item
  live, play the whole book, hand it to the walkthrough recorder and generate its documentation.

Nothing in it is a hand-kept list. `catalog.mjs` builds the catalog (`glossary-catalog@1`) from what the repo already
registers:

| Kind | Source |
| --- | --- |
| Concept | `terms.json` (hand-written definitions of ideas no single file defines: asset@1, hot-swap, veto call, merge queue…) |
| Plugin, Command | every `plugins/<folder>/plugin.json` and its `commands.items`, with REST routes, MCP tool names and the `axf` CLI form |
| Screen, Control, Setting | every help@1 entry: framework chrome, Dev Console + plugins, axHub web |
| Asset type, Asset, Job type | `framework/schemas/asset-types.json`, `framework/assets/<type>/*.json` |
| Demonstration, Book, Clip, Documentation | `framework/assets/{demonstration,book,clip,docs}/` (starters) and every one made in the console (this plugin's data folder, `<type>/<id>.json`) |
| CLI tool | the header comment of every `framework/cli/*.mjs` |
| Build option | `framework/schemas/build-options.json` |
| Feature | the feature tracker, `framework/catalog/catalog.json` |
| UI element | `apps/<app>/src/assets/ui-registry/*.json` when an app ships the UI registry |

Every entry has an id (`<kind>:<scope>:<key>`), term, kind, category path (`Plugins › Build manager › Controls`), a
one-sentence summary, the longer detail, the file it comes from, where it appears, its API, related entries,
children (a plugin lists its controls and commands) and keywords (for search and auto-tagging).

## The four contracts (Fable, Nov 7 2026)

`framework/core/engines/demo-rules.mjs` (pure, zero tokens; fixture `framework/spec/fixtures/demo.json`, check
`npx -y tsx framework/spec/check-demo.mts`), all built on walkthrough@1 steps `{ say, do, target }`:

| Type | What it is |
| --- | --- |
| `demonstration` (demonstration@1) | a narrated demo of one glossary entry: steps (say, do = a console action, target = what to highlight, highlight label, wait, title), the surface it runs on (live, preview, recorder), a voice, demos chained after it, the entry it is about and the entries it covers, auto-tagged keywords, where it was generated from |
| `book` (book@1) | chapters of items (a glossary entry id, `demonstration/<id>`, `clip/<id>`, `book/<id>#<chapter>`) with the wizard's plan (total and per-chapter minutes, style, look, narrator), the docs to generate (depth, format, interactivity) and the outputs (video, chapter clips) |
| `clip` (clip@1) | a generated clip / demo / chapter / walkthrough / video: source, media, recording facts, transcript, chained clips, the entries shown and a large auto-extracted keyword set |
| `docs` (docs@1) | generated documentation: source, depth, format, interactivity, the files, when, and a hash of the sources |

The engine also holds the generator (`demonstrationFromEntry`), the walkthrough conversions, the book planner
(`bookPlan`, `newBook`, `bookMinutes`, `moveItem`, `moveChapter`, `addItem`, `bookOutline`, `bookToWalkthrough`), the
clip tagger (`clipKeywords`, `clipFromDemonstration`) and the docs plan (`docsPlan`). Kotlin twin deferred
(`framework/spec/PORTING.md`).

## Using it

- Console: **Help › Glossary & Index** (or the side nav). Search (every word must match), filter by kind, sort, show
  drafts, show only undescribed entries; switch Glossary / Index / Grid; tap an entry for its details and links,
  **Generate demonstration**, **Play demonstration**, **Add to book…**.
- **Help › Demonstration Designer**: Generate from an entry / Blank; the editor (name, about, app, surface, voice,
  steps with Play / Up / Down / Remove, chain); Play, Save, Revert, Regenerate, Record clip…, Delete. The **Clips** tab
  lists every clip (source, media, transcript, keywords) and registers a new one.
- **Help › Book Builder**: New book… (the wizard), the books tree (drag items between chapters, chapters up and down),
  the chapter editor (title, minutes, intro, items with minutes and notes), the content picker (drag or Add), Preview
  (the real screen in a floating window), Preview book, Record video, Documentation (depth, format, interactivity,
  Generate, Open), Outputs.
- The **player** is a floating window: Back / Repeat / Next / Stop, arrows and Escape, **Voice control** (next, back,
  repeat, stop through the browser's speech recognition), and the console actions `demo.play[:type:id]`,
  `demo.replay`, `demo.next`, `demo.prev`, `demo.repeat`, `demo.stop`, `demo.generate:<entry>`, `book.new`,
  `book.open:<id>`, `book.add:<ref>` (so AmberX and Molly can drive it by voice).
- `?axf-view=<view id>` on the console URL opens that view on load (the generated docs' live frames use it).
- MCP: `glossary_index_stats`, `glossary_index_search`, `glossary_index_entry`, `glossary_index_changes`,
  `glossary_index_rebuild`, `glossary_index_demos`, `glossary_index_demo`, `glossary_index_demo_save`,
  `glossary_index_demo_delete`, `glossary_index_demo_generate`, `glossary_index_demo_walkthrough`,
  `glossary_index_book_new`, `glossary_index_book_change`, `glossary_index_book_outline`, `glossary_index_book_record`,
  `glossary_index_clip_register`, `glossary_index_clip_from_demo`, `glossary_index_docs_generate`,
  `glossary_index_docs_file`.
- CLI: `axf glossary-index search --q "merge queue"`; offline `node catalog.mjs search merge queue`,
  `node catalog.mjs get concept:asset`, `node catalog.mjs stats`; `node demos.mjs list | get | generate <entry> --save
  | walkthrough <type> <id> | book new "<title>" … | book <id> add <chapter> <ref> | book <id> record | clip from-demo
  <id> --video … | docs generate <book id> --depth … --format … --interactive …`.
- Other plugins: capability `glossary@1` (`lookup(id)`, `search(q, kind, limit)`, `rebuild(reason, build)`,
  `demos(type)`, `demo(type, id)`, `generate(entry)`).

## Documentation output (docs@1)

`docs.mjs` writes exactly the files `docsPlan` lists into `<dataDir>/docs-out/<docs id>/`: light = one page; standard =
an index plus a page per chapter; deep = plus a page per item with its full API, links, children and walkthrough
steps; extreme = plus runnable API examples (read-only REST calls against the console, token pasted once), live
components (the real screen in a frame of the console), a search index and the TypeScript sources. Formats: markdown,
html, interactive-html-ts (`docs.ts` compiled to `docs.js` with the console's TypeScript). The look comes from theme
tokens only: `docs.css` reads `--fx-*`, `data/tokens.css` carries their values (the live console's when generated from
the console, the framework's default assets from the CLI). `GET docs/file?id=&path=` serves a file.

## Recording

**Record video** on a book writes its walkthrough@1 to `<dataDir>/video/<book>.walkthrough.json` and hands the
`amberx-walkthrough` job to the hired Walkthrough producer (`framework/cli/agent-job.mjs`) with the chapters as its
flow. **Record clip…** on a demonstration (or `clip from-demo`) registers what the recorder filmed as a clip asset.

## Keeping it complete

- The built catalog and every demonstration, book, clip and docs set live in the plugin's data folder
  (`.axf-console/plugins/glossary-index/`), never in git. The catalog is rebuilt when missing, from Settings › Plugins ›
  Glossary & Index › **Rebuild now**, over the API, whenever an asset is saved, and **after every build**: `build-hooks.mjs`
  (build-hook@1 listener, plugin.json `buildHooks`) rebuilds it on created, steps-added, step-done, status, pr-opened,
  pr-merged, addendum and restored events with the build's id, so `changes.json` says which build added, changed or
  removed what.
- CI runs `test.mts` and `catalog.mjs --check`: every plugin and asset type must have an entry, every entry a summary,
  and the number of items whose source has no description of its own (their summary is generated) may only go down
  (`coverage.json`; lower it with `node catalog.mjs --update-ratchet` after describing things).
- New kind of thing in the system? Add a source function in `catalog.mjs` and a kind in `KINDS`.
