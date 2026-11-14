# Demonstration Designer

Pitch the product in three picks and one button (Brett, Nov 9 2026: "I want a demonstration designer plugin"). It
replaces the Demonstration Designer view of the Glossary, Index & Demos plugin, which was built as an editor and was
unusable for pitching. This one is for **pitching**: dead simple in front, everything else folded away.

## The main flow

1. **What to show**: any plugin, screen or UI element. The list is the live registry: every console plugin
   (`plugin.json` + its `help.json`), the console's own screens (`src/assets/help`), UI-registry files when an app
   ships one, plus whatever the open console's search index knows (dialogs, settings tabs).
2. **How long**: 1, 2, 3, 5 or 10 minutes (the API takes 1 to 30).
3. **Narrator voice**: a device voice, the default one, or captions only; calm / normal / brisk.

**Generate** writes the pitch with zero tokens (`engine.mjs`, pitch-script@1): a hook ("Meet X." plus the strongest
benefit sentence) over the first screen, the best screens of the topic (help text and controls count) each with a
benefit line and one or more highlighted controls, and the closing call to action. Spec words (ids, `@1` names, file
names, API paths) never reach the narration; sentences that sell go first. The script is fitted to the minutes:
when the words run long the weakest beats go (never the hook or the closing), then long says are cut to their first
sentence; when they run short each screen dwells a little longer. The result is a **demonstration@1** asset
(reusable, chainable, played by anything that plays walkthrough@1) with its pitch facts beside it.

Then the stage plays it on the **real console**: logo intro (the brand mark from the active branding, else the product
initial), the console moves to each screen (`nav:<view>`), the app zooms and pans to the target, a spotlight (the rest
dims) or an outline lands on the control with its label, captions show the words while the device voice reads them,
soft synthesised music plays under it (no files; it ducks under the narrator), and a logo outro shows the call to
action. Pause / Back / Next / Stop on the stage, keyboard (space, arrows, Escape), or the actions below.

After: **tweak the script** (plain text, one block per step; actions and highlights stay with their step), **Play**,
**Export video** (records the tab with getDisplayMedia + MediaRecorder: MP4 where the browser can, else WebM; the
file is uploaded, kept as a clip@1 under `media/`, and transcoded to MP4 on the server when ffmpeg is there), **Copy
share link** (`?axf-demo=<id>`, `&axf-autoplay=1` plays it), and **Tour** (chain saved pitches after this one).

**Advanced** (folded; a setting hides it): the step timeline (title, say, do, target, highlight, dwell; play one
step) and **record by doing** (every screen you open and control you tap becomes a step with draft words).

## Pipelines mode: demo pipelines, walked through live

Brett, Nov 13 2026: "a bunch of different types of pipelines for demonstration purposes, walked through so you can see
what's going on behind the scenes; follow the console building stuff, and a terminal or scrolling window showing all
the output you wouldn't normally see". The designer page has two modes (a TabGroup): **Pitch** (above) and **Pipelines**.

- **Library** (`pipeline-library.mjs`): one ready-made demo per pipeline type: voice to app, add a feature, skin swap
  across the whole app, parallel split build, fix a failing build automatically, new project from a template, the
  approval flow (veto, approve by voice). Each is a **pipeline-demo@1** (`pipelines.mjs`): chapters with narration,
  the screen focus mode moves to (orchestrator, builds and steps, UI Review, Shipped features…), an optional element,
  a length, the behind-the-scenes lines of the chapter and the live probes it runs.
- **Guided walkthrough** (`web/cover.tsx`, slot `app.frame.cover`, so it stays up as the console moves): the chapter's
  title and words (spoken by the device voice unless muted), chapter numbers to jump to, back / play-pause / skip /
  restart / speed / stop. As each chapter starts the console navigates to its screen and scrolls to its element.
- **Behind the scenes** (`web/bts.tsx`): a terminal-style scrolling window streaming orchestrator decisions, model
  picks, step splits, agent log, git, tests, axHub calls, focus moves and errors, each kind its own colour, filterable
  by kind and words, docked along the bottom, floated (resizable) or full screen; it follows the newest line unless
  you scroll up; Copy copies the shown lines.
