<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md tokens=176 -->
## Screenshots
Same pixels as the Opus build (the avatar draws the same paths with the same classes and tokens; no other visible
change), so no UI Review item was raised. A `rebuild-shots` run was attempted for Crew, ID cards and Group chat
(before = origin/main, after = this branch, `agent-swarm-fable-rebuild/shots.json`): the console under Playwright on
this headless box only shows the "Waiting for axHub" banner, because the look comes from axHub alone (no local
fallback, Brett's rule) and the sandbox browser cannot reach the hub. The captures were discarded rather than kept as
blank pages; the shots list stays in the folder so a session with hub access (or the console container) can run it.
