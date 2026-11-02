# The whole-stack walkthrough (plan, queued)

**Asked (Brett, Nov 1 2026):** a guided, narrated browser walkthrough like the AmberX app's, but about 90 minutes,
covering everything: the framework, the Dev Console, AmberX, axHub, the VPS and the MCP server. It explains how
unique, powerful and valuable the whole thing is, in Amber's voice (thick RI/Boston street slang, cussing, no slurs),
and downloads as a video too. **Update (Brett, Nov 1 21:32):** "Wanna be able to edit voice make it a plugin for
amberx with downloadable video": it lives in AmberX's walkthrough plugin, the voice and narration are editable there,
and the video downloads from it.

**State:** built on branch `claude/project-thread-646cjb` (PR #229); waiting on merge, then the recording run on the VPS (`WALKTHROUGH=stack bash apps/amberx-droid/walkthrough/rebuild.sh`, a veto call). As built: 26 chapters, 275 scenes, ~11.9k words at speed 0.93 (~85 min speech, about 90 with screen holds). Details: `apps/amberx-droid/walkthrough/README.md`. Profile: Refactor (current).
Model: Opus for every step (no new cross-port contract; the walkthrough-video@1 extension below is script-level).
Recurring re-records go to the job type `amberx-walkthrough` (Walkthrough producer) once it lands.

## Reuse, don't rebuild

The AmberX walkthrough (`apps/amberx-droid/walkthrough/`, 9:12, walkthrough-video@1) already does the hard parts:
chapters → scenes `{ say, act }`, Piper TTS clips cached by their words, Playwright recording on the live app with
highlights and blur, ffmpeg assembly into `walkthrough.mp4` + `.vtt` + `chapters.json` + poster, a script checker
and a secrets scan. This build lifts that into a shared recorder and adds a second walkthrough on top of it.

## What changes

1. **Shared recorder** (`framework/cli/walkthrough/`): move record/tts/assemble/check out of the AmberX folder,
   AmberX's script keeps working unchanged (its `rebuild.sh` calls the shared one; re-record proves it).
2. **Multi-app chapters:** each chapter names its own `url` + `viewport` + sign-in; desktop chapters at 1920×1080,
   AmberX chapters at the phone layout letterboxed into 1080p.
3. **Explainer scenes** for things with no screen of their own (VPS layout, request path through axHub to the MCP
   server, the veto flow, build orchestrator): an animated diagram page served by the recorder, styled from theme
   tokens, recorded like any other page.
4. **Demo data only:** the AmberX `demo-hub.mjs` approach extended to the console and axHub (seeded builds, change
   log, approvals). No real tokens, IPs, emails or account values; `check.mjs --scan` runs on every scene text,
   caption and a frame sample.
5. **Long-video handling:** chapter-at-a-time recording with resume (`ONLY=`), per-chapter mp4 cache, final concat;
   a 1080p H.264 export (~1–1.5 GB at 90 min) plus a 720p download copy (~400 MB).
6. **AmberX plugin** (`apps/amberx-droid/src/plugins/walkthrough/`, grown from the existing player): a picker (AmberX
   tour / The whole stack), chapter list, captions, and a **Download video** button (1080p or 720p, signed link
   behind the hub's wall). The console's Help links to it. Video files live with the published walkthrough files,
   never in git.
7. **Voice editor in the plugin:** pick Amber's voice (Piper voices installed on the VPS, speed, pitch), preview a
   line, and edit any scene's narration in a chapter → scene list. Saving writes a script override (walkthrough
   data on axHub, versioned) and queues a re-render as a veto call: only the changed scenes' clips re-voice (clips are
   cached by words + voice), the chapter is re-timed and re-cut, the rest is reused, so a one-line edit is minutes,
   not a 2-hour re-record. A changed `act` (what's shown) still needs that chapter re-recorded; the editor says so.
   Built from framework controls and theme tokens only; goes to UI Review.

## Chapters (~90 min, ~13,500 words of narration)

| # | Chapter | Where | Min |
|---|---|---|---|
| 1 | Cold open: what this thing is and why nobody else has it | diagram | 4 |
| 2 | asset@1: everything visible is a hot-swappable asset | console Studio | 7 |
| 3 | The engines: tokens, themes, style, scale, hot-swap live | console | 7 |
| 4 | One framework, two ports: TS reference + Kotlin kernel, fixtures as the contract | diagram + console | 5 |
| 5 | Build engine + CLI: `axf init`, bake, validate, conformance checks | diagram (terminal) | 6 |
| 6 | Dev Console tour: layout, banner, menus, search, settings levels | console | 7 |
| 7 | Plugins: manager, lifecycle, capabilities, skip-when-hosted | console | 6 |
| 8 | Builds: orchestrator, one builds store, pending, queue, profiles, Opus/Fable | console | 7 |
| 9 | Codebase changes log, UI Review, systems check + Fix it yourself | console | 6 |
| 10 | Agent swarm + hired job agents, agent cap | console Breakroom | 5 |
| 11 | axHub: connector hub, services, memory, one look for every app | axHub web | 7 |
| 12 | The veto system: held calls, countdown, Deny/Approve/Shelve | axHub + AmberX | 4 |
| 13 | AmberX: pocket control room (condensed from the existing tour) | AmberX phone | 7 |
| 14 | The VPS: Coolify, Traefik, containers, auto-deploy, headless Claude | diagram | 5 |
| 15 | The MCP server: tools Claude drives (build_next, pending, changes) | diagram + console | 5 |
| 16 | Why it matters: speed, one look everywhere, Claude-native, what's next | diagram | 2 |

Rules for the words (same as AmberX's script): facts match the code and docs; nothing unbuilt is promised (Android
work on hold, Patches paused, HR shelved are skipped or named as on hold); persona only in narration, captions follow
the narration word for word; no slurs, no sexual stuff.

## Steps

In the Build orchestrator as `stack-walkthrough` (Refactor): 25 steps of 10 minutes each, Opus (Brett, Nov 1 22:37:
"Save it in steps in case it fails, do 10 minute steps"). Each step is committed and pushed when it's ticked
(`orchestrator.mjs act step stack-walkthrough sN`), so a cut-off session resumes from `orchestrator.mjs next`.
