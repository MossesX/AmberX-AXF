<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=51-51 tokens=97 -->
## Oct 20 2026 — App catalog on axHub (app-catalog@1)

- Every Android app built with the framework is built by CI and listed with download links on the hub (`/apps`). CI publishes `app-bundle@1`; the console files it as `app-catalog@1` in `/projects/_shared/_data/app-catalog` (last 3 builds per app); the hub only reads it (axHub decision #86). Admins, or users with `apps.download`.
