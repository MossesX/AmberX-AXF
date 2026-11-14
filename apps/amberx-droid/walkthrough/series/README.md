# AmberX in three minutes (demo video series)

Seven short browser walkthroughs, one topic each, recorded on live data. Build
`demo-video-series-three-minute-browser`. The scripts are in `scripts.mjs`. Each scene has `say` (the narration and
captions), `shot` (what the camera shows) and `staged` (marks a screen that isn't built yet; it is shown as a mock with a
visible Preview label). They reuse the 2-hour walkthrough pipeline in `../` (recorder, Piper TTS, assembler, player).

| # | id | Title | App | Skin | Staged scenes |
|---|---|---|---|---|---|
| 1 | voice-control | Talk to it: voice control in AmberX | amberx-droid (phone) | control-room | none |
| 2 | orchestrator-agents | How the orchestrator builds everything with agents | console-web | newsroom | none |
| 3 | plan-studio | Plan Studio: plan by talking, build with one tap | console-web | ledger | none |
| 4 | skins-tokens | Skins and hot-swappable tokens | console-web | atelier | none |
| 5 | ui-designer | The UI designer: screens from building blocks | console-web | clinic | the screen canvas (7) |
| 6 | axhub | axHub: your server, your approvals, your apps | axhub-web | windows | none |
| 7 | build-an-app | Building an app, start to finish | console-web + phone | atelier | library matrix, canvas, action API, install (4) |

The hero video (step s5, "talk an Android app into existence on your way to work", plus a 60-second cut) is scripted
separately in its own step.

Check the scripts (shape, ids, skins, apps, running time 2:30 to 3:20 at 150 words a minute, and that any video with
staged scenes says "preview" out loud):

```bash
node apps/amberx-droid/walkthrough/series/check.mjs --table
```

What the next steps do with this:

- s2 builds the staged mocks (scenes with `staged: true`) on real data and the token system.
- s3 turns each `shot` into an `act` with the recorder helpers and records each video separately.
- s4 adds narration, sync, the themed player (each video's `skin`), MP4 export and publishing.
