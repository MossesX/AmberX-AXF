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

| File | What |
| --- | --- |
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
