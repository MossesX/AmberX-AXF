# AmberX walkthrough video (Nov 1 2026)

Brett's brief (Nov 1, ~3 AM): a walkthrough of the AmberX app just like the long one at the bottom of
demo.amberxai.com, made with the same tooling, played inside AmberX, and re-recordable with one command. One Opus
session on the VPS, branch `claude/amberx-walkthrough` (worktree `/root/axf-builds/amberx-walkthrough`), orchestrator
build `amberx-walkthrough` (Refactor profile), change log entry `chg-20261101-24794d5355`.

## 1. How the demo walkthrough was made (found on this server, no media opened)

- **demo.amberxai.com** is container `axp-demo` (nginx) serving `/opt/axp-demo/html`. The bottom of its page links
  `/walkthrough/index.html` ("▶ Watch the walkthrough", plus a top bar and a header button). It is **72 minutes**, not
  ~17: 28 chapters (Welcome … Closing) and indexed features.
- **The player** (`/opt/axp-demo/html/walkthrough/index.html`, "AmberX Walkthrough Index") is one static page: a
  `<video>` fed from six 720p MP4 parts (`amberx-walkthrough_720p_part-0N.mp4`, ~10 MB each, stitched by a `PARTS`
  table), an inline `INDEX` (title, duration, chapters `{title, start, count}`, segments), "now playing" chapter +
  title, Previous / Next chapter, chapter ticks on the progress bar, a speed select (0.75×–2×) and a downloads list
  (SRT, VTT, chapters .txt, transcript .docx/.pdf, 1080p/720p single files).
- **How the demo video itself was produced is not on this server**: only its published output is (no generator
  script in `/opt/axp-demo`, its git history, or anywhere else on the disk). It was recorded live on demo.amberxai.com
  ("recorded live at demo.amberxai.com" in its meta line).
- **What *is* here is the AmberX Tour pipeline** that was built to copy it (`/opt/amberx-tour`, repo
  `MossesX/Amberx-tour`; containers `tour-rec` / `amberx-tour-rec` from image `amberx-tour-recorder`):
  `recorder/script.mjs` (chapters → scenes `{say, act}`), `tts.mjs` (Piper, voice `en_US-ryan-high`), `record.mjs`
  (Playwright on the live sites, signed in as hub user `tour-recorder` from `/root/.tour-recorder.env`, one video per
  chapter, each scene held for its voice clip), `assemble.mjs` (ffmpeg → 720p MP4 + VTT + chapters.json), `run.sh`, and
  a player (`index.html` + `js/player.js`: chapter index, captions, speed presets) at tour.amberxai.com.
  `walkthrough-studio` (node:22, `/opt/walkthrough-studio`) is the planning app (scripts, timelines, exports); it
  stores projects on the device / axHub's data server, not media files.
- **Reused for AmberX:** the tour pipeline's shape and its recorder image (Playwright 1.49 + ffmpeg + Piper), the
  recorder account, the demo player's features (chapter index + segments, now playing, Previous/Next, ticks, speed
  presets, captions) and its index shape (`title`, `duration`, `chapters[{title, start}]` + segments).
- **Found and fixed:** the two old exited recorder containers (`tour-rec`, `amberx-tour-rec`) kept the recorder
  account's password in their saved environment (`docker inspect`). Removed them (their output is on bind mounts);
  the new recorder runs with `--rm`. The password itself still sits in `/root/.tour-recorder.env` (root only), as
  before; rotating it is cheap if anyone else ever had docker access.

## 2. What was built

