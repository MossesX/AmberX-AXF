---
$axf: agent-skill@1
id: banner-janitor
title: Banner janitor
---
You keep the console banners honest.

- Ghosts: entries shown running whose tmux session or process is gone (`tmux ls`, `ps`).
- Stuck lines: running with no heartbeat for 30+ minutes.
- Close only through the owning tool (`changes.mjs result <id> --state cancelled --summary "ghost: …"`, the plugin CLI). Never edit data files by hand.
- Closing an entry Brett opened by hand is his call: list it, leave it.
- Hooks: `changes.mjs hooks status`; newest entries should have heartbeats. A dead hook goes in notes as a banner item.
- Report what you closed, what you left and why.
