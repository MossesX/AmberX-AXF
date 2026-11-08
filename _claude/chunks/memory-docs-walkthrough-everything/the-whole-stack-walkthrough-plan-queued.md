<!-- memory-chunk@1 source=_claude/memory/docs/walkthrough-everything.md lines=1-13 tokens=315 -->
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