- **Replay or live** (`pipeline-demos.mjs`): replay plays the recording of the last live run, else the script:
  instant and offline. Live first runs each chapter's probes for real on the test-sandbox project and this checkout
  (`git log`, `git status`, the test-sandbox builds through the orchestrator, `model-policy` on the chapter's words,
  the rules split, this plugin's self-test, `check-theme`, `agent-slots status`, and the axHub payload a chapter's
  call would carry, printed and never sent). Every probe is read-only: a demo never writes a build, a commit or a hub
  record. The output is kept as a pipeline-recording@1, so the next replay shows what really ran. Speed 0.5× to 4×.
- **Designer** (`web/pipelines.tsx`): New demo or Edit a copy of a built-in; pick the pipeline type, name, voice
  phrases, then per chapter the narration, the screen, an element, seconds, the behind-the-scenes lines (`@seconds
  kind: text`) and the live probes. A saved copy under a built-in's id shadows it; deleting it brings the built-in back.

| what | UI | REST (`/api/plugins/demonstration-designer/…`) | MCP / CLI (plugin-commands) | voice / console actions |
| --- | --- | --- | --- | --- |
| list / one demo | library | `GET pipelines` · `GET pipeline?id=` | `demonstration_designer_pipelines`, `…_pipeline` · `axf demonstration-designer pipelines` | `pipeline.open[:<words>]` |
| play (replay) | Play | `GET pipeline/timeline?id=&speed=&script=` (what plays) | `…_pipeline_timeline` | `pipeline.run:<words>` ("run the voice-to-app demo"), `pipeline.replay:<words>` |
| run live | Live + Run live | `POST pipeline/live {id, chapter?}` · `GET pipeline/recording?id=` | `…_pipeline_live`, `…_pipeline_recording` | `pipeline.live:<words>`, `pipeline.run:<words>:live` |
| player moves | walkthrough bar | `GET pipeline/state` (read) | `console_action pipeline.pause` … | `pipeline.pause`, `.resume`, `.next`, `.prev`, `.chapter:<n>`, `.restart`, `.speed:<x>`, `.mode:<replay/live>`, `.follow:<on/off>`, `.stop` |
| behind the scenes | panel | `GET pipeline/lines?id=&kind=&q=` | `…_pipeline_lines` · `node pipeline-demos.mjs lines <id> --kind git` | `pipeline.panel:<on/off>`, `pipeline.dock:<dock/float/full>`, `pipeline.filter:<kinds>:<words>` |
| design | designer | `POST pipeline {demo}` · `POST pipeline/copy {id, as}` · `DELETE pipeline?id=` · `GET pipeline/types` | `…_pipeline_save`, `…_pipeline_copy`, `…_pipeline_delete`, `…_pipeline_types` | — |
| which demo a phrase names | — | `GET pipeline/match?q=` | `…_pipeline_match` | (used by `pipeline.run`) |
| deep link | — | `GET pipeline/link?id=&play=&live=` | `…_pipeline_link` | `?axf-pipeline=<id>[&axf-autoplay=1][&axf-mode=live]`, `?axf-pipeline=library` |

CLI without the console: `node apps/console-web/plugins/demonstration-designer/pipeline-demos.mjs …` (see its header).
Data: `pipeline/<id>.json` (demos made in the designer) and `pipeline-recording/<id>.json` (live runs) in the dataDir.

## Files

| file | what |
| --- | --- |
| `engine.mjs` (+ `engine.d.mts`) | the pure rules: topics, benefit sentences, pitch generation, length fitting, script text, record-by-doing steps, settings, music plan, deep links; loaded by Node and the browser |
| `registry.mjs` | the topics read from the repo (plugins + help, console screens, UI registries); CLI `list / search / get` |
| `demos.mjs` | the store + CLI: demos as demonstration@1 in the data folder, pitch facts, chain, walkthrough, recordings as clip@1, MP4 export (ffmpeg), settings (pitch-settings@1), share links |
| `server/__init__.py` | the REST routes over `demos.mjs`; capability `demonstrations@1` for other plugins |
| `web/page.tsx` | the page: three picks, Generate, the result (play, export, share, tour, script), saved pitches, Advanced |
| `web/stage.ts` | the player: overlay, zoom/pan, spotlight, captions, speech, music, logo cards, recording |
| `web/settings.tsx` | Settings → Plugins → Demonstration Designer in collapsible sections; layout = a `settings` asset (three in `assets/settings/`, the UI Review options) |
| `web/model.ts` | the web store and API calls |
| `pipelines.mjs` (+ `.d.mts`) | Pipelines mode rules: pipeline-demo@1, timeline, the pure player, panel filter, voice match, probe lines, deep link |
| `pipeline-library.mjs` | the built-in pipeline demos, one per type |
| `pipeline-demos.mjs` | Pipelines store + live runner (read-only probes) + CLI |
| `web/pipelines.tsx`, `web/pipeline-model.ts`, `web/cover.tsx`, `web/bts.tsx` | the Pipelines page and designer, its store and clock, the walkthrough bar, the behind-the-scenes panel |
| `test.mjs` | the self-test (CI) |

