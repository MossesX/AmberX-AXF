# glossary-index-demos — report

Build `glossary-index-demos` (profile `all`). s1 on Opus (r2, Nov 7 2026, branch `claude/glossary-index-demos-r2`, never
pushed, merged into r3); s2–s6 on Fable (r3, Nov 7 2026, branch `claude/glossary-index-demos-r3`, agent Janitor Joey).
Brett (voice, Nov 7 2026): "the demonstration designer is gonna work off of the walkthrough. … we're going to create a
glossary in an index. Of every single … feature element setting … as if it's indexing an encyclopedia. … I want to be
able to generate a demonstration. … I want to be able to, like, say, write my own book with it. … when you build a book,
you'll be able to check off whether you want documentation and what type and how extensive … interactive HTML,
TypeScript documentation … In the future, anything built, the orchestrator will update this catalog … every time we
generate a clip … it needs to automatically attach a shitload of keywords to it. And … it needs itself to be an asset
going to a registry."

## What landed

### s1 (Opus, r2) — Glossary + index from the registry, CI completeness
Plugin `apps/console-web/plugins/glossary-index`: glossary-catalog@1 built from plugin manifests + commands, every help@1
entry, framework assets, asset types, job types, CLI tools, build options, the feature tracker, the UI registry and
hand-written concepts; Glossary / Index / Grid views, a detail panel with API and links; CI `test.mts` +
`catalog.mjs --check` (every registered item has an entry; the undescribed count only goes down).

### s2 (Fable) — the four contracts + the Demonstration Designer
`framework/core/engines/demo-rules.mjs` (+ `.d.mts`), four asset types built on walkthrough@1 steps `{ say, do, target }`:

