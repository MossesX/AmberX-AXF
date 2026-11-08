<!-- memory-chunk@1 source=_claude/memory/todo/install-keys.md lines=1-6 tokens=95 -->
# To-do: Install keys

Goal: Hostinger runs through axHub on the VPS (vault key), then the direct Claude Hostinger connector gets removed. Nov 5 2026.

Status: axHub vault is configured but holds 3 secrets, none for Hostinger. `hostinger.*` calls fail with "credential not available". DNS for molly is already correct (molly A -> 31.97.13.252, checked via the Claude connector).
