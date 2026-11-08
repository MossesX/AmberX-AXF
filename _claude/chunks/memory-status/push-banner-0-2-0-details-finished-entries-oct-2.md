<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=129-129 tokens=177 -->
## Status (as of Oct 21 2026)

- **Push banner 0.2.0: details + finished entries (Oct 22 2026, Opus):** tap an entry's title for its details (`GET /detail?repo=&number=|branch=`: newest 20 commits, every check run on its head with links, GitHub's merge state, files changed, PR text). A successful **Merge** or **Pull main in** is remembered server-side (`done.json`, every device, 7 days) and shows in a **Done** group at the top (it leaves the other groups) with a **trash can**: `POST /done/remove {key, sha?}` forgets it and, when the entry is still open on GitHub, hides it as `<key>@<head sha>`: back on its next commit (hidden entries may carry `@sha`). `test.py` 54. <!-- axf-plugin:push-banner -->
