<!-- memory-chunk@1 source=_claude/memory/docs/walkthrough-everything.md lines=14-20 tokens=119 -->
## Reuse, don't rebuild

The AmberX walkthrough (`apps/amberx-droid/walkthrough/`, 9:12, walkthrough-video@1) already does the hard parts:
chapters → scenes `{ say, act }`, Piper TTS clips cached by their words, Playwright recording on the live app with
highlights and blur, ffmpeg assembly into `walkthrough.mp4` + `.vtt` + `chapters.json` + poster, a script checker
and a secrets scan. This build lifts that into a shared recorder and adds a second walkthrough on top of it.