| Type | Required | Enums | What else |
| --- | --- | --- | --- |
| `demonstration` | `steps` (1–60; say ≤ 600, `do` = a console action spec never a URL, `target` without `< > { } \``, `highlight`, `wait` ≤ 30 s, `title`) | `surface` live / preview / recorder; `generated.from` glossary / manual / book / help-intro / recorder | `about` + `entries` (glossary ids), `app`, `voice` (narrator, speed 0.5–2), `chain` (≤ 20 demos), `keywords` (≤ 200), `editable` |
| `book` | `plan` (chapterMinutes 1–120; totalMinutes 0–600; style quickstart / tutorial / tour / reference / deep-dive; theme, narrator, speed), `chapters` (≤ 200; id, title, minutes, intro, items ≤ 500 of `ref` = entry id \| `demonstration/<id>` \| `clip/<id>` \| `book/<id>#<chapter>`, minutes, note) | `docs.depth` light / standard / deep / extreme; `docs.format` markdown / html / interactive-html-ts; `docs.interactive` none / examples / live (live needs interactive-html-ts; markdown can't run examples) | `outputs` (video, chapterClips), `keywords` |
| `clip` | `source` (kind entry / demonstration / book / chapter / walkthrough / manual + id), `media` (seconds; video / poster / captions / audio = data-folder path or https) | `kind` clip / demo / chapter / walkthrough / video | `recorded` (at, app, url, viewport, designPackage, voice), `transcript` (≤ 2000 lines), `chain`, `entries`, `keywords` |
| `docs` | `source` (book / demonstration / entries), `depth`, `format`, `files` (path inside the docs folder, kind index / page / asset / script / style / data / media) | as book.docs | `interactive`, `generatedAt`, `sourceHash`, `build`, `keywords` |

One registry drives both validators (`core/validate.ts`, `cli/build-engine.mjs`), the normalisers, the generator
(`demonstrationFromEntry`: intro step that moves the console to the entry and highlights it, what it does, where, its
API, what it contains, see also), `demonstrationToWalkthrough`, the book planner (`bookPlan`, `newBook`, `bookMinutes`,
`moveItem`, `moveChapter`, `addItem`, `bookOutline`, `bookToWalkthrough`), the clip tagger (`clipKeywords`,
`clipFromDemonstration`: a transcript line per step at its time) and `docsPlan` (the exact file list per depth and
format). Registered in `asset-types.json` (before `uac-policy`, `shared: false`, never rolled, group Demos),
`types.ts`, `core/index.ts`; starters `framework/assets/{demonstration,book,clip,docs}/`; schemas regenerated; fixture
`spec/fixtures/demo.json` + `spec/check-demo.mts` (243 checks, in CI); Kotlin twin deferred (PORTING.md).

Demonstration Designer (`web/designer.tsx`), player (`web/player.tsx`, a floating window: speak, run the step's action,
highlight the target with its label, auto-advance when the voice ends, Back / Repeat / Next / Stop, arrows and Escape,
Voice control through the browser's speech recognition; actions `demo.play[:type:id]`, `demo.replay`, `demo.next`,
`demo.prev`, `demo.repeat`, `demo.stop`, `demo.generate:<entry>`), **Generate demonstration / Play demonstration / Add
to book…** on every glossary entry, `demos.mjs` (store: every asset is an asset@1 file in the plugin's data folder and a
glossary entry; CLI), server routes + 14 commands (REST / MCP / CLI through plugin-commands@1).

### s3 (Fable) — Book Builder with sandbox preview and video
`web/books.tsx`: the wizard dialog (title, about, total minutes, minutes per chapter, chapters, narrator, speed, look,
style ChoiceGrid, documentation options, outputs), the books tree (lib-tree with drag: items between chapters, chapters
up / down), the chapter editor (title, minutes or its share, intro, items with minutes and notes, Up / Down / Remove,
drop zone for dragged entries and items), the content picker (everything in the glossary plus demonstrations and
clips, search + kind filter, drag grip or Add), **Preview** (the real screen of an entry in a floating window through the
placement engine's view tab; a demonstration or clip plays), **Preview book** (one walkthrough: chapter intros + every
item's steps), **Record video** (writes `<dataDir>/video/<book>.walkthrough.json` and hands `amberx-walkthrough` to the
Walkthrough producer through `framework/cli/agent-job.mjs`), Plan / Documentation / Outputs tabs; `book.new`,
`book.open:<id>`, `book.add:<ref>` actions and the Add to a book dialog.

### s4 (Fable) — Interactive documentation output
`docs.mjs`: writes exactly the files `docsPlan` lists into `<dataDir>/docs-out/<docs id>/`: light = one page; standard =
index + a page per chapter; deep = + a page per item (full API table, links, children, walkthrough steps); extreme = +
runnable API examples (read-only REST against the console, token pasted once per tab), live components (the real screen
in a frame of the console through `?axf-view=<id>&axf-embed=docs`, which this plugin's `register` honours), a search
index and the TypeScript sources. Formats markdown, html, interactive-html-ts (`docs.ts` compiled to `docs.js` with the
console's TypeScript, a regex fallback when it is missing). The look comes from theme tokens only: `docs.css` reads
`--fx-*`; `data/tokens.css` carries their values (the console passes its live `--fx-*` values; the CLI writes the
framework's default assets). `GET docs/file?id=&path=` serves a file (path-escape refused). The Book Builder's
Documentation tab generates and opens them; the docs@1 asset lists the files, `generatedAt`, `sourceHash`, `build`.

### s5 (Fable) — Orchestrator auto-catalog hook
`build-hooks.mjs` (plugin.json `buildHooks`, build-hook@1 listener): on created, steps-added, step-done, status,
pr-opened, pr-merged, addendum and restored events the catalog is rebuilt from the registries with the build ids, so
`changes.json` says which build added, changed or removed what; idempotent (a rebuild with nothing new writes
nothing). Rule written into `_claude/rules/RULES.md` and `_claude/builds/BRIEF-TEMPLATE.md` (describe what you add
where it is defined; `catalog.mjs --check` fails CI on a new undescribed item).

### s6 (Fable) — Auto-tagged clip assets
`clip from-demo` / **Record clip…** on a demonstration, `clip register` / **Register a clip** on the Clips tab: every
clip is a clip@1 asset, indexed in the glossary (kind Clip, linked to its demonstration / book and the entries it
shows), with `clipKeywords`: the entries' terms, kinds, categories, summaries and keywords, every step's title, action,
target and words, the transcript, the app, the look and the voice (≤ 200, deduped). The smoke clip of the UI Review
demonstration carries 126 keywords.

## Checks (all green on the branch)

| Check | Result |
| --- | --- |
| `npx -y tsx framework/spec/check-demo.mts` | 243 checks |
| `npx -y tsx apps/console-web/plugins/glossary-index/test.mts` | 13 glossary + 7 demo checks (generator, books, clips, docs at three depths, hook, commands ↔ routes) |
| `node apps/console-web/plugins/glossary-index/catalog.mjs --check` | 3103 entries, 388 undescribed (ratchet 388; the nine UI Review choices commands got descriptions) |
| `node framework/cli/axf.mjs validate --framework` | 520 assets |
| check-job-type / help / agent-card / brand / card / model-policy / project-fixtures / plugin-commands | pass (type order pins hold) |
| `node framework/cli/check-theme.mjs`, `check-controls.mjs`, `check-toolbars.mjs`, `check-chrome-assets.mjs` | pass |
| `node framework/cli/plugin-lifecycle.mjs check glossary-index` | clean |
| `node framework/cli/help-coverage.mjs --check` | 100% (76 help entries in the plugin) |
| console `tsc --noEmit`, `vite build` | pass |
| server routes (FastAPI test client) | generate, walkthrough, book new / change / outline / record (dry), docs generate / file (escape → 404), clip from-demo, delete, 401 without a token |

## Screenshots
UI Review → Screenshots, group "Glossary demos - Nov 7" (desktop + phone): glossary entry with Generate demonstration,
Demonstration Designer, player window, Clips, Book Builder, Documentation tab, book wizard, generated docs (index and
an item page). Copies in `_claude/builds/reports/glossary-index-demos/shots/`.

## Gaps and notes
- The recorder (`apps/amberx-droid/walkthrough`) plays only the walkthroughs in `load.mjs`; a book's video goes to the
  Walkthrough producer job with the book's walkthrough@1 written beside it. The data-script input lands with the
  build-docs runner.
- The formal UI Review submission with three asset options was not made: Brett's r3 brief routed the screenshots to UI
  Review → Screenshots. The Book Builder, designer and player UIs are one option each.
- Kotlin twins of the four types are deferred (Android on hold); the Kotlin type registry reads `asset-types.json`, so
  the plain optional types validate there already.
- s3–s6 were pinned to Opus and ran on Fable in this one session (Brett restarted the build on Fable; recorded as a
  note on the build and in the orchestrator's phase switch).
