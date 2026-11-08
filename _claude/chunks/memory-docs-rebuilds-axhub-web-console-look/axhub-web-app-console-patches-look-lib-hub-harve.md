<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/axhub-web-console-look.md tokens=180 -->
# axHub web app: console / Patches look + lib-hub harvest (Oct 23 2026, Opus)

Pending item **`axhub-web-console-look`** · branch `claude/project-thread-j1ri9d` · PR #30.

Brett asked (Oct 22 2026) to rebuild the axHub web app with the framework, its look and layout matching the Dev Console
and Patches, and to harvest libraries out of it. He chose that the AXF app serves the hub's UI (decision of Oct 22 2026:
`apps/axhub-web` is the page at `axhub.amberxai.com/`, the hub server keeps its API and wall and has no AXF code; the
serving itself landed in PR #36, `claude/axhub-web-on-hub`). On Oct 23 he chose to **keep the side nav and toolbar on
screen** (the console hides both); everything else follows the console.
