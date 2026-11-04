# Build docs and walkthroughs

Right-click anything that's built and get its documentation or a narrated walkthrough video.

**Where:** right-click a built build or a done step in the Build manager (and its Built history), the Build
orchestrator (cards and step rows), Pending builds, Plan Studio (plan rows and tree) and Codebase changes →
**Create documentation** / **Create walkthrough video**. Both dialogs take more builds and single steps
(*Add builds or steps*), so one job can cover several. Builds → **Docs & videos** lists every job.

## Create documentation

Reads the build: Brett's verbatim words and addenda, its steps, the build report, the merged PR's diff, and what the
touched plugins declare (pages, dialogs, settings tabs, settings, menu items, help entries, REST / MCP / CLI commands).

| Option | What |
| --- | --- |
| Audience | Me (short, plain) · Developer (files, keys, commands) · End user (no internals) |
| Depth | Brief · Standard · Deep |
| Include screenshots | adds the build's screens |
| Deep mode (AI) | `axf.llm@1` writes it from the material only; off, or no provider: a template from the same material |
| Anything special to cover | free text, quoted at the top |

The result is `<plugin or app>/docs/<build>.md` (else `docs/builds/<build>.md`) on a `docs/<build>-xxxx` branch, as a
pull request into main: the merge queue lands it when CI is green. The PR is linked in the build's plan (Plan Studio →
the plan → **Docs**).

## Create walkthrough video

| Option | What |
| --- | --- |
| Length | 30 s · 1 · 2 · 5 min · Custom (15 s to 30 min); the script is fitted to it (~2.5 words a second) |
| Focus | free text *special stuff to cover* + checkboxes of the build's done steps, screens and commands |
| Picture | viewport (desktop 1920×1080, phone 412×915 → 720×1600), theme (design package), layout, intro / outro cards |
| Sound | narration on/off, Piper voice, captions burned in (the .vtt is saved either way), speed |
| Deep mode (AI) | the AI plans the click path and lines; off, or no provider: the build's screens in order |

1. **Plan the script**: the job reads the build and plans `walkthrough-video@1` (data form): chapters → scenes
   `{ say, do: [{ op, … }] }`. Moves are data only (`open view hl click scroll wait go calm card settings menu dialog`),
   and `open` only goes to the hub's own apps, so neither a model nor an edit can make the recorder run code.
2. **Approve it**: edit any line or leave scenes out, then **Approve and record**. That sends **one veto call** on
   axHub (`vps.run` through Vinny). When it runs, the VPS waits for a heavy slot (`agent-slots.mjs heavy`) and
   `runner.mjs` hands the script to the walkthrough recorder (`apps/amberx-droid/walkthrough/rebuild.sh`, the same
   Playwright + Piper + ffmpeg image as the AmberX and whole-stack walkthroughs): the live console is recorded with
   every write answered in the browser, a forced theme stays in the recorder's browser, and every frame's text passes
   the secrets scan.
3. **Watch it**: progress is live on Docs & videos (reading, planning, voicing, part n of m, cutting, scan); **Cancel**
   stops the recorder container. The MP4, captions, poster and transcript land in the job; the video is attached to
   the build's plan (Docs + Attachments, opening the job on Docs & videos).

**Re-run with tweaks** on any finished job opens its dialog with the same options.

## Where things live

| What | Where |
| --- | --- |
| Jobs, scripts, docs drafts, videos | `AXF_BUILD_DOCS_DIR`, else `/projects/amberx-axf/_data/build-docs/jobs/<job>/` (the VPS data volume, mounted in the console and on the host), else `.axf-console/plugins/build-docs/` |
| A job | `job.json` (build-docs-job@1), `source-<n>.json`, `script.json`, `docs/<build>.md`, `work/` (recorder), `out/walkthrough.mp4 · .vtt · poster.jpg · transcript.md`, `run.log`, `cancel` |
| Rules | `core.mjs` (options, jobs, template docs, scripts and their safety), `gather.mjs` (what a build is made of), `jobs.mjs` (store), `cli.mjs` (server's way in), `runner.mjs` (VPS host) |
| Recorder | `apps/amberx-droid/walkthrough/script-file.mjs` (data scripts), `card` / `dialog` / `navigate` helpers and `LOOK_B64` in `record.mjs`, narration off in `tts.mjs`, burned-in captions in `assemble.mjs` |

## Commands

REST under `/api/plugins/build-docs/` (MCP `build_docs_*`, CLI `axf build-docs …` through plugin-commands@1):
`GET index | options | ai-status | jobs | job?id= | source?target= | file?id=&name= | finished`,
`POST docs | video | script | approve | cancel | rerun | remove`. Molly answers them by voice once the voice-command
asset is regenerated (`voice-commands.mjs generate console-web --write`).

```bash
node apps/console-web/plugins/build-docs/cli.mjs index                        # what can be documented
node apps/console-web/plugins/build-docs/cli.mjs docs plan-studio --audience developer   # template docs to stdout (--write)
node apps/console-web/plugins/build-docs/cli.mjs script plan-studio --length 60          # the fallback script
node apps/console-web/plugins/build-docs/cli.mjs list | get <job> | cancel <job>
node apps/console-web/plugins/build-docs/test.mjs && python3 apps/console-web/plugins/build-docs/test.py
```
