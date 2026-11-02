# AmberX walkthrough video

A narrated walkthrough of the AmberX app (walkthrough-video@1), like the one on demo.amberxai.com: chapters you can
skip, Amber's voice, captions, highlights on the control being explained. Recorded on the live app
(https://amberx.amberxai.com) in the phone layout (412×915) with demo data only, played in AmberX → Walkthrough
(Home card, AmberX menu, Help, `walkthrough.open:<chapterId>`).

```bash
bash apps/amberx-droid/walkthrough/rebuild.sh              # re-record everything and publish (~15 min)
ONLY=home,settings bash apps/amberx-droid/walkthrough/rebuild.sh   # just those chapters
NO_PUBLISH=1 bash …/rebuild.sh                              # record + check, don't publish
UI_CHECK=1 bash …/rebuild.sh                                # publish, then check the entry + player on the live app
node apps/amberx-droid/walkthrough/check.mjs                # validate the script
```
Console: Settings → Plugins → Molly guide → **Re-record the AmberX walkthrough** (a veto call on axHub that runs
`rebuild.sh` on the VPS).

## More than one walkthrough, and editing the voice (Nov 1 2026)

`WALKTHROUGH=<id>` picks the script (`load.mjs` → `WALKTHROUGHS`): `amberx-app` (this tour, the default, `script.mjs`) or
`stack` (the whole-stack walkthrough, `stack.mjs`: ~90 min, 26 chapters on the console and axHub at 1920×1080, AmberX
letterboxed from the phone layout, explainer slides from `explainer.html`). Other walkthroughs work and publish in
their own folder (`/opt/amberx-walkthrough-rec/<id>`, `…/data/walkthrough/<id>/`).

```bash
WALKTHROUGH=stack bash apps/amberx-droid/walkthrough/rebuild.sh                 # record + publish the whole-stack one
WALKTHROUGH=stack VOICE_ONLY=1 bash …/rebuild.sh                                 # re-voice edited lines and re-cut, no re-recording
WALKTHROUGH=stack node apps/amberx-droid/walkthrough/check.mjs                   # validate its script
```

In AmberX, Walkthrough → **Edit the voice** picks the Piper voice and speed and rewrites any scene's line
(walkthrough-voice@1 edits: only what differs from the script, saved on axHub, table `voice` in folder `walkthrough`).
**Re-voice** posts them to `POST /api/walkthrough/<id>/render` (hub admins) → the console's molly-guide
`amberx-walkthrough/rerecord` → one veto call on axHub running `rebuild.sh` with the edits base64-encoded in
`VOICE_OVERRIDES_B64` (kept as `<work>/voice.json` for later full re-records). Clips are cached by words + voice + speed,
so only changed lines are voiced; a longer line holds the scene's last frame. **Re-record** runs the full recording.
Desktop chapters read the console and axHub live with every write answered in the browser (`installReadOnly`); the
phone chapters keep the demo data. **Download** offers `walkthrough.mp4` and the smaller copies (`downloads` in the
script, e.g. `walkthrough-720.mp4`), served as attachments with `?download=1`.

| File | What |
| --- | --- |
| `load.mjs` | which walkthrough a run works on, the voice edits applied, the voices on offer |
| `stack.mjs` | the whole-stack walkthrough's chapters (cussing allowed, slurs refused) |
| `explainer.html` | the diagram slides for parts with no screen of their own |
| `script.mjs` | the chapters: scenes `{ say, act }` (narration + what to show) and the walkthrough-video@1 rules |
| `seed.mts` | the demo data (notes, lists, tasks, approvals), built with the app's own notes core |
| `demo-hub.mjs` | the request layer: seed data in place of axHub's data server and approvals feed, every write kept in the browser, the demo user |
| `record.mjs` | Playwright on the live app: sign-in (never recorded), warm-up, one video per chapter, highlights, blur, scene texts |
| `tts.mjs` | Amber's voice (Piper `en_US-kristin-medium`), clips cached by their words |
| `assemble.mjs` | ffmpeg: `walkthrough.mp4` (720×1600), `walkthrough.vtt`, `chapters.json`, `poster.jpg` |
| `check.mjs` | script validation; `--scan DIR`: no key-like strings or account values in any scene's text or the captions |
| `ui-check.mjs` | the Home card, menus and player on the live app (phone + desktop screenshots) |
| `run.sh` / `rebuild.sh` | inside the recorder image / on the VPS |

Where things live: work files `/opt/amberx-walkthrough-rec/` (voice, audio cache, raw videos, shots, texts), published
files in AmberX's data folder `/opt/amberx-web/.app/data/walkthrough/`, served by the AmberX server at
`/api/walkthrough/*` behind the hub's wall. The recorder account is `/root/.tour-recorder.env` (root only). The image is
the AmberX Tour recorder's (`amberx-tour-recorder`, built from `/opt/amberx-tour/recorder`).