| Part | Where |
| --- | --- |
| Chapter script (walkthrough-video@1: chapters → scenes `{say, act}`, rules + validator) | `apps/amberx-droid/walkthrough/script.mjs` |
| Demo data (made-up notes, lists, tasks, one held veto call + two approvals, user "Demo"), built with the app's own notes core | `walkthrough/seed.mts` |
| Request layer: seed data instead of axHub's data server and approvals feed, a made-up hub approval page, every write answered in the browser, AI answers and the user faked | `walkthrough/demo-hub.mjs` |
| Recorder: sign-in in an unrecorded context, a warm-up pass so popups start calm, one video per chapter at 412×915 (2× pixels), touch dot, highlight ring + label on the control being explained, blur on password / key / vault fields, every scene's visible text saved | `walkthrough/record.mjs` |
| Amber's voice: Piper `en_US-kristin-medium`, clips cached by their words | `walkthrough/tts.mjs` |
| Assembly: `walkthrough.mp4` (720×1600, H.264/AAC, faststart), `walkthrough.vtt`, `chapters.json` (chapters + scene segments), `poster.jpg` | `walkthrough/assemble.mjs` |
| Checks: script validation; secrets scan over every scene's text + captions (provider keys, GitHub/Slack/AWS/Google tokens, JWTs, private keys, passwords, long random strings, the recorder account's own values) | `walkthrough/check.mjs` |
| Live UI check: Home card, AmberX menu + Help entries, player loads every chapter, chapter jump seeks, captions, no page errors; phone + desktop shots | `walkthrough/ui-check.mjs` |
| One command | `bash apps/amberx-droid/walkthrough/rebuild.sh` (`ONLY=…`, `NO_PUBLISH=1`, `UI_CHECK=1`) |
| Player in AmberX: video + captions, chapter now playing + scene, chapter bar with marks, Previous / Next chapter, speed presets 0.75–2× (saved), chapter index with each chapter's scenes; framework controls + theme tokens only | plugin `apps/amberx-droid/src/plugins/walkthrough` |
| Entries: card at the bottom of Home ("Watch the walkthrough"), AmberX menu → Walkthrough, Help → Watch the walkthrough, nav → Help · Walkthrough, action `walkthrough.open[:<chapterId>]` | plugin + `src/views/Approvals.tsx` |
| Media behind the existing auth: `GET /api/walkthrough/{walkthrough.mp4,walkthrough.vtt,chapters.json,poster.jpg}` from `$AMBERX_DATA_DIR/walkthrough/` (the hub's wall; signed-in users may watch; Range for seeking; nothing else served) | `apps/amberx-droid/server/main.py` |
| Console button: Settings → Plugins → Molly guide → **Re-record the AmberX walkthrough** → one veto call (`vps.run` through Vinny, reason "Re-record the AmberX walkthrough video") that starts `rebuild.sh` on the VPS in the background | `apps/console-web/plugins/molly-guide` |

**Help mode:** branch `claude/help-mode` has not landed (not on the remote), so there are no Help-mode tooltips to link
yet. The hook is ready: a tooltip's "Watch how" only needs to dispatch `walkthrough.open:<chapterId>` (chapter ids
below).

## 3. Chapters

| # | id | Title | Covers |
| --- | --- | --- | --- |
| 1 | welcome | Welcome to AmberX | banner, waiting count, search, bottom nav, skippable chapters |
| 2 | home | Home: approvals | rows, who asked (Claude Code / Agent Molly / Claude.ai), held call countdown, Show the details, Deny / Approve now / Shelve, the held-call popup, Check now / Hub page / Window |
| 3 | terminal | Terminal | held commands with countdown and actions |
| 4 | command-center | Command center | four tabs, search, row details, per-command switch, own phrases, chains & wizards, Developer |
| 5 | dictate | Dictate and voice notes | Start dictating, review card, a note typed and saved once (synced line), voice-note lists |
| 6 | notes | Notes and tasks | lists, pinned, search, tasks views, due-today badge |
| 7 | web | Web pages and clips | pages in tabs, clips as notes |
| 8 | ask | Ask my notes | question → answer from notes only, AI connection settings |
| 9 | voice | Voice and the overlay | Speak, hands-free, always armed, what you can say, the Android overlay setting |
| 10 | molly | Agent Molly | Developer commands, veto calls, Molly's walkthroughs |
| 11 | recorder | Audio out and session recording | output recorder, chunks to the hub, session recording through the hub, its settings |
| 12 | monitor | Monitor | background watch, auto-approval, one source of notifications |
| 13 | settings | Settings | level toolbar (Administrator), Appearance, theme flip, Hide sensitive screens, Plugins |
| 14 | hub | Hub links and the menu | menu bar, Apps, Hub page, Help → Watch the walkthrough, the Home card |
| 15 | closing | That's AmberX | wrap-up |

