# changes/

Codebase changes log (`change-log@1`, one JSON file per entry, `changes/<YYYY>/<MM>/<id>.json`): every request to Claude
to build, edit, remove or fix something, with what was asked, its steps and its result. Written by the console's
Codebase changes plugin and its `changes.mjs` CLI / Claude Code hook.

The main copy is on the hub at `/projects/amberx-axf/_data/changes/` (this folder is in the root manifest's
`data.shared`, so `claude-sync` and `persist.mjs` keep both copies in step). Sessions that can't reach the hub or the
console write here with `--to-repo`; commit the new files so they reach the log.

Browse it in the Dev Console → Builds → **Codebase changes**. It is Brett's permanent record: uninstalling the plugin
never deletes it. Entries never contain tokens or keys (secret-looking text is hidden before it's written).
