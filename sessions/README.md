# sessions/

Session check-in archive (`session-log@1`, one JSON file per session, `sessions/<YYYY>/<MM>/<id>.json`), written by the
Session check-in plugin (`apps/console-web/plugins/session-checkin`).

The main copy is on the hub at `/projects/amberx-axf/_data/sessions/` (this folder is in the root manifest's
`data.shared`, so `claude-sync` and `persist.mjs` keep both copies in step). Sessions that can't reach the hub (cloud
containers, laptops) write here instead; commit the new files so they reach the archive.

Browse it in the Dev Console → Plugins → **Sessions**, or `node apps/console-web/plugins/session-checkin/checkin.mjs list`.
Records never contain tokens, keys, memory contents or message text.
