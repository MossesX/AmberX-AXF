<!-- memory-chunk@1 source=_claude/THREADS.md lines=135-135 tokens=211 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| UI Review: one schema (review-schema, headless VPS, Opus): everything in UI Review (queue + Screenshots, any source) is `ui-review-item@1` / `ui-review-group@1` — name, group, createdAt, kind, source, sender, app, screen, viewport, files, status; every intake refuses missing fields by name (API, multipart/Upload, review.mjs, shot.mjs, rebuild-shots --submit, ui-review@1.submit, Send to review); stores validate on every write; migration (dry run → apply, server runs it on start); CI `check-ui-review.mjs`; shared rule line | done (tests green) | `claude/review-schema` → main | — | UI Review r-20261101-b57bz01 waiting. Report `_claude/builds/reports/review-schema.md`. Live data migrates when the new console starts (dry run: 17 records, 0 left) | 2026-11-01 |
