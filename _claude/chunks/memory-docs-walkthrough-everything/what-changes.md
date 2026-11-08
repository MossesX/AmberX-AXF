<!-- memory-chunk@1 source=_claude/memory/docs/walkthrough-everything.md tokens=538 -->
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