## Every action and setting, four ways

| what | UI | REST (`/api/plugins/demonstration-designer/…`) | MCP / CLI (plugin-commands) | voice (console actions) |
| --- | --- | --- | --- | --- |
| what can be pitched | pick 1 | `GET registry?q=&kind=` | `demonstration_designer_registry` · `axf demonstration-designer registry` | — |
| generate | Generate | `POST generate {topic, minutes, voice, speed, save}` | `…_generate` | `pitch.generate:<topic>:<minutes>` |
| play / pause / next / back / stop | stage buttons | — (runs in the open console) | `console_action pitch.play` … | `pitch.play:<id>`, `pitch.pause`, `pitch.resume`, `pitch.next`, `pitch.prev`, `pitch.stop` |
| open a pitch (deep link) | share link | `GET share?id=` | `…_share` | `pitch.open:<id>`; `?axf-demo=<id>[&axf-autoplay=1]` (`?axf-demo=new` opens the designer empty) |
| tweak the script | Script box | `GET script?id=` · `POST script {id, text}` | `…_script`, `…_script_apply` | — |
| tour | Add to tour | `POST chain {id, chain}` | `…_chain` | — |
| export video | Export video | `POST media?id=&seconds=&mime=` (bytes) · `POST export {clip}` · `GET media` · `GET media/file?name=` | `…_media_upload`, `…_export`, `…_media`, `…_media_file` | `pitch.export:<id>` |
| list / get / save / delete | saved pitches | `GET demos` · `GET demo?id=` · `POST demo` · `DELETE demo?id=` | `…_demos`, `…_demo`, `…_save`, `…_delete` | — |
| cloud narrator voices | Voice picker, Default narrator | `GET narrators` · `POST narrate {narrator, text, speed}` (audio/mpeg) | `…_narrators`, `…_narrate` · `axf demonstration-designer narrators` | `pitch.generate` then play; the narrator is `agent:<id>` in `generate {voice}` |
| settings | Settings → Plugins → Demonstration Designer | `GET settings` · `POST settings {section: {key: value}}` or `{key, value}` | `…_settings`, `…_settings_set` · `axf demonstration-designer settings-set --key music.volume --value 12` | — |

CLI without the console: `node apps/console-web/plugins/demonstration-designer/demos.mjs …` (see its header).

## Data

`.axf-console/plugins/demonstration-designer/` (plugin-lifecycle@1 dataDir; `AXF_DEMO_DESIGNER_DIR` overrides):
`demonstration/<id>.json`, `pitch/<id>.json`, `clip/<id>.json`, `media/<demo>-<stamp>.<ext>`, `settings.json`.
The glossary catalog indexes the `demonstration/` folder of every plugin providing `service:demonstrations@1`, so each
pitch is a registry asset. `AXF_FFMPEG` names an ffmpeg binary for MP4 export (else `ffmpeg` on the path, else
Playwright's copy); without one, recordings stay WebM and the lifecycle check says so.

## Known limits

- A device voice is the browser's speech synthesis, which Chrome does not route into tab capture: an exported video
  narrated by a device voice carries captions and music but no voice. Pick a cloud narrator (`agent:<id>`, an agent
  whose Agent voice profile allows cloud voices, through the optional `axf.speech@1` capability) and the stage plays
  each line through WebAudio, so the recording carries the voice. Cloud lines cost the provider's credits (cached per
  line on the server); when the server can't speak a line, that line falls back to the device voice.
- Export needs a browser with `getDisplayMedia` (Chrome, Edge); the person picks the tab once.
- Zoom and pan transform the console's React root; the stage itself is a sibling of it, so it stays sharp.
