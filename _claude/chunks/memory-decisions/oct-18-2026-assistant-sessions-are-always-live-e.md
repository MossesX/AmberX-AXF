<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=156 -->
## Dev Console

- Oct 18 2026: **Assistant sessions are always live.** Every assistant in the framework keeps its sessions open: they never close when the browser/app closes, because they run on the host (routed through axHub on the VPS); viewers attach/detach and replay. The features belong to the **assistant plugin**; the kernel only carries the contract (`live-session@1`, placeholder capability `axf.live-sessions`). Built on Opus: kernel contract on both ports + local host in the console's AI assistant plugin; axHub host is a placeholder until axHub's session workers exist. Spec `framework/spec/LIVE-SESSIONS.md`.
