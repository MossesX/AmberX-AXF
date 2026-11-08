<!-- memory-chunk@1 source=_claude/memory/docs/assistant-approvals.md lines=49-57 tokens=134 -->
## Shots

`_claude/memory/docs/rebuilds/assistant-approvals/shots/{before,after}/` — `assistant-*` (console, via
`framework/cli/rebuild-shots.mjs`) and `amberx-*` (AmberX `vite preview` + Playwright), phone and desktop, title bar and
popover. The feed (and, for AmberX, the hub's data reads) were faked in the page, since no hub was reachable.

![console popover, after](rebuilds/assistant-approvals/shots/after/assistant-popover-desktop.png)
![AmberX popover, after](rebuilds/assistant-approvals/shots/after/amberx-popover-phone.png)
