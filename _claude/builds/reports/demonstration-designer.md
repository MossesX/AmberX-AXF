# Demonstration Designer plugin (demonstration-designer-plugin-new-standalone)

Built Nov 9 2026 on Fable, branch `claude/demo-designer`. Brett: "Make a new one. I want a demonstration designer
plugin." For pitching: dead simple in front, everything else folded away.

## What it is
A new standalone console plugin, `apps/console-web/plugins/demonstration-designer` (own nav section **Demos**, Plugins
menu, Help → Pitch a demo…). It replaces the glossary's demonstration editor for pitching; that editor stays where it is
for books (its player button and help entry were renamed "Open the designer" so the two never share a help id).

**Main flow = three picks and one button.**
1. What to show: any plugin, screen or UI element from the live registry (`registry.mjs` reads every plugin's
   `plugin.json` + `help.json`, the console's own screens from `src/assets/help`, UI-registry files; the page merges in
   the open console's search index, so dialogs and settings tabs can be pitched too).
2. How long: 1 / 2 / 3 / 5 / 10 minutes (API: 1 to 30).
3. Narrator voice: a device voice, the default, or captions only; calm / normal / brisk.

**Generate** writes the pitch with zero tokens (`engine.mjs`, pitch-script@1, pure, the same file in Node and the
browser): a hook ("Meet X." plus the strongest benefit sentence) over the first screen, the best screens (help text and
controls count) each with a benefit line and up to three highlighted controls, and the closing call to action. Spec
words (ids, `@1` names, file names, API paths) never reach the narration; sentences that sell go first. The script is
fitted to the minutes: long = the weakest beats go (never the hook or the closing), then long says are cut to their
first sentence; short = each screen dwells longer (and the page says when a topic has too little material). The result
is a **demonstration@1** asset in the plugin's data folder with its pitch facts beside it.

**The stage** (`web/stage.ts`, a plain-DOM overlay over the live console): logo intro (the active brand mark, else the
product initial), the console moves to each screen (`nav:<view>`), the React root zooms and pans to the target, a
spotlight (the rest dims) or an outline lands on the control with its label, captions show the words while the device
voice reads them, soft synthesised music plays underneath (WebAudio chords, no files, ducked under the narrator), logo
outro with the call to action. Pause / Back / Next / Stop on the stage, keyboard, or the `pitch.*` actions.

**After**: tweak the script as plain text (one block per step; actions and highlights stay with their step), Play,
**Export video** (getDisplayMedia + MediaRecorder: MP4 where the browser can, else WebM; uploaded and kept as a clip@1
under `media/`, transcoded to MP4 on the server when ffmpeg is there), **Copy share link** (`?axf-demo=<id>`,
`&axf-autoplay=1` plays it), **Tour** (chain saved pitches). **Advanced** (folded, a setting hides it): the step
timeline and record by doing.

**Settings** (pitch-settings@1) live on the server so the API, MCP and CLI see the same values: Script, Narration,
Stage, Music, Export, Advanced in collapsible sections; the layout is a `settings` asset (three in `assets/settings/`).

## Every action and setting, four ways
REST `/api/plugins/demonstration-designer/…` (17 routes), MCP `demonstration_designer_*` and `axf demonstration-designer …`
through plugin-commands@1 (11 reads, 17 commands), voice through the console actions `pitch.open | play | export |
generate | pause | resume | next | prev | stop` (AmberX → console_action), the deep link `?axf-demo=<id>`. The CLI also
runs without the console: `demos.mjs topics | generate | list | get | save | delete | script | chain | walkthrough |
media | share | settings`. The README's table maps each UI action to its three other surfaces.

## Cross-plugin
- Capability `demonstrations@1` (topics, demos, demo, generate, walkthrough) for other plugins.
- The glossary catalog (`glossary-index/catalog.mjs`) now indexes the `demonstration/` folder of every plugin that
  provides `service:demonstrations@1` (found by capability, never by folder), so each pitch is a registry asset.

## UI Review
Two items wait in UI Review on the live console (group "demonstration-designer-plugin-new-standalone - Nov 9 4:10 AM",
branch `claude/demo-designer`, PR #405), each with three options as real `settings` assets in `assets/settings/`
(ui-choices@1), desktop and phone shots:
- **Demonstration Designer page** (`r-20261109-eb1a4485`, kind screen): Stacked · Three cards · Picker beside the dials
  (setting `axf.demonstration-designer.page.view`); the shots also show a generated pitch with Play / Export video /
  Copy share link and the script box.
- **Demonstration Designer settings** (`r-20261109-438d0f75`, kind settings): Sections · Numbered walk · Two columns
  (setting `axf.demonstration-designer.settings.view`).
Both default to the first option until Brett picks. Shots were taken with the local console pointed at no hub
(`AXF_APPEARANCE_HUB=off`), so the look is the default theme.

## Checks
`test.mjs` (21 checks: engine, registry over the real repo, store + CLI in a scratch folder, manifest vs routes; wired
into `.github/workflows/android.yml`), `tsc --noEmit` clean, check-theme / check-controls / check-toolbars /
check-chrome-assets / check-plugin-pages clean, `plugin-lifecycle.mjs check demonstration-designer` clean,
`plugin-commands.mjs check` clean, `plugins.mjs --check` clean, glossary `catalog.mjs --check` complete (ratchet held),
help coverage: every control of the plugin has an entry (76 entries + 1 intro).

Pre-existing failures seen while checking, not from this build: `help-coverage --check` is at 98.3% for console-web
(claude-accounts' `routing.tsx` controls and approvals-banner fields have no help; claude-accounts `help.json`
entries[17] has an invalid kind); `menu-reach.mts` reports unknown pages for shipped-features, glossary-index,
demo-designer and book-builder (their nav items use shapes the script cannot read); `plugin-lifecycle check
glossary-index` has stale references in THREADS.md and RULES.md.

## Known limits
- Narration is the browser's speech synthesis. Tab recording captures the music and page audio; Chrome does not route
  speech synthesis into tab capture, so an exported video can carry captions and music but no voice. A server-side
  voice (Piper or a cloud voice) is the next step.
- Export needs `getDisplayMedia` (Chrome, Edge); the person picks the tab once.
- MP4 on the server needs ffmpeg (`AXF_FFMPEG`, `ffmpeg` on the path, or Playwright's copy); the lifecycle check says
  when it is missing.

## Decisions made alone (nobody to ask)
- Pitch facts (length, topic, product, call to action, plan) live in a sidecar `pitch/<id>.json`, not in
  demonstration@1, so no framework engine changed and every demo plays anywhere walkthrough@1 plays.
- Page layout options are carried by `settings`-type assets (the only loose asset type the choices tooling writes), the
  same way the Job routing panel's options were.
- The glossary plugin was left in place (CI and the orchestrator depend on its catalog); only the clash with this
  plugin's help id was renamed.
