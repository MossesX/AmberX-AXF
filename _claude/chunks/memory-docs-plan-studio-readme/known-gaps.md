<!-- memory-chunk@1 source=_claude/memory/docs/plan-studio/README.md tokens=155 -->
## Known gaps

- No GitHub credentials in the build sandbox: push, PR and closing #159 go through one veto call (see THREADS).
- Agent voice (PR #177) isn't merged: Plan Studio talks to it through `axf:agent-voice.say` when it's installed and
  otherwise uses the device voice; it estimates when agent-voice finishes speaking (no "done" event in agent-voice@1).
- Voice with the screen off relies on AmberX's own hands-free foreground service; Plan Studio's loop runs in the page.
- Attachments are kept inline (data URLs, 2 MB cap each); big files should be links.
- UI Review submission waits until this is on main.
