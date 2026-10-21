# session-archive@1

One file per Claude session on Brett's projects: `<YYYY>/<MM>/<id>.json` (`cc-<Claude Code session id>`,
`ai-<claude.ai chat id>`), with what ran it, every prompt with its tokens and cost, the files, change entries and
features it touched. Live copy on the hub (`/projects/amberx-axf/_data/sessions/archive/`); this folder is the seed.
Written by `framework/cli/session-archive.mjs` (its Claude Code hook archives every session on Stop / SessionEnd);
browse it in the console: Builds → Build manager → Sessions.