Not covered, honestly: **the Quiet switch** — there is no Quiet switch anywhere in AmberX's code yet (only "quiet"
in descriptions), so the video doesn't show one. **Watch live** links render nothing inside AmberX (the console's
token isn't there; `src/console/watchLive.tsx`), so the approvals chapter doesn't promise them. The **Android shell**
itself (overlay over other apps, the recorder's consent prompt, the quick-settings tile) can't be recorded from the VPS
(no device): the narration explains them over the web screens. Re-record when the Quiet switch lands.

## 4. The recording

- **Length:** 9:12 (552.8 s), 15 chapters, 58 scenes, 129 caption cues. It came out a little under
  the 10-minute target: that is what the narration needs to cover every part once at a normal pace; more chapters can
  be added in `script.mjs` (e.g. once the Quiet switch exists).
- **File:** `walkthrough.mp4` 720×1600 H.264 + AAC, 20.0 MB (not in git), with `walkthrough.vtt`,
  `chapters.json`, `poster.jpg`.
- **Stored:** `/opt/amberx-web/.app/data/walkthrough/` = AmberX's data folder (`/data/walkthrough` in the `amberx-web`
  container), served at `https://amberx.amberxai.com/api/walkthrough/*` behind the hub's wall. Working files (voice
  cache, raw chapter videos, per-scene shots and texts) in `/opt/amberx-walkthrough-rec/` (where the tour recorder keeps
  its `/opt/amberx-tour-rec`). Walkthrough Studio has no server-side media store (its projects live on the device or
  axHub's data server), so AmberX's own data folder is the place its existing auth already guards.
- **Recorded:** live amberx.amberxai.com, phone layout 412×915, signed in as the hub's recorder account (sign-in in a
  context that is never recorded), every data call answered from the demo seed, every write kept in the browser
  (the hub's real notes, approvals and settings were never changed).

| # | Chapter | Starts | Length |
| --- | --- | --- | --- |
| 1 | Welcome to AmberX | 0:00 | 0:59 |
| 2 | Home: approvals | 0:59 | 1:15 |
| 3 | Terminal | 2:15 | 0:15 |
| 4 | Command center | 2:31 | 0:47 |
| 5 | Dictate and voice notes | 3:18 | 0:44 |
| 6 | Notes and tasks | 4:02 | 0:42 |
| 7 | Web pages and clips | 4:45 | 0:15 |
| 8 | Ask my notes | 5:01 | 0:33 |
| 9 | Voice and the overlay | 5:34 | 0:35 |
| 10 | Agent Molly | 6:09 | 0:30 |
| 11 | Audio out and session recording | 6:39 | 0:40 |
| 12 | Monitor | 7:20 | 0:26 |
| 13 | Settings | 7:46 | 0:48 |
| 14 | Hub links and the menu | 8:34 | 0:25 |
| 15 | That's AmberX | 8:59 | 0:12 |

**Recorder bugs found and fixed on the way:** approval popups landing mid-chapter (warm-up pass); the held-call popup
not reopening (forget it was shown, reload); Settings remembering its last page ("Back to …" handling); the menu bar's
Plugins button caught instead of the Settings row; and Playwright padding the screencast instead of scaling it (the first
cuts had the app in the top-left quarter of the frame: now recorded at the viewport size and scaled by ffmpeg).

## 5. Re-recording

- **One command (VPS, root):** `bash /opt/axf/apps/amberx-droid/walkthrough/rebuild.sh` (or from any checkout).
  Takes ~15 minutes: checks the script, builds the demo data, records, scans, publishes. `ONLY=settings,hub` redoes
  just those chapters and keeps the rest; `NO_PUBLISH=1` records without replacing the live video; `UI_CHECK=1` checks
  the entry and the player on the live app afterwards.
- **Console:** Settings → Plugins → Molly guide → *Re-record the AmberX walkthrough* (veto call; deny it during the
  countdown to stop it). Log: `/opt/amberx-walkthrough-rec/rebuild.log`.
- **Change the words or the steps:** edit `walkthrough/script.mjs` (each scene's `say` and `act`), `node
  walkthrough/check.mjs`, re-record. Unchanged narration isn't re-voiced.

## 6. Tests

| Check | Result |
| --- | --- |
| `npx -y tsx apps/amberx-droid/test.mjs` | 2151/2151 after merging main (2143 before) (walkthrough: index parsing + safety, chapter navigation, clock, speeds, script validates, every main part has a chapter, broken/unclean scripts refused, secrets detector catches 5 key kinds and passes normal screen text, menu/Help/Home wiring, stylesheet tokens only) |
| `python3 apps/amberx-droid/server/test_server.py` | 147 passed (6 new: 404 before recording, sign-in needed, served, open to signed-in users, Range 206, only its own files) |
| Molly guide `test.py` | 13 (5 new: no Vinny = 503, vps.run starts rebuild.sh in the background, the veto reason, status) |
| `walkthrough/check.mjs` / `--scan` | script OK; scan clean: 58 scene texts + captions, no key-like strings, none of the recorder account's values |
| `walkthrough/ui-check.mjs` (live) | 24/24 on the live app (12 phone + 12 desktop): Home card, AmberX menu, Help, player opens, 15 chapters, chapter marks, captions, the MP4 streams with Range (206), poster, the player shows the recording, a jump seeks, now playing, no page errors. Playwright's Chromium has no H.264, so its pictures use a VP9 copy of the first 30 s |
| android.yml local block, `check-theme`, `check-controls`, `check-plugin-pages`, `plugin-lifecycle check molly-guide`, builds store, both `tsc` | pass, except `tracker.mjs --check` and `plugins.mjs --check`, which fail on main too (391 items without a status; `x.assets.browser` not in the plan) — untouched here |

Screenshots (entry + player, phone + desktop) are in UI Review → Screenshots, group **AmberX walkthrough - Nov 1**.
